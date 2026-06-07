import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

/** Clase unificada del botón «volver» en formularios y pantallas de detalle. */
export const FORM_BACK_BUTTON_CLASS =
  'shrink-0 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 pt-0.5 transition-colors';

/**
 * Botón «volver atrás» unificado para toda la aplicación.
 * Preferí `(clicked)` + NavigationBackService; `routerLink` queda solo por compatibilidad.
 * En móvil muestra `shortLabel`; en desktop muestra `label`.
 */
@Component({
  selector: 'app-form-back-button',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  template: `
    <a
      *ngIf="routerLink; else actionButton"
      [routerLink]="routerLink"
      [class]="buttonClass"
      [attr.aria-label]="resolvedAriaLabel"
      [title]="resolvedAriaLabel">
      <i-lucide [name]="icon" class="w-4 h-4 shrink-0"></i-lucide>
      <ng-container *ngIf="icon === 'arrow-left'">
        <span class="sm:hidden">{{ shortLabel }}</span>
        <span class="hidden sm:inline">{{ label }}</span>
      </ng-container>
      <span *ngIf="icon === 'x'" class="hidden sm:inline">{{ label }}</span>
    </a>
    <ng-template #actionButton>
      <button
        type="button"
        (click)="clicked.emit()"
        [class]="buttonClass"
        [attr.aria-label]="resolvedAriaLabel"
        [title]="resolvedAriaLabel">
        <i-lucide [name]="icon" class="w-4 h-4 shrink-0"></i-lucide>
        <ng-container *ngIf="icon === 'arrow-left'">
          <span class="sm:hidden">{{ shortLabel }}</span>
          <span class="hidden sm:inline">{{ label }}</span>
        </ng-container>
        <span *ngIf="icon === 'x'" class="hidden sm:inline">{{ label }}</span>
      </button>
    </ng-template>
  `,
})
export class FormBackButtonComponent {
  @Input() label = 'Volver';
  @Input() shortLabel = 'Volver';
  @Input() ariaLabel = '';
  @Input() icon: 'arrow-left' | 'x' = 'arrow-left';
  @Input() routerLink: string | readonly unknown[] | null = null;

  @Output() clicked = new EventEmitter<void>();

  readonly buttonClass = FORM_BACK_BUTTON_CLASS;

  get resolvedAriaLabel(): string {
    return this.ariaLabel.trim() || this.label;
  }
}
