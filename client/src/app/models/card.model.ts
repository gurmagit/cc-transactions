export interface Cards {
  items: Array<CardItem>;
}

export interface CardItem {
  num: string;
  identifier: string;
  date: string;
  amount: number;
  originalAmount: number;
  originalCurrency: string | null;
  desc: string;
  memo: string;
  category: string | null;
}