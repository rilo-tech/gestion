import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormScreenHeaderComponent } from '../form-shell/form-screen-header.component';

@Component({
  selector: 'app-transaction-form-page',
  standalone: true,
  imports: [CommonModule, FormScreenHeaderComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
      <app-form-screen-header
        [title]="title"
        [titleBadge]="titleBadge"
        [subtitle]="subtitle"
        [backLabel]="backLabel"
        [backShortLabel]="backShortLabel"
        [backAriaLabel]="backAriaLabel"
        [backRouterLink]="backRouterLink"
        [hideSubtitleOnMobile]="hideSubtitleOnMobile"
        [hasHeaderActions]="hasHeaderActions"
        (backClick)="backClick.emit()">
        <ng-content select="[headerActions]" headerActions></ng-content>
      </app-form-screen-header>

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
  /** Número de documento (ej. pedido) mostrado junto al título. */
  @Input() titleBadge = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = 'Volver';
  @Input() backRouterLink: string | readonly unknown[] | null = null;
  @Input() hideSubtitleOnMobile = true;
  @Input() hasHeaderActions = false;

  @Output() backClick = new EventEmitter<void>();
}
