import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-form-save-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="wrapperClass">
      <button
        type="button"
        [disabled]="saving || disabled"
        [class]="buttonClass"
        (click)="saveClick.emit()">
        {{ saving ? 'Guardando...' : label }}
      </button>
      <p
        *ngIf="successMessage"
        [class]="successClass"
        role="status"
        aria-live="polite">
        {{ successMessage }}
      </p>
    </div>
  `,
})
export class FormSaveFooterComponent {
  @Input() label = 'Guardar';
  @Input() saving = false;
  @Input() disabled = false;
  @Input() successMessage = '';
  @Input() fullWidth = true;
  @Input() theme: 'light' | 'dark' = 'light';
  @Output() saveClick = new EventEmitter<void>();

  get wrapperClass(): string {
    return this.fullWidth
      ? 'flex w-full flex-col gap-2'
      : 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4';
  }

  get buttonClass(): string {
    const width = this.fullWidth ? 'w-full' : '';
    return `${width} px-5 py-2.5 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity`;
  }

  get successClass(): string {
    const align = this.fullWidth ? 'text-center' : this.theme === 'dark' ? 'text-center sm:text-left' : '';
    return this.theme === 'dark'
      ? `${align} text-xs font-medium text-teal-300`.trim()
      : `${align} text-sm font-medium text-teal-700`.trim();
  }
}
