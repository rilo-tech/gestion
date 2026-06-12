import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

/** Clase unificada del botón «volver» en formularios y pantallas de detalle. */
export const FORM_BACK_BUTTON_CLASS =
  'shrink-0 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 pt-0.5 transition-colors';

/** Clase del botón «volver» solo icono (encabezado de pantalla). */
export const FORM_BACK_ICON_BUTTON_CLASS =
  'shrink-0 inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 p-2 sm:p-2.5 min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors';

/**
 * Botón «volver atrás» unificado para toda la aplicación.
 * Preferí `(clicked)` + NavigationBackService; `routerLink` queda solo por compatibilidad.
 * `appearance="icon"`: flecha grande sin texto (encabezado de pantalla).
 */
@Component({
  selector: 'app-form-back-button',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  template: `
    <a
      *ngIf="routerLink; else actionButton"
      [routerLink]="routerLink"
      [class]="resolvedButtonClass"
      [attr.aria-label]="resolvedAriaLabel"
      [title]="resolvedAriaLabel">
      <i-lucide [name]="icon" [class]="iconClass"></i-lucide>
      <ng-container *ngIf="showTextLabel">
        <span class="sm:hidden">{{ shortLabel }}</span>
        <span class="hidden sm:inline">{{ label }}</span>
      </ng-container>
    </a>
    <ng-template #actionButton>
      <button
        type="button"
        (click)="clicked.emit()"
        [class]="resolvedButtonClass"
        [attr.aria-label]="resolvedAriaLabel"
        [title]="resolvedAriaLabel">
        <i-lucide [name]="icon" [class]="iconClass"></i-lucide>
        <ng-container *ngIf="showTextLabel && icon === 'arrow-left'">
          <span class="sm:hidden">{{ shortLabel }}</span>
          <span class="hidden sm:inline">{{ label }}</span>
        </ng-container>
        <span *ngIf="showTextLabel && icon === 'x'" class="hidden sm:inline">{{ label }}</span>
      </button>
    </ng-template>
  `,
})
export class FormBackButtonComponent {
  @Input() label = 'Volver';
  @Input() shortLabel = 'Volver';
  @Input() ariaLabel = '';
  @Input() icon: 'arrow-left' | 'x' = 'arrow-left';
  @Input() appearance: 'text' | 'icon' = 'text';
  @Input() routerLink: string | readonly unknown[] | null = null;

  @Output() clicked = new EventEmitter<void>();

  readonly buttonClass = FORM_BACK_BUTTON_CLASS;
  readonly iconButtonClass = FORM_BACK_ICON_BUTTON_CLASS;

  get resolvedButtonClass(): string {
    return this.appearance === 'icon' ? this.iconButtonClass : this.buttonClass;
  }

  get showTextLabel(): boolean {
    return this.appearance === 'text';
  }

  get iconClass(): string {
    if (this.appearance === 'icon') {
      return 'w-5 h-5 sm:w-[1.35rem] sm:h-[1.35rem] shrink-0';
    }
    return 'w-4 h-4 shrink-0';
  }

  get resolvedAriaLabel(): string {
    return this.ariaLabel.trim() || this.label;
  }
}
