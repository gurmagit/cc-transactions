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
    this.reflectDateFilterInputs();
  }

  fetchData() {
    this.isLoading$.next(true);
    this.cardService.triggerScrape(30, 0).pipe(
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
    if (!this.searchObj.cards.length) {
      this.searchObj.cards = [...this.allCards];
      this.selectedCards$.next([...this.allCards]);
    } else {
      // a card that wasn't available before (e.g. its login had been failing)
      // should show up by default rather than staying silently excluded
      const newlySeen = this.allCards.filter((c: string) => !previousAllCards.includes(c));
      if (newlySeen.length) {
        this.searchObj.cards = [...this.searchObj.cards, ...newlySeen];
        this.selectedCards$.next([...this.selectedCards$.value, ...newlySeen]);
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
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  private setPreviousMonthFilter() {
    this.searchObj.dates.start = this.getLastThirteenth();
    this.searchObj.dates.end = this.formatLocalDate(new Date());
  }

  showFutureTransactions() {
    this.searchObj.dates.end = '';
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

  private getLastThirteenth(): string {
    const now = new Date();
    let month = now.getMonth();
    let year = now.getFullYear();
    if (now.getDate() < 13) {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    return this.formatLocalDate(new Date(year, month, 13));
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
