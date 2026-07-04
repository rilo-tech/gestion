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
  type Html5QrcodeCameraScanConfig,
} from 'html5-qrcode';
import { normalizeBarcodeKey, sanitizeScannedBarcode } from '../../../core/utils/barcode-key';

type ScanStatus = 'idle' | 'starting' | 'scanning' | 'detected' | 'error';

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
              class="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 py-2 text-center text-xs font-medium text-white"
              [class.bg-black/75]="status !== 'detected'"
              [class.bg-teal-700/90]="status === 'detected'">
              <span *ngIf="status === 'starting'">Preparando lector...</span>
              <span *ngIf="status === 'scanning'" class="inline-flex items-center justify-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse"></span>
                {{ scanningHint }}
              </span>
              <span *ngIf="status === 'detected'">
                Código leído: {{ detectedCode }}
                <span *ngIf="autoApplySecondsLeft > 0"> · usando en {{ autoApplySecondsLeft }}s</span>
              </span>
              <span *ngIf="status === 'error'">Usá el campo de abajo</span>
            </div>
          </div>

          <p class="text-xs text-gray-500 leading-relaxed">
            Centrá el código en el recuadro. Al detectarlo se copia abajo; tocá <span class="font-semibold">Usar</span> si no se aplica solo.
          </p>

          <div
            class="rounded-xl border p-3 space-y-2 transition-colors"
            [class.border-gray-200]="status !== 'detected'"
            [class.border-teal-300]="status === 'detected'"
            [class.bg-teal-50/40]="status === 'detected'">
            <div *ngIf="status === 'detected'" class="flex items-center gap-2 text-sm font-semibold text-teal-800">
              <i-lucide name="circle-check" class="w-4 h-4 shrink-0"></i-lucide>
              <span>Código copiado en el campo</span>
            </div>
            <div class="flex gap-2">
              <input
                #manualInput
                type="text"
                [(ngModel)]="manualCode"
                (ngModelChange)="onManualCodeEdited()"
                name="manualBarcode"
                placeholder="Código de barras"
                autocomplete="off"
                inputmode="numeric"
                class="form-control flex-1 min-w-0 text-sm tabular-nums"
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

  @Output() closed = new EventEmitter<void>();
  @Output() scanned = new EventEmitter<string>();

  readonly scannerHostId = `barcode-scanner-${Math.random().toString(36).slice(2, 11)}`;

  status: ScanStatus = 'idle';
  errorMessage = '';
  manualCode = '';
  detectedCode = '';
  autoApplySecondsLeft = 0;
  scanningHint = 'Leyendo… apuntá al código';

  private scanner: Html5Qrcode | null = null;
  private startToken = 0;
  private pendingStart = false;
  private viewReadyAttempts = 0;
  private autoApplyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoApplyIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastDetectedAt = 0;
  private manualEditedAfterDetect = false;

  ngOnChanges(changes: SimpleChanges) {
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

  private resetScanState() {
    this.manualCode = '';
    this.detectedCode = '';
    this.errorMessage = '';
    this.status = 'starting';
    this.autoApplySecondsLeft = 0;
    this.manualEditedAfterDetect = false;
    this.lastDetectedAt = 0;
    this.scanningHint = 'Leyendo… apuntá al código';
    this.clearAutoApply();
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

    if (!window.isSecureContext) {
      this.setError('La cámara necesita HTTPS. Ingresá el código a mano abajo.');
      return;
    }

    await this.stopScanner(false);
    const token = ++this.startToken;

    if (!this.open) return;

    this.status = 'starting';
    this.cdr.markForCheck();

    try {
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
        () => undefined
      );

      if (token !== this.startToken || !this.open) {
        await this.stopScanner(false);
        return;
      }

      this.status = 'scanning';
      this.scanningHint = 'Leyendo… centrá el código en el recuadro';
      this.cdr.markForCheck();
    } catch {
      if (token !== this.startToken) return;
      this.setError(
        'No se pudo usar la cámara. Revisá permisos del navegador o ingresá el código a mano.'
      );
      await this.stopScanner(false);
    }
  }

  private async resolveCameraConfig(): Promise<string | MediaTrackConstraints> {
    try {
      const cameras = await Html5Qrcode.getCameras();
      const preferred =
        cameras.find((camera) => /back|rear|environment|trás|trasera/i.test(camera.label)) ??
        cameras[cameras.length - 1];
      if (preferred?.id) return preferred.id;
    } catch {
      // fallback below
    }
    return { facingMode: { ideal: 'environment' } };
  }

  private handleScanCandidate(raw: string | undefined) {
    const code = sanitizeScannedBarcode(raw) ?? normalizeBarcodeKey(raw);
    if (!code || code.length < 3) return;

    const now = Date.now();
    if (code === this.detectedCode && now - this.lastDetectedAt < 350) {
      return;
    }

    this.lastDetectedAt = now;
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

  private async stopScanner(resetStatus = true) {
    this.startToken += 1;
    this.pendingStart = false;
    this.clearAutoApply();

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
