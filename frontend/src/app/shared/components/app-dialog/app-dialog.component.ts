import { Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { DialogRequest, DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      *ngIf="request"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="onCancel()">
      </button>

      <div class="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
        <div class="mb-4 flex items-start gap-4">
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            [ngClass]="iconWrapperClass">
            <i-lucide [name]="iconName" class="h-5 w-5"></i-lucide>
          </div>
          <div class="min-w-0 pt-0.5">
            <h2 class="text-lg font-bold text-gray-900">{{ title }}</h2>
            <p class="mt-2 text-sm leading-relaxed text-gray-600">{{ request.options.message }}</p>
          </div>
        </div>

        <div class="flex justify-end gap-3">
          <button
            *ngIf="request.type === 'confirm'"
            type="button"
            (click)="onCancel()"
            class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            (click)="onConfirm()"
            class="rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
            [ngClass]="confirmButtonClass">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class AppDialogComponent implements OnInit, OnDestroy {
  private dialogService = inject(DialogService);
  private sub?: Subscription;

  request: DialogRequest | null = null;

  ngOnInit() {
    this.sub = this.dialogService.request$.subscribe((request) => {
      this.request = request;
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.request) return;
    this.onCancel();
  }

  get title(): string {
    if (!this.request) return '';
    return this.request.options.title ?? (this.request.type === 'confirm' ? 'Confirmar acción' : 'Aviso');
  }

  get confirmLabel(): string {
    if (!this.request) return 'Aceptar';
    if (this.request.type === 'alert') {
      return this.request.options.confirmLabel ?? 'Entendido';
    }
    return this.request.options.confirmLabel ?? 'Confirmar';
  }

  get cancelLabel(): string {
    if (!this.request || this.request.type !== 'confirm') return 'Cancelar';
    return this.request.options.cancelLabel ?? 'Cancelar';
  }

  get isDanger(): boolean {
    return this.request?.type === 'confirm' && this.request.options.variant === 'danger';
  }

  get iconName(): string {
    if (this.request?.type === 'alert') return 'alert-circle';
    return this.isDanger ? 'trash-2' : 'alert-circle';
  }

  get iconWrapperClass(): string {
    if (this.request?.type === 'alert') {
      return 'bg-teal-50 text-teal-600';
    }
    return this.isDanger ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-600';
  }

  get confirmButtonClass(): string {
    if (this.request?.type === 'alert') {
      return 'bg-primary text-white hover:bg-teal-700';
    }
    return this.isDanger
      ? 'bg-red-600 text-white hover:bg-red-700'
      : 'bg-primary text-white hover:bg-teal-700';
  }

  onConfirm() {
    if (!this.request) return;

    if (this.request.type === 'confirm') {
      this.request.result.next(true);
      this.request.result.complete();
    } else {
      this.request.result.next();
      this.request.result.complete();
    }

    this.dialogService.dismiss();
  }

  onCancel() {
    if (!this.request) return;

    if (this.request.type === 'confirm') {
      this.request.result.next(false);
      this.request.result.complete();
    }

    this.dialogService.dismiss();
  }
}
