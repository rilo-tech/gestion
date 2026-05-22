import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CreateSalePayload,
  EligibleOrderForSale,
  Sale,
  SalesService,
} from '../../core/services/sales.service';
import { Client, ClientService } from '../../core/services/client.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { LucideAngularModule } from 'lucide-angular';

interface SaleDraftLine {
  stockItemId: string;
  cantidad: number | null;
  precioUnitario: number | null;
}

type SaleModalMode = 'mostrador' | 'pedido';

@Component({
  selector: 'app-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, SearchableSelectComponent],
  template: `
    <div class="p-8">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Ventas</h1>
          <p class="text-gray-500">
            Ventas de mostrador o entregas de pedidos. Los pagos previos del pedido no se duplican en caja.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            (click)="openSaleModal('mostrador')"
            class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
            Venta mostrador
          </button>
          <button
            type="button"
            (click)="openSaleModal('pedido')"
            class="inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100">
            <i-lucide name="truck" class="w-4 h-4"></i-lucide>
            Entrega desde pedido
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Ventas registradas</p>
          <p class="text-2xl font-bold text-gray-900">{{ sales.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Facturado</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + totalFacturado }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Cobrado en ventas</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalCobradoEnVentas }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Saldo pendiente</p>
          <p class="text-2xl font-bold text-orange-500">{{ '$' + totalSaldoPendiente }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Venta</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cobrado / Saldo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let sale of sales" class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(sale.fecha) }}
              </td>
              <td class="px-6 py-4 text-sm font-semibold text-teal-700">
                #{{ sale.ventaLabel || sale.id?.slice(-6) }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-700">
                {{ sale.clienteNombre?.trim() || '—' }}
              </td>
              <td class="px-6 py-4 text-sm">
                <ng-container *ngIf="sale.origen === 'pedido' && sale.pedidoId">
                  <a
                    [routerLink]="['/orders', sale.pedidoId, 'edit']"
                    class="text-teal-600 hover:underline font-medium">
                    Pedido #{{ sale.numeroPedidoLabel || '—' }}
                  </a>
                  <p *ngIf="sale.totalPagadoAnterior" class="text-xs text-gray-400 mt-0.5">
                    Ya pagado en pedido: {{ '$' + sale.totalPagadoAnterior }}
                  </p>
                </ng-container>
                <span *ngIf="sale.origen !== 'pedido'" class="text-gray-600">Mostrador</span>
              </td>
              <td class="px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (sale.total || 0) }}
              </td>
              <td class="px-6 py-4 text-sm text-right tabular-nums">
                <div class="font-semibold text-teal-700">{{ '$' + (sale.montoCobrado || 0) }}</div>
                <div
                  class="text-xs font-semibold"
                  [class.text-orange-500]="(sale.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(sale.saldoPendiente || 0)">
                  Saldo {{ '$' + (sale.saldoPendiente || 0) }}
                </div>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando ventas...</td>
            </tr>
            <tr *ngIf="!loading && sales.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay ventas. Registrá una venta de mostrador o la entrega de un pedido listo.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      *ngIf="saleModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="closeSaleModal()">
      </button>
      <div class="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl p-6">
        <h2 class="text-lg font-bold text-gray-900 mb-1">
          {{ saleModalMode === 'pedido' ? 'Registrar entrega / venta' : 'Venta de mostrador' }}
        </h2>
        <p class="text-sm text-gray-500 mb-4">
          <ng-container *ngIf="saleModalMode === 'pedido'">
            Solo se registra en caja el saldo que cobrás ahora. Seña y cuotas del pedido ya están en caja.
          </ng-container>
          <ng-container *ngIf="saleModalMode === 'mostrador'">
            Descuenta stock y registra el cobro en caja. Podés dejar saldo pendiente para el cliente.
          </ng-container>
        </p>

        <ng-container *ngIf="saleModalMode === 'pedido'">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Buscar por cliente (opcional)</label>
            <app-searchable-select
              [(ngModel)]="orderFilterClienteId"
              name="orderFilterClienteId"
              [labeledOptions]="clientOptions"
              (ngModelChange)="onOrderClientFilterChange()"
              placeholder="Filtrar pedidos por cliente..."
              listHint="Dejá vacío para ver todos los pedidos listos."
              emptyOptionsMessage="No hay clientes cargados.">
            </app-searchable-select>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Pedido listo para entregar</label>
            <app-searchable-select
              [(ngModel)]="selectedOrderId"
              name="selectedOrderId"
              [labeledOptions]="orderSelectOptions"
              (ngModelChange)="onOrderSelected()"
              placeholder="Buscar por N° pedido, cliente o descripción..."
              listHint="El cobro se registra como pago del pedido en caja."
              emptyOptionsMessage="No hay pedidos listos sin venta.">
            </app-searchable-select>
            <p *ngIf="eligibleOrders.length === 0" class="text-xs text-orange-600 mt-2">
              No hay pedidos listos sin venta. Marcá un pedido como listo desde Pedidos.
            </p>
          </div>

          <div *ngIf="selectedOrder" class="rounded-xl border border-gray-100 bg-gray-50 p-4 mb-4 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <span class="text-gray-500">Cliente</span>
              <span class="font-medium text-right">{{ selectedOrder.clienteNombre || getClientName(selectedOrder.clienteId) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Total pedido</span>
              <span class="font-bold tabular-nums">{{ '$' + selectedOrder.total }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Ya pagado (seña / cuotas)</span>
              <span class="font-semibold text-teal-700 tabular-nums">{{ '$' + selectedOrder.totalPagadoAnterior }}</span>
            </div>
            <div class="flex justify-between border-t border-gray-200 pt-2">
              <span class="text-gray-700 font-medium">Saldo a cobrar</span>
              <span class="font-bold text-orange-600 tabular-nums">{{ '$' + selectedOrder.saldoPedido }}</span>
            </div>
            <p *ngIf="selectedOrder.descripcion" class="text-xs text-gray-500 pt-1">
              {{ selectedOrder.descripcion }}
            </p>
          </div>
        </ng-container>

        <ng-container *ngIf="saleModalMode === 'mostrador'">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
            <app-searchable-select
              [(ngModel)]="saleClienteId"
              name="saleClienteId"
              [labeledOptions]="clientOptions"
              placeholder="Buscar cliente..."
              listHint=""
              emptyOptionsMessage="No hay clientes cargados.">
            </app-searchable-select>
          </div>

          <div class="space-y-3 mb-4">
            <div
              *ngFor="let line of draftLines; let i = index"
              class="grid grid-cols-12 gap-2 items-end">
              <div class="col-span-5">
                <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Producto</label>
                <select
                  [(ngModel)]="line.stockItemId"
                  (ngModelChange)="onProductSelected(line)"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                  <option value="">Seleccionar...</option>
                  <option *ngFor="let item of stockItems" [value]="item.id">{{ item.nombre }}</option>
                </select>
              </div>
              <div class="col-span-2">
                <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Cant.</label>
                <input
                  type="number"
                  [(ngModel)]="line.cantidad"
                  min="1"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
              <div class="col-span-3">
                <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Precio u.</label>
                <input
                  type="number"
                  [(ngModel)]="line.precioUnitario"
                  min="0"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
              <div class="col-span-2 flex gap-1">
                <button
                  type="button"
                  (click)="removeLine(i)"
                  [disabled]="draftLines.length === 1"
                  class="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40">
                  <i-lucide name="minus" class="w-4 h-4"></i-lucide>
                </button>
                <button
                  *ngIf="i === draftLines.length - 1"
                  type="button"
                  (click)="addLine()"
                  class="p-2 rounded-lg text-teal-600 hover:bg-teal-50">
                  <i-lucide name="plus" class="w-4 h-4"></i-lucide>
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 mb-4 flex justify-between text-sm">
            <span class="text-gray-600">Total venta</span>
            <span class="font-bold tabular-nums">{{ '$' + draftTotal }}</span>
          </div>
        </ng-container>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar ahora</label>
            <input
              type="number"
              [(ngModel)]="montoCobrado"
              min="0"
              [max]="maxMontoCobrado"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
            <p class="text-xs text-gray-400 mt-1">
              Dejá menos que el saldo si el cliente paga después.
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
            <select
              [(ngModel)]="medioPago"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        <div
          *ngIf="showCompromisoPlan"
          class="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
          <div>
            <h3 class="text-sm font-bold text-orange-900">Plan de cuotas del saldo</h3>
            <p class="text-xs text-orange-800 mt-1">
              Saldo que queda a favor: {{ '$' + saldoRestante }}. Quedará en la cuenta del cliente y en los próximos cobros.
            </p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad de cuotas</label>
              <input
                type="number"
                [(ngModel)]="compromisoCuotas"
                min="1"
                max="24"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Primer vencimiento</label>
              <input
                type="date"
                [(ngModel)]="compromisoFechaVencimiento"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm">
            </div>
          </div>
          <p *ngIf="compromisoCuotaPreview" class="text-xs text-orange-900">
            {{ compromisoCuotaPreview }}
          </p>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <textarea
            [(ngModel)]="saleNotas"
            rows="2"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </textarea>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <button
            type="button"
            (click)="closeSaleModal()"
            class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="submitSale()"
            [disabled]="savingSale"
            class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ savingSale ? 'Guardando...' : (saleModalMode === 'pedido' ? 'Registrar entrega' : 'Registrar venta') }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class SalesComponent implements OnInit {
  private salesService = inject(SalesService);
  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  sales: Sale[] = [];
  eligibleOrders: EligibleOrderForSale[] = [];
  clients: Client[] = [];
  stockItems: StockItem[] = [];
  loading = true;

  saleModalOpen = false;
  saleModalMode: SaleModalMode = 'mostrador';
  savingSale = false;

  saleClienteId = '';
  draftLines: SaleDraftLine[] = [this.emptyLine()];
  selectedOrderId = '';
  orderFilterClienteId = '';
  montoCobrado: number | null = null;
  medioPago = 'efectivo';
  saleNotas = '';
  compromisoCuotas = 1;
  compromisoFechaVencimiento = this.defaultVencimientoDate();
  compromisoNotas = '';

  get clientOptions() {
    return this.clients
      .filter((client) => client.id)
      .map((client) => ({ value: client.id!, label: client.nombre }));
  }

  get selectedOrder(): EligibleOrderForSale | undefined {
    return this.eligibleOrders.find((order) => order.id === this.selectedOrderId);
  }

  get orderSelectOptions() {
    return this.eligibleOrders.map((order) => ({
      value: order.id,
      label: this.formatOrderOptionLabel(order),
    }));
  }

  get saldoRestante(): number {
    const monto = Number(this.montoCobrado) || 0;
    if (this.saleModalMode === 'pedido' && this.selectedOrder) {
      return Math.max(0, this.selectedOrder.saldoPedido - monto);
    }
    if (this.saleModalMode === 'mostrador') {
      return Math.max(0, this.draftTotal - monto);
    }
    return 0;
  }

  get showCompromisoPlan(): boolean {
    return this.saldoRestante > 0;
  }

  get compromisoCuotaPreview(): string {
    const cuotas = Number(this.compromisoCuotas) || 0;
    if (cuotas < 1 || this.saldoRestante <= 0) return '';
    const montoCuota = Math.round((this.saldoRestante / cuotas) * 100) / 100;
    return `${cuotas} cuota(s) de aprox. $${montoCuota} · primer vencimiento ${this.formatDateInput(
      this.compromisoFechaVencimiento
    )}`;
  }

  get draftTotal(): number {
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const price = Number(line.precioUnitario) || 0;
      return acc + qty * price;
    }, 0);
  }

  get maxMontoCobrado(): number {
    if (this.saleModalMode === 'pedido' && this.selectedOrder) {
      return this.selectedOrder.saldoPedido;
    }
    return this.draftTotal;
  }

  get totalFacturado(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.total) || 0), 0);
  }

  get totalCobradoEnVentas(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.montoCobrado) || 0), 0);
  }

  get totalSaldoPendiente(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.saldoPendiente) || 0), 0);
  }

  ngOnInit() {
    this.loadSales();
    this.clientService.getClients().subscribe((clients) => (this.clients = clients));
    this.stockService.getStock().subscribe((items) => (this.stockItems = items));
    this.loadEligibleOrders();

    this.route.queryParamMap.subscribe((params) => {
      const pedidoId = params.get('pedidoId');
      if (pedidoId) {
        this.openSaleModal('pedido', pedidoId);
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { pedidoId: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  formatDateInput(value?: string): string {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR');
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  getClientName(clienteId?: string): string {
    if (!clienteId) return 'Sin cliente';
    return this.clients.find((client) => client.id === clienteId)?.nombre ?? 'Cliente';
  }

  openSaleModal(mode: SaleModalMode, preselectedOrderId?: string) {
    this.saleModalMode = mode;
    this.saleClienteId = '';
    this.draftLines = [this.emptyLine()];
    this.selectedOrderId = preselectedOrderId ?? '';
    this.orderFilterClienteId = '';
    this.medioPago = 'efectivo';
    this.saleNotas = '';
    this.montoCobrado = null;
    this.compromisoCuotas = 1;
    this.compromisoFechaVencimiento = this.defaultVencimientoDate();
    this.compromisoNotas = '';

    if (mode === 'mostrador' && this.stockItems.length === 0) {
      this.dialogService.alert({
        title: 'Sin productos',
        message: 'Cargá productos en Stock antes de registrar una venta de mostrador.',
      });
      return;
    }

    if (mode === 'pedido') {
      this.loadEligibleOrders(undefined, () => {
        if (preselectedOrderId) {
          const order = this.eligibleOrders.find((entry) => entry.id === preselectedOrderId);
          if (order?.clienteId) {
            this.orderFilterClienteId = order.clienteId;
          }
          if (!order) {
            this.dialogService.alert({
              title: 'Pedido no disponible',
              message:
                'Ese pedido no está listo para entrega, ya tiene venta registrada o no existe.',
            });
            return;
          }
        }
        this.onOrderSelected();
        this.saleModalOpen = true;
      });
      return;
    }

    this.onOrderSelected();
    this.saleModalOpen = true;
  }

  closeSaleModal() {
    this.saleModalOpen = false;
  }

  onOrderSelected() {
    if (this.saleModalMode === 'pedido' && this.selectedOrder) {
      this.montoCobrado = this.selectedOrder.saldoPedido;
      if (this.selectedOrder.clienteId && !this.orderFilterClienteId) {
        this.orderFilterClienteId = this.selectedOrder.clienteId;
      }
    } else if (this.saleModalMode === 'mostrador') {
      this.montoCobrado = this.draftTotal;
    }
  }

  onOrderClientFilterChange() {
    this.selectedOrderId = '';
    this.loadEligibleOrders(this.orderFilterClienteId || undefined);
  }

  formatOrderOptionLabel(order: EligibleOrderForSale): string {
    const cliente = order.clienteNombre || this.getClientName(order.clienteId);
    const descripcion = order.descripcion?.trim();
    const suffix = descripcion ? ` · ${descripcion.slice(0, 40)}` : '';
    return `#${order.numeroPedidoLabel} · ${cliente} · saldo $${order.saldoPedido}${suffix}`;
  }

  loadEligibleOrders(clienteId?: string, done?: () => void) {
    this.salesService.getEligibleOrders({ clienteId }).subscribe({
      next: (orders) => {
        this.eligibleOrders = orders;
        if (this.selectedOrderId && !orders.some((order) => order.id === this.selectedOrderId)) {
          this.selectedOrderId = '';
        }
        done?.();
      },
    });
  }

  addLine() {
    this.draftLines = [...this.draftLines, this.emptyLine()];
  }

  removeLine(index: number) {
    if (this.draftLines.length === 1) return;
    this.draftLines = this.draftLines.filter((_, i) => i !== index);
    if (this.saleModalMode === 'mostrador') {
      this.montoCobrado = this.draftTotal;
    }
  }

  onProductSelected(line: SaleDraftLine) {
    const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
    if (!item) return;
    if (line.precioUnitario == null || line.precioUnitario === 0) {
      line.precioUnitario = Number(item.precioSugerido) || Number(item.costo) || 0;
    }
    if (this.saleModalMode === 'mostrador') {
      this.montoCobrado = this.draftTotal;
    }
  }

  submitSale() {
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return;
    }

    let payload: CreateSalePayload;

    if (this.saleModalMode === 'pedido') {
      if (!this.selectedOrderId) {
        this.dialogService.alert({
          title: 'Pedido requerido',
          message: 'Seleccioná el pedido que estás entregando.',
        });
        return;
      }

      if (monto > (this.selectedOrder?.saldoPedido ?? 0)) {
        this.dialogService.alert({
          title: 'Monto excedido',
          message: 'El monto no puede superar el saldo pendiente del pedido.',
        });
        return;
      }

      payload = {
        origen: 'pedido',
        pedidoId: this.selectedOrderId,
        montoCobrado: monto,
        medioPago: this.medioPago,
        notas: this.saleNotas.trim(),
        ...this.buildCompromisoPayload(),
      };
    } else {
      if (!this.saleClienteId) {
        this.dialogService.alert({
          title: 'Cliente requerido',
          message: 'Seleccioná un cliente para la venta.',
        });
        return;
      }

      const items = this.draftLines
        .map((line) => {
          const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
          return {
            stockItemId: line.stockItemId,
            nombre: item?.nombre ?? '',
            cantidad: Number(line.cantidad) || 0,
            precioUnitario: Number(line.precioUnitario) || 0,
          };
        })
        .filter((line) => line.stockItemId && line.cantidad > 0);

      if (items.length === 0) {
        this.dialogService.alert({
          title: 'Productos requeridos',
          message: 'Agregá al menos un producto con cantidad.',
        });
        return;
      }

      if (monto > this.draftTotal) {
        this.dialogService.alert({
          title: 'Monto excedido',
          message: 'El monto cobrado no puede superar el total de la venta.',
        });
        return;
      }

      payload = {
        origen: 'mostrador',
        clienteId: this.saleClienteId,
        items,
        montoCobrado: monto,
        medioPago: this.medioPago,
        notas: this.saleNotas.trim(),
        ...this.buildCompromisoPayload(),
      };
    }

    this.savingSale = true;
    this.salesService.createSale(payload).subscribe({
      next: () => {
        this.savingSale = false;
        this.closeSaleModal();
        this.loadSales();
        this.loadEligibleOrders();
      },
      error: (err: HttpErrorResponse) => {
        this.savingSale = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar la venta.',
        });
      },
    });
  }

  private loadSales() {
    this.loading = true;
    this.salesService.getSales().subscribe({
      next: (sales) => {
        this.sales = sales;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las ventas.',
        });
      },
    });
  }

  private emptyLine(): SaleDraftLine {
    return { stockItemId: '', cantidad: 1, precioUnitario: 0 };
  }

  private defaultVencimientoDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  }

  private buildCompromisoPayload(): Pick<CreateSalePayload, 'compromisoPago'> {
    if (!this.showCompromisoPlan) return {};

    const cantidadCuotas = Math.round(Number(this.compromisoCuotas) || 0);
    if (cantidadCuotas < 1 || !this.compromisoFechaVencimiento) return {};

    return {
      compromisoPago: {
        cantidadCuotas,
        fechaPrimerVencimiento: this.compromisoFechaVencimiento,
        notas: this.compromisoNotas.trim() || undefined,
      },
    };
  }
}
