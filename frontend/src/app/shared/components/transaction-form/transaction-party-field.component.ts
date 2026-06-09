import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TRANSACTION_COMPACT_LABEL_INLINE_CLASS,
  TRANSACTION_PICKER_OVERLAY_HOST_CLASS,
} from './transaction-form.constants';

@Component({
  selector: 'app-transaction-party-field',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-w-0">
      <div class="flex items-center justify-between gap-2 mb-1">
        <label [class]="headerLabelClass">{{ label }}</label>
        <button
          *ngIf="showCreateAction"
          type="button"
          (click)="createClick.emit()"
          class="text-xs sm:text-sm font-medium text-teal-700 hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-300 hover:underline shrink-0">
          {{ createActionLabel }}
        </button>
      </div>
      <div [class]="pickerHostClass">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class TransactionPartyFieldComponent {
  @Input() label = 'Cliente';
  @Input() showCreateAction = true;
  @Input() createActionLabel = '+ Nuevo';

  @Output() createClick = new EventEmitter<void>();

  readonly headerLabelClass = TRANSACTION_COMPACT_LABEL_INLINE_CLASS;
  readonly pickerHostClass = TRANSACTION_PICKER_OVERLAY_HOST_CLASS;
}
