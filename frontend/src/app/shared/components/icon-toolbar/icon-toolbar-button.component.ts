import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

export type IconToolbarVariant = 'primary' | 'success' | 'outline' | 'danger' | 'teal-outline' | 'orange-outline' | 'ghost-teal' | 'ghost-gray' | 'ghost-red';
export type IconToolbarSize = 'row' | 'header';

@Component({
  selector: 'app-icon-toolbar-button',
  standalone: true,
  host: { class: 'inline-flex shrink-0' },
  imports: [CommonModule, LucideAngularModule],
  template: `
    <button
      type="button"
      [disabled]="disabled || loading"
      [title]="label"
      [attr.aria-label]="label"
      [class]="buttonClass"
      (click)="onClick($event)">
      <i-lucide [name]="displayIcon" [class]="iconClass"></i-lucide>
    </button>
  `,
})
export class IconToolbarButtonComponent {
  @Input() icon = 'pencil';
  @Input() label = '';
  @Input() variant: IconToolbarVariant = 'outline';
  @Input() size: IconToolbarSize = 'header';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() loadingIcon = 'clock';
  @Output() clicked = new EventEmitter<Event>();

  onClick(event: Event) {
    event.stopPropagation();
    if (this.disabled || this.loading) return;
    this.clicked.emit(event);
  }

  get displayIcon(): string {
    return this.loading ? this.loadingIcon : this.icon;
  }

  get iconClass(): string {
    const base = 'w-4 h-4 shrink-0';
    return this.loading ? `${base} animate-pulse` : base;
  }

  get buttonClass(): string {
    const rowBase = 'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
    const headerBase =
      'inline-flex items-center justify-center transition-all disabled:cursor-not-allowed disabled:opacity-60';

    if (this.size === 'row') {
      const rowVariants: Record<IconToolbarVariant, string> = {
        primary: 'p-2 text-teal-600 hover:bg-teal-50 hover:text-teal-800',
        success: 'p-2 text-green-600 hover:bg-green-50',
        outline: 'p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        danger: 'p-2 text-red-500 hover:bg-red-50 hover:text-red-700',
        'teal-outline': 'p-2 text-teal-600 hover:bg-teal-50 hover:text-teal-800',
        'orange-outline': 'p-2 text-orange-600 hover:bg-orange-50 hover:text-orange-800',
        'ghost-teal': 'p-2 text-teal-600 hover:bg-teal-50 hover:text-teal-800',
        'ghost-gray': 'p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        'ghost-red': 'p-2 text-red-500 hover:bg-red-50 hover:text-red-700',
      };
      return `${rowBase} ${rowVariants[this.variant]}`;
    }

    const headerVariants: Record<IconToolbarVariant, string> = {
      primary: 'rounded-xl p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] bg-teal-600 text-white hover:bg-teal-700',
      success: 'rounded-xl p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] bg-green-600 text-white hover:bg-green-700',
      outline:
        'rounded-lg border border-gray-200 dark:border-gray-700 p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] text-gray-600 hover:bg-gray-100 hover:text-gray-900 bg-white dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800',
      danger:
        'rounded-lg border border-gray-200 dark:border-gray-700 p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 bg-white dark:bg-gray-900',
      'teal-outline':
        'rounded-lg border border-teal-300 dark:border-teal-700 p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40 bg-white dark:bg-gray-900',
      'orange-outline':
        'rounded-lg border border-orange-200 dark:border-orange-800 p-2 sm:p-2.5 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/40 bg-white dark:bg-gray-900',
      'ghost-teal': 'rounded-lg p-2.5 min-h-[40px] min-w-[40px] text-teal-600 hover:bg-teal-50',
      'ghost-gray': 'rounded-lg p-2.5 min-h-[40px] min-w-[40px] text-gray-600 hover:bg-gray-100',
      'ghost-red': 'rounded-lg p-2.5 min-h-[40px] min-w-[40px] text-red-500 hover:bg-red-50',
    };
    return `${headerBase} ${headerVariants[this.variant]}`;
  }
}
