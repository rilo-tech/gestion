import { Component, EventEmitter, Input, Output, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OrderLineItem,
  OrderService,
  OrderStockPreparationLine,
  OrderStockPreparationView,
  ReservationSourceOrder,
} from '../../core/services/order.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  buildSuggestedStockAllocations,
  getStockPrepPendiente,
  mergeDraftOrderIntoStockPrepView,
  splitProductDisplayName,
} from '../../core/utils/order-stock-prep';
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
} from '../../shared/components/icon-action/icon-action.component';

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
      <button
        type="button"
        class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        (click)="cancel()"
        aria-label="Cerrar"></button>

      <div
        class="relative z-[1] w-full max-w-5xl max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div class="shrink-0 border-b border-gray-100 dark:border-gray-800 px-3 py-2.5 sm:px-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
                {{ isReedit ? 'Editar stock' : 'Revisar stock' }}
                <span *ngIf="displayOrderLabel" class="font-semibold text-teal-600 dark:text-teal-400">
                  #{{ displayOrderLabel }}
                </span>
              </h2>
              <p class="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-medium truncate" [title]="displayClientName">
                {{ displayClientName }}
              </p>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
                Al confirmar se reserva stock en depósito. Usá +/− o escribí cantidades; reservado + faltante = pedido.
              </p>
            </div>
            <div *ngIf="view && !loading" class="flex flex-wrap gap-1.5 text-[10px]">
              <span
                class="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-medium text-gray-600 dark:text-gray-300">
                {{ draftLines.length }} ítem{{ draftLines.length === 1 ? '' : 's' }}
              </span>
              <span
                class="inline-flex items-center rounded-md bg-teal-50 dark:bg-teal-950/50 px-1.5 py-0.5 font-medium text-teal-700 dark:text-teal-300">
                {{ completeLineCount }} ok
              </span>
              <span
                *ngIf="shortageLineCount > 0"
                class="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 font-medium text-sky-700 dark:text-sky-300">
                {{ shortageLineCount }} faltante{{ shortageLineCount === 1 ? '' : 's' }}
              </span>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-auto">
          <table class="app-data-table w-full min-w-0 text-left border-collapse text-xs">
            <thead
              class="sticky top-0 z-[1] bg-gray-50 dark:bg-gray-950 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th class="px-2 py-1.5 font-semibold w-[34%]">Producto</th>
                <th class="px-1 py-1.5 font-semibold text-center w-9">Ped.</th>
                <th class="px-1 py-1.5 font-semibold text-center w-9" title="Libre en depósito">Lib.</th>
                <th class="px-1 py-1.5 font-semibold text-center w-[4.75rem]">Reserv.</th>
                <th class="px-1 py-1.5 font-semibold text-center w-[4.75rem]">Falt.</th>
                <th class="px-1 py-1.5 font-semibold text-center w-14">Acc.</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <ng-container *ngIf="loading">
                <tr *ngFor="let _ of skeletonRows" class="animate-pulse">
                  <td class="px-2 py-1" colspan="6">
                    <div class="h-2 bg-gray-100 dark:bg-gray-800 rounded w-1/2"></div>
                  </td>
                </tr>
              </ng-container>

              <ng-container *ngIf="!loading && view">
                <ng-container *ngFor="let line of draftLines; trackBy: trackLine">
                  <tr class="align-middle transition-colors" [ngClass]="lineRowClass(line)">
                    <td class="px-2 py-1 min-w-0">
                      <p
                        class="font-medium text-gray-900 dark:text-gray-100 truncate leading-tight"
                        [title]="line.nombre">
                        {{ productBase(line) }}
                        <span *ngIf="productVariant(line)" class="font-normal text-gray-500 dark:text-gray-400">
                          · {{ productVariant(line) }}
                        </span>
                      </p>
                      <p *ngIf="!line.controlaStock" class="text-[10px] text-gray-500 mt-0.5">Sin control de stock</p>
                      <p
                        *ngIf="isReedit && line.controlaStock"
                        class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                        Guardado {{ line.cantidadReservada }}/{{ getPendiente(line) }}
                        <span *ngIf="line.cantidadFaltante > 0"> · falt. {{ line.cantidadFaltante }}</span>
                      </p>
                    </td>
                    <td class="px-1 py-1 text-center tabular-nums text-gray-700 dark:text-gray-300">
                      {{ getPendiente(line) }}
                    </td>
                    <td class="px-1 py-1 text-center tabular-nums text-gray-600 dark:text-gray-400">
                      {{ line.controlaStock ? line.stockDisponible : '—' }}
                    </td>
                    <td class="px-1 py-1">
                      <div class="flex items-center justify-center gap-0.5 mx-auto">
                        <button
                          type="button"
                          (click)="adjustReservar(line, -1)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                          −
                        </button>
                        <input
                          type="text"
                          inputmode="numeric"
                          class="form-control !min-h-0 !h-7 !w-9 !py-0 !px-1 !rounded !text-xs text-center tabular-nums focus:!ring-teal-500/40"
                          [(ngModel)]="line.reservarInput"
                          (ngModelChange)="onReservarInput(line)" />
                        <button
                          type="button"
                          (click)="adjustReservar(line, 1)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                          +
                        </button>
                      </div>
                    </td>
                    <td class="px-1 py-1">
                      <div class="flex items-center justify-center gap-0.5 mx-auto">
                        <button
                          type="button"
                          (click)="adjustFaltante(line, -1)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                          −
                        </button>
                        <input
                          type="text"
                          inputmode="numeric"
                          class="form-control !min-h-0 !h-7 !w-9 !py-0 !px-1 !rounded !text-xs text-center tabular-nums !border-sky-200 dark:!border-sky-800 focus:!ring-sky-400/40"
                          [(ngModel)]="line.faltanteInput"
                          (ngModelChange)="onFaltanteInput(line)" />
                        <button
                          type="button"
                          (click)="adjustFaltante(line, 1)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                          +
                        </button>
                      </div>
                    </td>
                    <td class="px-1 py-1">
                      <div class="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          (click)="markComplete(line)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-colors"
                          [class.border-teal-500]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                          [class.bg-teal-600]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                          [class.text-white]="getFaltante(line) === 0 && getReservar(line) === getPendiente(line)"
                          [class.border-gray-200]="getFaltante(line) !== 0 || getReservar(line) !== getPendiente(line)"
                          [class.dark:border-gray-700]="getFaltante(line) !== 0 || getReservar(line) !== getPendiente(line)"
                          [class.text-teal-700]="getFaltante(line) !== 0 || getReservar(line) !== getPendiente(line)"
                          title="Reservar todo lo posible">
                          ✓
                        </button>
                        <button
                          type="button"
                          (click)="markNeedsPurchase(line)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-colors"
                          [class.border-sky-400]="getFaltante(line) > 0"
                          [class.bg-sky-500/15]="getFaltante(line) > 0"
                          [class.text-sky-700]="getFaltante(line) > 0"
                          [class.dark:text-sky-300]="getFaltante(line) > 0"
                          [class.border-gray-200]="getFaltante(line) === 0"
                          [class.dark:border-gray-700]="getFaltante(line) === 0"
                          [class.text-gray-500]="getFaltante(line) === 0"
                          title="Marcar faltante">
                          ✗
                        </button>
                      </div>
                    </td>
                  </tr>

                  <tr *ngIf="needsTransfer(line)" class="bg-sky-50/70 dark:bg-sky-950/25">
                    <td colspan="6" class="px-2 py-1.5 border-t border-sky-100 dark:border-sky-900/50">
                      <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                        <span class="min-w-0 flex-1">
                          Falta libre para reservar {{ getReservar(line) }} u. Transferí de otro pedido o subí el faltante.
                        </span>
                        <button
                          type="button"
                          (click)="loadTransferSources(line)"
                          [disabled]="line.loadingSources"
                          class="shrink-0 font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-60">
                          {{ line.loadingSources ? 'Buscando...' : 'Buscar origen' }}
                        </button>
                        <ng-container *ngIf="line.transferSources.length">
                          <select
                            class="form-control !min-h-0 !h-7 !py-0 !px-2 !rounded !text-[11px] min-w-[8rem]"
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
                            class="form-control !min-h-0 !h-7 !py-0 !px-2 !rounded !text-[11px] text-center tabular-nums w-12"
                            [(ngModel)]="line.transferQtyInput"
                            (ngModelChange)="onTransferQtyInput(line)" />
                          <button
                            type="button"
                            (click)="executeTransfer(line)"
                            [disabled]="line.transferring || !line.transferSourceKey"
                            class="px-2 py-1 rounded-md bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 disabled:opacity-60">
                            {{ line.transferring ? '...' : 'Transferir' }}
                          </button>
                        </ng-container>
                      </div>
                    </td>
                  </tr>
                </ng-container>
              </ng-container>
            </tbody>
          </table>

          <p
            *ngIf="!loading && view"
            class="px-3 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/40">
            Lib. = stock libre en depósito. Al confirmar se aparta lo reservado; el faltante queda para comprar.
          </p>
        </div>

        <div
          class="shrink-0 border-t border-gray-100 dark:border-gray-800 px-3 py-3 sm:px-4 flex flex-wrap gap-2 justify-end bg-white dark:bg-gray-900">
          <button type="button" (click)="cancel()" [class]="formCancelClass">Cancelar</button>
          <button
            type="button"
            (click)="confirm()"
            [disabled]="loading || saving || !view"
            [class]="formSubmitClass">
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
  @Input() orderLabel = '';
  @Input() clientName = '';
  /** Líneas del formulario (pueden diferir del pedido guardado hasta pulsar Guardar). */
  @Input() draftOrderLines: OrderLineItem[] | null = null;
  /** Se incrementa al cambiar cantidades o ítems para refrescar el panel abierto. */
  @Input() draftOrderLinesRevision = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<{ estadoStock: string; stockPreparado: boolean }>();

  loading = false;
  saving = false;
  view: OrderStockPreparationView | null = null;
  draftLines: DraftLine[] = [];
  readonly skeletonRows = [0, 1, 2];
  private loadGeneration = 0;

  readonly formCancelClass =
    FORM_CANCEL_CLASS + ' dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
  readonly formSubmitClass = FORM_SUBMIT_CLASS;

  get displayOrderLabel(): string {
    return this.view?.orderLabel || this.orderLabel || '';
  }

  get displayClientName(): string {
    return (this.view?.clienteNombre || this.clientName || '').trim() || 'Sin cliente';
  }

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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue && this.open && this.orderId) {
      this.load();
      return;
    }
    if (
      (changes['draftOrderLines'] || changes['draftOrderLinesRevision']) &&
      this.open &&
      this.view &&
      !this.loading
    ) {
      this.syncFromDraftOrderLines();
    }
  }

  trackLine(_index: number, line: DraftLine): number {
    return line.lineIndex;
  }

  lineRowClass(line: DraftLine): string {
    const base = 'border-l-2';
    if (this.getFaltante(line) > 0) {
      return `${base} border-l-sky-400 dark:border-l-sky-500 bg-sky-500/[0.06] dark:bg-sky-500/10`;
    }
    if (this.getReservar(line) > 0 && this.getFaltante(line) === 0) {
      return `${base} border-l-teal-500 bg-teal-500/[0.06] dark:bg-teal-500/10`;
    }
    return `${base} border-l-transparent`;
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
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.view = null;
    this.draftLines = [];

    this.orderService.getStockPreparation(this.orderId).subscribe({
      next: (view) => {
        if (generation !== this.loadGeneration) return;
        this.applyView(view);
        this.syncFromDraftOrderLines();
        this.loading = false;
      },
      error: () => {
        if (generation !== this.loadGeneration) return;
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la revisión de stock.',
        });
        this.cancel();
      },
    });
  }

  private syncFromDraftOrderLines() {
    if (!this.view) return;
    const draftLines = this.draftOrderLines ?? [];
    const merged = mergeDraftOrderIntoStockPrepView(this.view, draftLines);
    this.applyView(merged, true);
    for (const line of this.draftLines) {
      this.syncLineTotals(line, 'reservar');
    }
  }

  private applyView(view: OrderStockPreparationView, preserveInputs = false) {
    const previous = new Map(this.draftLines.map((line) => [line.lineIndex, line]));
    const suggestions = new Map(
      buildSuggestedStockAllocations(view).map((entry) => [entry.lineIndex, entry.cantidadFaltante])
    );

    this.view = view;
    this.draftLines = view.lines.map((line) => {
      const prev = previous.get(line.lineIndex);
      if (preserveInputs && prev) {
        return {
          ...prev,
          ...line,
          reservarInput: prev.reservarInput,
          faltanteInput: prev.faltanteInput,
          transferSources: prev.transferSources,
          transferSourceKey: prev.transferSourceKey,
          transferQtyInput: prev.transferQtyInput,
          loadingSources: false,
          transferring: false,
        };
      }
      return this.buildDraftLine(line, view.stockPreparado, suggestions.get(line.lineIndex) ?? 0);
    });
  }

  private buildDraftLine(
    line: OrderStockPreparationLine,
    stockPreparado: boolean,
    suggestedFaltante: number
  ): DraftLine {
    const pendiente = this.getPendiente(line);
    let faltante = suggestedFaltante;
    if (stockPreparado) {
      faltante = Math.min(pendiente, Math.max(0, Number(line.cantidadFaltante) || 0));
    } else if (!line.controlaStock) {
      faltante = 0;
    }
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
    return this.getPendiente(line);
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

  adjustReservar(line: DraftLine, delta: number) {
    line.reservarInput = String(Math.max(0, this.getReservar(line) + delta));
    this.syncLineTotals(line, 'reservar');
  }

  adjustFaltante(line: DraftLine, delta: number) {
    line.faltanteInput = String(Math.max(0, this.getFaltante(line) + delta));
    this.syncLineTotals(line, 'faltante');
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
    const nextFaltante =
      currentFaltante > 0
        ? currentFaltante
        : Math.min(pendiente, Math.max(1, pendiente - (Number(line.reservarInput) || 0) || 1));
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
    line.transferQtyInput = String(Math.min(src.cantidadTransferible, this.transferNeeded(line)));
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
        next: (result) => {
          line.transferring = false;
          if (result.lines?.length && this.view) {
            this.applyView(
              {
                ...this.view,
                estadoStock: result.estadoStock ?? this.view.estadoStock,
                stockPreparado: result.stockPreparado ?? this.view.stockPreparado,
                lines: result.lines,
              },
              true
            );
            return;
          }
          this.reloadAfterTransfer(line.lineIndex);
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

  private reloadAfterTransfer(lineIndex: number) {
    if (!this.orderId) return;
    this.orderService.getStockPreparation(this.orderId).subscribe({
      next: (view) => {
        this.applyView(view, true);
        const updated = view.lines.find((line) => line.lineIndex === lineIndex);
        if (updated) {
          const draft = this.draftLines.find((line) => line.lineIndex === lineIndex);
          if (draft) {
            const pendiente = this.getPendiente(updated);
            const reservar = Math.min(this.getReservar(draft), pendiente);
            draft.reservarInput = String(reservar);
            draft.faltanteInput = String(Math.max(0, pendiente - reservar));
          }
        }
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
