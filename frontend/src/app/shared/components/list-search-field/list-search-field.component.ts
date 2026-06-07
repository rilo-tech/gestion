import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type ListSearchMode = 'filter' | 'picker';

/** Altura compartida con botones de toolbar (`app-icon-action`, historial, etc.). */
export const LIST_TOOLBAR_CONTROL_HEIGHT = 'h-[42px] box-border shrink-0';

/** Fila buscador + iconos en encabezados y toolbars de listado. */
export const LIST_TOOLBAR_ROW_CLASS = 'flex items-center gap-2 min-w-0';

/** Clase unificada para buscadores en grillas (desktop) y móvil. */
export const LIST_SEARCH_INPUT_CLASS =
  'w-full px-2 sm:px-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 ' +
  LIST_TOOLBAR_CONTROL_HEIGHT;

/** Buscador en formularios (picker): misma altura que campos compactos del formulario. */
export const LIST_SEARCH_PICKER_INPUT_CLASS =
  'w-full min-h-8 sm:min-h-10 box-border px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800';

/** Variante solo móvil en el encabezado de módulo. */
export const LIST_SEARCH_MOBILE_HEADER_CLASS =
  LIST_SEARCH_INPUT_CLASS + ' sm:hidden flex-1 min-w-0';

/** Contenedor del buscador sobre grillas (desktop). */
export const LIST_SEARCH_DESKTOP_WRAP_CLASS =
  'hidden sm:block px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50';

/**
 * Campo de búsqueda unificado.
 * - `filter`: filtra datos en listados/grillas.
 * - `picker`: selecciona ítems en formularios (ej. productos en ventas).
 */
@Component({
  selector: 'app-list-search-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <input
      #inputEl
      [ngModel]="query"
      (ngModelChange)="onQueryChange($event)"
      [name]="name"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [attr.autocomplete]="autocomplete"
      [class]="inputClass"
      (focus)="focused.emit()"
      (blur)="blurred.emit()"
      (keydown)="keydown.emit($event)">
  `,
})
export class ListSearchFieldComponent {
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLInputElement>;

  @Input() mode: ListSearchMode = 'filter';
  @Input() query = '';
  @Input() name = 'listSearch';
  @Input() placeholder = 'Buscar...';
  @Input() disabled = false;
  @Input() autocomplete = 'off';
  /** En modo filter: limita ancho en desktop (max-w-xl). */
  @Input() constrainWidth = true;

  /** Clases Tailwind adicionales para el input. */
  @Input() extraClass = '';

  @Output() queryChange = new EventEmitter<string>();
  @Output() focused = new EventEmitter<void>();
  @Output() blurred = new EventEmitter<void>();
  @Output() keydown = new EventEmitter<KeyboardEvent>();

  get inputClass(): string {
    const width =
      this.mode === 'filter' && this.constrainWidth ? ' max-w-xl' : '';
    const extra = this.extraClass.trim();
    const base = this.mode === 'picker' ? LIST_SEARCH_PICKER_INPUT_CLASS : LIST_SEARCH_INPUT_CLASS;
    return base + width + (extra ? ` ${extra}` : '');
  }

  onQueryChange(value: string) {
    this.query = value;
    this.queryChange.emit(value);
  }

  focus() {
    const el = this.inputEl?.nativeElement;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  blur() {
    this.inputEl?.nativeElement?.blur();
  }

  isFocused(): boolean {
    const el = this.inputEl?.nativeElement;
    return !!el && document.activeElement === el;
  }
}
