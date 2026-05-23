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
      <span class="hidden sm:inline">{{ label }}</span>
    </button>
  `,
})
export class IconActionComponent {
  @Input() label = '';
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

export const PAGE_SHELL_CLASS = 'p-4 sm:p-6 lg:p-8';

export const TABLE_SCROLL_CLASS = 'overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0';

export const TABLE_MIN_WIDTH_CLASS = 'w-full min-w-[640px] text-left border-collapse';
