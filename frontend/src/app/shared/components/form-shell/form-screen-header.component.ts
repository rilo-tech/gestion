import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBackButtonComponent } from './form-back-button.component';

/**
 * Encabezado de pantallas de formulario/detalle: flecha grande, título e iconos en la misma fila.
 */
@Component({
  selector: 'app-form-screen-header',
  standalone: true,
  imports: [CommonModule, FormBackButtonComponent],
  template: `
    <header class="mb-3 sm:mb-4">
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <app-form-back-button
          appearance="icon"
          [label]="backLabel"
          [shortLabel]="backShortLabel"
          [ariaLabel]="backAriaLabel"
          [icon]="backIcon"
          [routerLink]="backRouterLink"
          (clicked)="backClick.emit()">
        </app-form-back-button>

        <div class="min-w-0 flex-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <h1
            class="min-w-0 text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight truncate">
            {{ title }}
          </h1>
          <span
            *ngIf="titleBadge"
            class="shrink-0 text-sm sm:text-lg font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
            #{{ titleBadge }}
          </span>
        </div>

        <div
          *ngIf="hasHeaderActions"
          class="flex shrink-0 items-center justify-end gap-2 sm:gap-2.5 max-sm:max-w-[45%]">
          <ng-content select="[headerActions]"></ng-content>
        </div>
      </div>

      <p
        *ngIf="subtitle"
        class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 sm:mt-1 leading-snug pl-[calc(2.5rem+0.5rem)] sm:pl-[calc(2.75rem+0.75rem)]"
        [class.desc-lg-only]="hideSubtitleOnMobile">
        {{ subtitle }}
      </p>

      <div
        *ngIf="hasHeaderExtra"
        class="mt-1 pl-[calc(2.5rem+0.5rem)] sm:pl-[calc(2.75rem+0.75rem)]">
        <ng-content select="[headerExtra]"></ng-content>
      </div>
    </header>
  `,
})
export class FormScreenHeaderComponent {
  @Input() title = '';
  @Input() titleBadge = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = '';
  @Input() backIcon: 'arrow-left' | 'x' = 'arrow-left';
  @Input() backRouterLink: string | readonly unknown[] | null = null;
  @Input() hideSubtitleOnMobile = true;
  @Input() hasHeaderActions = false;
  @Input() hasHeaderExtra = false;

  @Output() backClick = new EventEmitter<void>();
}
