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
      [class]="layout === 'fullscreen'
        ? 'z-50 flex flex-col bg-white'
        : zIndexClass + ' flex items-end sm:items-center justify-center sm:p-4'"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="title ? titleId : null">
      <button
        *ngIf="layout === 'dialog'"
        type="button"
        class="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-label="Cerrar"
        (click)="closed.emit()">
      </button>

      <div
        class="relative w-full mx-0 sm:mx-auto flex flex-col min-h-0"
        [class.flex-1]="layout === 'fullscreen'"
        [ngClass]="layout === 'dialog'
          ? maxWidthClass + ' max-h-[min(92dvh,100%)] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-gray-100 bg-white shadow-2xl ' + (compact ? 'p-4 sm:p-5' : 'p-5 sm:p-6')
          : ''">
        <div
          *ngIf="layout === 'dialog'"
          class="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-gray-300 sm:hidden"
          aria-hidden="true">
        </div>

        <header
          class="shrink-0"
          [class.border-b]="layout === 'fullscreen'"
          [class.border-gray-100]="layout === 'fullscreen'"
          [class.px-4]="layout === 'fullscreen'"
          [class.sm:px-6]="layout === 'fullscreen'"
          [class.lg:px-8]="layout === 'fullscreen'"
          [class.py-4]="layout === 'fullscreen'"
          [class.mb-0]="layout === 'dialog'"
          [class.mb-3]="layout === 'dialog' && compact && (title || subtitle)"
          [class.mb-4]="layout === 'dialog' && !compact && (title || subtitle)">
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
                [class.text-lg]="layout === 'dialog' && compact"
                [class.text-xl]="layout === 'dialog' && !compact"
                [class.text-2xl]="layout === 'fullscreen'"
                [class.mb-0]="layout === 'dialog' && compact"
                [class.mb-1]="layout === 'dialog' && !compact">
                {{ title }}
              </h2>
              <p
                *ngIf="subtitle"
                class="text-sm text-gray-500"
                [class.hidden]="hideSubtitleOnMobile"
                [class.sm:block]="hideSubtitleOnMobile"
                [class.mt-1]="layout === 'fullscreen'">
                {{ subtitle }}
              </p>
            </div>
            <button
              *ngIf="layout === 'fullscreen'"
              type="button"
              (click)="closed.emit()"
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shrink-0 min-h-[44px]">
              <i-lucide name="x" class="w-4 h-4"></i-lucide>
              Cerrar
            </button>
            <button
              *ngIf="layout === 'dialog'"
              type="button"
              (click)="closed.emit()"
              class="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0 -mr-1"
              aria-label="Cerrar">
              <i-lucide name="x" class="w-5 h-5"></i-lucide>
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
          [class.py-6]="layout === 'fullscreen'"
          [class.pb-safe-dialog]="layout === 'dialog'">
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
  /** Menos padding y título más chico en diálogos. */
  @Input() compact = false;
  /** Oculta el subtítulo en pantallas chicas. */
  @Input() hideSubtitleOnMobile = false;
  @Output() closed = new EventEmitter<void>();

  readonly titleId = `transaction-modal-title-${Math.random().toString(36).slice(2, 9)}`;
}
