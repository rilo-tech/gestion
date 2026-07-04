import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { OrderPhoto, OrderService } from '../../core/services/order.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  MAX_ORDER_PHOTOS,
  PreparedOrderPhotoUpload,
  isOrderPhotoFile,
  prepareOrderPhotoFile,
} from '../../core/utils/order-photo-upload';

type PendingOrderPhotoView = PreparedOrderPhotoUpload & {
  uploadState: 'preparing' | 'queued' | 'uploading' | 'failed';
  errorMessage?: string;
  objectUrl?: string;
};

type PhotoUploadFeedback = {
  tone: 'success' | 'error' | 'info';
  message: string;
};

@Component({
  selector: 'app-order-photo-attachments',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div>
      <div class="flex items-center justify-between gap-2 mb-1">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Fotos de referencia</label>
        <span class="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{{ photoCount }}/{{ maxPhotos }}</span>
      </div>
      <p *ngIf="showPrintHint" class="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        Se imprimen abajo del imprimible, en la misma hoja A4.
      </p>

      <p
        *ngIf="feedback"
        class="text-[11px] mb-2 rounded-lg px-2.5 py-1.5 border"
        [ngClass]="{
          'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 border-green-100 dark:border-green-900': feedback.tone === 'success',
          'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900': feedback.tone === 'error',
          'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-100 dark:border-teal-900': feedback.tone === 'info'
        }"
        role="status"
        aria-live="polite">
        {{ feedback.message }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button
          *ngIf="canEdit"
          type="button"
          (click)="pickPhotos()"
          [disabled]="uploadBusy || photoCount >= maxPhotos"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed shrink-0">
          <i-lucide [name]="uploadBusy ? 'loader-circle' : 'plus'" [class.animate-spin]="uploadBusy" class="w-4 h-4"></i-lucide>
          <span>{{ uploadBusy ? 'Subiendo…' : 'Adjuntar fotos' }}</span>
        </button>

        <figure
          *ngFor="let photo of photos; trackBy: trackPhoto"
          class="group relative w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-900 shadow-sm">
          <button
            type="button"
            class="absolute inset-0 w-full h-full cursor-zoom-in"
            (click)="openPreview(photo.url, photo.name)"
            [attr.aria-label]="'Ver ' + (photo.name || 'foto') + ' en grande'"
            title="Ver en grande">
            <img [src]="photo.url" [alt]="photo.name" class="w-full h-full object-cover pointer-events-none" />
          </button>
          <button
            *ngIf="canEdit"
            type="button"
            (click)="removeSavedPhoto(photo); $event.stopPropagation()"
            [disabled]="uploadBusy"
            class="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 rounded-bl-md bg-black/60 text-white hover:bg-black/80 disabled:opacity-50 z-10"
            aria-label="Quitar foto"
            title="Quitar foto">
            <i-lucide name="x" class="w-3 h-3"></i-lucide>
          </button>
        </figure>

        <figure
          *ngFor="let pending of pendingPhotos; let index = index; trackBy: trackPending"
          class="group relative w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-lg border border-dashed overflow-hidden shadow-sm"
          [class.border-amber-300]="pending.uploadState === 'queued' || pending.uploadState === 'preparing'"
          [class.bg-amber-50]="pending.uploadState === 'queued' || pending.uploadState === 'preparing'"
          [class.dark:bg-amber-950/30]="pending.uploadState === 'queued' || pending.uploadState === 'preparing'"
          [class.border-teal-400]="pending.uploadState === 'uploading'"
          [class.border-red-300]="pending.uploadState === 'failed'"
          [class.bg-red-50]="pending.uploadState === 'failed'"
          [class.dark:bg-red-950/30]="pending.uploadState === 'failed'"
          [attr.title]="pending.uploadState === 'failed' ? pending.errorMessage : null">
          <button
            type="button"
            class="absolute inset-0 w-full h-full cursor-zoom-in"
            (click)="openPreview(pending.previewUrl, pending.name)"
            title="Ver en grande">
            <img
              [src]="pending.previewUrl"
              [alt]="pending.name"
              class="w-full h-full object-cover pointer-events-none"
              [class.opacity-55]="pending.uploadState === 'preparing' || pending.uploadState === 'uploading'" />
          </button>
          <div
            *ngIf="pending.uploadState === 'preparing' || pending.uploadState === 'uploading'"
            class="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
            <i-lucide name="loader-circle" class="w-4 h-4 text-white animate-spin"></i-lucide>
          </div>
          <button
            *ngIf="canEdit && pending.uploadState !== 'uploading' && pending.uploadState !== 'preparing'"
            type="button"
            (click)="removePending(index); $event.stopPropagation()"
            [disabled]="uploadBusy"
            class="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 rounded-bl-md bg-black/60 text-white hover:bg-black/80 disabled:opacity-50 z-10"
            aria-label="Quitar foto"
            title="Quitar foto">
            <i-lucide name="x" class="w-3 h-3"></i-lucide>
          </button>
        </figure>
      </div>
    </div>

    <div
      *ngIf="preview"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      (click)="closePreview()">
      <button
        type="button"
        class="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/50 text-white hover:bg-black/70"
        aria-label="Cerrar"
        (click)="closePreview(); $event.stopPropagation()">
        <i-lucide name="x" class="w-5 h-5"></i-lucide>
      </button>
      <figure class="max-w-full max-h-full flex flex-col items-center gap-2" (click)="$event.stopPropagation()">
        <img
          [src]="preview.url"
          [alt]="preview.name"
          class="max-w-full max-h-[min(82dvh,900px)] object-contain rounded-lg shadow-2xl bg-black/20" />
        <figcaption *ngIf="preview.name" class="text-xs sm:text-sm text-white/90 text-center px-2 truncate max-w-[min(90vw,48rem)]">
          {{ preview.name }}
        </figcaption>
      </figure>
    </div>
  `,
})
export class OrderPhotoAttachmentsComponent implements OnDestroy {
  private orderService = inject(OrderService);
  private dialogService = inject(DialogService);

  readonly maxPhotos = MAX_ORDER_PHOTOS;

  @Input() orderId: string | null = null;
  @Input() canEdit = false;
  @Input() showPrintHint = false;
  @Input() photos: OrderPhoto[] = [];
  @Output() photosChange = new EventEmitter<OrderPhoto[]>();

  pendingPhotos: PendingOrderPhotoView[] = [];
  uploadBusy = false;
  feedback: PhotoUploadFeedback | null = null;
  preview: { url: string; name: string } | null = null;

  private feedbackTimer?: ReturnType<typeof setTimeout>;

  get photoCount(): number {
    return this.photos.length + this.pendingPhotos.length;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.preview) this.closePreview();
  }

  ngOnDestroy() {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    for (const pending of this.pendingPhotos) this.revokeObjectUrl(pending);
  }

  /** Llamar después de crear el pedido para subir las fotos en cola. */
  async flushPendingUploads(orderId: string): Promise<void> {
    const queued = this.pendingPhotos.filter((photo) => photo.uploadState === 'queued');
    if (!queued.length) return;
    await this.uploadPrepared(orderId, queued);
  }

  pickPhotos() {
    if (!this.canEdit || this.uploadBusy || this.photoCount >= this.maxPhotos) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/*';
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      () => {
        void this.handleFiles(input.files);
        input.remove();
      },
      { once: true }
    );

    input.click();
  }

  trackPhoto(_index: number, photo: OrderPhoto): string {
    return photo.id ?? photo.url;
  }

  trackPending(index: number, pending: PendingOrderPhotoView): string {
    return pending.objectUrl ?? pending.previewUrl ?? `${index}-${pending.name}`;
  }

  openPreview(url: string, name: string) {
    const src = String(url ?? '').trim();
    if (!src) return;
    this.preview = { url: src, name: String(name ?? '').trim() || 'Foto' };
  }

  closePreview() {
    this.preview = null;
  }

  removePending(index: number) {
    if (!this.canEdit || this.uploadBusy) return;
    const pending = this.pendingPhotos[index];
    if (pending) this.revokeObjectUrl(pending);
    this.pendingPhotos = this.pendingPhotos.filter((_, i) => i !== index);
  }

  removeSavedPhoto(photo: OrderPhoto) {
    if (!this.canEdit || this.uploadBusy || !this.orderId || !photo.id) return;

    this.dialogService
      .confirm({
        title: 'Quitar foto',
        message: '¿Eliminar esta foto de referencia del pedido?',
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.orderId || !photo.id) return;
        this.uploadBusy = true;
        this.orderService.deleteOrderPhoto(this.orderId, photo.id).subscribe({
          next: (result) => {
            this.photos = result.fotos;
            this.photosChange.emit(result.fotos);
            this.uploadBusy = false;
            this.setFeedback('success', 'Foto eliminada.');
          },
          error: (err: HttpErrorResponse) => {
            this.uploadBusy = false;
            this.dialogService.alert({
              title: 'Error',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar la foto.',
            });
          },
        });
      });
  }

  private async handleFiles(fileList: FileList | null) {
    if (!fileList?.length || !this.canEdit) return;

    this.setFeedback('info', 'Procesando imagen…', 0);

    if (this.photoCount >= this.maxPhotos) {
      this.setFeedback('error', `Podés adjuntar hasta ${this.maxPhotos} fotos por pedido.`);
      return;
    }

    const remaining = this.maxPhotos - this.photoCount;
    const files = Array.from(fileList).filter((file) => isOrderPhotoFile(file)).slice(0, remaining);
    if (!files.length) {
      this.setFeedback('error', 'Elegí al menos una imagen (JPG, PNG o WebP).');
      return;
    }

    const added: PendingOrderPhotoView[] = [];

    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      const pending: PendingOrderPhotoView = {
        data: '',
        contentType: file.type || 'image/jpeg',
        name: file.name.trim() || 'foto.jpg',
        previewUrl: objectUrl,
        objectUrl,
        uploadState: 'preparing',
      };
      added.push(pending);
      this.pendingPhotos = [...this.pendingPhotos, pending];
    }

    const ready: PendingOrderPhotoView[] = [];

    for (let i = 0; i < added.length; i++) {
      const pending = added[i];
      try {
        const prepared = await prepareOrderPhotoFile(files[i]);
        this.revokeObjectUrl(pending);
        Object.assign(pending, prepared, { uploadState: 'queued' as const });
        ready.push(pending);
      } catch (error) {
        pending.uploadState = 'failed';
        pending.errorMessage =
          error instanceof Error ? error.message : 'No se pudo procesar la imagen.';
      }
    }

    if (!ready.length) {
      this.setFeedback('error', 'No se pudieron preparar las fotos seleccionadas.');
      return;
    }

    if (!this.orderId) {
      this.setFeedback(
        'info',
        ready.length === 1
          ? 'Miniatura lista. Guardá el pedido para subirla al servidor.'
          : `${ready.length} miniaturas listas. Guardá el pedido para subirlas al servidor.`,
        10000
      );
      return;
    }

    await this.uploadPrepared(this.orderId, ready);
  }

  private async uploadPrepared(orderId: string, prepared: PendingOrderPhotoView[]) {
    if (!prepared.length) return;

    this.uploadBusy = true;
    this.setFeedback(
      'info',
      prepared.length === 1 ? 'Subiendo 1 foto…' : `Subiendo ${prepared.length} fotos…`,
      0
    );

    let uploaded = 0;
    let lastError = 'No se pudo subir la foto.';

    try {
      for (const photo of prepared) {
        photo.uploadState = 'uploading';
        photo.errorMessage = undefined;

        try {
          const result = await firstValueFrom(
            this.orderService.uploadOrderPhoto(orderId, {
              data: photo.data,
              contentType: photo.contentType,
              name: photo.name,
            })
          );
          this.photos = result.fotos;
          this.photosChange.emit(result.fotos);
          this.pendingPhotos = this.pendingPhotos.filter((item) => item !== photo);
          uploaded += 1;
        } catch (error) {
          lastError = this.resolveUploadError(error);
          photo.uploadState = 'failed';
          photo.errorMessage = lastError;
        }
      }

      const failed = prepared.length - uploaded;
      if (uploaded > 0 && failed === 0) {
        this.setFeedback(
          'success',
          uploaded === 1 ? '1 foto guardada en el pedido.' : `${uploaded} fotos guardadas en el pedido.`
        );
        return;
      }
      if (uploaded > 0 && failed > 0) {
        this.setFeedback(
          'error',
          `Se guardaron ${uploaded} de ${prepared.length}. Las que fallaron quedaron marcadas en rojo.`
        );
        return;
      }
      this.setFeedback('error', lastError);
    } finally {
      this.uploadBusy = false;
    }
  }

  private resolveUploadError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const apiMessage = typeof error.error?.error === 'string' ? error.error.error : '';
      if (apiMessage) return apiMessage;
      if (error.status === 0) return 'Sin conexión con el servidor.';
      if (error.status === 404) return 'Pedido no encontrado. Guardá el pedido e intentá de nuevo.';
      if (error.status >= 500) return 'El servidor no pudo guardar la foto. ¿Está Storage desplegado?';
    }
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    return 'No se pudo subir la foto.';
  }

  private setFeedback(tone: PhotoUploadFeedback['tone'], message: string, autoClearMs = tone === 'success' ? 6000 : tone === 'info' ? 8000 : 0) {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = undefined;
    }
    this.feedback = { tone, message };
    if (autoClearMs > 0) {
      this.feedbackTimer = setTimeout(() => {
        this.feedbackTimer = undefined;
        if (this.feedback?.message === message) this.feedback = null;
      }, autoClearMs);
    }
  }

  private revokeObjectUrl(pending: PendingOrderPhotoView) {
    if (!pending.objectUrl) return;
    URL.revokeObjectURL(pending.objectUrl);
    pending.objectUrl = undefined;
  }
}
