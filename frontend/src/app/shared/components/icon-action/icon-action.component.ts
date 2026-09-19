import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
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
      `inline-flex items-center justify-center gap-1.5 rounded-lg text-xs sm:text-sm font-semibold w-[40px] p-0 sm:w-auto sm:min-h-[40px] sm:px-3 sm:py-2 sm:min-w-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;
    const variants: Record<IconActionVariant, string> = {
      primary: 'bg-teal-600 text-white hover:bg-teal-700',
      secondary: 'border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/50',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      outline:
        'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
      'ghost-teal': 'text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/50',
      'ghost-red': 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40',
    };
    return `${base} ${variants[this.variant]}`;
  }
}

/** Shared classes for routerLink / anchor primary actions on list pages. */
export const ICON_ACTION_LINK_CLASS =
  `inline-flex items-center justify-center gap-1.5 rounded-lg text-xs sm:text-sm font-semibold w-[40px] p-0 sm:w-auto sm:min-h-[40px] sm:px-3 sm:py-2 sm:min-w-0 transition-colors bg-teal-600 text-white hover:bg-teal-700 ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;

/** Botón secundario con borde en filas de toolbar (misma altura que el buscador). */
export const ICON_TOOLBAR_OUTLINE_LINK_CLASS =
  `inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 w-[40px] p-0 sm:w-auto sm:px-2.5 sm:py-2 ${LIST_TOOLBAR_CONTROL_HEIGHT} sm:h-auto`;

/** @deprecated Prefer `shared/ui.constants` — se mantiene por compatibilidad. */
export {
  PAGE_SHELL_CLASS,
  PAGE_CONTENT_MAX_CLASS,
  PAGE_DESC_CLASS,
  PAGE_TITLE_CLASS,
  PAGE_TITLE_COMPACT_CLASS,
  TABLE_SEARCH_INPUT_CLASS,
  MOBILE_HEADER_SEARCH_INPUT_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
  LIST_TOOLBAR_ROW_CLASS,
  LIST_TABLE_ROW_CLASS,
  MODULE_SUMMARY_KPIS_CLASS,
  TABLE_SCROLL_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  FORM_CONTROL_CLASS,
  FORM_LABEL_CLASS,
  FORM_SUBMIT_CLASS,
  FORM_CANCEL_CLASS,
  FORM_DANGER_CLASS,
} from '../../ui.constants';
