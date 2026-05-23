import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transaction-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      *ngIf="open"
      class="fixed inset-0 flex items-center justify-center p-4"
      [class]="zIndexClass"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="title ? titleId : null">
      <button
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="closed.emit()">
      </button>

      <div
        class="relative w-full max-h-[92vh] sm:max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl p-4 sm:p-6 mx-0 sm:mx-auto"
        [ngClass]="maxWidthClass">
        <h2 *ngIf="title" [id]="titleId" class="text-lg font-bold text-gray-900 mb-1">{{ title }}</h2>
        <p *ngIf="subtitle" class="text-sm text-gray-500 mb-4">{{ subtitle }}</p>
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class TransactionModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle = '';
  @Input() maxWidthClass = 'max-w-2xl';
  @Input() zIndexClass = 'z-50';
  @Output() closed = new EventEmitter<void>();

  readonly titleId = `transaction-modal-title-${Math.random().toString(36).slice(2, 9)}`;
}
