import { Component, EventEmitter, Input, Output, inject, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OrderService,
  OrderStockPreparationLine,
  OrderStockPreparationView,
  ReservationSourceOrder,
} from '../../core/services/order.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  buildSuggestedStockAllocations,
  getStockPrepPendiente,
  splitProductDisplayName,
} from '../../core/utils/order-stock-prep';

type DraftLine = OrderStockPreparationLine & {
  reservarInput: string;
  faltanteInput: string;
  transferSources: ReservationSourceOrder[];
  transferSourceKey: string;
  transferQtyInput: string;
  loadingSources: boolean;
  transferring: boolean;
};

@Component({
  selector: 'app-order-stock-preparation-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      *ngIf="open"
      class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" class="absolute inset-0 bg-black/75 backdrop-blur-sm" (click)="cancel()" aria-label="Cerrar"></button>

      <div
        class="relative z-[1] w-full max-w-5xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div class="shrink-0 border-b border-gray-100 px-4 py-3 sm:px-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-bold text-gray-900">
                {{ isReedit ? 'Editar stock' : 'Revisar stock' }}
                <span *ngIf="view" class="font-semibold text-teal-700">#{{ view.orderLabel }}</span>
              </h2>
              <p class="text-xs text-gray-500 mt-0.5">
                Al confirmar se reserva stock en depósito (pedido pendiente). Podés volver a editarlo cuando quieras.
              </p>
            </div>
            <div *ngIf="view && !loading" class="flex flex-wrap gap-2 text-[11px]">
              <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                {{ draftLines.length }} ítem{{ draftLines.length === 1 ? '' : 's' }}
              </span>
              <span class="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
                {{ completeLineCount }} completo{{ completeLineCount === 1 ? '' : 's' }}
              </span>
              <span
                *ngIf="shortageLineCount > 0"
                class="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-700">
                {{ shortageLineCount }} con faltante
              </span>
            </div>
          </div>
        </div>

        <div *ngIf="loading" class="px-5 py-8 text-center text-sm text-gray-500">Cargando stock...</div>

        <div *ngIf="!loading && view" class="flex-1 min-h-0 overflow-auto">
          <table class="w-full table-fixed text-left border-collapse text-sm">
            <thead class="sticky top-0 z-[1] bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th class="px-3 py-2 font-semibold w-[38%]">Producto</th>
                <th class="px-2 py-2 font-semibold text-center w-12">Ped.</th>
                <th class="px-2 py-2 font-semibold text-center w-12" title="Stock libre (real − reservado en otros pedidos)">Libre</th>
                <th class="px-2 py-2 font-semibold text-center w-20">Reserv.</th>
                <th class="px-2 py-2 font-semibold text-center w-20">Falt.</th>
                <th class="px-2 py-2 font-semibold text-center w-16">Est.</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <ng-container *ngFor="let line of draftLines">
                <tr
                  class="align-middle transition-colors"
                  [class.bg-teal-50/40]="getFaltante(line) === 0 && getReservar(line) > 0"
                  [class.bg-orange-50]="getFaltante(line) > 0">
                  <td class="px-3 py-2 min-w-0">
                    <p class="font-medium text-gray-900 truncate text-sm leading-tight" [title]="line.nombre">
                      {{ productBase(line) }}
                    </p>
                    <p
                      *ngIf="productVariant(line)"
                      class="text-[11px] text-gray-500 truncate leading-tight mt-0.5"
                      [title]="productVariant(line)">
                      {{ productVariant(line) }}
                    </p>
                    <p *ngIf="!line.controlaStock" class="text-[11px] text-gray-500 mt-0.5">
                      Sin control de stock
                    </p>
                    <p *ngIf="isReedit && line.controlaStock" class="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                      Guardado: {{ line.cantidadReservada }} / {{ line.cantidadFaltante }}
                    </p>
                  </td>
                  <td class="px-2 py-2 text-center tabular-nums text-gray-700">
                    {{ getPendiente(line) }}
                  </td>
                  <td class="px-2 py-2 text-center tabular-nums text-gray-600">
                    {{ line.controlaStock ? line.stockDisponible : '—' }}
                  </td>
                  <td class="px-2 py-2">
                    <input
                      type="text"
                      inputmode="numeric"
                      class="form-control !min-h-0 !py-1 !px-2 !rounded-md !text-sm text-center tabular-nums max-w-[4.5rem] mx-auto focus:!ring-primary"
                      [(ngModel)]="line.reservarInput"
                      (ngModelChange)="onReservarInput(line)" />
                  </td>
                  <td class="px-2 py-2">
                    <input
                      type="text"
                      inputmode="numeric"
                      class="form-control !min-h-0 !py-1 !px-2 !rounded-md !text-sm text-center tabular-nums max-w-[4.5rem] mx-auto !border-orange-200 focus:!ring-orange-400"
                      [(ngModel)]="line.faltanteInput"
                      (ngModelChange)="onFaltanteInput(line)" />
                  </td>
                  <td class="px-2 py-2">
                    <div class="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        (click)="markComplete(line)"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold transition-colors"
                        [class.border-primary]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                        [class.bg-primary]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                        [class.text-white]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                        [class.border-gray-200]="getFaltante(line) !== 0 || getReservar(line) !== getPendiente(line)"
                        [class.text-teal-700]="getFaltante(line) !== 0 || getReservar(line) !== getPendiente(line)"
                        title="Todo reservado">
                        ✓
                      </button>
                      <button
                        type="button"
                        (click)="markNeedsPurchase(line)"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold transition-colors"
                        [class.border-orange-200]="getFaltante(line) > 0"
                        [class.bg-orange-50]="getFaltante(line) > 0"
                        [class.text-orange-700]="getFaltante(line) > 0"
                        [class.border-gray-200]="getFaltante(line) === 0"
                        [class.text-gray-500]="getFaltante(line) === 0"
                        title="Marcar faltante">
                        ✗
                      </button>
                    </div>
                  </td>
                </tr>

                <tr *ngIf="needsTransfer(line)" class="bg-amber-50/80">
                  <td colspan="6" class="px-3 py-2 border-t border-amber-200/60">
                    <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 text-xs text-gray-700">
                      <span class="min-w-0 flex-1">
                        Falta stock libre para reservar {{ getReservar(line) }} u. Transferí de otro pedido o subí el faltante.
                      </span>
                      <button
                        type="button"
                        (click)="loadTransferSources(line)"
                        [disabled]="line.loadingSources"
                        class="shrink-0 font-semibold text-teal-700 hover:text-teal-800 underline disabled:opacity-60">
                        {{ line.loadingSources ? 'Buscando...' : 'Buscar pedido origen' }}
                      </button>
                      <ng-container *ngIf="line.transferSources.length">
                        <select
                          class="form-control !min-h-0 !py-1 !px-2 !rounded-md !text-xs min-w-[9rem]"
                          [(ngModel)]="line.transferSourceKey"
                          (ngModelChange)="onTransferSourceChange(line)">
                          <option value="">Pedido...</option>
                          <option *ngFor="let src of line.transferSources" [value]="transferSourceKey(src)">
                            #{{ src.orderLabel }} ({{ src.cantidadTransferible }} u.)
                          </option>
                        </select>
                        <input
                          type="text"
                          inputmode="numeric"
                          class="form-control !min-h-0 !py-1 !px-2 !rounded-md !text-xs text-center tabular-nums w-14"
                          [(ngModel)]="line.transferQtyInput"
                          (ngModelChange)="onTransferQtyInput(line)" />
                        <button
                          type="button"
                          (click)="executeTransfer(line)"
                          [disabled]="line.transferring || !line.transferSourceKey"
                          class="px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-opacity-90 disabled:opacity-60">
                          {{ line.transferring ? '...' : 'Transferir' }}
                        </button>
                      </ng-container>
                    </div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>

          <p class="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100 bg-gray-50/80">
            Reservado + faltante debe igualar el pedido. Confirmar aparta stock libre; lo faltante queda para comprar.
          </p>
        </div>

        <div class="shrink-0 border-t border-gray-100 px-4 py-3 sm:px-5 flex flex-wrap gap-2 justify-end bg-white">
          <button
            type="button"
            (click)="cancel()"
            class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="confirm()"
            [disabled]="loading || saving || !view"
            class="px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-bold hover:bg-opacity-90 disabled:opacity-60">
            {{ saving ? 'Guardando...' : (isReedit ? 'Guardar reserva' : 'Confirmar y reservar') }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class OrderStockPreparationPanelComponent implements OnChanges {
  private orderService = inject(OrderService);
  private dialogService = inject(DialogService);

  @Input() open = false;
  @Input() orderId = '';
  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<{ estadoStock: string; stockPreparado: boolean }>();

  loading = false;
  saving = false;
  view: OrderStockPreparationView | null = null;
  draftLines: DraftLine[] = [];

  get isReedit(): boolean {
    return !!this.view?.stockPreparado;
  }

  get completeLineCount(): number {
    return this.draftLines.filter(
      (line) => this.getFaltante(line) === 0 && this.getReservar(line) === this.getPendiente(line)
    ).length;
  }

  get shortageLineCount(): number {
    return this.draftLines.filter((line) => this.getFaltante(line) > 0).length;
  }

  ngOnChanges(): void {
    if (this.open && this.orderId) {
      this.load();
    }
  }

  getPendiente(line: OrderStockPreparationLine): number {
    return getStockPrepPendiente(line);
  }

  productBase(line: OrderStockPreparationLine): string {
    return splitProductDisplayName(line.nombre).base;
  }

  productVariant(line: OrderStockPreparationLine): string {
    return splitProductDisplayName(line.nombre).variant;
  }

  getReservar(line: DraftLine): number {
    return Number(line.reservarInput) || 0;
  }

  getFaltante(line: DraftLine): number {
    return Number(line.faltanteInput) || 0;
  }

  needsTransfer(line: DraftLine): boolean {
    if (!line.controlaStock) return false;
    const pendiente = this.getPendiente(line);
    const targetReserva = this.getReservar(line);
    if (targetReserva <= 0 || targetReserva > pendiente) return false;

    const delta = targetReserva - (Number(line.cantidadReservada) || 0);
    const libre = Number(line.stockDisponible) || 0;
    return delta > libre;
  }

  transferSourceKey(src: ReservationSourceOrder): string {
    return `${src.orderId}:${src.lineIndex}`;
  }

  private parseTransferSourceKey(key: string): { orderId: string; lineIndex: number } | null {
    const [orderId, lineIndexRaw] = key.split(':');
    const lineIndex = Number(lineIndexRaw);
    if (!orderId || Number.isNaN(lineIndex)) return null;
    return { orderId, lineIndex };
  }

  private load() {
    this.loading = true;
    this.view = null;
    this.orderService.getStockPreparation(this.orderId).subscribe({
      next: (view) => {
        this.view = view;
        this.draftLines = view.lines.map((line) => this.buildDraftLine(line, view.stockPreparado));
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la revisión de stock.',
        });
        this.cancel();
      },
    });
  }

  private buildDraftLine(line: OrderStockPreparationLine, stockPreparado: boolean): DraftLine {
    const pendiente = this.getPendiente(line);
    const suggested = buildSuggestedStockAllocations({
      stockPreparado,
      lines: [line],
    } as OrderStockPreparationView)[0];
    const faltante = suggested?.cantidadFaltante ?? 0;
    const reservar = Math.max(0, pendiente - faltante);

    return {
      ...line,
      reservarInput: String(reservar),
      faltanteInput: String(faltante),
      transferSources: [],
      transferSourceKey: '',
      transferQtyInput: '1',
      loadingSources: false,
      transferring: false,
    };
  }

  private maxReservableForLine(line: DraftLine): number {
    const pendiente = this.getPendiente(line);
    // En ajuste manual de reservas permitimos sobre-reservar aunque no haya libre.
    return pendiente;
  }

  private syncLineTotals(line: DraftLine, source: 'reservar' | 'faltante') {
    const pendiente = this.getPendiente(line);
    if (source === 'reservar') {
      let reservar = Math.min(pendiente, Math.max(0, Number(line.reservarInput) || 0));
      if (line.controlaStock) {
        reservar = Math.min(reservar, this.maxReservableForLine(line));
      }
      line.reservarInput = String(reservar);
      line.faltanteInput = String(Math.max(0, pendiente - reservar));
      return;
    }

    const faltante = Math.min(pendiente, Math.max(0, Number(line.faltanteInput) || 0));
    let reservar = Math.max(0, pendiente - faltante);
    if (line.controlaStock) {
      reservar = Math.min(reservar, this.maxReservableForLine(line));
    }
    line.reservarInput = String(reservar);
    line.faltanteInput = String(Math.max(0, pendiente - reservar));
  }

  private refreshDraftLine(lineIndex: number, updated: OrderStockPreparationLine) {
    const current = this.draftLines.find((line) => line.lineIndex === lineIndex);
    const reservarInput = current?.reservarInput ?? String(updated.cantidadReservada || 0);
    const faltanteInput = current?.faltanteInput ?? String(updated.cantidadFaltante || 0);
    const transferSources = current?.transferSources ?? [];
    const transferSourceKey = current?.transferSourceKey ?? '';
    const transferQtyInput = current?.transferQtyInput ?? '1';

    const idx = this.draftLines.findIndex((line) => line.lineIndex === lineIndex);
    if (idx < 0) return;

    this.draftLines[idx] = {
      ...updated,
      reservarInput,
      faltanteInput,
      transferSources,
      transferSourceKey,
      transferQtyInput,
      loadingSources: false,
      transferring: false,
    };
  }

  markComplete(line: DraftLine) {
    const pendiente = this.getPendiente(line);
    const reservar = this.maxReservableForLine(line);
    line.reservarInput = String(reservar);
    line.faltanteInput = String(Math.max(0, pendiente - reservar));
  }

  markNeedsPurchase(line: DraftLine) {
    const pendiente = this.getPendiente(line);
    const currentFaltante = Number(line.faltanteInput) || 0;
    const nextFaltante = currentFaltante > 0 ? currentFaltante : Math.min(pendiente, Math.max(1, pendiente - (Number(line.reservarInput) || 0) || 1));
    line.faltanteInput = String(nextFaltante);
    this.syncLineTotals(line, 'faltante');
  }

  onReservarInput(line: DraftLine) {
    this.syncLineTotals(line, 'reservar');
  }

  onFaltanteInput(line: DraftLine) {
    this.syncLineTotals(line, 'faltante');
  }

  loadTransferSources(line: DraftLine) {
    if (!this.orderId || !line.stockItemId) return;
    line.loadingSources = true;
    this.orderService.getReservationSources(line.stockItemId, this.orderId).subscribe({
      next: (sources) => {
        line.transferSources = sources;
        line.loadingSources = false;
        if (sources.length === 1) {
          line.transferSourceKey = this.transferSourceKey(sources[0]);
          line.transferQtyInput = String(
            Math.min(sources[0].cantidadTransferible, this.transferNeeded(line))
          );
        }
      },
      error: () => {
        line.loadingSources = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron buscar reservas en otros pedidos.',
        });
      },
    });
  }

  transferNeeded(line: DraftLine): number {
    const delta = this.getReservar(line) - (Number(line.cantidadReservada) || 0);
    const libre = Number(line.stockDisponible) || 0;
    return Math.max(0, delta - libre);
  }

  onTransferSourceChange(line: DraftLine) {
    const src = line.transferSources.find((s) => this.transferSourceKey(s) === line.transferSourceKey);
    if (!src) return;
    line.transferQtyInput = String(
      Math.min(src.cantidadTransferible, this.transferNeeded(line))
    );
  }

  onTransferQtyInput(line: DraftLine) {
    const src = line.transferSources.find((s) => this.transferSourceKey(s) === line.transferSourceKey);
    const max = src ? src.cantidadTransferible : this.transferNeeded(line);
    const parsed = Math.floor(Number(String(line.transferQtyInput).replace(',', '.')) || 0);
    line.transferQtyInput = String(Math.min(max, Math.max(1, parsed)));
  }

  executeTransfer(line: DraftLine) {
    const parsed = this.parseTransferSourceKey(line.transferSourceKey);
    if (!parsed || !this.orderId) return;

    const cantidad = Number(line.transferQtyInput) || 0;
    if (cantidad <= 0) return;

    line.transferring = true;
    this.orderService
      .transferStockReservation({
        sourceOrderId: parsed.orderId,
        targetOrderId: this.orderId,
        stockItemId: line.stockItemId,
        cantidad,
        sourceLineIndex: parsed.lineIndex,
        targetLineIndex: line.lineIndex,
      })
      .subscribe({
        next: () => {
          line.transferring = false;
          this.orderService.getStockPreparation(this.orderId).subscribe({
            next: (view) => {
              this.view = view;
              const updated = view.lines.find((l) => l.lineIndex === line.lineIndex);
              if (updated) this.refreshDraftLine(line.lineIndex, updated);
            },
          });
        },
        error: (err) => {
          line.transferring = false;
          this.dialogService.alert({
            title: 'No se pudo transferir',
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'Revisá la cantidad e intentá de nuevo.',
          });
        },
      });
  }

  cancel() {
    this.open = false;
    this.closed.emit();
  }

  private validateLine(line: DraftLine): string | null {
    const pendiente = this.getPendiente(line);
    const reservar = this.getReservar(line);
    const faltante = this.getFaltante(line);

    if (reservar + faltante !== pendiente) {
      return `«${line.nombre}»: reservado + faltante debe sumar ${pendiente} u.`;
    }
    return null;
  }

  confirm() {
    if (!this.orderId || !this.view) return;

    for (const line of this.draftLines) {
      const error = this.validateLine(line);
      if (error) {
        this.dialogService.alert({ title: 'Revisá las cantidades', message: error });
        return;
      }
    }

    this.saving = true;

    const allocations = this.draftLines.map((line) => ({
      lineIndex: line.lineIndex,
      cantidadFaltante: this.getFaltante(line),
    }));

    this.orderService.confirmStockPreparation(this.orderId, allocations).subscribe({
      next: (result) => {
        this.saving = false;
        this.confirmed.emit({
          estadoStock: result.estadoStock,
          stockPreparado: result.stockPreparado,
        });
        this.open = false;
        this.closed.emit();
      },
      error: (err) => {
        this.saving = false;
        this.dialogService.alert({
          title: 'No se pudo guardar',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'Revisá las cantidades e intentá de nuevo.',
        });
      },
    });
  }
}
