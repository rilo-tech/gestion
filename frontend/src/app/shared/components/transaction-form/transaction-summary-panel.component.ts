import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transaction-summary-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-xl"
      [ngClass]="panelClass">
      <h2 class="text-sm sm:text-lg font-bold mb-3 sm:mb-4" [ngClass]="titleClass">{{ title }}</h2>
      <ng-content></ng-content>
    </div>
  `,
})
export class TransactionSummaryPanelComponent {
  @Input() title = 'Resumen';
  @Input() variant: 'dark' | 'light' = 'dark';

  get panelClass(): string {
    return this.variant === 'dark'
      ? 'bg-gray-900 text-white'
      : 'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100';
  }

  get titleClass(): string {
    return this.variant === 'dark' ? 'text-teal-400' : 'text-gray-900 dark:text-gray-100';
  }
}
