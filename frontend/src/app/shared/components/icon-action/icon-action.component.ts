import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

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
      'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold p-2.5 sm:px-4 sm:py-2 min-h-[42px] min-w-[42px] sm:min-w-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
    const variants: Record<IconActionVariant, string> = {
      primary: 'bg-teal-600 text-white hover:bg-teal-700',
      secondary: 'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      outline: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
      'ghost-teal': 'text-teal-600 hover:bg-teal-50',
      'ghost-red': 'text-red-500 hover:bg-red-50',
    };
    return `${base} ${variants[this.variant]}`;
  }
}

/** Shared classes for routerLink / anchor primary actions on list pages. */
export const ICON_ACTION_LINK_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold p-2.5 sm:px-4 sm:py-2 min-h-[42px] min-w-[42px] sm:min-w-0 transition-colors bg-primary text-white hover:bg-opacity-90';

export const PAGE_SHELL_CLASS = 'p-4 sm:p-6 lg:p-8 w-full min-w-0';

/** Oculto en celular (<640px); usar junto con `grid` en filas de KPIs/resumen. */
export const MODULE_SUMMARY_KPIS_CLASS = 'module-summary-kpis';

export const TABLE_SCROLL_CLASS = 'overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0';

export const TABLE_MIN_WIDTH_CLASS = 'w-full text-left border-collapse sm:min-w-[640px]';

export const FORM_CONTROL_CLASS =
  'form-control w-full outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-400';

export const FORM_LABEL_CLASS = 'form-label';

export const FORM_SUBMIT_CLASS =
  'form-btn-primary rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60';

export const FORM_CANCEL_CLASS =
  'form-btn-secondary rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
