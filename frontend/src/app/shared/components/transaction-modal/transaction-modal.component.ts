import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { FormBackButtonComponent } from '../form-shell/form-back-button.component';

@Component({
  selector: 'app-transaction-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormBackButtonComponent],
  template: `
    <div
      *ngIf="open"
      [class]="layout === 'fullscreen'
        ? 'fixed top-14 left-0 right-0 bottom-0 lg:left-64 z-40 flex flex-col bg-gray-50 min-h-0'
        : 'fixed inset-0 ' + zIndexClass + ' flex items-end sm:items-center justify-center sm:p-4'"
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

      <!-- Pantalla completa: mismo layout que páginas de pedido/venta -->
      <div *ngIf="layout === 'fullscreen'" class="relative flex flex-1 flex-col min-h-0 w-full overflow-y-auto">
        <div class="p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
          <div class="mb-6 flex flex-col gap-3 sm:gap-4 max-w-7xl mx-auto w-full">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <h2
                  *ngIf="title"
                  [id]="titleId"
                  class="text-xl sm:text-2xl font-bold text-gray-900">
                  {{ title }}
                </h2>
                <p
                  *ngIf="subtitle"
                  class="text-sm text-gray-500 mt-1 desc-lg-only"
                  [class.hidden]="hideSubtitleOnMobile"
                  [class.sm:block]="hideSubtitleOnMobile">
                  {{ subtitle }}
                </p>
              </div>
              <app-form-back-button
                [icon]="fullscreenCloseIcon"
                [label]="fullscreenCloseLabel"
                shortLabel="Volver"
                [ariaLabel]="fullscreenCloseLabel"
                (clicked)="closed.emit()">
              </app-form-back-button>
            </div>
            <div *ngIf="layout === 'fullscreen'" class="flex flex-wrap items-center gap-2">
              <ng-content select="[headerActions]"></ng-content>
            </div>
          </div>

          <div class="max-w-7xl mx-auto w-full">
            <ng-content></ng-content>
          </div>
        </div>
      </div>

      <!-- Diálogo modal -->
      <div
        *ngIf="layout === 'dialog'"
        class="relative w-full mx-0 sm:mx-auto flex flex-col min-h-0"
        [ngClass]="maxWidthClass + ' max-h-[min(92dvh,100%)] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-gray-100 bg-white shadow-2xl ' + (compact ? 'p-4 sm:p-5' : 'p-5 sm:p-6')">
        <div
          class="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-gray-300 sm:hidden"
          aria-hidden="true">
        </div>

        <header
          class="shrink-0"
          [class.mb-3]="compact && (title || subtitle)"
          [class.mb-4]="!compact && (title || subtitle)">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2
                *ngIf="title"
                [id]="titleId"
                class="font-bold text-gray-900"
                [class.text-lg]="compact"
                [class.text-xl]="!compact"
                [class.mb-0]="compact"
                [class.mb-1]="!compact">
                {{ title }}
              </h2>
              <p
                *ngIf="subtitle"
                class="text-sm text-gray-500"
                [class.hidden]="hideSubtitleOnMobile"
                [class.sm:block]="hideSubtitleOnMobile">
                {{ subtitle }}
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0 -mr-1">
              <ng-content select="[headerActions]"></ng-content>
              <button
                type="button"
                (click)="closed.emit()"
                class="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0"
                aria-label="Cerrar">
                <i-lucide name="x" class="w-5 h-5"></i-lucide>
              </button>
            </div>
          </div>
        </header>

        <div class="min-h-0 pb-safe-dialog">
          <ng-content></ng-content>
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
  @Input() hideSubtitleOnMobile = true;
  /** Botón superior en pantalla completa: cerrar (X) o volver (flecha). */
  @Input() fullscreenCloseIcon: 'x' | 'arrow-left' = 'x';
  @Input() fullscreenCloseLabel = 'Cerrar';
  @Output() closed = new EventEmitter<void>();

  readonly titleId = `transaction-modal-title-${Math.random().toString(36).slice(2, 9)}`;
}
