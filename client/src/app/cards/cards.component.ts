import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CardService, FetchError } from '../services/card.service';
import { CardItem } from '../models/card.model';
import { BehaviorSubject, finalize, switchMap } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmCategoryDialogComponent, ConfirmCategoryDialogResult } from './confirm-category-dialog.component';

interface PieSegment {
  num: string; total: number; color: string; path: string;
  inside: boolean; labelX: number; labelY: number; labelColor: string; textAnchor: string;
  leaderPoints?: string;
}

@Component({
  selector: 'app-cards',
  templateUrl: './cards.component.html',
  styleUrls: ['./cards.component.css']
})
export class CardsComponent implements OnInit {
  isLoading$ = new BehaviorSubject<boolean>(false);
  displayedColumns = ['num', 'date', 'amount', 'originalAmount', 'desc', 'memo', 'category'];
  // a parallel header row, one filter input per column — matColumnDef names
  // must be unique across the whole table, hence the suffix, not a reuse
  // of displayedColumns
  filterColumns = ['numFilter', 'dateFilter', 'amountFilter', 'originalAmountFilter', 'descFilter', 'memoFilter', 'categoryFilter'];
  headers = ['Card Number', 'Date', 'Amount', 'Original Amount', 'Description', 'Comments', 'Category'];
  // mirrors server/services/categorize.js's CATEGORIES — kept in sync by hand
  // since client/server don't share a package
  readonly CATEGORIES = [
    'ביגוד', 'בילויים', 'סופר', 'בריאות ושיניים', 'ביטוח', 'תחבורה',
    'עירייה וממשלה', 'תקשורת', 'חשבונות בית', 'טיפוח וכושר', 'חיות מחמד', 'חצר וגינה', 'החזרים', 'חופשה', 'ילדים', 'שונות',
  ];
  // reimbursements count toward every total like any other transaction, but
  // get a lighter row color in the table so they're still visually called out
  readonly REIMBURSEMENT_CATEGORY = 'החזרים';
  cardsData!: MatTableDataSource<CardItem>;
  private _sort?: MatSort;
  @ViewChild(MatSort) set sort(sort: MatSort | undefined) {
    this._sort = sort;
    if (sort && this.cardsData) {
      this.cardsData.sort = sort;
    }
  }
  get sort(): MatSort | undefined {
    return this._sort;
  }
  @ViewChild('cardsTableEl') cardsTableEl?: ElementRef<HTMLElement>;
  selectedCards$ = new BehaviorSubject<string[]>([]);
  fetchErrors$: BehaviorSubject<FetchError[]>;
  allCards: string[] = [];
  selectAllChkBox = true;
  totalCost: number = 0;
  searchObj = {
    columns: { num: '', date: '', amount: '', originalAmount: '', desc: '', memo: '', category: '' },
    cards: [] as string[],
    dates: { start: '', end: '' }
  };
  start_date = '';
  end_date = '';
  showingFuture = false;

  // null until the user actually drags the splitter — before that, the
  // table stays content-sized (its existing flex:0 1 auto behavior)
  tableWidthPx: number | null = null;
  private readonly TABLE_WIDTH_STORAGE_KEY = 'cardsTableWidthPx';
  private readonly MIN_TABLE_WIDTH = 300;
  private readonly MIN_CHART_WIDTH = 280;

  // categorical palette, fixed order — a card (or category) keeps its slot
  // for the whole session regardless of filtering, so color always means
  // the same card/category
  private readonly CARD_PALETTE = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
    '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  ];
  private cardColors = new Map<string, string>();
  // categories are a known fixed list, so colors can be assigned upfront
  // rather than lazily like cardColors (card numbers aren't known upfront)
  private readonly categoryColors = new Map<string, string>(
    this.CATEGORIES.map((c, i) => [c, this.CARD_PALETTE[i % this.CARD_PALETTE.length]])
  );
  private readonly UNCATEGORIZED = 'לא מסווג';
  private readonly UNCATEGORIZED_COLOR = '#898781';

  chartSegments: PieSegment[] = [];
  categoryChartSegments: PieSegment[] = [];

  constructor(
    private cardService: CardService,
    private dialog: MatDialog
  ) {
    this.fetchErrors$ = this.cardService.fetchErrors$;
  }

  // a genuinely new session (no saved filter) needs its default cycle
  // picked only once real data has loaded — see hasRealDataForNextCycle
  private needsDefaultCycle = false;

  ngOnInit(): void {
    this.restoreTableWidth();
    // a page refresh should keep whatever the user was looking at, not
    // reset to the default billing cycle — only genuinely new sessions
    // (no saved state yet) get the default
    this.needsDefaultCycle = !this.restoreFilterState();
    this.buildMonthOptions();
    this.loadHistory();
  }

  fetchData() {
    this.isLoading$.next(true);
    this.cardService.triggerScrape(30, 1).pipe(
      switchMap(() => this.cardService.getTransactions()),
      finalize(() => this.isLoading$.next(false))
    ).subscribe({
      next: (cards: CardItem[]) => this.applyCards(cards),
      error: (err: any) => {
        console.error('fetchData failed:', err);
        this.fetchErrors$.next([{ company: 'request', message: err?.message || 'Request to the server failed' }]);
      }
    });
  }

  private loadHistory() {
    this.isLoading$.next(true);
    this.cardService.getTransactions().pipe(
      finalize(() => this.isLoading$.next(false))
    ).subscribe({
      next: (cards: CardItem[]) => this.applyCards(cards),
      error: (err: any) => {
        console.error('loadHistory failed:', err);
        this.fetchErrors$.next([{ company: 'request', message: err?.message || 'Request to the server failed' }]);
      }
    });
  }

  private applyCards(cards: CardItem[]) {
    console.log('cards:', cards);
    this.cardsData = new MatTableDataSource(cards);
    if (this.sort) {
      this.cardsData.sort = this.sort;
    }
    this.cardsData.filterPredicate = this.setFilter();
    const previousAllCards = this.allCards;
    this.allCards = this.cardService.cardNumbers$.value;
    this.ensureCardColors();
    if (!this.searchObj.cards.length) {
      this.searchObj.cards = [...this.allCards];
      // deferred: emitting synchronously here lands in the same CD cycle as
      // the rest of this method's updates, and mat-form-field's derived
      // hide-placeholder state ends up one tick behind its own ngModel value,
      // which Angular's dev-mode re-check flags as NG0100 and aborts the
      // render of everything after this field in the template (the whole
      // table). Pushing it to the next cycle avoids that self-collision.
      setTimeout(() => this.selectedCards$.next([...this.allCards]));
    } else {
      // a card that wasn't available before (e.g. its login had been failing)
      // should show up by default rather than staying silently excluded
      const newlySeen = this.allCards.filter((c: string) => !previousAllCards.includes(c));
      if (newlySeen.length) {
        this.searchObj.cards = [...this.searchObj.cards, ...newlySeen];
      }
      // always resync (not just when newlySeen is non-empty) — a restored
      // filter (see restoreFilterState) lands here on a fresh component
      // instance where selectedCards$ was never populated at all
      setTimeout(() => this.selectedCards$.next([...this.searchObj.cards]));
      this.syncSelectAllChkBox();
    }
    if (cards.length) {
      this.start_date = new Date(Math.min(...cards.map((c: CardItem) =>
        new Date(c.date).getTime()))).toISOString().split('T')[0];
      this.end_date = new Date(Math.max(...cards.map((c: CardItem) =>
        new Date(c.date).getTime()))).toISOString().split('T')[0];
    }
    // full history, not the current filter — a trend needs more than the
    // single cycle the pies are scoped to, so this only needs recomputing
    // when the underlying data changes, not on every filter tweak
    this.buildMonthlyTotals(cards);
    if (this.needsDefaultCycle) {
      this.needsDefaultCycle = false;
      this.setPreviousMonthFilter(cards);
    }
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  calculateTotal() {
    this.totalCost = this.cardsData.filteredData
      .reduce((a: number, v: CardItem) => a + v.amount, 0);
    this.projectedTotal = this.calculateProjection();
    this.buildChartData();
  }

  projectedTotal: number | null = null;
  projectionTooltip = '';

  // matches "תשלום N מתוך M" / "תשלום N מ M" anywhere in the memo (the same
  // installment-counter format already normalized for dedup elsewhere) —
  // null for a transaction that isn't part of an installment plan at all
  private getInstallmentNumber(memo: string): number | null {
    const match = (memo || '').match(/תשלום\s*(\d+)\s*(?:מתוך|מ)\s*\d+/);
    return match ? parseInt(match[1], 10) : null;
  }

  // only meaningful while viewing the cycle that's still actually in
  // progress (the one containing today) — a past cycle is already final,
  // a custom range or "future" has no fixed end to prorate against
  private calculateProjection(): number | null {
    this.projectionTooltip = '';
    const anchor = this.getListAnchorMonth();
    const { start, end } = this.cycleBoundsForStartMonth(anchor.month, anchor.year);
    if (this.searchObj.dates.start !== start || this.searchObj.dates.end !== end) {
      return null;
    }

    // transactions typically take ~2 days to clear, so "today" overstates
    // how much of the cycle we actually have complete data for — both the
    // elapsed-days count and the base cutoff use this adjusted reference
    // point instead (installments are pre-scheduled, not subject to this lag)
    const effectiveToday = new Date();
    effectiveToday.setDate(effectiveToday.getDate() - 2);
    const today = this.formatLocalDate(effectiveToday);
    const daysInCycle = this.daysBetween(start, end) + 1;
    const daysElapsed = this.daysBetween(start, today) + 1;
    if (daysElapsed <= 0) return null;

    let base = 0;
    let laterInstallments = 0;
    for (const row of this.cardsData.filteredData) {
      const installmentNum = this.getInstallmentNumber(row.memo);
      if (installmentNum !== null && installmentNum > 1) {
        // a fixed, already-known amount regardless of date — counted once,
        // not scaled by how much of the month has elapsed
        laterInstallments += row.amount;
      } else if (row.date <= today) {
        // actual spend to date only — the part that gets extrapolated
        base += row.amount;
      }
    }
    const extrapolatedBase = base * daysInCycle / daysElapsed;
    const total = extrapolatedBase + laterInstallments;
    this.projectionTooltip =
      `Day ${daysElapsed} of ${daysInCycle}\n` +
      `Base so far (non/first-installment): ${base.toFixed(2)}\n` +
      `Extrapolated base: ${extrapolatedBase.toFixed(2)}\n` +
      `Later installments (fixed): ${laterInstallments.toFixed(2)}`;
    return total;
  }

  private daysBetween(startIso: string, endIso: string): number {
    return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86400000);
  }

  private ensureCardColors() {
    for (const num of this.allCards) {
      if (!this.cardColors.has(num)) {
        this.cardColors.set(num, this.CARD_PALETTE[this.cardColors.size % this.CARD_PALETTE.length]);
      }
    }
  }

  private cardColor(num: string): string {
    if (!this.cardColors.has(num)) {
      this.cardColors.set(num, this.CARD_PALETTE[this.cardColors.size % this.CARD_PALETTE.length]);
    }
    return this.cardColors.get(num)!;
  }

  // plain SVG pie — no chart library needed. Slices use each card's fixed
  // color (see CARD_PALETTE/cardColors) so identity stays stable as the
  // user filters; only the slice sizes change. Viewbox leaves margin around
  // the circle for thin slices' labels to sit outside with a leader line.
  // Card numbers are short (4 digits), so a tight margin fits; category
  // names ("עירייה וממשלה") are much longer and the category chart can have
  // many more thin slices at once (dominated by "לא מסווג"), so it gets a
  // roomier coordinate space — same on-screen circle size (CSS controls
  // that), just more internal units for long outside-label text to use
  // before hitting the edge.
  private readonly PIE_GEO = { center: 120, radius: 96 };
  private readonly PIE_GEO_CATEGORY = { center: 170, radius: 110 };

  private point(angleDeg: number, r: number, center: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: center + r * Math.sin(rad),
      y: center - r * Math.cos(rad),
    };
  }

  private arcPath(startAngle: number, endAngle: number, center: number, radius: number): string {
    const p1 = this.point(startAngle, radius, center);
    const p2 = this.point(endAngle, radius, center);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${center} ${center} L ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
  }

  // a label sitting inside a colored fill needs white-or-ink chosen by that
  // fill's luminance, not a fixed color — several palette slots (yellow,
  // aqua, magenta) are too light for white text to stay legible
  private labelColorFor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? '#0b0b0b' : '#ffffff';
  }

  private buildChartData() {
    this.chartSegments = this.buildPieSegments(
      row => row.num, num => this.cardColor(num), this.PIE_GEO
    );
    this.categoryChartSegments = this.buildPieSegments(
      row => row.category || this.UNCATEGORIZED,
      key => key === this.UNCATEGORIZED ? this.UNCATEGORIZED_COLOR : (this.categoryColors.get(key) || this.UNCATEGORIZED_COLOR),
      this.PIE_GEO_CATEGORY
    );
  }

  private buildPieSegments(
    keyFn: (row: CardItem) => string,
    colorFn: (key: string) => string,
    geo: { center: number; radius: number }
  ): PieSegment[] {
    const { center, radius } = geo;
    const sums = new Map<string, number>();
    for (const row of this.cardsData.filteredData) {
      const key = keyFn(row);
      sums.set(key, (sums.get(key) || 0) + row.amount);
    }
    const entries = Array.from(sums.entries())
      .filter(([, total]) => total > 0)
      .map(([num, total]) => ({ num, total, color: colorFn(num) }))
      .sort((a, b) => b.total - a.total);

    const sumTotal = entries.reduce((a, e) => a + e.total, 0);
    if (!entries.length || sumTotal <= 0) {
      return [];
    }

    const gapDeg = entries.length > 1 ? 1.5 : 0;
    let cumulative = 0;
    const built = entries.map(e => {
      const startAngle = cumulative;
      const rawEnd = cumulative + (e.total / sumTotal) * 360;
      // a lone 100% slice needs a near-full sweep, not a zero-length arc
      const endAngle = entries.length === 1 ? 359.99 : Math.max(startAngle, rawEnd - gapDeg);
      cumulative = rawEnd;
      const mid = (startAngle + endAngle) / 2;
      const path = this.arcPath(startAngle, endAngle, center, radius);
      // a slice this thin can't fit a two-line label inside without
      // overlapping its neighbors — give it an outside label on a leader
      // line instead of hiding it
      const inside = endAngle - startAngle >= 22;
      return { e, path, inside, mid };
    });

    // two thin slices can sit only ~15° apart (their true angle), which
    // isn't enough room for two-line labels at this radius without their
    // text overlapping — the earlier label's text occupies more angular
    // width than the gap between slices. Force a wider minimum gap between
    // consecutive outside labels' angle so the later one swings further
    // around; the leader line's start stays pinned to the slice's true edge.
    const MIN_LABEL_GAP = 28;
    let prevLabelAngle: number | null = null;
    return built.map(({ e, path, inside, mid }) => {
      if (inside) {
        const labelPt = this.point(mid, radius * 0.58, center);
        return {
          ...e, path, inside,
          labelX: labelPt.x, labelY: labelPt.y,
          labelColor: this.labelColorFor(e.color),
          textAnchor: 'middle',
        };
      }

      const labelAngle = prevLabelAngle === null ? mid : Math.max(mid, prevLabelAngle + MIN_LABEL_GAP);
      prevLabelAngle = labelAngle;

      const edgePt = this.point(mid, radius, center);
      const stubPt = this.point(labelAngle, radius + 7, center);
      const rightSide = stubPt.x >= center;
      const elbowPt = { x: stubPt.x + (rightSide ? 9 : -9), y: stubPt.y };
      return {
        ...e, path, inside,
        labelX: elbowPt.x + (rightSide ? 3 : -3), labelY: elbowPt.y,
        labelColor: '#0b0b0b',
        textAnchor: rightSide ? 'start' : 'end',
        leaderPoints: `${edgePt.x},${edgePt.y} ${stubPt.x},${stubPt.y} ${elbowPt.x},${elbowPt.y}`,
      };
    });
  }

  onColumnFilterChange() {
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  selectAll() {
    if (this.selectAllChkBox) {
      this.selectedCards$.next([...this.allCards]);
      this.searchObj.cards = [...this.allCards];
    } else {
      this.selectedCards$.next([]);
      this.searchObj.cards = [];
    }
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  updateSelected(e: string[]) {
    this.selectedCards$.next(e);
    this.searchObj.cards = e;
    this.syncSelectAllChkBox();
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  // a raw length comparison breaks if a card drops out of allCards (e.g. its
  // scrape failed this round) while still sitting in searchObj.cards — check
  // should still be checked whenever every *currently available* card is selected
  private syncSelectAllChkBox() {
    this.selectAllChkBox = this.allCards.length > 0 &&
      this.allCards.every((c: string) => this.searchObj.cards.includes(c));
  }

  clearFilters() {
    this.searchObj.columns = { num: '', date: '', amount: '', originalAmount: '', desc: '', memo: '', category: '' };
    this.searchObj.dates.start = '';
    this.searchObj.dates.end = '';
    this.searchObj.cards = [...this.allCards];
    this.selectedCards$.next([...this.allCards]);
    this.selectAllChkBox = true;
    this.showingFuture = false;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  selectMonth(opt: { label: string; month?: number; year?: number; isFuture?: boolean }) {
    if (opt.isFuture) {
      this.setFutureOnlyFilter();
    } else {
      const { start, end } = this.cycleBoundsForStartMonth(opt.month!, opt.year!);
      this.searchObj.dates.start = start;
      this.searchObj.dates.end = end;
      this.showingFuture = false;
    }
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  private setPreviousMonthFilter(cards: CardItem[] = this.cardsData?.data || []) {
    const { start, end } = this.getBillingCycleBounds(cards);
    this.searchObj.dates.start = start;
    this.searchObj.dates.end = end;
  }

  // strictly future-dated transactions only — anything dated today or
  // earlier is excluded, not just "from the current cycle's start onward"
  private setFutureOnlyFilter() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.searchObj.dates.start = this.formatLocalDate(tomorrow);
    this.searchObj.dates.end = '';
    this.showingFuture = true;
  }

  // the default billing cycle is normally named after today's calendar month
  // (cycles are named by their closing month — see cycleLabel), e.g. any day
  // in October defaults to the "October" cycle (13-Sep to 12-Oct) — *unless*
  // real transactions have already posted into the next cycle's window (see
  // hasRealDataForNextCycle), which means the statement has actually started
  // and the default should follow it instead of staying pinned to last month.
  private getCurrentCycleStartMonth(cards: CardItem[] = []): { month: number; year: number } {
    const now = new Date();
    let month = now.getMonth() - 1;
    let year = now.getFullYear();
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    if (this.hasRealDataForNextCycle(cards)) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return { month, year };
  }

  // true once an actual (non-future) transaction has landed on or after the
  // 13th of this calendar month — the start of the next-named cycle's window.
  // Before the 13th this range is empty by construction, so no explicit
  // day-of-month check is needed; guards against far-future installment rows
  // (scrapers can return those months ahead) counting as "real" activity.
  private hasRealDataForNextCycle(cards: CardItem[]): boolean {
    const today = new Date();
    const cutoverStr = this.formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 13));
    const todayStr = this.formatLocalDate(today);
    return cards.some((c: CardItem) => c.date >= cutoverStr && c.date <= todayStr);
  }

  // the dropdown list offers the next cycle as soon as it's conceptually
  // valid (we've passed the 13th), even before any real transaction has
  // posted to it — unlike the default selection above, which waits for data
  private getListAnchorMonth(): { month: number; year: number } {
    const now = new Date();
    let month = now.getMonth() - 1;
    let year = now.getFullYear();
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    if (now.getDate() >= 13) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return { month, year };
  }

  // a cycle runs from the 13th of its start month through the 12th of the
  // following month — exactly one calendar month, no overlap with the next
  // cycle (which starts the very next day, the 13th)
  private cycleBoundsForStartMonth(month: number, year: number): { start: string; end: string } {
    const start = this.formatLocalDate(new Date(year, month, 13));
    let endMonth = month + 1;
    let endYear = year;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    const end = this.formatLocalDate(new Date(endYear, endMonth, 12));
    return { start, end };
  }

  private getBillingCycleBounds(cards: CardItem[] = []): { start: string; end: string } {
    const { month, year } = this.getCurrentCycleStartMonth(cards);
    return this.cycleBoundsForStartMonth(month, year);
  }

  private readonly MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  monthOptions: { label: string; month?: number; year?: number; isFuture?: boolean }[] = [];

  // the card company names a cycle by the month it closes in, not the month
  // it starts in — a 13-Sep-to-12-Oct cycle is "the October cycle"
  private cycleLabel(startMonth: number, startYear: number): string {
    let endMonth = startMonth + 1;
    let endYear = startYear;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    return `${this.MONTH_NAMES[endMonth]} ${endYear}`;
  }

  private buildMonthOptions(count = 12) {
    let { month, year } = this.getListAnchorMonth();
    const options: { label: string; month?: number; year?: number; isFuture?: boolean }[] = [
      { label: 'Future transactions', isFuture: true },
    ];
    for (let i = 0; i < count; i++) {
      options.push({ label: this.cycleLabel(month, year), month, year });
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    this.monthOptions = options;
  }

  monthlyTotals: { label: string; total: number; heightPct: number; color: string }[] = [];

  private buildMonthlyTotals(cards: CardItem[], maxBars = 12) {
    const sums = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const row of cards) {
      const d = new Date(row.date);
      let month = d.getMonth();
      let year = d.getFullYear();
      if (d.getDate() < 13) {
        month -= 1;
        if (month < 0) {
          month = 11;
          year -= 1;
        }
      }
      let endMonth = month + 1;
      let endYear = year;
      if (endMonth > 11) {
        endMonth = 0;
        endYear += 1;
      }
      const key = `${endYear}-${String(endMonth + 1).padStart(2, '0')}`;
      sums.set(key, (sums.get(key) || 0) + row.amount);
      if (!labels.has(key)) {
        labels.set(key, `${this.MONTH_NAMES[endMonth].slice(0, 3)} ${String(endYear).slice(-2)}`);
      }
    }

    const recentKeys = Array.from(sums.keys()).sort().slice(-maxBars);
    const maxTotal = Math.max(...recentKeys.map(k => sums.get(k)!), 1);
    // a sequential ramp (one hue, light-to-dark), not arbitrary categorical
    // colors — the bars are a chronological series, not independent
    // categories, so color should encode "earlier vs later", oldest lightest
    const n = Math.max(recentKeys.length - 1, 1);
    this.monthlyTotals = recentKeys.map((k, i) => ({
      label: labels.get(k)!,
      total: sums.get(k)!,
      heightPct: Math.max(2, (sums.get(k)! / maxTotal) * 100),
      color: `hsl(212, 65%, ${72 - (i / n) * 35}%)`,
    }));
  }

  private formatLocalDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  applyFilter(filter: string) {
    this.cardsData.filter = filter;
    this.calculateTotal();
    this.saveFilterState();
  }

  private readonly FILTER_STORAGE_KEY = 'cardsFilterState';

  // sessionStorage, not localStorage — "keep it across a refresh" scoped to
  // this tab/session, not "remember forever" across separate visits
  private saveFilterState() {
    try {
      sessionStorage.setItem(this.FILTER_STORAGE_KEY, JSON.stringify({
        searchObj: this.searchObj,
        showingFuture: this.showingFuture,
      }));
    } catch {
      // private browsing / storage disabled — just skip persistence
    }
  }

  private restoreFilterState(): boolean {
    try {
      const raw = sessionStorage.getItem(this.FILTER_STORAGE_KEY);
      if (!raw) return false;
      const { searchObj, showingFuture } = JSON.parse(raw);
      // a previous session's saved shape (e.g. from before per-column
      // filters existed) would otherwise crash setFilter() on first run
      if (!searchObj?.columns || !searchObj?.dates || !Array.isArray(searchObj?.cards)) return false;
      this.searchObj = searchObj;
      this.showingFuture = !!showingFuture;
      return true;
    } catch {
      return false;
    }
  }

  startResize(event: MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.cardsTableEl?.nativeElement.getBoundingClientRect().width
      ?? this.tableWidthPx ?? this.MIN_TABLE_WIDTH;
    const handle = event.currentTarget as HTMLElement;
    handle.classList.add('resizing');

    const onMove = (e: MouseEvent) => {
      const maxWidth = window.innerWidth - this.MIN_CHART_WIDTH - 60;
      this.tableWidthPx = Math.min(
        Math.max(startWidth + (e.clientX - startX), this.MIN_TABLE_WIDTH),
        maxWidth
      );
    };
    const onUp = () => {
      handle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.saveTableWidth();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private saveTableWidth() {
    if (this.tableWidthPx == null) return;
    try {
      sessionStorage.setItem(this.TABLE_WIDTH_STORAGE_KEY, String(this.tableWidthPx));
    } catch {
      // private browsing / storage disabled — just skip persistence
    }
  }

  private restoreTableWidth() {
    try {
      const raw = sessionStorage.getItem(this.TABLE_WIDTH_STORAGE_KEY);
      if (!raw) return;
      const width = parseInt(raw, 10);
      if (Number.isFinite(width)) this.tableWidthPx = width;
    } catch {
      // ignore
    }
  }

  setFilter() {
    // the predicate runs once per row, but MatTableDataSource passes the same
    // filter string each time — cache the parsed version instead of re-parsing
    // (and re-stringifying every row) on every single row, every filter change
    let cachedFilterStr: string | null = null;
    let cachedSearch: any = null;
    return (data: CardItem, filter: string) => {
      if (filter !== cachedFilterStr) {
        cachedFilterStr = filter;
        cachedSearch = JSON.parse(filter);
      }
      const search = cachedSearch;
      const cols = search.columns;
      // desc/memo/category can be null in the DB — .toLowerCase() on null
      // throws, which silently breaks the whole filter, not just that row
      const matchCol = (value: any, key: string) => {
        const q = (cols[key] || '').toLowerCase();
        return q === '' || String(value ?? '').toLowerCase().includes(q);
      };
      const matchColumns =
        matchCol(data.num, 'num') &&
        matchCol(data.date, 'date') &&
        matchCol(data.amount, 'amount') &&
        matchCol(data.originalAmount, 'originalAmount') &&
        matchCol(data.desc, 'desc') &&
        matchCol(data.memo, 'memo') &&
        matchCol(data.category, 'category');
      const matchCards = search.cards.includes(data.num);
      const matchDate = (search.dates.start === '' || data.date >= search.dates.start) &&
        (search.dates.end === '' || data.date <= search.dates.end);
      return matchCards && matchColumns && matchDate;
    }
  }

  downloadCSV() {
    const csvData = this.tableToCSV();
    console.log('csvData:', csvData.slice(0, 20));
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.downloadFilename();
    console.log('downloadLink:', url);
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // reflects whatever's currently filtered/displayed — a billing-cycle label
  // when the active date range matches one exactly, falling back to the raw
  // range (or "future"/"all") otherwise
  private downloadFilename(): string {
    if (this.showingFuture) return 'transactions_future.csv';
    const { start, end } = this.searchObj.dates;
    if (start && end) {
      const match = this.monthOptions.find(opt => {
        if (opt.isFuture) return false;
        const bounds = this.cycleBoundsForStartMonth(opt.month!, opt.year!);
        return bounds.start === start && bounds.end === end;
      });
      if (match) return `transactions_${match.label.replace(/\s+/g, '_')}.csv`;
      return `transactions_${start}_to_${end}.csv`;
    }
    return 'transactions_all.csv';
  }

  tableToCSV(): string {
    let csvData = [[...this.headers]];
    // the current view, not every row — matches what's actually on screen
    this.cardsData.filteredData.forEach(rowObj => {
      // was Object.values(rowObj) — relied on the object's own key order
      // matching headers exactly, which broke once CardItem gained fields
      // (identifier) that aren't displayed/exported columns
      csvData.push(this.displayedColumns.map(col => (rowObj as any)[col]));
    });
    return csvData.join('\n');
  }

  private normalizeDesc(s: string): string {
    return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  updateCategory(row: CardItem, category: string) {
    const target = this.normalizeDesc(row.desc);
    const otherRows = this.cardsData.data.filter(r => r !== row);
    const hasMatchingDesc = otherRows.some(r => this.normalizeDesc(r.desc) === target);

    // the same merchant can serve two different real purposes (e.g. a
    // supermarket run for home vs. a work-reimbursed purchase) — don't
    // silently recategorize everything sharing this description unless asked
    if (hasMatchingDesc) {
      this.dialog.open(ConfirmCategoryDialogComponent, {
        data: { desc: row.desc, amount: row.amount, num: row.num, otherRows },
        width: '420px',
      }).afterClosed().subscribe((result: ConfirmCategoryDialogResult | undefined) => {
        // dismissed (backdrop/escape) without choosing — do nothing
        if (result === undefined) return;
        this.applyCategory(row, category, result);
      });
    } else {
      this.applyCategory(row, category, { applyToAll: false, sameAmount: false, sameCard: false });
    }
  }

  private applyCategory(row: CardItem, category: string, { applyToAll, sameAmount, sameCard }: ConfirmCategoryDialogResult) {
    const previous = row.category;
    row.category = category; // optimistic, for instant feedback on the row just clicked
    const onDone = {
      // other rows may have been updated server-side too — reload so the
      // whole table reflects it, not just this row
      next: () => this.loadHistory(),
      error: (err: any) => {
        console.error('updateCategory failed:', err);
        row.category = previous;
      }
    };
    if (applyToAll) {
      const criteria: { desc: string; amount?: number; num?: string } = { desc: row.desc };
      if (sameAmount) criteria.amount = row.amount;
      if (sameCard) criteria.num = row.num;
      this.cardService.setCategoryByCriteria(criteria, category).subscribe(onDone);
    } else {
      this.cardService.setCategory(row.num, row.identifier, category).subscribe(onDone);
    }
  }

}
