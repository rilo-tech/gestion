import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-duplicate-action-button',
  standalone: true,
  host: { class: 'inline-flex shrink-0' },
  imports: [CommonModule, LucideAngularModule],
  template: `
    <button
      type="button"
      [disabled]="disabled"
      [attr.title]="label"
      [attr.aria-label]="label"
      [class]="buttonClass"
      (click)="onClick($event)">
      <i-lucide name="copy" class="w-4 h-4 shrink-0"></i-lucide>
      <span *ngIf="!iconOnly" class="text-xs font-medium">{{ label }}</span>
    </button>
  `,
})
export class DuplicateActionButtonComponent {
  @Input() label = 'Duplicar';
  @Input() iconOnly = true;
  @Input() disabled = false;
  @Input() variant: 'ghost' | 'outline' | 'dark' = 'ghost';
  @Output() duplicateClick = new EventEmitter<Event>();

  onClick(event: Event) {
    event.stopPropagation();
    if (this.disabled) return;
    this.duplicateClick.emit(event);
  }

  get buttonClass(): string {
    const base =
      'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const variants: Record<'ghost' | 'outline' | 'dark', string> = {
      ghost: 'p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900',
      outline:
        'p-2 sm:p-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px]',
      dark: 'flex-1 py-2 px-2.5 border border-gray-700 bg-gray-800/50 text-gray-200 hover:bg-gray-800',
    };
    return `${base} ${variants[this.variant]}`;
  }
}
