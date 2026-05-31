import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TRANSACTION_COMPACT_FIELD_CLASS,
  TRANSACTION_COMPACT_LABEL_CLASS,
} from './transaction-form.constants';

@Component({
  selector: 'app-transaction-notes-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div>
      <label [class]="labelClass">{{ label }}</label>
      <textarea
        [ngModel]="notes"
        (ngModelChange)="notesChange.emit($event)"
        [name]="fieldName"
        [rows]="rows"
        [disabled]="disabled"
        [placeholder]="placeholder"
        [class]="fieldClass"></textarea>
    </div>
  `,
})
export class TransactionNotesFieldComponent {
  @Input() notes = '';
  @Input() label = 'Notas (opcional)';
  @Input() fieldName = 'txnNotes';
  @Input() rows = 2;
  @Input() disabled = false;
  @Input() placeholder = '';

  @Output() notesChange = new EventEmitter<string>();

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;
  readonly labelClass = TRANSACTION_COMPACT_LABEL_CLASS;
}
