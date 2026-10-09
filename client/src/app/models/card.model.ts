export interface Cards {
  items: Array<CardItem>;
}

export interface CardItem {
  num: string;
  date: string;
  amount: number;
  originalAmount: number;
  desc: string;
  memo: string;
}