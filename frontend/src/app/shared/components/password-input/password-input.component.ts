import { Component, forwardRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-password-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PasswordInputComponent),
      multi: true,
    },
  ],
  template: `
    <div
      class="flex items-stretch overflow-hidden rounded-lg border border-gray-700 bg-gray-950 focus-within:ring-2 focus-within:ring-teal-500"
      [class.opacity-60]="disabled">
      <input
        [id]="inputId"
        [name]="name"
        [type]="showPassword ? 'text' : 'password'"
        [placeholder]="placeholder"
        [autocomplete]="autocomplete"
        [required]="required"
        [disabled]="disabled"
        [ngModel]="value"
        (ngModelChange)="onValueChange($event)"
        (blur)="onTouched()"
        class="min-w-0 flex-1 border-0 bg-transparent px-4 py-2.5 text-sm outline-none ring-0 focus:ring-0"
        [class]="inputClass">
      <button
        type="button"
        (click)="toggleVisibility()"
        [disabled]="disabled"
        class="shrink-0 border-l border-gray-700 px-3 text-xs font-semibold text-teal-400 hover:bg-gray-900 hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
        [attr.aria-label]="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        [attr.aria-pressed]="showPassword">
        {{ showPassword ? 'Ocultar' : 'Ver' }}
      </button>
    </div>
  `,
})
export class PasswordInputComponent implements ControlValueAccessor {
  @Input() inputId = '';
  @Input() name = '';
  @Input() placeholder = '';
  @Input() autocomplete = '';
  @Input() required = false;
  @Input() inputClass = '';

  value = '';
  showPassword = false;
  disabled = false;

  private onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onValueChange(next: string): void {
    this.value = next;
    this.onChange(next);
  }

  toggleVisibility(): void {
    this.showPassword = !this.showPassword;
  }
}
