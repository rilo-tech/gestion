import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
} from '../icon-action/icon-action.component';

export type FormFooterMode = 'inline' | 'modal' | 'sidebar';

/**
 * Pie de formulario unificado.
 * - `inline`: cancelar + guardar (submit) + eliminar opcional, para páginas.
 * - `modal`: cancelar + acción principal (button), para modales.
 * - `sidebar`: solo guardar ancho completo, para paneles laterales oscuros/claros.
 */
@Component({
  selector: 'app-form-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container [ngSwitch]="mode">
      <div *ngSwitchCase="'sidebar'" [class]="sidebarWrapperClass">
        <button
          type="button"
          [disabled]="saving || saveDisabled"
          [class]="sidebarButtonClass"
          (click)="saveClick.emit()">
          {{ saving ? 'Guardando...' : saveLabel }}
        </button>
        <p
          *ngIf="successMessage"
          [class]="sidebarSuccessClass"
          role="status"
          aria-live="polite">
          {{ successMessage }}
        </p>
      </div>

      <div *ngSwitchDefault [class]="actionsWrapperClass">
        <div
          *ngIf="mode === 'inline' && (deleteLabel || secondaryActionLabel)"
          class="flex flex-wrap items-center gap-3">
          <button
            *ngIf="secondaryActionLabel"
            type="button"
            (click)="secondaryActionClick.emit()"
            [disabled]="secondaryActionDisabled"
            class="text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 min-h-[44px] sm:min-h-0 disabled:opacity-60">
            {{ secondarySaving ? 'Guardando...' : secondaryActionLabel }}
          </button>
          <button
            *ngIf="deleteLabel"
            type="button"
            (click)="deleteClick.emit()"
            class="text-sm font-medium text-red-600 hover:text-red-700 min-h-[44px] sm:min-h-0">
            {{ deleteLabel }}
          </button>
        </div>
        <div
          class="flex flex-col items-stretch sm:items-end gap-2"
          [class.sm:ml-auto]="mode === 'inline'">
          <p
            *ngIf="successMessage && mode === 'inline'"
            class="text-sm font-semibold text-teal-800 dark:text-teal-200 text-right"
            role="status"
            aria-live="polite">
            {{ successMessage }}
          </p>
          <p
            *ngIf="successMessage && mode === 'modal'"
            class="text-sm font-medium text-teal-700 dark:text-teal-400 text-right w-full"
            role="status"
            aria-live="polite">
            {{ successMessage }}
          </p>
          <div class="flex justify-end gap-3 flex-wrap">
            <button
              *ngIf="secondaryActionLabel && mode === 'modal'"
              type="button"
              (click)="secondaryActionClick.emit()"
              [disabled]="secondaryActionDisabled"
              class="text-sm font-medium text-gray-600 hover:text-gray-800 min-h-[44px] sm:min-h-0 disabled:opacity-60">
              {{ secondarySaving ? 'Guardando...' : secondaryActionLabel }}
            </button>
            <button
              *ngIf="showCancel"
              type="button"
              (click)="cancelClick.emit()"
              [class]="formCancelClass">
              {{ cancelLabel }}
            </button>
            <button
              *ngIf="showSave"
              [attr.type]="saveAsSubmit ? 'submit' : 'button'"
              [disabled]="saving || saveDisabled"
              [class]="resolvedSaveButtonClass"
              (click)="onSaveButtonClick($event)">
              {{ saving ? 'Guardando...' : saveLabel }}
            </button>
          </div>
        </div>
      </div>
    </ng-container>
  `,
})
export class FormFooterComponent {
  @Input() mode: FormFooterMode = 'inline';
  @Input() saveLabel = 'Guardar';
  @Input() cancelLabel = 'Cancelar';
  @Input() deleteLabel = '';
  @Input() secondaryActionLabel = '';
  @Input() secondaryActionDisabled = false;
  @Input() secondarySaving = false;
  @Input() saving = false;
  @Input() saveDisabled = false;
  @Input() showSave = true;
  @Input() showCancel = true;
  /** Dentro de `<form (submit)=...>`: el botón principal dispara el submit nativo. */
  @Input() saveAsSubmit = false;
  /** Clases extra del contenedor (modal suele usar mt-6 pt-2). */
  @Input() footerClass = '';
  /** Override del botón principal (ej. ingreso/egreso en caja). */
  @Input() saveButtonClass = '';

  /** Mensaje breve tras guardar (sidebar o inline). */
  @Input() successMessage = '';
  @Input() fullWidth = true;
  @Input() centerOnLarge = false;
  @Input() theme: 'light' | 'dark' = 'light';

  @Output() cancelClick = new EventEmitter<void>();
  @Output() saveClick = new EventEmitter<void>();
  @Output() deleteClick = new EventEmitter<void>();
  @Output() secondaryActionClick = new EventEmitter<void>();

  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly formSubmitClass = FORM_SUBMIT_CLASS;

  get resolvedSaveButtonClass(): string {
    return this.saveButtonClass || this.formSubmitClass;
  }

  get actionsWrapperClass(): string {
    const base =
      this.mode === 'inline'
        ? 'form-actions flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2'
        : 'form-actions flex flex-col-reverse sm:flex-row sm:justify-end gap-3';
    const extra = this.footerClass.trim();
    return extra ? `${base} ${extra}` : base;
  }

  get sidebarWrapperClass(): string {
    if (this.centerOnLarge) {
      return 'flex w-full flex-col gap-2 items-stretch lg:items-center';
    }
    return this.fullWidth
      ? 'flex w-full flex-col gap-2'
      : 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4';
  }

  get sidebarButtonClass(): string {
    let width = '';
    if (this.centerOnLarge) {
      width = 'w-full lg:w-auto lg:min-w-[12rem]';
    } else if (this.fullWidth) {
      width = 'w-full';
    }
    return `${width} px-5 py-2.5 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity`;
  }

  get sidebarSuccessClass(): string {
    const align =
      this.fullWidth && !this.centerOnLarge
        ? 'text-center'
        : this.centerOnLarge
          ? 'text-center'
          : this.theme === 'dark'
            ? 'text-center sm:text-left'
            : '';
    return this.theme === 'dark'
      ? `${align} text-xs font-medium text-teal-300`.trim()
      : `${align} text-sm font-medium text-teal-700`.trim();
  }

  onSaveButtonClick(event: MouseEvent) {
    if (this.saveAsSubmit) return;
    event.preventDefault();
    if (this.saving || this.saveDisabled) return;
    this.saveClick.emit();
  }
}
