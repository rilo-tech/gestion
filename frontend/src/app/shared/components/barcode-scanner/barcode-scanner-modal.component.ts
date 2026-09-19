import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
  type Html5QrcodeCameraScanConfig,
} from 'html5-qrcode';
import { normalizeBarcodeKey, sanitizeScannedBarcode } from '../../../core/utils/barcode-key';
import {
  observeContinuousScan,
  releaseContinuousScanIfAbsent,
  createContinuousScanLock,
  type ContinuousScanLockState,
  BARCODE_LOCK_ABSENCE_MS,
} from './barcode-scan-lock';

export type BarcodeScanMode = 'single' | 'continuous';

type ScanStatus = 'idle' | 'starting' | 'scanning' | 'detected' | 'error';

/** @deprecated use BARCODE_LOCK_ABSENCE_MS */
const LOCK_ABSENCE_MS = BARCODE_LOCK_ABSENCE_MS;

@Component({
  selector: 'app-barcode-scanner-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <div
      *ngIf="open"
      class="fixed inset-0 z-[110] flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Escanear código de barras">
      <button
        type="button"
        class="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
        aria-label="Cerrar"
        (click)="close()">
      </button>

      <div
        class="relative w-full max-w-lg flex flex-col min-h-0 max-h-[min(92dvh,100%)] sm:max-h-[90vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div class="min-w-0">
            <h2 class="text-lg font-bold text-gray-900 truncate">{{ title }}</h2>
            <p *ngIf="hint" class="text-xs text-gray-500 mt-0.5">{{ hint }}</p>
            <p *ngIf="mode === 'continuous'" class="text-[11px] text-teal-700 mt-0.5 font-medium">
              Modo continuo · apuntá, alejalo y volvé a escanear
            </p>
          </div>
          <button
            type="button"
            (click)="close()"
            class="inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0"
            aria-label="Cerrar">
            <i-lucide name="x" class="w-5 h-5"></i-lucide>
          </button>
        </div>

        <div class="p-4 space-y-3 overflow-y-auto">
          <div
            class="relative overflow-hidden rounded-xl bg-black aspect-[4/3]"
            [class.ring-2]="status === 'detected'"
            [class.ring-teal-400]="status === 'detected'">
            <div
              #scannerHost
              [id]="scannerHostId"
              class="barcode-scanner-host absolute inset-0 w-full h-full">
            </div>

            <div
              *ngIf="status === 'starting'"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-white/90 text-sm bg-gray-900/80">
              <i-lucide name="loader-circle" class="w-8 h-8 animate-spin"></i-lucide>
              <span>Iniciando cámara...</span>
            </div>

            <div
              *ngIf="status === 'error'"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white bg-gray-900/90">
              <i-lucide name="alert-circle" class="w-8 h-8 text-amber-300"></i-lucide>
              <p>{{ errorMessage }}</p>
            </div>

            <div
              class="absolute top-2 right-2 z-30 flex flex-col gap-1.5"
              *ngIf="status === 'scanning' || status === 'detected'">
              <button
                *ngIf="torchAvailable"
                type="button"
                (click)="toggleTorch()"
                class="inline-flex items-center gap-1 rounded-lg bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/85"
                [attr.aria-pressed]="torchOn"
                [title]="torchOn ? 'Apagar linterna' : 'Linterna'">
                <i-lucide name="flashlight" class="w-3.5 h-3.5"></i-lucide>
                {{ torchOn ? 'On' : 'Off' }}
              </button>
              <button
                *ngIf="cameras.length > 1"
                type="button"
                (click)="cycleCamera()"
                class="inline-flex items-center gap-1 rounded-lg bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/85"
                title="Cambiar cámara">
                <i-lucide name="switch-camera" class="w-3.5 h-3.5"></i-lucide>
                Cámara
              </button>
            </div>

            <div
              class="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 py-2 text-center text-xs font-medium text-white"
              [class.bg-black/75]="status !== 'detected'"
              [class.bg-teal-700/90]="status === 'detected'">
              <span *ngIf="status === 'starting'">Preparando lector...</span>
              <span *ngIf="status === 'scanning'" class="inline-flex items-center justify-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse"></span>
                {{ scanningHint }}
              </span>
              <span *ngIf="status === 'detected' && mode === 'single'">
                Código leído: {{ detectedCode }}
                <span *ngIf="autoApplySecondsLeft > 0"> · usando en {{ autoApplySecondsLeft }}s</span>
              </span>
              <span *ngIf="status === 'detected' && mode === 'continuous'">
                ✓ {{ detectedCode }}
              </span>
              <span *ngIf="status === 'error'">Usá el campo de abajo</span>
            </div>
          </div>

          <div
            *ngIf="lastContinuousFeedback"
            class="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900">
            ✓ {{ lastContinuousFeedback }}
          </div>

          <p class="text-xs text-gray-500 leading-relaxed">
            <ng-container *ngIf="mode === 'single'">
              Centrá el código. Al detectarlo se copia abajo; tocá <span class="font-semibold">Usar</span> si no se aplica solo.
            </ng-container>
            <ng-container *ngIf="mode === 'continuous'">
              Cada lectura deliberada suma una unidad. Alejá el código del cuadro antes de volver a escanear el mismo.
            </ng-container>
          </p>

          <div
            class="rounded-xl border p-3 space-y-2 transition-colors"
            [class.border-gray-200]="status !== 'detected'"
            [class.border-teal-300]="status === 'detected'"
            [class.bg-teal-50/40]="status === 'detected'">
            <div class="flex gap-2">
              <input
                #manualInput
                type="text"
                [(ngModel)]="manualCode"
                (ngModelChange)="onManualCodeEdited()"
                name="manualBarcode"
                placeholder="Código de barras"
                autocomplete="off"
                inputmode="text"
                autocapitalize="off"
                spellcheck="false"
                class="form-control flex-1 min-w-0 text-sm"
                (keydown.enter)="submitManual($event)">
              <button
                type="button"
                (click)="submitManual()"
                [disabled]="!manualCode.trim()"
                class="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                [class.bg-teal-600]="!!manualCode.trim()"
                [class.text-white]="!!manualCode.trim()"
                [class.hover:bg-teal-700]="!!manualCode.trim()"
                [class.bg-gray-200]="!manualCode.trim()"
                [class.text-gray-500]="!manualCode.trim()">
                Usar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class BarcodeScannerModalComponent implements OnChanges, OnDestroy, AfterViewInit {
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('scannerHost') scannerHost?: ElementRef<HTMLDivElement>;
  @ViewChild('manualInput') manualInput?: ElementRef<HTMLInputElement>;

  @Input() open = false;
  @Input() title = 'Escanear código';
  @Input() hint = '';
  @Input() mode: BarcodeScanMode = 'single';
  /** Texto de feedback tras un escaneo continuo exitoso (lo setea el padre). */
  @Input() continuousFeedback = '';

  @Output() closed = new EventEmitter<void>();
  @Output() scanned = new EventEmitter<string>();

  readonly scannerHostId = `barcode-scanner-${Math.random().toString(36).slice(2, 11)}`;

  status: ScanStatus = 'idle';
  errorMessage = '';
  manualCode = '';
  detectedCode = '';
  autoApplySecondsLeft = 0;
  scanningHint = 'Leyendo… apuntá al código';
  lastContinuousFeedback = '';
  torchAvailable = false;
  torchOn = false;
  cameras: CameraDevice[] = [];

  private scanner: Html5Qrcode | null = null;
  private startToken = 0;
  private pendingStart = false;
  private viewReadyAttempts = 0;
  private autoApplyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoApplyIntervalId: ReturnType<typeof setInterval> | null = null;
  private absenceCheckId: ReturnType<typeof setInterval> | null = null;
  private manualEditedAfterDetect = false;
  private lockedCode: string | null = null;
  private lockedLastSeenAt = 0;
  private continuousLock: ContinuousScanLockState = createContinuousScanLock();
  private selectedCameraId: string | null = null;
  private videoTrack: MediaStreamTrack | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['continuousFeedback'] && this.continuousFeedback) {
      this.lastContinuousFeedback = this.continuousFeedback;
      this.cdr.markForCheck();
    }
    if (changes['open']) {
      if (this.open) {
        this.resetScanState();
        this.pendingStart = true;
        this.viewReadyAttempts = 0;
        this.scheduleScannerStart();
      } else {
        this.pendingStart = false;
        void this.stopScanner();
      }
    }
  }

  ngAfterViewInit() {
    this.scheduleScannerStart();
  }

  ngOnDestroy() {
    void this.stopScanner();
  }

  close() {
    void this.stopScanner().finally(() => this.closed.emit());
  }

  submitManual(event?: Event) {
    event?.preventDefault();
    const code = normalizeBarcodeKey(this.manualCode);
    if (!code) return;
    if (this.mode === 'continuous') {
      this.emitContinuous(code);
      this.manualCode = '';
      this.cdr.markForCheck();
      return;
    }
    void this.stopScanner().finally(() => this.scanned.emit(code));
  }

  onManualCodeEdited() {
    if (!this.detectedCode) return;
    const current = normalizeBarcodeKey(this.manualCode);
    if (current !== this.detectedCode) {
      this.manualEditedAfterDetect = true;
      this.clearAutoApply();
      this.autoApplySecondsLeft = 0;
      this.cdr.markForCheck();
    }
  }

  async toggleTorch() {
    if (!this.torchAvailable || !this.videoTrack) return;
    try {
      await this.videoTrack.applyConstraints({
        // @ts-expect-error torch is a non-standard constraint
        advanced: [{ torch: !this.torchOn }],
      });
      this.torchOn = !this.torchOn;
      this.cdr.markForCheck();
    } catch {
      this.torchAvailable = false;
      this.torchOn = false;
      this.cdr.markForCheck();
    }
  }

  async cycleCamera() {
    if (this.cameras.length < 2) return;
    const ids = this.cameras.map((c) => c.id);
    const currentIdx = Math.max(0, ids.indexOf(this.selectedCameraId ?? ''));
    const next = ids[(currentIdx + 1) % ids.length];
    this.selectedCameraId = next;
    await this.startScanner();
  }

  private resetScanState() {
    this.manualCode = '';
    this.detectedCode = '';
    this.errorMessage = '';
    this.status = 'starting';
    this.autoApplySecondsLeft = 0;
    this.manualEditedAfterDetect = false;
    this.lockedCode = null;
    this.lockedLastSeenAt = 0;
    this.continuousLock = createContinuousScanLock();
    this.lastContinuousFeedback = '';
    this.torchOn = false;
    this.torchAvailable = false;
    this.scanningHint =
      this.mode === 'continuous'
        ? 'Continuo · apuntá al código'
        : 'Leyendo… apuntá al código';
    this.clearAutoApply();
    this.clearAbsenceCheck();
    this.cdr.markForCheck();
  }

  private scheduleScannerStart() {
    if (!this.pendingStart || !this.open) return;

    if (!this.scannerHost?.nativeElement) {
      this.viewReadyAttempts += 1;
      if (this.viewReadyAttempts > 60) {
        this.setError('No se pudo preparar la cámara. Ingresá el código manualmente.');
        this.pendingStart = false;
        return;
      }
      window.setTimeout(() => this.scheduleScannerStart(), 50);
      return;
    }

    this.pendingStart = false;
    void this.startScanner();
  }

  private async startScanner() {
    if (!this.open) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.setError('Este navegador no soporta cámara. Ingresá el código manualmente.');
      return;
    }

    if (!window.isSecureContext) {
      this.setError('La cámara necesita HTTPS (o localhost). Ingresá el código a mano abajo.');
      return;
    }

    await this.stopScanner(false);
    const token = ++this.startToken;

    if (!this.open) return;

    this.status = 'starting';
    this.cdr.markForCheck();

    try {
      this.cameras = await Html5Qrcode.getCameras().catch(() => [] as CameraDevice[]);
      this.scanner = new Html5Qrcode(this.scannerHostId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
        ],
        useBarCodeDetectorIfSupported: true,
      });

      const cameraConfig = await this.resolveCameraConfig();
      const scanConfig: Html5QrcodeCameraScanConfig = {
        fps: 12,
        disableFlip: false,
        qrbox: (viewfinderWidth, viewfinderHeight) => ({
          width: Math.floor(Math.min(viewfinderWidth * 0.92, 420)),
          height: Math.floor(Math.min(viewfinderHeight * 0.42, 160)),
        }),
        aspectRatio: 1.333333,
      };

      await this.scanner.start(
        cameraConfig,
        scanConfig,
        (decodedText) => {
          if (token !== this.startToken || !this.open) return;
          this.ngZone.run(() => this.handleScanCandidate(decodedText));
        },
        () => {
          if (token !== this.startToken || !this.open) return;
          // Frame sin detección: el absence check libera el lock.
        }
      );

      if (token !== this.startToken || !this.open) {
        await this.stopScanner(false);
        return;
      }

      this.bindVideoTrack();
      this.ensureAbsenceCheck();
      this.status = 'scanning';
      this.scanningHint =
        this.mode === 'continuous'
          ? 'Continuo · centrá el código'
          : 'Leyendo… centrá el código en el recuadro';
      this.cdr.markForCheck();
    } catch (err) {
      if (token !== this.startToken) return;
      this.setError(this.mapCameraError(err));
      await this.stopScanner(false);
    }
  }

  private mapCameraError(err: unknown): string {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
    const message = err instanceof Error ? err.message : String(err ?? '');
    const combined = `${name} ${message}`.toLowerCase();
    if (combined.includes('notallowed') || combined.includes('permission')) {
      return 'Permiso de cámara rechazado. Habilitalo en el navegador o ingresá el código a mano.';
    }
    if (combined.includes('notfound') || combined.includes('devices not found')) {
      return 'No hay cámara disponible. Ingresá el código manualmente.';
    }
    if (combined.includes('notreadable') || combined.includes('trackstart') || combined.includes('in use')) {
      return 'La cámara está ocupada por otra app. Cerrala e intentá de nuevo, o ingresá el código a mano.';
    }
    if (combined.includes('secure') || combined.includes('https')) {
      return 'La cámara necesita HTTPS. Ingresá el código a mano abajo.';
    }
    return 'No se pudo usar la cámara. Revisá permisos o ingresá el código a mano.';
  }

  private bindVideoTrack() {
    this.videoTrack = null;
    this.torchAvailable = false;
    this.torchOn = false;
    try {
      const video = document.querySelector(
        `#${this.scannerHostId} video`
      ) as HTMLVideoElement | null;
      const track = video?.srcObject instanceof MediaStream
        ? video.srcObject.getVideoTracks()[0] ?? null
        : null;
      this.videoTrack = track;
      if (track) {
        const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
        this.torchAvailable = caps?.torch === true;
      }
    } catch {
      this.torchAvailable = false;
    }
  }

  private async resolveCameraConfig(): Promise<string | MediaTrackConstraints> {
    try {
      if (!this.cameras.length) {
        this.cameras = await Html5Qrcode.getCameras();
      }
      if (this.selectedCameraId && this.cameras.some((c) => c.id === this.selectedCameraId)) {
        return this.selectedCameraId;
      }
      const preferred =
        this.cameras.find((camera) => /back|rear|environment|trás|trasera/i.test(camera.label)) ??
        this.cameras[this.cameras.length - 1];
      if (preferred?.id) {
        this.selectedCameraId = preferred.id;
        return preferred.id;
      }
    } catch {
      // fallback below
    }
    return { facingMode: { ideal: 'environment' } };
  }

  private handleScanCandidate(raw: string | undefined) {
    const code = sanitizeScannedBarcode(raw) ?? normalizeBarcodeKey(raw);
    if (!code || code.length < 3) return;

    const now = Date.now();

    if (this.mode === 'continuous') {
      const shouldEmit = observeContinuousScan(this.continuousLock, code, now, LOCK_ABSENCE_MS);
      this.lockedCode = this.continuousLock.lockedCode;
      this.lockedLastSeenAt = this.continuousLock.lockedLastSeenAt;
      if (!shouldEmit) return;

      this.detectedCode = code;
      this.manualCode = code;
      this.status = 'detected';
      this.emitContinuous(code);
      this.cdr.markForCheck();
      return;
    }

    // SINGLE: same short debounce for frame spam before auto-apply
    if (code === this.detectedCode && now - this.lockedLastSeenAt < 350) {
      this.lockedLastSeenAt = now;
      return;
    }

    this.lockedLastSeenAt = now;
    this.detectedCode = code;
    this.manualCode = code;
    this.manualEditedAfterDetect = false;
    this.status = 'detected';

    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(40);
    }

    window.setTimeout(() => {
      this.manualInput?.nativeElement?.focus();
      this.manualInput?.nativeElement?.select();
    }, 0);

    this.scheduleAutoApply(code);
    this.cdr.markForCheck();
  }

  private emitContinuous(code: string) {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(30);
    }
    this.scanned.emit(code);
  }

  private ensureAbsenceCheck() {
    this.clearAbsenceCheck();
    if (this.mode !== 'continuous') return;
    this.absenceCheckId = window.setInterval(() => {
      if (releaseContinuousScanIfAbsent(this.continuousLock, Date.now(), LOCK_ABSENCE_MS)) {
        this.lockedCode = null;
        if (this.status === 'detected') {
          this.status = 'scanning';
          this.cdr.markForCheck();
        }
      }
    }, 120);
  }

  private scheduleAutoApply(code: string) {
    this.clearAutoApply();
    this.autoApplySecondsLeft = 2;

    this.autoApplyIntervalId = window.setInterval(() => {
      if (this.autoApplySecondsLeft > 0) {
        this.autoApplySecondsLeft -= 1;
        this.cdr.markForCheck();
      }
    }, 1000);

    this.autoApplyTimeoutId = window.setTimeout(() => {
      if (this.manualEditedAfterDetect || !this.open) return;
      if (normalizeBarcodeKey(this.manualCode) !== code) return;
      void this.stopScanner().finally(() => this.scanned.emit(code));
    }, 2000);
  }

  private setError(message: string) {
    this.status = 'error';
    this.errorMessage = message;
    this.cdr.markForCheck();
  }

  private clearAutoApply() {
    if (this.autoApplyTimeoutId != null) {
      window.clearTimeout(this.autoApplyTimeoutId);
      this.autoApplyTimeoutId = null;
    }
    if (this.autoApplyIntervalId != null) {
      window.clearInterval(this.autoApplyIntervalId);
      this.autoApplyIntervalId = null;
    }
  }

  private clearAbsenceCheck() {
    if (this.absenceCheckId != null) {
      window.clearInterval(this.absenceCheckId);
      this.absenceCheckId = null;
    }
  }

  private async stopScanner(resetStatus = true) {
    this.startToken += 1;
    this.pendingStart = false;
    this.clearAutoApply();
    this.clearAbsenceCheck();
    this.videoTrack = null;
    this.torchOn = false;

    const scanner = this.scanner;
    this.scanner = null;

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // ignore stop errors when camera already closed
      }
      try {
        scanner.clear();
      } catch {
        // ignore
      }
    }

    if (resetStatus && this.open && this.status !== 'error') {
      this.status = 'idle';
      this.cdr.markForCheck();
    }
  }
}
