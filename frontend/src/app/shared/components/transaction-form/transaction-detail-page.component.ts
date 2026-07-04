import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormScreenHeaderComponent } from '../form-shell/form-screen-header.component';

@Component({
  selector: 'app-transaction-detail-page',
  standalone: true,
  imports: [CommonModule, FormScreenHeaderComponent],
  template: `
    <div
      class="fixed top-14 left-0 right-0 bottom-0 lg:left-64 z-40 flex flex-col bg-gray-50 dark:bg-gray-950 min-h-0 overflow-y-auto"
      role="dialog"
      aria-modal="true">
      <div class="transaction-form-page-shell p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
        <div class="max-w-7xl mx-auto w-full">
          <app-form-screen-header
            [title]="title"
            [titleBadge]="titleBadge"
            [subtitle]="subtitle"
            [backLabel]="backLabel"
            [backShortLabel]="backShortLabel"
            [backAriaLabel]="backAriaLabel"
            [hasHeaderActions]="hasHeaderActions"
            (backClick)="closeClick.emit()">
            <ng-content select="[headerActions]" headerActions></ng-content>
          </app-form-screen-header>

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
