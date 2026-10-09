import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
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
  useCache: boolean = false;

  getCards(days = 30, months = 0, refresh = false): Observable<CardItem[]> {
    let params = new HttpParams()
      .set('days', days)
      .set('months', months);
    console.log('url:', `${this.url}?${params.toString()}`);
    const cached = refresh ? null : this.readCache();
    return cached ?
      of(cached).pipe(
        map((data: CardItem[]) => {
          this.fetchErrors$.next([]);
          this.updateObservers(data);
          return data;
        })
      )
      : this.http.get<CardsResponse>(this.url, { params }).pipe(
        map((result: CardsResponse) => {
          const errors = result?.errors || [];
          const freshData = Array.isArray(result?.data) ? result.data : [];
          this.fetchErrors$.next(errors);
          // an explicit refresh shows exactly what came back this time, even if
          // that's incomplete — the error banner explains what's missing and why,
          // rather than silently mixing in older cached rows
          localStorage.setItem('cardsData', JSON.stringify(freshData));
          this.updateObservers(freshData);
          return freshData;
        })
      );
  }

  private readCache(): CardItem[] | null {
    const raw = localStorage.getItem('cardsData');
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch {
      console.warn('cardsData in localStorage was corrupted, ignoring it');
      return null;
    }
  }

  private updateObservers(data: CardItem[]): void {
    this.cards$.next(data);
    const uniques = [...new Set(data.map((elem: CardItem) => elem.num.toString()))];
    this.cardNumbers$.next(uniques);
  }
}
