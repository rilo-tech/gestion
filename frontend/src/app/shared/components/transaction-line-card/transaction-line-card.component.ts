import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

export type TransactionLineProductMode = 'select' | 'readonly' | 'link';

export interface TransactionLineSelectOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-transaction-line-card',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <div class="px-3 sm:px-4 py-2.5 sm:py-3 space-y-2">
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
        <div [class]="productColClass + ' min-w-0'">
          <label *ngIf="showLabels" class="block text-xs font-medium text-gray-500 mb-1">Producto</label>

          <select
            *ngIf="productMode === 'select'"
            [ngModel]="stockItemId"
            (ngModelChange)="stockItemIdChange.emit($event)"
            [name]="fieldPrefix + 'Product' + index"
            [disabled]="readOnly"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50">
            <option value="">Seleccionar...</option>
            <option *ngFor="let option of productOptions" [value]="option.value">{{ option.label }}</option>
          </select>

          <button
            *ngIf="productMode === 'link'"
            type="button"
            (click)="productClick.emit()"
            class="w-full text-left font-medium text-gray-900 truncate leading-snug hover:text-teal-700 hover:underline"
            [title]="'Abrir producto: ' + productName">
            {{ productName }}
          </button>

          <div *ngIf="productMode === 'readonly'" class="min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate">{{ productName || 'Producto' }}</p>
            <span *ngIf="productBadge" class="text-[10px] font-semibold uppercase" [ngClass]="productBadgeClass">
              {{ productBadge }}
            </span>
          </div>

          <ng-content select="[productExtra]"></ng-content>
        </div>

        <ng-content select="[lineFields]"></ng-content>

        <div *ngIf="showActions" [class]="actionsColClass + ' flex gap-1 justify-end sm:justify-start items-end'">
          <button
            *ngIf="canRemove"
            type="button"
            (click)="remove.emit()"
            [disabled]="removeDisabled"
            class="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
            [attr.aria-label]="removeLabel"
            [title]="removeLabel">
            <i-lucide [name]="removeIcon" class="w-4 h-4"></i-lucide>
          </button>
          <button
            *ngIf="showAddOnLast"
            type="button"
            (click)="addLine.emit()"
            class="p-2 rounded-lg text-teal-600 hover:bg-teal-50"
            aria-label="Agregar línea"
            title="Agregar línea">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </button>
        </div>
      </div>

      <div *ngIf="hasMetaRow" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-snug">
        <ng-content select="[lineMeta]"></ng-content>
      </div>

      <ng-content select="[lineFooter]"></ng-content>
    </div>
  `,
})
export class TransactionLineCardComponent {
  @Input() index = 0;
  @Input() showLabels = false;
  @Input() readOnly = false;
  @Input() fieldPrefix = 'line';
  @Input() productMode: TransactionLineProductMode = 'readonly';
  @Input() productName = '';
  @Input() productBadge = '';
  @Input() productBadgeClass = 'text-teal-600';
  @Input() stockItemId = '';
  @Input() productOptions: TransactionLineSelectOption[] = [];
  @Input() showActions = true;
  @Input() canRemove = true;
  @Input() removeDisabled = false;
  @Input() showAddOnLast = false;
  @Input() removeIcon: 'minus' | 'trash-2' | 'x' = 'minus';
  @Input() removeLabel = 'Quitar línea';
  @Input() hasMetaRow = false;
  @Input() productColClass = 'sm:col-span-5';
  @Input() actionsColClass = 'sm:col-span-2';

  @Output() stockItemIdChange = new EventEmitter<string>();
  @Output() productClick = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() addLine = new EventEmitter<void>();
}
