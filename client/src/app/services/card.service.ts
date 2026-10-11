import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { HttpClient, HttpParams } from '@angular/common/http';
import { CardItem } from '../models/card.model';
import { environment } from '../../environment/environment';

export interface FetchError {
  company: string;
  type?: string;
  message: string;
}

interface CardsResponse {
  data: CardItem[];
  errors: FetchError[];
}

@Injectable({ providedIn: 'root' })
export class CardService {
  constructor(
    private http: HttpClient
  ) { }

  cards$ = new BehaviorSubject<CardItem[]>([]);
  cardNumbers$ = new BehaviorSubject<string[]>([]);
  fetchErrors$ = new BehaviorSubject<FetchError[]>([]);
  private url = environment.serverURL + '/cards';

  triggerScrape(days = 30, months = 0): Observable<FetchError[]> {
    const params = new HttpParams()
      .set('days', days)
      .set('months', months);
    console.log('url:', `${this.url}?${params.toString()}`);
    return this.http.get<CardsResponse>(this.url, { params }).pipe(
      map((result: CardsResponse) => {
        const errors = result?.errors || [];
        this.fetchErrors$.next(errors);
        return errors;
      })
    );
  }

  getTransactions(): Observable<CardItem[]> {
    return this.http.get<CardItem[]>(`${this.url}/transactions`).pipe(
      map((data: CardItem[]) => {
        const cards = Array.isArray(data) ? data : [];
        this.updateObservers(cards);
        return cards;
      })
    );
  }

  private updateObservers(data: CardItem[]): void {
    this.cards$.next(data);
    const uniques = [...new Set(data.map((elem: CardItem) => elem.num.toString()))];
    this.cardNumbers$.next(uniques);
  }
}
