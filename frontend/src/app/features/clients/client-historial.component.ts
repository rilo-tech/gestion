import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ClientAccount,
  ClientAccountOrder,
  ClientAccountSale,
  ClientService,
} from '../../core/services/client.service';
import { OrderService } from '../../core/services/order.service';
import { SalesService } from '../../core/services/sales.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import {
  IconActionComponent,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';

type CollectTarget =
  | { kind: 'pedido'; item: ClientAccountOrder }
  | { kind: 'venta'; item: ClientAccountSale };

type CollectMode = 'client' | 'item';

@Component({
  selector: 'app-client-historial',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    TransactionModalComponent,
    IconActionComponent,
    ConceptRefLinksComponent,
  ],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <div class="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div class="min-w-0">
          <a
            routerLink="/clients"
            class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 mb-3">
            <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
            Volver a clientes
          </a>
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">
            Historial · {{ clientName }}
          </h1>
          <p class="text-sm text-gray-500 mt-1">
            Cuenta corriente, compras y cobros registrados en caja.
          </p>
        </div>
        <div class="flex flex-col sm:flex-row gap-2 shrink-0">
          <app-icon-action
            *ngIf="account?.debe"
            label="Cobrar cuenta"
            (clicked)="openClientCollectModal()">
            <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <a
            *ngIf="clientId"
            [routerLink]="['/clients', clientId, 'edit']"
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shrink-0">
            <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
            <span class="hidden sm:inline">Editar datos</span>
          </a>
        </div>
      </div>

      <div *ngIf="loading" class="py-16 text-center text-gray-400">Cargando historial...</div>

      <ng-container *ngIf="!loading && account">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Saldo pendiente</p>
            <p
              class="text-xl sm:text-2xl font-bold tabular-nums"
              [class.text-orange-600]="account.debe"
              [class.text-gray-900]="!account.debe">
              {{ '$' + account.saldoTotal }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Total facturado</p>
            <p class="text-xl sm:text-2xl font-bold tabular-nums text-gray-900">
              {{ '$' + (account.totalFacturado || 0) }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Total cobrado</p>
            <p class="text-xl sm:text-2xl font-bold tabular-nums text-teal-700">
              {{ '$' + (account.totalCobrado || 0) }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm col-span-2 lg:col-span-1">
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Desglose deuda</p>
            <p class="text-sm text-gray-600">Pedidos: {{ '$' + account.saldoPedidos }}</p>
            <p class="text-sm text-gray-600">Mostrador: {{ '$' + account.saldoVentasMostrador }}</p>
          </div>
        </div>

        <section *ngIf="pendingItems.length" class="mb-6 rounded-xl border border-orange-100 bg-orange-50 p-4 sm:p-5">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h2 class="text-sm font-bold text-orange-900">Saldos pendientes de cobro</h2>
            <p class="text-xs text-orange-800">
              Podés cobrar uno por uno o usar «Cobrar cuenta» para aplicar un pago a varios saldos.
            </p>
          </div>
          <div class="space-y-2">
            <div
              *ngFor="let entry of pendingItems"
              class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-white/80 border border-orange-100 px-4 py-3">
              <a
                [routerLink]="getPendingItemRoute(entry.target)"
                [queryParams]="getPendingItemQueryParams(entry.target)"
                class="min-w-0 group">
                <p class="font-medium text-gray-900 group-hover:text-teal-700">{{ entry.label }}</p>
                <p class="text-xs text-gray-500 truncate group-hover:text-teal-600">{{ entry.detail }}</p>
              </a>
              <div class="flex items-center gap-3 shrink-0">
                <span class="font-bold tabular-nums text-orange-700">{{ '$' + entry.saldo }}</span>
                <app-icon-action label="Cobrar" (clicked)="openCollectModal(entry.target)">
                  <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
                </app-icon-action>
              </div>
            </div>
          </div>
        </section>

        <section class="mb-6 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <h2 class="text-sm font-bold text-gray-900 px-4 py-3 border-b border-gray-100">
            Historial de cobros (caja)
          </h2>
          <div *ngIf="!(account.historialPagos?.length)" class="px-4 py-10 text-center text-gray-400 text-sm">
            Todavía no hay cobros registrados para este cliente.
          </div>
          <div *ngIf="account.historialPagos?.length" class="divide-y divide-gray-50">
            <div
              *ngFor="let pago of account.historialPagos"
              class="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-900">
                  <app-concept-ref-links
                    [text]="pago.concepto"
                    [pedidoId]="pago.pedidoId"
                    [ventaId]="pago.ventaId"
                    [numeroPedidoLabel]="pago.numeroPedidoLabel"
                    [ventaLabel]="pago.ventaLabel">
                  </app-concept-ref-links>
                </p>
                <p class="text-xs text-gray-500">
                  {{ formatDate(pago.fecha) }}
                  <span *ngIf="pago.medio"> · {{ pago.medio }}</span>
                </p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <span class="font-bold tabular-nums text-teal-700">{{ '$' + pago.monto }}</span>
              </div>
            </div>
          </div>
        </section>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <h2 class="text-sm font-bold text-gray-900 px-4 py-3 border-b border-gray-100">Pedidos</h2>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                  <tr>
                    <th class="px-4 py-3">Pedido</th>
                    <th class="px-4 py-3">Estado</th>
                    <th class="px-4 py-3 text-right">Total</th>
                    <th class="px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50 text-sm">
                  <tr *ngFor="let pedido of account.pedidos">
                    <td class="px-4 py-3">
                      <a [routerLink]="['/orders', pedido.id, 'edit']" class="font-semibold text-teal-700 hover:underline">
                        #{{ pedido.numeroPedidoLabel }}
                      </a>
                      <p class="text-xs text-gray-500 truncate">{{ pedido.descripcion || '—' }}</p>
                    </td>
                    <td class="px-4 py-3 text-gray-600">{{ pedido.estado || '—' }}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ '$' + pedido.total }}</td>
                    <td class="px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="pedido.saldo > 0">
                      {{ '$' + pedido.saldo }}
                    </td>
                  </tr>
                  <tr *ngIf="account.pedidos.length === 0">
                    <td colspan="4" class="px-4 py-8 text-center text-gray-400">Sin pedidos.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <h2 class="text-sm font-bold text-gray-900 px-4 py-3 border-b border-gray-100">Ventas</h2>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                  <tr>
                    <th class="px-4 py-3">Venta</th>
                    <th class="px-4 py-3">Origen</th>
                    <th class="px-4 py-3 text-right">Total</th>
                    <th class="px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50 text-sm">
                  <tr *ngFor="let venta of account.ventas" class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="getVentaRoute(venta)"
                        [queryParams]="getVentaQueryParams(venta)"
                        class="font-semibold text-teal-700 hover:underline">
                        #{{ venta.ventaLabel }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-gray-600">
                      <a
                        *ngIf="venta.origen === 'pedido' && venta.pedidoId"
                        [routerLink]="['/orders', venta.pedidoId, 'edit']"
                        class="text-teal-700 hover:underline">
                        Pedido #{{ venta.numeroPedidoLabel || '—' }}
                      </a>
                      <span *ngIf="venta.origen !== 'pedido'">Mostrador</span>
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ '$' + venta.total }}</td>
                    <td class="px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="venta.saldoPendiente > 0">
                      {{ '$' + venta.saldoPendiente }}
                    </td>
                  </tr>
                  <tr *ngIf="account.ventas.length === 0">
                    <td colspan="4" class="px-4 py-8 text-center text-gray-400">Sin ventas.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </ng-container>
    </div>

    <app-transaction-modal
      [open]="collectModalOpen"
      [title]="collectModalTitle"
      [subtitle]="collectModalSubtitle"
      maxWidthClass="max-w-md"
      (closed)="closeCollectModal()">
      <div class="space-y-4">
        <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm space-y-2">
          <div class="flex justify-between gap-4">
            <span class="text-gray-500">
              {{ collectMode === 'client' ? 'Saldo total del cliente' : 'Saldo pendiente' }}
            </span>
            <span class="font-bold tabular-nums text-orange-600">{{ '$' + collectSaldoMax }}</span>
          </div>
          <div *ngIf="collectMode === 'client' && collectAllocationPreview.length" class="pt-2 border-t border-gray-200">
            <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Se aplicará en este orden</p>
            <div class="space-y-1">
              <div
                *ngFor="let row of collectAllocationPreview"
                class="flex justify-between gap-3 text-xs text-gray-700">
                <span class="truncate">{{ row.label }}</span>
                <span class="font-semibold tabular-nums shrink-0">{{ '$' + row.monto }}</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar</label>
          <input
            type="number"
            [(ngModel)]="collectMonto"
            min="0"
            [max]="collectSaldoMax"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          <p *ngIf="collectMode === 'client'" class="text-xs text-gray-400 mt-1">
            El pago se distribuye automáticamente sobre los saldos más antiguos.
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
          <select
            [(ngModel)]="collectMedio"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            [(ngModel)]="collectNotas"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6">
        <button
          type="button"
          (click)="closeCollectModal()"
          class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          type="button"
          (click)="submitCollect()"
          [disabled]="collectSaving"
          class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
          {{ collectSaving ? 'Guardando...' : 'Registrar en caja' }}
        </button>
      </div>
    </app-transaction-modal>
  `,
})
export class ClientHistorialComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;

  private clientService = inject(ClientService);
  private orderService = inject(OrderService);
  private salesService = inject(SalesService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  clientId = '';
  clientName = 'Cliente';
  account: ClientAccount | null = null;
  loading = true;

  collectModalOpen = false;
  collectMode: CollectMode = 'item';
  collectTarget: CollectTarget | null = null;
  collectMonto: number | null = null;
  collectMedio = 'efectivo';
  collectNotas = '';
  collectSaving = false;

  pendingItems: Array<{
    label: string;
    detail: string;
    saldo: number;
    fecha: string;
    target: CollectTarget;
  }> = [];

  get collectSaldoMax(): number {
    if (this.collectMode === 'client') {
      return Number(this.account?.saldoTotal) || 0;
    }
    if (!this.collectTarget) return 0;
    return this.collectTarget.kind === 'pedido'
      ? this.collectTarget.item.saldo
      : this.collectTarget.item.saldoPendiente;
  }

  get collectModalTitle(): string {
    return this.collectMode === 'client' ? 'Cobrar cuenta corriente' : 'Registrar cobro';
  }

  get collectModalSubtitle(): string {
    if (this.collectMode === 'client') {
      return `Un solo pago puede cubrir varios pedidos y ventas de ${this.clientName}.`;
    }
    if (!this.collectTarget) return '';
    if (this.collectTarget.kind === 'pedido') {
      return `Pedido #${this.collectTarget.item.numeroPedidoLabel} · se registra en caja y actualiza el saldo del pedido.`;
    }
    return `Venta #${this.collectTarget.item.ventaLabel} · cobro de saldo mostrador.`;
  }

  get collectAllocationPreview(): Array<{ label: string; monto: number }> {
    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) return [];

    let remaining = monto;
    const preview: Array<{ label: string; monto: number }> = [];
    const sorted = [...this.pendingItems].sort((a, b) => a.fecha.localeCompare(b.fecha));

    for (const entry of sorted) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, entry.saldo);
      if (apply <= 0) continue;
      preview.push({ label: entry.label, monto: apply });
      remaining -= apply;
    }

    return preview;
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.router.navigate(['/clients']);
        return;
      }
      this.clientId = id;
      this.loadAccount();
    });
  }

  loadAccount() {
    this.loading = true;
    this.clientService.getClientAccount(this.clientId).subscribe({
      next: (account) => {
        this.account = account;
        this.clientName = account.cliente.nombre || 'Cliente';
        this.buildPendingItems(account);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el historial del cliente.',
        });
        this.router.navigate(['/clients']);
      },
    });
  }

  buildPendingItems(account: ClientAccount) {
    const items: typeof this.pendingItems = [];

    for (const pedido of account.pedidos) {
      if (pedido.saldo <= 0) continue;
      items.push({
        label: `Pedido #${pedido.numeroPedidoLabel}`,
        detail: pedido.descripcion || pedido.estado || 'Pedido',
        saldo: pedido.saldo,
        fecha: pedido.fechaEntrega || '',
        target: { kind: 'pedido', item: pedido },
      });
    }

    for (const venta of account.ventas) {
      if (venta.origen === 'pedido' || venta.saldoPendiente <= 0) continue;
      items.push({
        label: `Venta #${venta.ventaLabel}`,
        detail: 'Venta mostrador',
        saldo: venta.saldoPendiente,
        fecha: venta.fecha || '',
        target: { kind: 'venta', item: venta },
      });
    }

    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    this.pendingItems = items;
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR');
  }

  getPendingItemRoute(target: CollectTarget): string[] {
    if (target.kind === 'pedido') {
      return ['/orders', target.item.id, 'edit'];
    }
    return ['/sales'];
  }

  getPendingItemQueryParams(target: CollectTarget): Record<string, string> | null {
    if (target.kind === 'venta') {
      return { ventaId: target.item.id };
    }
    return null;
  }

  getVentaRoute(venta: ClientAccountSale): string[] {
    if (venta.origen === 'pedido' && venta.pedidoId) {
      return ['/orders', venta.pedidoId, 'edit'];
    }
    return ['/sales'];
  }

  getVentaQueryParams(venta: ClientAccountSale): Record<string, string> | null {
    if (venta.origen !== 'pedido') {
      return { ventaId: venta.id };
    }
    return null;
  }

  openClientCollectModal() {
    if (!(Number(this.account?.saldoTotal) > 0)) return;
    this.collectMode = 'client';
    this.collectTarget = null;
    this.collectMonto = Number(this.account?.saldoTotal) || 0;
    this.collectMedio = 'efectivo';
    this.collectNotas = '';
    this.collectModalOpen = true;
  }

  openCollectModal(target: CollectTarget) {
    this.collectMode = 'item';
    this.collectTarget = target;
    this.collectMonto =
      target.kind === 'pedido' ? target.item.saldo : target.item.saldoPendiente;
    this.collectMedio = 'efectivo';
    this.collectNotas = '';
    this.collectModalOpen = true;
  }

  closeCollectModal() {
    this.collectModalOpen = false;
    this.collectTarget = null;
    this.collectMode = 'item';
  }

  submitCollect() {
    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    if (monto > this.collectSaldoMax) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: `El monto no puede superar el saldo pendiente ($${this.collectSaldoMax}).`,
      });
      return;
    }

    this.collectSaving = true;

    if (this.collectMode === 'client') {
      this.clientService
        .collectClientBalance(this.clientId, {
          monto,
          medioPago: this.collectMedio,
          notas: this.collectNotas.trim() || undefined,
        })
        .subscribe({
          next: () => this.onCollectSuccess(),
          error: (err) => this.onCollectError(err),
        });
      return;
    }

    if (!this.collectTarget) {
      this.collectSaving = false;
      return;
    }

    if (this.collectTarget.kind === 'pedido') {
      this.orderService
        .addOrderPayment(this.collectTarget.item.id, {
          monto,
          tipo: 'pago',
          notas: this.collectNotas.trim() || undefined,
        })
        .subscribe({
          next: () => this.onCollectSuccess(),
          error: (err) => this.onCollectError(err),
        });
      return;
    }

    this.salesService
      .collectSaleBalance(this.collectTarget.item.id, {
        monto,
        medioPago: this.collectMedio,
        notas: this.collectNotas.trim() || undefined,
      })
      .subscribe({
        next: () => this.onCollectSuccess(),
        error: (err) => this.onCollectError(err),
      });
  }

  private onCollectSuccess() {
    this.collectSaving = false;
    this.closeCollectModal();
    this.loadAccount();
  }

  private onCollectError(err: { error?: { error?: string } }) {
    this.collectSaving = false;
    this.dialogService.alert({
      title: 'Error',
      message: typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar el cobro.',
    });
  }
}
