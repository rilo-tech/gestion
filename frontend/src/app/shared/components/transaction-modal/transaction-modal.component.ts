import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-transaction-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      *ngIf="open"
      class="fixed inset-0"
      [class]="layout === 'fullscreen' ? 'z-50 flex flex-col bg-white' : zIndexClass + ' flex items-center justify-center p-4'"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="title ? titleId : null">
      <button
        *ngIf="layout === 'dialog'"
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="closed.emit()">
      </button>

      <div
        class="relative w-full mx-0 sm:mx-auto flex flex-col min-h-0"
        [class.max-h-[92vh]]="layout === 'dialog'"
        [class.sm:max-h-[90vh]]="layout === 'dialog'"
        [class.flex-1]="layout === 'fullscreen'"
        [ngClass]="layout === 'dialog' ? maxWidthClass + ' overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl p-4 sm:p-6' : ''">
        <header
          class="shrink-0"
          [class.border-b]="layout === 'fullscreen'"
          [class.border-gray-100]="layout === 'fullscreen'"
          [class.px-4]="layout === 'fullscreen'"
          [class.sm:px-6]="layout === 'fullscreen'"
          [class.lg:px-8]="layout === 'fullscreen'"
          [class.py-4]="layout === 'fullscreen'"
          [class.mb-0]="layout === 'dialog'"
          [class.mb-4]="layout === 'dialog' && (title || subtitle)">
          <div
            class="flex items-start justify-between gap-4"
            [class.max-w-7xl]="layout === 'fullscreen'"
            [class.mx-auto]="layout === 'fullscreen'"
            [class.w-full]="layout === 'fullscreen'">
            <div class="min-w-0">
              <h2
                *ngIf="title"
                [id]="titleId"
                class="font-bold text-gray-900"
                [class.text-lg]="layout === 'dialog'"
                [class.text-xl]="layout === 'fullscreen'"
                [class.mb-1]="layout === 'dialog'">
                {{ title }}
              </h2>
              <p
                *ngIf="subtitle"
                class="text-sm text-gray-500"
                [class.mt-1]="layout === 'fullscreen'">
                {{ subtitle }}
              </p>
            </div>
            <button
              *ngIf="layout === 'fullscreen'"
              type="button"
              (click)="closed.emit()"
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shrink-0">
              <i-lucide name="x" class="w-4 h-4"></i-lucide>
              Cerrar
            </button>
          </div>
        </header>

        <div
          class="min-h-0"
          [class.overflow-y-auto]="layout === 'fullscreen'"
          [class.flex-1]="layout === 'fullscreen'"
          [class.px-4]="layout === 'fullscreen'"
          [class.sm:px-6]="layout === 'fullscreen'"
          [class.lg:px-8]="layout === 'fullscreen'"
          [class.py-6]="layout === 'fullscreen'">
          <div [class.max-w-7xl]="layout === 'fullscreen'" [class.mx-auto]="layout === 'fullscreen'" [class.w-full]="layout === 'fullscreen'">
            <ng-content></ng-content>
          </div>
        </div>
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
  @Input() layout: 'dialog' | 'fullscreen' = 'dialog';
  @Output() closed = new EventEmitter<void>();

  readonly titleId = `transaction-modal-title-${Math.random().toString(36).slice(2, 9)}`;
}
