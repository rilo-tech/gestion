import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormScreenHeaderComponent } from '../form-shell/form-screen-header.component';

@Component({
  selector: 'app-transaction-form-page',
  standalone: true,
  imports: [CommonModule, FormScreenHeaderComponent],
  template: `
    <div class="transaction-form-page-shell p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
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

      <div
        class="grid grid-cols-1 gap-4 sm:gap-6"
        [ngClass]="gridClass">
        <div class="space-y-4" [ngClass]="mainColumnClass">
          <ng-content select="[main]"></ng-content>
        </div>
        <aside *ngIf="!hideAside" class="space-y-4 lg:sticky lg:top-8 lg:self-start min-w-0">
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
  /** Oculta la columna lateral y usa todo el ancho para el formulario principal. */
  @Input() hideAside = false;
  /** En desktop: columna lateral más angosta para dar más espacio al formulario. */
  @Input() asideLayout: 'default' | 'narrow' = 'default';

  @Output() backClick = new EventEmitter<void>();

  get gridClass(): string {
    if (this.hideAside) return '';
    return this.asideLayout === 'narrow'
      ? 'lg:grid-cols-[minmax(0,1fr)_17rem]'
      : 'lg:grid-cols-3';
  }

  get mainColumnClass(): string {
    if (this.hideAside) return '';
    return this.asideLayout === 'narrow' ? '' : 'lg:col-span-2';
  }
}
