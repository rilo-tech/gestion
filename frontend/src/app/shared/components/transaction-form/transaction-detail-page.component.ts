import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBackButtonComponent } from '../form-shell/form-back-button.component';

@Component({
  selector: 'app-transaction-detail-page',
  standalone: true,
  imports: [CommonModule, FormBackButtonComponent],
  template: `
    <div
      class="fixed top-14 left-0 right-0 bottom-0 lg:left-64 z-40 flex flex-col bg-gray-50 dark:bg-gray-950 min-h-0 overflow-y-auto"
      role="dialog"
      aria-modal="true">
      <div class="p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
        <div class="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4 max-w-7xl mx-auto w-full">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{{ title }}</h1>
                <span
                  *ngIf="titleBadge"
                  class="shrink-0 text-sm sm:text-lg font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
                  #{{ titleBadge }}
                </span>
              </div>
              <p
                *ngIf="subtitle"
                class="text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1 desc-lg-only">
                {{ subtitle }}
              </p>
            </div>
            <div class="flex flex-col items-end gap-2.5 sm:gap-3 shrink-0">
              <app-form-back-button
                [label]="backLabel"
                [shortLabel]="backShortLabel"
                [ariaLabel]="backAriaLabel"
                (clicked)="closeClick.emit()">
              </app-form-back-button>
              <div
                *ngIf="hasHeaderActions"
                class="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
                <ng-content select="[headerActions]"></ng-content>
              </div>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto w-full">
          <div *ngIf="loading && !hasContent" class="py-12 text-center text-sm text-gray-400">{{ loadingMessage }}</div>
          <div *ngIf="hasContent" class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <div class="lg:col-span-2 space-y-4">
              <div *ngIf="loading" class="text-xs sm:text-sm text-gray-400">{{ refreshingMessage }}</div>
              <ng-content select="[main]"></ng-content>
            </div>
            <aside class="space-y-4 lg:sticky lg:top-8 lg:self-start">
              <ng-content select="[aside]"></ng-content>
            </aside>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TransactionDetailPageComponent {
  @Input() title = '';
  /** Número de documento (ej. compra) junto al título. */
  @Input() titleBadge = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = 'Volver';
  @Input() loading = false;
  @Input() hasContent = false;
  @Input() hasHeaderActions = false;
  @Input() loadingMessage = 'Cargando...';
  @Input() refreshingMessage = 'Actualizando...';

  @Output() closeClick = new EventEmitter<void>();
}
