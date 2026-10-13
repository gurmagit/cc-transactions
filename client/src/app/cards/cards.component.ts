import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CardService, FetchError } from '../services/card.service';
import { CardItem } from '../models/card.model';
import { BehaviorSubject, finalize, switchMap } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';

@Component({
  selector: 'app-cards',
  templateUrl: './cards.component.html',
  styleUrls: ['./cards.component.css']
})
export class CardsComponent implements OnInit, AfterViewInit {
  isLoading$ = new BehaviorSubject<boolean>(false);
  displayedColumns = ['num', 'date', 'amount', 'originalAmount', 'desc', 'memo'];
  headers = ['Card Number', 'Date', 'Amount', 'Original Amount', 'Description', 'Comments'];
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
  @ViewChild('search') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('startDate') startDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('endDate') endDateInput?: ElementRef<HTMLInputElement>;
  selectedCards$ = new BehaviorSubject<string[]>([]);
  fetchErrors$: BehaviorSubject<FetchError[]>;
  allCards: string[] = [];
  selectAllChkBox = true;
  totalCost: number = 0;
  searchObj = {
    wildcard: '',
    cards: [] as any,
    dates: { start: '', end: '' }
  };
  start_date = '';
  end_date = '';
  showingFuture = false;

  // categorical palette, fixed order — a card keeps its slot for the whole
  // session regardless of filtering, so color always means the same card
  private readonly CARD_PALETTE = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
    '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  ];
  private cardColors = new Map<string, string>();
  chartSegments: {
    num: string; total: number; color: string; path: string;
    inside: boolean; labelX: number; labelY: number; labelColor: string; textAnchor: string;
    leaderPoints?: string;
  }[] = [];

  constructor(
    private cardService: CardService
  ) {
    this.fetchErrors$ = this.cardService.fetchErrors$;
  }

  ngOnInit(): void {
    this.setPreviousMonthFilter();
    this.loadHistory();
  }

  ngAfterViewInit(): void {
    // deferred: mutating the date inputs synchronously here, during the
    // initial view-check cycle, makes mat-form-field's derived
    // hide-placeholder state change after Angular already checked it —
    // NG0100, which aborts rendering everything else in the template
    setTimeout(() => this.reflectDateFilterInputs());
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
        setTimeout(() => this.selectedCards$.next([...this.selectedCards$.value, ...newlySeen]));
      }
    }
    if (cards.length) {
      this.start_date = new Date(Math.min(...cards.map((c: CardItem) =>
        new Date(c.date).getTime()))).toISOString().split('T')[0];
      this.end_date = new Date(Math.max(...cards.map((c: CardItem) =>
        new Date(c.date).getTime()))).toISOString().split('T')[0];
    }
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  calculateTotal() {
    this.totalCost = this.cardsData.filteredData.reduce((a: number, v: any) => a + v.amount, 0);
    this.buildChartData();
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
  private readonly PIE_CENTER = 120;
  private readonly PIE_RADIUS = 96;

  private point(angleDeg: number, r: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: this.PIE_CENTER + r * Math.sin(rad),
      y: this.PIE_CENTER - r * Math.cos(rad),
    };
  }

  private arcPath(startAngle: number, endAngle: number): string {
    const p1 = this.point(startAngle, this.PIE_RADIUS);
    const p2 = this.point(endAngle, this.PIE_RADIUS);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${this.PIE_CENTER} ${this.PIE_CENTER} L ${p1.x} ${p1.y} A ${this.PIE_RADIUS} ${this.PIE_RADIUS} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
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
    const sums = new Map<string, number>();
    for (const row of this.cardsData.filteredData) {
      sums.set(row.num, (sums.get(row.num) || 0) + row.amount);
    }
    const entries = Array.from(sums.entries())
      .filter(([, total]) => total > 0)
      .map(([num, total]) => ({ num, total, color: this.cardColor(num) }))
      .sort((a, b) => b.total - a.total);

    const sumTotal = entries.reduce((a, e) => a + e.total, 0);
    if (!entries.length || sumTotal <= 0) {
      this.chartSegments = [];
      return;
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
      const path = this.arcPath(startAngle, endAngle);
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
    this.chartSegments = built.map(({ e, path, inside, mid }) => {
      if (inside) {
        const labelPt = this.point(mid, this.PIE_RADIUS * 0.58);
        return {
          ...e, path, inside,
          labelX: labelPt.x, labelY: labelPt.y,
          labelColor: this.labelColorFor(e.color),
          textAnchor: 'middle',
        };
      }

      const labelAngle = prevLabelAngle === null ? mid : Math.max(mid, prevLabelAngle + MIN_LABEL_GAP);
      prevLabelAngle = labelAngle;

      const edgePt = this.point(mid, this.PIE_RADIUS);
      const stubPt = this.point(labelAngle, this.PIE_RADIUS + 7);
      const rightSide = stubPt.x >= this.PIE_CENTER;
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
    this.selectAllChkBox = (this.selectedCards$.value.length === this.allCards.length)
    console.log('e:', e, this.searchObj);
    this.searchObj.cards = e;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  searchFilter(e: any) {
    console.log('e:', e.target.value);
    // this.applyFilter(this.searchKey.trim().toLowerCase());
    this.searchObj.wildcard = e.target.value;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  clearFilters() {
    this.searchObj.wildcard = '';
    this.searchObj.dates.start = '';
    this.searchObj.dates.end = '';
    this.searchObj.cards = [...this.allCards];
    this.selectedCards$.next([...this.allCards]);
    this.selectAllChkBox = true;
    if (this.searchInput) this.searchInput.nativeElement.value = '';
    this.setDateInputValue(this.startDateInput, '');
    this.setDateInputValue(this.endDateInput, '');
    this.showingFuture = false;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  private setDateInputValue(input: ElementRef<HTMLInputElement> | undefined, value: string) {
    if (!input) return;
    input.nativeElement.value = value;
    input.nativeElement.dispatchEvent(new Event('input'));
  }

  previousMonth() {
    this.setPreviousMonthFilter();
    this.reflectDateFilterInputs();
    this.showingFuture = false;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  private setPreviousMonthFilter() {
    const { start, end } = this.getBillingCycleBounds();
    this.searchObj.dates.start = start;
    this.searchObj.dates.end = end;
  }

  toggleFutureTransactions() {
    if (this.showingFuture) {
      this.setPreviousMonthFilter();
      this.showingFuture = false;
    } else {
      this.searchObj.dates.end = '';
      this.showingFuture = true;
    }
    this.reflectDateFilterInputs();
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  private reflectDateFilterInputs() {
    this.setDateInputValue(this.startDateInput,
      this.searchObj.dates.start ? this.toDisplayDate(this.searchObj.dates.start) : '');
    this.setDateInputValue(this.endDateInput,
      this.searchObj.dates.end ? this.toDisplayDate(this.searchObj.dates.end) : '');
  }

  private toDisplayDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }

  // the current billing cycle: starts on the 13th (this month if today is on
  // or after the 15th, otherwise last month's), and always runs through the
  // 14th of the following month — covering already-posted future-dated
  // charges (e.g. installments) within the same cycle, not just "through today"
  private getBillingCycleBounds(): { start: string; end: string } {
    const now = new Date();
    let month = now.getMonth();
    let year = now.getFullYear();
    if (now.getDate() < 15) {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    const start = this.formatLocalDate(new Date(year, month, 13));
    let endMonth = month + 1;
    let endYear = year;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    const end = this.formatLocalDate(new Date(endYear, endMonth, 14));
    return { start, end };
  }

  private formatLocalDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  datePicker(sDate: any, eDate: any) {
    const start = sDate.value ? this.formatDate(sDate.value) : '';
    const end = eDate.value ? this.formatDate(eDate.value) : '';
    console.log('picker:', start, end);
    this.searchObj.dates.start = start;
    this.searchObj.dates.end = end;
    this.showingFuture = false;
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  applyFilter(filter: string) {
    this.cardsData.filter = filter;
    this.calculateTotal();
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
      const wc = search.wildcard.toLowerCase();
      const matchSearch = wc === '' ||
        data.num.toLowerCase().includes(wc) ||
        data.date.toLowerCase().includes(wc) ||
        data.desc.toLowerCase().includes(wc) ||
        data.memo.toLowerCase().includes(wc) ||
        String(data.amount).includes(wc) ||
        String(data.originalAmount).includes(wc);
      const matchCards = search.cards.includes(data.num);
      const matchDate = (search.dates.start === '' || data.date >= search.dates.start) &&
        (search.dates.end === '' || data.date <= search.dates.end);
      return matchCards && matchSearch && matchDate;
    }
  }

  formatDate(s: string): string {
    const a = s.split('/');
    return `${a[2]}-${a[1].padStart(2, '0')}-${a[0].padStart(2, '0')}`;
  }

  downloadCSV() {
    const csvData = this.tableToCSV();
    console.log('csvData:', csvData.slice(0, 20));
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'file.csv';
    console.log('downloadLink:', url);
    a.click();
    window.URL.revokeObjectURL(url);
  }

  tableToCSV(): string {
    let csvData = [[...this.headers]];
    this.cardsData.data.forEach(rowObj => {
      csvData.push(Object.values(rowObj));
    });
    return csvData.join('\n');
  }

}
