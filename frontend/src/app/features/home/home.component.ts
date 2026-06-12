import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderService, Order } from '../../core/services/order.service';
import { StockService } from '../../core/services/stock.service';
import { SalesService } from '../../core/services/sales.service';
import { AuthService } from '../../core/services/auth.service';
import { isOrderPendingDelivery } from '../../core/constants/order-status';
import { getCalendarMonthRange, monthYearQueryParams, formatMonthYearLabel } from '../../core/utils/calendar-range';
import { LucideAngularModule } from 'lucide-angular';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  template: `
    <div [class]="pageShellClass">
      <div class="mb-6 sm:mb-10">
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">¡Hola, {{ auth.currentUserName }}!</h1>
        <p class="text-sm sm:text-base text-gray-500 desc-lg-only">Aquí tienes un resumen de tu negocio hoy.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-10">
        <a
          *ngIf="auth.canViewEconomics && auth.canAccessSales"
          routerLink="/sales"
          class="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 sm:gap-4 sm:col-span-2 lg:col-span-1 transition-colors hover:border-teal-200 hover:bg-teal-50/30">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="wallet" class="w-5 h-5 sm:w-6 sm:h-6"></i-lucide>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] sm:text-xs font-bold text-gray-400 uppercase truncate">Ventas · {{ currentMonthLabel }}</p>

            <div class="hidden sm:block">
              <p class="text-xl font-bold text-gray-900 tabular-nums">{{ formatMoney(monthlySalesIncome, true) }}</p>
              <p class="text-xs font-semibold text-teal-600 mt-0.5 tabular-nums">
                Gan. cobrada {{ formatMoney(monthlyProfit, true) }}
              </p>
              <p
                *ngIf="monthlyOfferBonus > 0"
                class="text-xs font-semibold text-amber-600 mt-0.5 tabular-nums">
                Bonif. ofertas {{ formatMoney(monthlyOfferBonus, true) }}
              </p>
              <p
                *ngIf="monthlyDonationsCount > 0"
                class="text-xs font-semibold text-amber-700 mt-0.5 tabular-nums">
                Donaciones {{ monthlyDonationsCount }}
                <span *ngIf="monthlyDonationsCost > 0"> · −{{ formatMoney(monthlyDonationsCost, true) }} costo</span>
              </p>
            </div>

            <button
              type="button"
              class="sm:hidden w-full text-left rounded-md -mx-0.5 px-0.5 py-0.5 select-none"
              (click)="toggleMobileSalesKpiReveal($event)"
              [attr.aria-label]="mobileSalesKpiRevealed ? 'Ocultar ventas del mes' : 'Mostrar ventas del mes'"
              [attr.aria-pressed]="mobileSalesKpiRevealed">
              <div class="flex items-end gap-4 mt-0.5">
                <div class="min-w-0">
                  <p class="text-[9px] font-bold text-gray-400 uppercase leading-none">Fact.</p>
                  <p class="text-base font-bold text-gray-900 tabular-nums leading-tight">
                    {{ mobileSalesKpiRevealed ? formatMoney(monthlySalesIncome, true) : maskedMoneyLabel }}
                  </p>
                </div>
                <div class="min-w-0">
                  <p class="text-[9px] font-bold text-teal-600 uppercase leading-none">Gan.</p>
                  <p class="text-base font-bold text-teal-600 tabular-nums leading-tight">
                    {{ mobileSalesKpiRevealed ? formatMoney(monthlyProfit, true) : maskedMoneyLabel }}
                  </p>
                </div>
              </div>
              <p
                *ngIf="monthlyOfferBonus > 0 && mobileSalesKpiRevealed"
                class="text-[10px] font-semibold text-amber-600 tabular-nums mt-0.5">
                Ofertas {{ formatMoney(monthlyOfferBonus, true) }}
              </p>
              <p
                *ngIf="monthlyDonationsCount > 0 && mobileSalesKpiRevealed"
                class="text-[10px] font-semibold text-amber-700 tabular-nums mt-0.5">
                Donaciones {{ monthlyDonationsCount }}
                <span *ngIf="monthlyDonationsCost > 0"> · −{{ formatMoney(monthlyDonationsCost, true) }}</span>
              </p>
            </button>
          </div>
        </a>

        <div
          *ngIf="auth.canViewEconomics && !auth.canAccessSales"
          class="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 sm:gap-4 sm:col-span-2 lg:col-span-1">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="wallet" class="w-5 h-5 sm:w-6 sm:h-6"></i-lucide>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] sm:text-xs font-bold text-gray-400 uppercase truncate">Ventas · {{ currentMonthLabel }}</p>

            <div class="hidden sm:block">
              <p class="text-xl font-bold text-gray-900 tabular-nums">{{ formatMoney(monthlySalesIncome, true) }}</p>
              <p class="text-xs font-semibold text-teal-600 mt-0.5 tabular-nums">
                Gan. cobrada {{ formatMoney(monthlyProfit, true) }}
              </p>
              <p
                *ngIf="monthlyOfferBonus > 0"
                class="text-xs font-semibold text-amber-600 mt-0.5 tabular-nums">
                Bonif. ofertas {{ formatMoney(monthlyOfferBonus, true) }}
              </p>
              <p
                *ngIf="monthlyDonationsCount > 0"
                class="text-xs font-semibold text-amber-700 mt-0.5 tabular-nums">
                Donaciones {{ monthlyDonationsCount }}
                <span *ngIf="monthlyDonationsCost > 0"> · −{{ formatMoney(monthlyDonationsCost, true) }} costo</span>
              </p>
            </div>

            <button
              type="button"
              class="sm:hidden w-full text-left rounded-md -mx-0.5 px-0.5 py-0.5 select-none"
              (click)="toggleMobileSalesKpiReveal($event)"
              [attr.aria-label]="mobileSalesKpiRevealed ? 'Ocultar ventas del mes' : 'Mostrar ventas del mes'"
              [attr.aria-pressed]="mobileSalesKpiRevealed">
              <div class="flex items-end gap-4 mt-0.5">
                <div class="min-w-0">
                  <p class="text-[9px] font-bold text-gray-400 uppercase leading-none">Fact.</p>
                  <p class="text-base font-bold text-gray-900 tabular-nums leading-tight">
                    {{ mobileSalesKpiRevealed ? formatMoney(monthlySalesIncome, true) : maskedMoneyLabel }}
                  </p>
                </div>
                <div class="min-w-0">
                  <p class="text-[9px] font-bold text-teal-600 uppercase leading-none">Gan.</p>
                  <p class="text-base font-bold text-teal-600 tabular-nums leading-tight">
                    {{ mobileSalesKpiRevealed ? formatMoney(monthlyProfit, true) : maskedMoneyLabel }}
                  </p>
                </div>
              </div>
              <p
                *ngIf="monthlyOfferBonus > 0 && mobileSalesKpiRevealed"
                class="text-[10px] font-semibold text-amber-600 tabular-nums mt-0.5">
                Ofertas {{ formatMoney(monthlyOfferBonus, true) }}
              </p>
              <p
                *ngIf="monthlyDonationsCount > 0 && mobileSalesKpiRevealed"
                class="text-[10px] font-semibold text-amber-700 tabular-nums mt-0.5">
                Donaciones {{ monthlyDonationsCount }}
                <span *ngIf="monthlyDonationsCost > 0"> · −{{ formatMoney(monthlyDonationsCost, true) }}</span>
              </p>
            </button>
          </div>
        </div>

        <a
          routerLink="/orders"
          [queryParams]="{ filter: 'pendientes-entrega' }"
          [ngClass]="adminKpiLinkClass"
          class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 items-center gap-4 transition-colors hover:border-blue-200 hover:bg-blue-50/30">
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
          [ngClass]="adminKpiLinkClass"
          class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 items-center gap-4 transition-colors hover:border-orange-200 hover:bg-orange-50/30">
          <div class="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center shrink-0">
            <i-lucide name="package" class="w-6 h-6"></i-lucide>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-gray-400 uppercase">Stock Bajo</p>
            <p class="text-xl font-bold text-gray-900">{{ lowStockItems }}</p>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate">Ver productos a reponer</p>
          </div>
        </a>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div
          *ngIf="hasQuickAccess"
          class="home-quick-access order-1 lg:order-2 bg-gray-900 p-5 sm:p-6 rounded-2xl shadow-xl text-white">
          <h2 class="home-quick-access-title text-lg font-bold mb-3 text-teal-400">Accesos Rápidos</h2>
          <div class="flex gap-2 sm:gap-3">
            <button
              *ngIf="auth.canEditRecords"
              routerLink="/orders/new"
              class="home-quick-access-btn flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="clipboard-list" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Nuevo Pedido</p>
            </button>
            <button
              *ngIf="auth.canAccessSales"
              routerLink="/sales"
              class="home-quick-access-btn flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="shopping-cart" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Ventas</p>
            </button>
            <button
              *ngIf="auth.canAccessCash"
              routerLink="/cash"
              class="home-quick-access-btn flex-1 min-w-0 p-2.5 sm:p-3 bg-gray-800 rounded-lg hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="wallet" class="w-4 h-4 sm:w-5 sm:h-5 mb-1"></i-lucide>
              <p class="text-xs sm:text-sm font-bold leading-tight">Caja</p>
            </button>
          </div>
        </div>

        <div
          class="order-2 lg:order-1 bg-white p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-sm"
          [class.lg:col-span-2]="!hasQuickAccess">
          <div class="flex justify-between items-center gap-3 mb-4">
            <div class="min-w-0">
              <h2 class="text-lg font-bold">Actividad Reciente</h2>
              <p class="text-xs text-gray-400 mt-0.5">Últimos pedidos del negocio</p>
            </div>
            <a
              *ngIf="hasMoreRecentOrders"
              routerLink="/orders"
              class="shrink-0 text-teal-600 text-sm font-semibold hover:text-teal-800 hover:underline">
              Ver todo
            </a>
          </div>
          <div class="space-y-2">
            <a
              *ngFor="let order of recentOrders"
              [routerLink]="order.id ? ['/orders', order.id, 'edit'] : null"
              (click)="openRecentOrder(order, $event)"
              class="flex justify-between items-center gap-3 p-2.5 hover:bg-gray-50 rounded-lg transition-colors"
              [class.pointer-events-none]="!order.id"
              [class.cursor-default]="!order.id"
              [class.cursor-pointer]="!!order.id">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-2 h-2 rounded-full bg-yellow-400 shrink-0"></div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 truncate">{{ order.descripcion || 'Pedido sin descripción' }}</p>
                  <p class="text-xs text-gray-400 truncate">
                    {{
                      order.numeroPedidoLabel
                        ? ('#' + order.numeroPedidoLabel + ' · ')
                        : ''
                    }}Entrega:
                    {{
                      order.fechaEntrega
                        ? (order.fechaEntrega | date:'d/M/yy')
                        : '—'
                    }}
                  </p>
                </div>
              </div>
              <span *ngIf="auth.canViewOrderSalePrice" class="text-sm font-bold shrink-0 tabular-nums">{{
                formatMoney(order.total || 0, true)
              }}</span>
            </a>
            <p *ngIf="recentOrders.length === 0" class="text-sm text-gray-400 py-6 text-center">
              Todavía no hay pedidos recientes.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class HomeComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly maskedMoneyLabel = '$ ••••••';
  readonly auth = inject(AuthService);

  mobileSalesKpiRevealed = false;

  /** En celular ocultamos pedidos/stock si hay tarjeta de ganancia, para priorizarla. */
  get adminKpiLinkClass(): Record<string, boolean> {
    return {
      flex: !this.auth.canViewEconomics,
      hidden: this.auth.canViewEconomics,
      'sm:flex': this.auth.canViewEconomics,
    };
  }

  get hasQuickAccess(): boolean {
    return this.auth.canEditRecords || this.auth.canAccessSales || this.auth.canAccessCash;
  }

  private orderService = inject(OrderService);
  private stockService = inject(StockService);
  private salesService = inject(SalesService);
  private router = inject(Router);

  readonly recentActivityLimit = 4;

  pendingOrders = 0;
  lowStockItems = 0;
  monthlySalesIncome = 0;
  monthlyProfit = 0;
  monthlyOfferBonus = 0;
  monthlyDonationsCount = 0;
  monthlyDonationsCost = 0;
  currentMonthLabel = '';
  recentOrders: Order[] = [];
  totalRecentOrders = 0;

  get hasMoreRecentOrders(): boolean {
    return this.totalRecentOrders > this.recentActivityLimit;
  }

  ngOnInit() {
    this.orderService.getOrdersPage(120).subscribe((page) => {
      const visible = page.items
        .filter((order) => this.auth.canViewOrder(order.estado))
        .sort((a, b) => {
          const dateA = Date.parse(String(a.createdAt ?? a.fechaEntrega ?? '')) || 0;
          const dateB = Date.parse(String(b.createdAt ?? b.fechaEntrega ?? '')) || 0;
          return dateB - dateA;
        });
      this.totalRecentOrders = visible.length;
      this.recentOrders = visible.slice(0, this.recentActivityLimit);
      this.pendingOrders = visible.filter((order) => isOrderPendingDelivery(order)).length;
    });

    this.stockService.getStockMetrics().subscribe((metrics) => {
      this.lowStockItems = metrics.lowStockCount;
    });

    if (!this.auth.canViewEconomics) return;

    const monthRange = getCalendarMonthRange();
    this.currentMonthLabel = formatMonthYearLabel(monthRange.label);

    const { mes, anio } = monthYearQueryParams(monthRange);
    this.salesService.getMonthlySummary(mes, anio).subscribe((summary) => {
      this.monthlySalesIncome = summary.totalFacturado;
      this.monthlyProfit = summary.totalGanancia;
      this.monthlyOfferBonus = summary.bonificacionOfertas ?? 0;
      this.monthlyDonationsCount = summary.donacionesCount ?? 0;
      this.monthlyDonationsCost = summary.donacionesCost ?? 0;
    });
  }

  formatMoney(value: number, withSymbol = false): string {
    const formatted = Number(value ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return withSymbol ? `$${formatted}` : formatted;
  }

  toggleMobileSalesKpiReveal(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.mobileSalesKpiRevealed = !this.mobileSalesKpiRevealed;
  }

  openRecentOrder(order: Order, event: MouseEvent) {
    if (!order.id) return;
    event.preventDefault();
    // Navegamos al instante con el pedido que ya mostramos en el dashboard; el
    // formulario revalida con getOrder en segundo plano (sin espera previa).
    this.router.navigate(['/orders', order.id, 'edit'], {
      state: { orderPreview: order },
    });
  }
}
