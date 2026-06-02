import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBackButtonComponent } from '../form-shell/form-back-button.component';

@Component({
  selector: 'app-transaction-form-page',
  standalone: true,
  imports: [CommonModule, FormBackButtonComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
      <div class="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{{ title }}</h1>
            <p
              *ngIf="subtitle"
              class="text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1"
              [class.desc-lg-only]="hideSubtitleOnMobile">
              {{ subtitle }}
            </p>
          </div>
          <app-form-back-button
            [label]="backLabel"
            [shortLabel]="backShortLabel"
            [ariaLabel]="backAriaLabel"
            [routerLink]="backRouterLink"
            (clicked)="backClick.emit()">
          </app-form-back-button>
        </div>
        <div *ngIf="hasHeaderActions" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <ng-content select="[headerActions]"></ng-content>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div class="lg:col-span-2 space-y-4">
          <ng-content select="[main]"></ng-content>
        </div>
        <aside class="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <ng-content select="[aside]"></ng-content>
        </aside>
      </div>
    </div>
  `,
})
export class TransactionFormPageComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = 'Volver';
  @Input() backRouterLink: string | readonly unknown[] | null = null;
  @Input() hideSubtitleOnMobile = true;
  @Input() hasHeaderActions = false;

  @Output() backClick = new EventEmitter<void>();
}
