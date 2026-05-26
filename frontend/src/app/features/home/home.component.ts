import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderService } from '../../core/services/order.service';
import { StockService, itemIsLowStock } from '../../core/services/stock.service';
import { SalesService, Sale } from '../../core/services/sales.service';
import { AuthService } from '../../core/services/auth.service';
import { isOrderPendingDelivery } from '../../core/constants/order-status';
import { LucideAngularModule } from 'lucide-angular';
import { PAGE_SHELL_CLASS, MODULE_SUMMARY_KPIS_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  template: `
    <div [class]="pageShellClass">
      <div class="mb-6 sm:mb-10">
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">¡Hola, {{ auth.currentUserName }}!</h1>
        <p class="text-sm sm:text-base text-gray-500">Aquí tienes un resumen de tu negocio hoy.</p>
      </div>

      <div [class]="summaryKpisClass + ' grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-10'">
        <a
          routerLink="/orders"
          [queryParams]="{ filter: 'pendientes-entrega' }"
          class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 transition-colors hover:border-blue-200 hover:bg-blue-50/30">
          <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="clipboard-list" class="w-6 h-6"></i-lucide>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-gray-400 uppercase">Pedidos Pend.</p>
            <p class="text-xl font-bold text-gray-900">{{ pendingOrders }}</p>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate">Confirmados sin entregar</p>
          </div>
        </a>

        <a
          routerLink="/stock"
          [queryParams]="{ filter: 'stock-bajo' }"
          class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 transition-colors hover:border-orange-200 hover:bg-orange-50/30">
          <div class="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="package" class="w-6 h-6"></i-lucide>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-gray-400 uppercase">Stock Bajo</p>
            <p class="text-xl font-bold text-gray-900">{{ lowStockItems }}</p>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate">Ver productos a reponer</p>
          </div>
        </a>

        <div
          *ngIf="auth.canViewEconomics"
          class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 sm:col-span-2 lg:col-span-1">
          <div class="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="wallet" class="w-6 h-6"></i-lucide>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-gray-400 uppercase">Ventas Mes</p>
            <p class="text-xl font-bold text-gray-900">{{ '$' + formatMoney(monthlySalesIncome) }}</p>
            <p class="text-xs font-semibold text-teal-600 mt-0.5">
              Gan. estimada {{ '$' + formatMoney(monthlyProfit) }}
            </p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div
          *ngIf="hasQuickAccess"
          class="order-1 lg:order-2 bg-gray-900 p-5 sm:p-6 rounded-2xl shadow-xl text-white">
          <h2 class="text-lg font-bold mb-3 text-teal-400">Accesos Rápidos</h2>
          <div class="flex gap-2 sm:gap-3">
            <button
              *ngIf="auth.canEditRecords"
              routerLink="/orders/new"
              class="flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="clipboard-list" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Nuevo Pedido</p>
            </button>
            <button
              *ngIf="auth.canAccessSales"
              routerLink="/sales"
              class="flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="shopping-cart" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Ventas</p>
            </button>
            <button
              *ngIf="auth.canAccessCash"
              routerLink="/cash"
              class="flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="wallet" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Caja</p>
            </button>
          </div>
        </div>

        <div
          class="order-2 lg:order-1 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm"
          [class.lg:col-span-2]="!hasQuickAccess">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-lg font-bold">Actividad Reciente</h2>
            <button routerLink="/orders" class="text-teal-600 text-sm font-bold">Ver todo</button>
          </div>
          <div class="space-y-4">
            <div *ngFor="let order of recentOrders" class="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg transition-colors">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full bg-yellow-400"></div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{{ order.descripcion }}</p>
                  <p class="text-xs text-gray-400">Entrega: {{ order.fechaEntrega | date:'shortDate' }}</p>
                </div>
              </div>
              <span *ngIf="auth.canViewOrderSalePrice" class="text-sm font-bold">{{ '$' + formatMoney(order.total || 0) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class HomeComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly summaryKpisClass = MODULE_SUMMARY_KPIS_CLASS + ' grid';
  readonly auth = inject(AuthService);

  get hasQuickAccess(): boolean {
    return this.auth.canEditRecords || this.auth.canAccessSales || this.auth.canAccessCash;
  }

  private orderService = inject(OrderService);
  private stockService = inject(StockService);
  private salesService = inject(SalesService);

  pendingOrders = 0;
  lowStockItems = 0;
  monthlySalesIncome = 0;
  monthlyProfit = 0;
  recentOrders: any[] = [];

  ngOnInit() {
    this.orderService.getOrders().subscribe((orders) => {
      const visible = orders.filter((order) => this.auth.canViewOrder(order.estado));
      this.recentOrders = visible.slice(0, 5);
      this.pendingOrders = visible.filter((order) => isOrderPendingDelivery(order)).length;
    });

    this.stockService.getStock().subscribe((items) => {
      this.lowStockItems = items.filter((i) => itemIsLowStock(i)).length;
    });

    if (!this.auth.canViewEconomics) return;

    this.salesService.getSales().subscribe((sales) => {
      const now = new Date();
      const month = now.getMonth();
      const year = now.getFullYear();

      this.monthlySalesIncome = sales.reduce(
        (acc, sale) => acc + this.getSaleCollectedInMonth(sale, month, year),
        0
      );

      this.monthlyProfit = sales
        .filter((sale) => this.isInMonth(sale.fecha, month, year))
        .reduce((acc, sale) => acc + (Number(sale.gananciaEstimada) || 0), 0);
    });
  }

  formatMoney(value: number): string {
    return Math.round(value).toLocaleString('es-AR');
  }

  private isInMonth(iso: string | undefined, month: number, year: number): boolean {
    if (!iso) return false;
    const date = new Date(iso);
    return !Number.isNaN(date.getTime()) && date.getMonth() === month && date.getFullYear() === year;
  }

  private getSaleCollectedInMonth(sale: Sale, month: number, year: number): number {
    const cobros = sale.cobros ?? [];

    if (cobros.length > 0) {
      let collected = cobros
        .filter((cobro) => this.isInMonth(cobro.fecha, month, year))
        .reduce((acc, cobro) => acc + (Number(cobro.monto) || 0), 0);

      const adicionales = cobros.reduce((acc, cobro) => acc + (Number(cobro.monto) || 0), 0);
      const inicial = Math.max(0, (Number(sale.montoCobrado) || 0) - adicionales);
      if (inicial > 0 && this.isInMonth(sale.fecha, month, year)) {
        collected += inicial;
      }

      return collected;
    }

    if (this.isInMonth(sale.fecha, month, year)) {
      return Number(sale.montoCobrado) || 0;
    }

    return 0;
  }
}
