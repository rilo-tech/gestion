import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TRANSACTION_COMPACT_FIELD_CLASS,
  TRANSACTION_COMPACT_LABEL_CLASS,
  TRANSACTION_COMPACT_LABEL_INLINE_CLASS,
  TRANSACTION_COMPACT_LABEL_ROW_CLASS,
} from './transaction-form.constants';

@Component({
  selector: 'app-transaction-date-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="min-w-0"
      [ngClass]="
        showTime
          ? 'grid grid-cols-[minmax(0,1fr)_7.25rem] sm:grid-cols-[minmax(0,1fr)_6.5rem] gap-2 sm:gap-3'
          : null
      ">
      <div class="min-w-0">
        <div [class]="labelRowClass">
          <label [class]="inlineLabelClass">{{ label }}</label>
        </div>
        <input
          type="date"
          [ngModel]="date"
          (ngModelChange)="dateChange.emit($event)"
          [name]="fieldName"
          [disabled]="disabled"
          [class]="fieldClass + ' form-control'" />
      </div>
      <div *ngIf="showTime" class="min-w-0">
        <div [class]="labelRowClass">
          <label [class]="inlineLabelClass">{{ timeLabel }}</label>
        </div>
        <input
          type="time"
          [ngModel]="time"
          (ngModelChange)="timeChange.emit($event)"
          [name]="timeFieldName"
          [disabled]="disabled"
          [class]="fieldClass + ' form-control tabular-nums text-center sm:text-left'" />
      </div>
    </div>
  `,
})
export class TransactionDateFieldComponent {
  @Input() date = '';
  @Input() time = '';
  @Input() label = 'Fecha';
  @Input() timeLabel = 'Hora';
  @Input() fieldName = 'txnDate';
  @Input() timeFieldName = 'txnTime';
  @Input() showTime = false;
  @Input() disabled = false;

  @Output() dateChange = new EventEmitter<string>();
  @Output() timeChange = new EventEmitter<string>();

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;
  readonly labelClass = TRANSACTION_COMPACT_LABEL_CLASS;
  readonly labelRowClass = TRANSACTION_COMPACT_LABEL_ROW_CLASS;
  readonly inlineLabelClass = TRANSACTION_COMPACT_LABEL_INLINE_CLASS;
}
