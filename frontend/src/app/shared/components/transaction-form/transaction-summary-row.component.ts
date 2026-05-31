import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transaction-summary-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="flex justify-between gap-3"
      [class.text-xs]="size === 'sm'"
      [class.sm:text-sm]="size === 'sm'"
      [class.text-sm]="size === 'md'"
      [class.font-bold]="bold"
      [class.text-base]="bold && size === 'md'"
      [class.sm:text-lg]="bold && size === 'md'"
      [class.border-t]="divider"
      [class.border-gray-800]="divider && darkContext"
      [class.border-gray-200]="divider && !darkContext"
      [class.dark:border-gray-700]="divider && !darkContext"
      [class.pt-2]="divider"
      [class.sm:pt-3]="divider">
      <span [ngClass]="labelClass">{{ label }}</span>
      <span class="tabular-nums shrink-0 text-right" [ngClass]="valueClass">{{ value }}</span>
    </div>
  `,
})
export class TransactionSummaryRowComponent {
  @Input() label = '';
  @Input() value = '';
  @Input() bold = false;
  @Input() divider = false;
  @Input() size: 'sm' | 'md' = 'sm';
  @Input() darkContext = true;
  @Input() valueTone: 'default' | 'teal' | 'orange' | 'green' = 'default';

  get labelClass(): string {
    if (!this.darkContext) {
      return this.bold ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400';
    }
    return this.bold ? '' : 'text-gray-400';
  }

  get valueClass(): string {
    if (this.bold && this.darkContext) return 'text-teal-300';
    if (this.bold && !this.darkContext) return 'text-gray-900 dark:text-gray-100';
    switch (this.valueTone) {
      case 'teal':
        return this.darkContext ? 'text-teal-300 font-semibold' : 'text-teal-600 dark:text-teal-400 font-semibold';
      case 'orange':
        return this.darkContext ? 'text-orange-300 font-semibold' : 'text-orange-600 dark:text-orange-400 font-semibold';
      case 'green':
        return this.darkContext ? 'text-green-400 font-bold' : 'text-green-600 font-bold';
      default:
        return this.bold ? 'font-semibold' : 'font-semibold';
    }
  }
}
