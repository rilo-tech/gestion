import {
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import {
  StockItem,
  StockService,
  getStockDisponible,
  getStockEnDeposito,
  itemControlsStock,
} from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { BarcodeScanButtonComponent } from '../../shared/components/barcode-scanner/barcode-scan-button.component';
import { normalizeBarcodeKey } from '../../core/utils/barcode-key';

export type StockBarcodeMode = 'oneByOne' | 'manualQuantity';

@Component({
  selector: 'app-stock-barcode-adjust-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TransactionModalComponent,
    BarcodeScanButtonComponent,
  ],
  template: `
    <app-transaction-modal
      [open]="open"
      title="Ajuste por código de barras"
      subtitle="Elegí cómo trabajar: de a uno o buscá el producto y cargá la cantidad."
      maxWidthClass="max-w-md"
      [compact]="true"
      (closed)="close()">
      <div class="space-y-4">
        <div class="inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            (click)="setMode('oneByOne')"
            class="flex-1 rounded-md px-2 py-2 text-xs sm:text-sm font-semibold transition-colors"
            [class.bg-white]="mode === 'oneByOne'"
            [class.text-teal-800]="mode === 'oneByOne'"
            [class.shadow-sm]="mode === 'oneByOne'"
            [class.text-gray-600]="mode !== 'oneByOne'">
            Uno por uno
          </button>
          <button
            type="button"
            (click)="setMode('manualQuantity')"
            class="flex-1 rounded-md px-2 py-2 text-xs sm:text-sm font-semibold transition-colors"
            [class.bg-white]="mode === 'manualQuantity'"
            [class.text-teal-800]="mode === 'manualQuantity'"
            [class.shadow-sm]="mode === 'manualQuantity'"
            [class.text-gray-600]="mode !== 'manualQuantity'">
            Cantidad manual
          </button>
        </div>

        <p class="text-xs text-gray-500 leading-relaxed">
          <ng-container *ngIf="mode === 'oneByOne'">
            Cada escaneo suma o resta <span class="font-semibold">1 unidad</span> al instante. Ideal con lector USB.
          </ng-container>
          <ng-container *ngIf="mode === 'manualQuantity'">
            Primero encontrá el producto; después cargás la cantidad y aplicás.
          </ng-container>
        </p>

        <ng-container *ngIf="mode === 'oneByOne'">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium text-gray-600">Por escaneo:</span>
            <div class="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              <button
                type="button"
                (click)="oneByOneDirection = 1"
                class="px-3 py-1.5 text-xs font-semibold transition-colors"
                [class.bg-teal-600]="oneByOneDirection === 1"
                [class.text-white]="oneByOneDirection === 1"
                [class.text-gray-700]="oneByOneDirection !== 1">
                +1 entrada
              </button>
              <button
                type="button"
                (click)="oneByOneDirection = -1"
                class="px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200"
                [class.bg-orange-600]="oneByOneDirection === -1"
                [class.text-white]="oneByOneDirection === -1"
                [class.text-gray-700]="oneByOneDirection !== -1">
                −1 salida
              </button>
            </div>
          </div>

          <div
            *ngIf="lastOneByOneMessage"
            class="rounded-lg border px-3 py-2 text-sm font-medium"
            [class.border-teal-200]="lastOneByOneSuccess"
            [class.bg-teal-50]="lastOneByOneSuccess"
            [class.text-teal-800]="lastOneByOneSuccess"
            [class.border-red-200]="!lastOneByOneSuccess"
            [class.bg-red-50]="!lastOneByOneSuccess"
            [class.text-red-800]="!lastOneByOneSuccess">
            {{ lastOneByOneMessage }}
          </div>
        </ng-container>

        <ng-container *ngIf="mode === 'manualQuantity' && selectedItem">
          <div class="rounded-xl border border-teal-100 bg-teal-50/50 p-3 space-y-1">
            <p class="text-sm font-semibold text-gray-900 leading-snug">{{ selectedItem.nombre }}</p>
            <p *ngIf="selectedItem.codigoBarras?.trim() || selectedItem.codigo?.trim()" class="text-xs text-gray-500 tabular-nums">
              <span *ngIf="selectedItem.codigoBarras?.trim() as cb">Barras: {{ cb }}</span>
              <span *ngIf="selectedItem.codigoBarras?.trim() && selectedItem.codigo?.trim()"> · </span>
              <span *ngIf="selectedItem.codigo?.trim() as c">Cód.: {{ c }}</span>
            </p>
            <p *ngIf="controlsStock(selectedItem)" class="text-xs text-gray-600">
              Depósito: {{ getStockEnDeposito(selectedItem) }} u. · Disponible: {{ getStockDisponible(selectedItem) }} u.
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
            <p class="text-[11px] text-gray-500 mb-2">Positivo suma, negativo resta.</p>
            <div class="flex flex-wrap items-end gap-2">
              <div class="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                <button
                  type="button"
                  (click)="stepManualQty(-1)"
                  [disabled]="applying"
                  class="inline-flex items-center justify-center w-9 h-9 text-gray-600 border-r border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                  <i-lucide name="minus" class="w-4 h-4"></i-lucide>
                </button>
                <input
                  type="number"
                  [(ngModel)]="manualQuantity"
                  name="manualQuantity"
                  step="1"
                  [disabled]="applying"
                  class="w-16 px-1 py-2 text-sm text-center tabular-nums border-0 bg-transparent outline-none">
                <button
                  type="button"
                  (click)="stepManualQty(1)"
                  [disabled]="applying"
                  class="inline-flex items-center justify-center w-9 h-9 text-gray-600 border-l border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                  <i-lucide name="plus" class="w-4 h-4"></i-lucide>
                </button>
              </div>
              <input
                type="text"
                [(ngModel)]="motivo"
                name="adjustMotivo"
                placeholder="Motivo (opcional)"
                [disabled]="applying"
                class="form-control flex-1 min-w-[8rem] text-sm">
            </div>
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              (click)="clearManualSelection()"
              [disabled]="applying"
              class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Otro código
            </button>
            <button
              type="button"
              (click)="applyManualQuantity()"
              [disabled]="applying || !canApplyManual"
              class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {{ applying ? 'Guardando...' : 'Aplicar' }}
            </button>
          </div>

          <p *ngIf="manualSuccessMessage" class="text-sm font-medium text-teal-700">{{ manualSuccessMessage }}</p>
        </ng-container>

        <div *ngIf="mode !== 'manualQuantity' || !selectedItem" class="space-y-3">
          <div class="flex flex-col items-center gap-2 py-1">
            <app-barcode-scan-button
              label="Escanear"
              modalTitle="Escanear producto"
              variant="primary"
              (scanned)="onBarcodeRead($event)">
            </app-barcode-scan-button>
          </div>
          <div class="flex gap-2">
            <input
              #barcodeInputEl
              type="text"
              [(ngModel)]="barcodeInput"
              name="barcodeInput"
              placeholder="Código de barras"
              autocomplete="off"
              inputmode="numeric"
              class="form-control flex-1 min-w-0 text-sm tabular-nums"
              [disabled]="resolving || applying"
              (keydown.enter)="onBarcodeRead(barcodeInput)">
            <button
              type="button"
              (click)="onBarcodeRead(barcodeInput)"
              [disabled]="resolving || applying || !barcodeInput.trim()"
              class="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {{ resolving ? '...' : (mode === 'oneByOne' ? 'Leer' : 'Buscar') }}
            </button>
          </div>
        </div>
      </div>
    </app-transaction-modal>
  `,
})
export class StockBarcodeAdjustPanelComponent implements OnChanges {
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  readonly auth = inject(AuthService);

  readonly controlsStock = itemControlsStock;
  readonly getStockDisponible = getStockDisponible;
  readonly getStockEnDeposito = getStockEnDeposito;

  @ViewChild('barcodeInputEl') barcodeInputEl?: ElementRef<HTMLInputElement>;

  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() adjusted = new EventEmitter<StockItem>();

  mode: StockBarcodeMode = 'oneByOne';
  oneByOneDirection: 1 | -1 = 1;
  barcodeInput = '';
  resolving = false;
  applying = false;
  selectedItem: StockItem | null = null;
  manualQuantity: number | null = 1;
  motivo = 'Ajuste por código de barras';
  manualSuccessMessage = '';
  lastOneByOneMessage = '';
  lastOneByOneSuccess = true;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open']?.currentValue === true) {
      this.resetState();
      this.focusBarcodeInput();
    }
  }

  get canApplyManual(): boolean {
    return (
      !!this.selectedItem?.id &&
      this.controlsStock(this.selectedItem) &&
      Number(this.manualQuantity) !== 0 &&
      !Number.isNaN(Number(this.manualQuantity)) &&
      this.auth.canEditRecords
    );
  }

  close() {
    this.resetState();
    this.closed.emit();
  }

  setMode(mode: StockBarcodeMode) {
    this.mode = mode;
    this.clearManualSelection();
    this.lastOneByOneMessage = '';
    this.focusBarcodeInput();
  }

  onBarcodeRead(raw: string) {
    const code = normalizeBarcodeKey(raw);
    if (!code) return;
    if (this.mode === 'oneByOne') {
      void this.applyOneByOne(code);
      return;
    }
    void this.findForManualQuantity(code);
  }

  stepManualQty(delta: number) {
    const current = Number(this.manualQuantity) || 0;
    this.manualQuantity = current + delta;
  }

  clearManualSelection() {
    this.selectedItem = null;
    this.manualQuantity = 1;
    this.manualSuccessMessage = '';
    this.barcodeInput = '';
    this.focusBarcodeInput();
  }

  applyManualQuantity() {
    if (!this.canApplyManual || !this.selectedItem?.id) return;
    const delta = Number(this.manualQuantity) || 0;
    if (delta === 0) return;
    this.applyStockDelta(this.selectedItem, delta, this.motivo.trim() || 'Ajuste por código de barras', {
      onSuccess: (updated) => {
        const sign = delta > 0 ? '+' : '−';
        this.manualSuccessMessage = `${sign}${Math.abs(delta)} u. aplicadas.`;
        this.selectedItem = updated;
        window.setTimeout(() => {
          this.manualSuccessMessage = '';
          this.clearManualSelection();
        }, 900);
      },
    });
  }

  private async applyOneByOne(code: string) {
    if (!this.auth.canEditRecords) {
      this.dialogService.alert({
        title: 'Sin permiso',
        message: 'No tenés permiso para ajustar stock.',
      });
      return;
    }

    this.resolving = true;
    this.lastOneByOneMessage = '';

    this.stockService.getItemByBarcode(code).subscribe({
      next: (item) => {
        this.resolving = false;
        this.barcodeInput = '';
        if (!item.id) return;

        if (!this.controlsStock(item)) {
          this.lastOneByOneSuccess = false;
          this.lastOneByOneMessage = `${item.nombre}: no controla stock físico.`;
          this.focusBarcodeInput();
          return;
        }

        const delta = this.oneByOneDirection;
        const motivo =
          delta > 0 ? 'Entrada por código de barras' : 'Salida por código de barras';

        this.applyStockDelta(item, delta, motivo, {
          onSuccess: (updated) => {
            const sign = delta > 0 ? '+' : '−';
            this.lastOneByOneSuccess = true;
            this.lastOneByOneMessage = `${sign}1 · ${updated.nombre} (dep. ${getStockEnDeposito(updated)} u.)`;
            this.focusBarcodeInput();
          },
          onError: () => {
            this.lastOneByOneSuccess = false;
            this.lastOneByOneMessage = `No se pudo ajustar ${item.nombre}.`;
            this.focusBarcodeInput();
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.resolving = false;
        this.barcodeInput = '';
        this.lastOneByOneSuccess = false;
        this.lastOneByOneMessage =
          err.status === 404
            ? 'Producto no encontrado con ese código.'
            : ((err.error as { error?: string })?.error ?? 'Error al buscar el producto.');
        this.focusBarcodeInput();
      },
    });
  }

  private findForManualQuantity(code: string) {
    this.resolving = true;
    this.manualSuccessMessage = '';

    this.stockService.getItemByBarcode(code).subscribe({
      next: (item) => {
        this.resolving = false;
        this.barcodeInput = '';
        this.selectedItem = item;
        this.manualQuantity = 1;
        if (!this.controlsStock(item)) {
          this.dialogService.alert({
            title: 'Sin stock físico',
            message: 'Este ítem no controla stock. Elegí otro producto.',
          });
          this.clearManualSelection();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.resolving = false;
        const message =
          (err.error as { error?: string })?.error ??
          'No se encontró un producto con ese código.';
        this.dialogService.alert({ title: 'Sin coincidencias', message });
        this.focusBarcodeInput();
      },
    });
  }

  private applyStockDelta(
    item: StockItem,
    delta: number,
    motivo: string,
    callbacks: { onSuccess: (updated: StockItem) => void; onError?: () => void }
  ) {
    if (!item.id) return;

    this.applying = true;
    this.stockService.adjustStock(item.id, delta, motivo).subscribe({
      next: () => {
        this.applying = false;
        const updated: StockItem = {
          ...item,
          stockActual: (Number(item.stockActual) || 0) + delta,
        };
        this.stockService.notifyCatalogChanged({ item: updated });
        this.adjusted.emit(updated);
        callbacks.onSuccess(updated);
      },
      error: (err: HttpErrorResponse) => {
        this.applying = false;
        if (callbacks.onError) {
          callbacks.onError();
          return;
        }
        this.dialogService.alert({
          title: 'Error',
          message:
            (err.error as { error?: string })?.error ??
            'No se pudo registrar el movimiento de stock.',
        });
      },
    });
  }

  private focusBarcodeInput() {
    window.setTimeout(() => {
      this.barcodeInputEl?.nativeElement?.focus();
      this.barcodeInputEl?.nativeElement?.select();
    }, 80);
  }

  private resetState() {
    this.mode = 'oneByOne';
    this.oneByOneDirection = 1;
    this.barcodeInput = '';
    this.resolving = false;
    this.applying = false;
    this.selectedItem = null;
    this.manualQuantity = 1;
    this.motivo = 'Ajuste por código de barras';
    this.manualSuccessMessage = '';
    this.lastOneByOneMessage = '';
    this.lastOneByOneSuccess = true;
  }
}
