import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-transaction-lines-section',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <section class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
      <div
        *ngIf="title"
        class="px-2.5 sm:px-4 py-1.5 sm:py-2.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
        <h2 *ngIf="headingLevel === 2" class="text-[11px] sm:text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5 sm:gap-2 min-w-0">
          <i-lucide *ngIf="icon" [name]="icon" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600 shrink-0"></i-lucide>
          <span class="truncate">{{ title }}</span>
        </h2>
        <h3 *ngIf="headingLevel === 3" class="text-[11px] sm:text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5 sm:gap-2 min-w-0">
          <i-lucide *ngIf="icon" [name]="icon" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600 shrink-0"></i-lucide>
          <span class="truncate">{{ title }}</span>
        </h3>
        <ng-content select="[headerAction]"></ng-content>
      </div>

      <div *ngIf="searchVisible" class="px-2.5 sm:px-4 py-1.5 sm:py-4 border-b border-gray-100 dark:border-gray-800 bg-teal-50/40 dark:bg-teal-950/20">
        <div *ngIf="searchTitle" class="mb-1">
          <p class="text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100">{{ searchTitle }}</p>
          <p *ngIf="searchHint" class="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">{{ searchHint }}</p>
        </div>
        <ng-content select="[search]"></ng-content>
      </div>

      <div
        *ngIf="lineCount === 0"
        class="px-2.5 sm:px-4 py-3 sm:py-8 text-center text-[10px] sm:text-sm text-gray-400 dark:text-gray-500 leading-snug">
        {{ emptyMessage }}
      </div>

      <div class="min-h-0">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class TransactionLinesSectionComponent {
  @Input() title = '';
  @Input() icon = '';
  @Input() headingLevel: 2 | 3 = 2;
  @Input() lineCount = 0;
  @Input() emptyMessage = 'Agregá productos para continuar.';
  @Input() searchVisible = false;
  @Input() searchTitle = '';
  @Input() searchHint = '';
}
