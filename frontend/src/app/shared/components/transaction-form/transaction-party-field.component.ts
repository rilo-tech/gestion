import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TRANSACTION_COMPACT_LABEL_CLASS } from './transaction-form.constants';

@Component({
  selector: 'app-transaction-party-field',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div>
      <div class="flex items-center justify-between gap-3 mb-0.5 sm:mb-1">
        <label [class]="labelClass">{{ label }}</label>
        <button
          *ngIf="showCreateAction"
          type="button"
          (click)="createClick.emit()"
          class="text-xs sm:text-sm font-medium text-teal-700 hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-300 hover:underline shrink-0">
          {{ createActionLabel }}
        </button>
      </div>
      <ng-content></ng-content>
    </div>
  `,
})
export class TransactionPartyFieldComponent {
  @Input() label = 'Cliente';
  @Input() showCreateAction = true;
  @Input() createActionLabel = '+ Nuevo';

  @Output() createClick = new EventEmitter<void>();

  readonly labelClass = TRANSACTION_COMPACT_LABEL_CLASS;
}
