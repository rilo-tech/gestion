import { Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { DialogRequest, DialogService, DialogVariant } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      *ngIf="request"
      class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-label="Cerrar"
        (click)="onCancel()">
      </button>

      <div
        class="relative flex w-full max-w-md max-h-[min(90dvh,34rem)] flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
        <div class="mb-4 flex min-h-0 flex-1 items-start gap-4 overflow-hidden">
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            [ngClass]="iconWrapperClass">
            <i-lucide [name]="iconName" class="h-5 w-5"></i-lucide>
          </div>
          <div class="min-h-0 min-w-0 flex-1 overflow-y-auto pt-0.5">
            <h2 class="text-lg font-bold text-gray-900">{{ title }}</h2>
            <p class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300 whitespace-pre-line">{{ request.options.message }}</p>
          </div>
        </div>

        <div
          *ngIf="request.type !== 'choice'"
          class="flex shrink-0 justify-end gap-3 border-t border-gray-100 pt-4">
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

        <div
          *ngIf="request.type === 'choice'"
          class="flex shrink-0 flex-col gap-2.5 border-t border-gray-100 pt-4">
          <button
            *ngFor="let opt of request.options.options"
            type="button"
            (click)="onChoice(opt.id)"
            class="rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
            [ngClass]="choiceButtonClass(opt.variant)">
            {{ opt.label }}
          </button>
          <button
            type="button"
            (click)="onCancel()"
            class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            {{ choiceCancelLabel }}
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
    if (this.request.options.title) return this.request.options.title;
    if (this.request.type === 'confirm') return 'Confirmar acción';
    if (this.request.type === 'choice') return 'Elegí una opción';
    return 'Aviso';
  }

  get choiceCancelLabel(): string {
    if (!this.request || this.request.type !== 'choice') return 'Cancelar';
    return this.request.options.cancelLabel ?? 'Cancelar';
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

  choiceButtonClass(variant?: DialogVariant): string {
    if (variant === 'danger') {
      return 'bg-red-600 text-white hover:bg-red-700';
    }
    if (variant === 'secondary') {
      return 'border-2 border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-950/60';
    }
    return 'bg-primary text-white hover:bg-teal-700';
  }

  onConfirm() {
    if (!this.request) return;

    if (this.request.type === 'confirm') {
      this.request.result.next(true);
      this.request.result.complete();
    } else if (this.request.type === 'alert') {
      this.request.result.next();
      this.request.result.complete();
    }

    this.dialogService.dismiss();
  }

  onChoice(id: string) {
    if (!this.request || this.request.type !== 'choice') return;
    this.request.result.next(id);
    this.request.result.complete();
    this.dialogService.dismiss();
  }

  onCancel() {
    if (!this.request) return;

    if (this.request.type === 'confirm') {
      this.request.result.next(false);
      this.request.result.complete();
    } else if (this.request.type === 'choice') {
      this.request.result.next(null);
      this.request.result.complete();
    }

    this.dialogService.dismiss();
  }
}
