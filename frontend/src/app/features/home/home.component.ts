import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderService } from '../../core/services/order.service';
import { StockService } from '../../core/services/stock.service';
import { AuthService } from '../../core/services/auth.service';
import { normalizeOrderStatus } from '../../core/constants/order-status';
import { LucideAngularModule } from 'lucide-angular';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
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
      
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-10">
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
            <i-lucide name="clipboard-list" class="w-6 h-6"></i-lucide>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-400 uppercase">Pedidos Pend.</p>
            <p class="text-xl font-bold text-gray-900">{{pendingOrders}}</p>
          </div>
        </div>
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div class="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
            <i-lucide name="package" class="w-6 h-6"></i-lucide>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-400 uppercase">Stock Bajo</p>
            <p class="text-xl font-bold text-gray-900">{{lowStockItems}}</p>
          </div>
        </div>
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div class="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center">
            <i-lucide name="wallet" class="w-6 h-6"></i-lucide>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-400 uppercase">Ventas Mes</p>
            <p class="text-xl font-bold text-gray-900">{{ '$' + totalSales }}</p>
          </div>
        </div>
        <div *ngIf="auth.canViewEconomics" class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div class="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
            <i-lucide name="bar-chart-3" class="w-6 h-6"></i-lucide>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-400 uppercase">Ganancia Est.</p>
            <p class="text-xl font-bold text-teal-600">{{ '$' + totalGain }}</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-lg font-bold">Actividad Reciente</h2>
            <button routerLink="/orders" class="text-teal-600 text-sm font-bold">Ver todo</button>
          </div>
          <div class="space-y-4">
            <div *ngFor="let order of recentOrders" class="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg transition-colors">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full bg-yellow-400"></div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{{order.descripcion}}</p>
                  <p class="text-xs text-gray-400">Entrega: {{order.fechaEntrega | date:'shortDate'}}</p>
                </div>
              </div>
              <span class="text-sm font-bold">{{ '$' + order.total }}</span>
            </div>
          </div>
        </div>

        <div class="bg-gray-900 p-8 rounded-2xl shadow-xl text-white">
          <h2 class="text-xl font-bold mb-4 text-teal-400">Accesos Rápidos</h2>
          <div class="grid grid-cols-2 gap-4">
            <button routerLink="/orders/new" class="p-4 bg-gray-800 rounded-xl hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="clipboard-list" class="w-6 h-6 mb-2"></i-lucide>
              <p class="font-bold">Nuevo Pedido</p>
            </button>
            <button routerLink="/clients" class="p-4 bg-gray-800 rounded-xl hover:bg-teal-500 hover:text-gray-900 transition-all text-left">
              <i-lucide name="users" class="w-6 h-6 mb-2"></i-lucide>
              <p class="font-bold">Nuevo Cliente</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: []
})
export class HomeComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly auth = inject(AuthService);

  private orderService = inject(OrderService);
  private stockService = inject(StockService);

  pendingOrders = 0;
  lowStockItems = 0;
  totalSales = 0;
  totalGain = 0;
  recentOrders: any[] = [];

  ngOnInit() {
    this.orderService.getOrders().subscribe(orders => {
      this.recentOrders = orders.slice(0, 5);
      this.pendingOrders = orders.filter((order) => normalizeOrderStatus(order.estado) === 'pendiente').length;
      this.totalSales = orders.reduce((acc, o) => acc + (o.total || 0), 0);
      this.totalGain = orders.reduce((acc, o) => acc + (o.gananciaEstimada || 0), 0);
    });

    this.stockService.getStock().subscribe(items => {
      this.lowStockItems = items.filter(i => (i.stockActual || 0) <= (i.stockMinimo || 0)).length;
    });
  }
}
