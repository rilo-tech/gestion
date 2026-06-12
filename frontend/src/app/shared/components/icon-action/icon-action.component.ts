import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NATIVE_COMPACT_TABLE_CLASS } from '../compact-list/compact-list.constants';
import { LIST_TOOLBAR_CONTROL_HEIGHT } from '../list-search-field/list-search-field.component';

type IconActionVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost-teal' | 'ghost-red';

@Component({
  selector: 'app-icon-action',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type"
      [disabled]="disabled"
      [attr.aria-label]="label"
      [title]="label"
      [class]="buttonClass"
      (click)="clicked.emit($event)">
      <ng-content></ng-content>
      <span *ngIf="!iconOnly" class="hidden sm:inline">{{ label }}</span>
    </button>
  `,
})
export class IconActionComponent {
  @Input() label = '';
  @Input() iconOnly = false;
  @Input() type: 'button' | 'submit' = 'button';
  @Input() disabled = false;
  @Input() variant: IconActionVariant = 'primary';
  @Output() clicked = new EventEmitter<Event>();

  get buttonClass(): string {
    const base =
      `inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold w-[36px] p-0 sm:w-auto sm:min-h-[36px] sm:px-3 sm:py-1.5 sm:min-w-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;
    const variants: Record<IconActionVariant, string> = {
      primary: 'bg-teal-600 text-white hover:bg-teal-700',
      secondary: 'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      outline:
        'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
      'ghost-teal': 'text-teal-600 hover:bg-teal-50',
      'ghost-red': 'text-red-500 hover:bg-red-50',
    };
    return `${base} ${variants[this.variant]}`;
  }
}

/** Shared classes for routerLink / anchor primary actions on list pages. */
export const ICON_ACTION_LINK_CLASS =
  `inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold w-[36px] p-0 sm:w-auto sm:min-h-[36px] sm:px-3 sm:py-1.5 sm:min-w-0 transition-colors bg-teal-600 text-white hover:bg-teal-700 ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;

/** Botón secundario con borde en filas de toolbar (misma altura que el buscador). */
export const ICON_TOOLBAR_OUTLINE_LINK_CLASS =
  `inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 w-[36px] p-0 sm:w-auto sm:px-2.5 sm:py-1.5 ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;

export const PAGE_SHELL_CLASS = 'p-4 sm:p-6 lg:p-8 w-full min-w-0';

/** Subtítulo bajo el título de página: oculto en celular, visible desde sm. */
export const PAGE_DESC_CLASS = 'text-sm sm:text-base text-gray-500 desc-lg-only';

export {
  LIST_SEARCH_INPUT_CLASS as TABLE_SEARCH_INPUT_CLASS,
  LIST_SEARCH_MOBILE_HEADER_CLASS as MOBILE_HEADER_SEARCH_INPUT_CLASS,
  LIST_SEARCH_DESKTOP_WRAP_CLASS as DESKTOP_LIST_SEARCH_WRAP_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
  LIST_TOOLBAR_ROW_CLASS,
} from '../list-search-field/list-search-field.component';

/** Standard clickable table row (open edit/detail on click). */
export const LIST_TABLE_ROW_CLASS = 'hover:bg-gray-50 transition-colors cursor-pointer';

/** Oculto en celular (<640px); usar junto con `grid` en filas de KPIs/resumen. */
export const MODULE_SUMMARY_KPIS_CLASS = 'module-summary-kpis';

export const TABLE_SCROLL_CLASS = 'app-table-scroll-host -mx-4 sm:mx-0 px-4 sm:px-0';

/** Añadir a tablas de listado: filas bajas y sin thead en celular. */
export { NATIVE_COMPACT_TABLE_CLASS };

export const TABLE_MIN_WIDTH_CLASS = NATIVE_COMPACT_TABLE_CLASS + ' w-full max-w-full';

export const FORM_CONTROL_CLASS =
  'form-control w-full outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400';

export const FORM_LABEL_CLASS = 'form-label';

export const FORM_SUBMIT_CLASS =
  'form-btn-primary rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60';

export const FORM_CANCEL_CLASS =
  'form-btn-secondary rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
