import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TRANSACTION_COMPACT_FIELD_CLASS,
  TRANSACTION_COMPACT_LABEL_CLASS,
} from './transaction-form.constants';

export interface TransactionPaymentMedioOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-transaction-payment-simple',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div>
      <p *ngIf="title" class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 sm:mb-3">{{ title }}</p>
      <div class="space-y-2 sm:space-y-3">
        <div class="grid grid-cols-2 gap-2 sm:gap-4">
          <div *ngIf="showAmount">
            <label [class]="labelClass">{{ amountLabel }}</label>
            <input
              type="number"
              [ngModel]="amount"
              (ngModelChange)="onAmountChange($event)"
              [name]="amountFieldName"
              min="0"
              [disabled]="amountDisabled"
              [class]="fieldClass"
              [class.border-red-300]="amountError"
              [class.dark:border-red-700]="amountError"
              [class.border-gray-200]="!amountError"
              [class.dark:border-gray-700]="!amountError">
            <ng-content select="[amountFooter]"></ng-content>
            <p *ngIf="amountError && !hasAmountFooter" class="text-[10px] sm:text-xs text-red-600 mt-1">{{ amountError }}</p>
            <p *ngIf="!amountError && amountHint && !hasAmountFooter" class="text-[10px] sm:text-xs text-gray-400 mt-1">{{ amountHint }}</p>
          </div>
          <div>
            <label [class]="labelClass">{{ methodLabel }}</label>
            <select
              [ngModel]="method"
              (ngModelChange)="onMethodChange($event)"
              [name]="methodFieldName"
              [disabled]="methodDisabled"
              [class]="fieldClass + ' form-control bg-white dark:bg-gray-900'">
              <option *ngFor="let option of medios" [ngValue]="option.value">{{ option.label }}</option>
            </select>
          </div>
          <ng-content select="[extraFields]"></ng-content>
        </div>
        <ng-content select="[footer]"></ng-content>
      </div>
    </div>
  `,
})
export class TransactionPaymentSimpleComponent {
  @Input() title = '';
  @Input() showAmount = true;
  @Input() amount: number | null = null;
  @Input() method = 'efectivo';
  @Input() amountLabel = 'Monto a cobrar ahora';
  @Input() methodLabel = 'Medio de pago';
  @Input() amountFieldName = 'txnPaymentAmount';
  @Input() methodFieldName = 'txnPaymentMethod';
  @Input() amountDisabled = false;
  @Input() methodDisabled = false;
  @Input() amountError = '';
  @Input() amountHint = '';
  @Input() medios: TransactionPaymentMedioOption[] = [
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'otro', label: 'Otro' },
  ];
  @Input() hasAmountFooter = false;

  @Output() amountChange = new EventEmitter<number | null>();
  @Output() methodChange = new EventEmitter<string>();

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;
  readonly labelClass = TRANSACTION_COMPACT_LABEL_CLASS;

  onAmountChange(value: number | null): void {
    this.amountChange.emit(value);
  }

  onMethodChange(value: string): void {
    this.methodChange.emit(value);
  }
}
