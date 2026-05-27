import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-form-save-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
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

  get buttonClass(): string {
    const width = this.fullWidth ? 'w-full sm:w-auto' : '';
    return `${width} px-5 py-2.5 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity`;
  }

  get successClass(): string {
    return this.theme === 'dark'
      ? 'text-center sm:text-left text-xs font-medium text-teal-300'
      : 'text-sm font-medium text-teal-700';
  }
}
