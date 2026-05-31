import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBackButtonComponent } from './form-back-button.component';

/**
 * Encabezado estándar de formularios: título, subtítulo opcional y botón volver.
 */
@Component({
  selector: 'app-form-page-header',
  standalone: true,
  imports: [CommonModule, FormBackButtonComponent],
  template: `
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
          <ng-content select="[headerExtra]"></ng-content>
        </div>
        <app-form-back-button
          [label]="backLabel"
          [shortLabel]="backShortLabel"
          [ariaLabel]="backAriaLabel"
          [routerLink]="backRouterLink"
          (clicked)="backClick.emit()">
        </app-form-back-button>
      </div>
      <div *ngIf="hasHeaderActions" class="flex flex-wrap items-center gap-2">
        <ng-content select="[headerActions]"></ng-content>
      </div>
    </div>
  `,
})
export class FormPageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = '';
  @Input() backRouterLink: string | readonly unknown[] | null = null;
  @Input() hideSubtitleOnMobile = true;
  @Input() hasHeaderActions = false;

  @Output() backClick = new EventEmitter<void>();
}
