import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transaction-form-shell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-4 animate-pulse" aria-hidden="true" aria-busy="true">
      <div *ngIf="showComprobanteSlot" class="space-y-1.5">
        <div class="h-3.5 w-36 rounded bg-gray-200 dark:bg-gray-800"></div>
        <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_8.5rem] sm:grid-cols-[minmax(0,1fr)_10.5rem] gap-2 sm:gap-4">
        <div class="space-y-1.5 min-w-0">
          <div class="h-3.5 w-16 rounded bg-gray-200 dark:bg-gray-800"></div>
          <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
        </div>
        <div class="space-y-1.5 min-w-0">
          <div class="h-3.5 w-12 rounded bg-gray-200 dark:bg-gray-800"></div>
          <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
        </div>
      </div>

      <div class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div class="h-9 sm:h-11 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800"></div>
        <div class="px-3 sm:px-4 py-3 sm:py-4 space-y-2 bg-teal-50/30 dark:bg-teal-950/10 border-b border-gray-100 dark:border-gray-800">
          <div class="h-3.5 w-32 rounded bg-gray-200 dark:bg-gray-800"></div>
          <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
        </div>
        <div class="px-3 sm:px-4 py-6 sm:py-8 flex justify-center">
          <div class="h-3 w-48 rounded bg-gray-200 dark:bg-gray-800"></div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div class="space-y-1.5">
          <div class="h-3.5 w-28 rounded bg-gray-200 dark:bg-gray-800"></div>
          <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
        </div>
        <div class="space-y-1.5">
          <div class="h-3.5 w-24 rounded bg-gray-200 dark:bg-gray-800"></div>
          <div class="h-8 sm:h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
        </div>
      </div>

      <div class="space-y-1.5">
        <div class="h-3.5 w-14 rounded bg-gray-200 dark:bg-gray-800"></div>
        <div class="h-16 sm:h-20 w-full rounded-lg bg-gray-200 dark:bg-gray-800"></div>
      </div>
    </div>
  `,
})
export class TransactionFormShellComponent {
  @Input() showComprobanteSlot = true;
}
