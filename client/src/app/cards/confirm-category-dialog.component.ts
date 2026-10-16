import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmCategoryDialogData {
  desc: string;
  amount: number;
  num: string;
  // every other transaction currently loaded — used to compute a live match
  // count as the user toggles the narrowing checkboxes
  otherRows: { desc: string; amount: number; num: string }[];
}

export interface ConfirmCategoryDialogResult {
  applyToAll: boolean;
  sameAmount: boolean;
  sameCard: boolean;
}

@Component({
  selector: 'app-confirm-category-dialog',
  templateUrl: './confirm-category-dialog.component.html',
  styleUrls: ['./confirm-category-dialog.component.css']
})
export class ConfirmCategoryDialogComponent {
  sameAmount = false;
  sameCard = false;

  constructor(
    private dialogRef: MatDialogRef<ConfirmCategoryDialogComponent, ConfirmCategoryDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmCategoryDialogData
  ) { }

  private normalize(s: string): string {
    return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // description always matches — amount/card are optional narrowing filters
  get matchCount(): number {
    const targetDesc = this.normalize(this.data.desc);
    return this.data.otherRows.filter(r =>
      this.normalize(r.desc) === targetDesc &&
      (!this.sameAmount || r.amount === this.data.amount) &&
      (!this.sameCard || r.num === this.data.num)
    ).length;
  }

  choose(applyToAll: boolean) {
    this.dialogRef.close({ applyToAll, sameAmount: this.sameAmount, sameCard: this.sameCard });
  }
}
