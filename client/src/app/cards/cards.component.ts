import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CardService, FetchError } from '../services/card.service';
import { CardItem } from '../models/card.model';
import { BehaviorSubject, finalize } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';

@Component({
  selector: 'app-cards',
  templateUrl: './cards.component.html',
  styleUrls: ['./cards.component.css']
})
export class CardsComponent implements OnInit {
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
  days: number = 30;
  months: number = 0;
  start_date = '';
  end_date = '';

  constructor(
    private cardService: CardService
  ) {
    this.fetchErrors$ = this.cardService.fetchErrors$;
  }

  ngOnInit(): void {
    this.fetchData(false);
  }

  fetchData(flag = true) {
    console.log('submit:', this.days, this.months);
    this.isLoading$.next(true);
    this.cardService.getCards(this.days, this.months, flag).pipe(
      finalize(() => this.isLoading$.next(false))
    ).subscribe({
      next: (cards: CardItem[]) => {
        console.log('cards:', cards);
        this.cardsData = new MatTableDataSource(cards);
        if (this.sort) {
          this.cardsData.sort = this.sort;
        }
        this.cardsData.filterPredicate = this.setFilter();
        const previousAllCards = this.allCards;
        this.allCards = this.cardService.cardNumbers$.value;
        if (!flag || !this.searchObj.cards.length) {
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
        this.start_date = new Date(Math.min(...cards.map((c: CardItem) =>
          new Date(c.date).getTime()))).toISOString().split('T')[0];
        this.end_date = new Date(Math.max(...cards.map((c: CardItem) =>
          new Date(c.date).getTime()))).toISOString().split('T')[0];
        this.applyFilter(JSON.stringify(this.searchObj));
      },
      error: (err) => {
        console.error('fetchData failed:', err);
        this.fetchErrors$.next([{ company: 'request', message: err?.message || 'Request to the server failed' }]);
      }
    });
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
    const start = this.getLastThirteenth();
    this.searchObj.dates.start = start;
    this.searchObj.dates.end = '';
    this.setDateInputValue(this.startDateInput, this.toDisplayDate(start));
    this.setDateInputValue(this.endDateInput, '');
    if (start < this.start_date) {
      this.days = Math.floor((Date.now() - Date.parse(start)) / 86400000);
      this.months = 0;
      this.fetchData(true);
    }
    this.applyFilter(JSON.stringify(this.searchObj));
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
    if ((start !== '' && start < this.start_date) || (end !== '' && end > this.end_date)) {
      this.days = Math.floor((Date.now() - Date.parse(start || this.start_date)) / 86400000);
      this.months = Math.ceil((Date.parse(end || this.end_date) - Date.now()) / 86400000 / 30);
      if (this.months < 0) this.months = 0;
      this.fetchData(true);
    }
    this.applyFilter(JSON.stringify(this.searchObj));
  }

  applyFilter(filter: string) {
    console.log('filter:', JSON.parse(filter));
    this.cardsData.filter = filter;
    console.log('filtered cards:', this.cardsData.filteredData);
    this.calculateTotal();
  }

  setFilter() {
    return (data: CardItem, filter: string) => {
      let matchCards = true;
      let matchSearch = true;
      let matchDate = true;
      const search = JSON.parse(filter);
      const row = JSON.stringify(data);
      const wc = search.wildcard;
      matchSearch = wc === '' || row.toLowerCase().includes(wc.toLowerCase());
      matchCards = search.cards.includes(data.num);
      matchDate = (search.dates.start === '' || data.date >= search.dates.start) &&
        (search.dates.end === '' || data.date <= search.dates.end);
      // console.log('matches:', matchCards, matchDate, matchSearch);
      if (matchDate) console.log('compare ends:', data.date, search.dates.end);
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

  onlyNum(e: any, len = 3, max = 9) {
    const target = e.target;
    const val = target.value;
    console.log('val:', val);
    const CHAR_CODES = [8, 37, 38, 39, 40, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57];
    if (!CHAR_CODES.includes(e.keyCode)) {
      e.preventDefault();
    } else if (e.code.slice(0, 5) === 'Digit' && (val.length >= len || e.key > max)
      && target.selectionStart == target.selectionEnd) {
      e.preventDefault();
    }
    if (target.name == 'days') this.days = val;
    if (target.name == 'months') this.months = val;
  }

}
