import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderService, Order } from '../../core/services/order.service';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  template: `
    <div class="p-8">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p class="text-gray-500">Gestiona tus pedidos personalizados y su producción.</p>
        </div>
        <button 
          routerLink="/orders/new"
          class="bg-primary text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-opacity-90">
          <i-lucide name="clipboard-list" class="w-4 h-4"></i-lucide>
          Nuevo Pedido
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-blue-50 p-4 rounded-xl border border-blue-100">
          <p class="text-xs font-bold text-blue-400 uppercase mb-1">Pendientes</p>
          <p class="text-xl font-bold text-blue-700">0</p>
        </div>
        <div class="bg-purple-50 p-4 rounded-xl border border-purple-100">
          <p class="text-xs font-bold text-purple-400 uppercase mb-1">En Producción</p>
          <p class="text-xl font-bold text-purple-700">0</p>
        </div>
        <div class="bg-green-50 p-4 rounded-xl border border-green-100">
          <p class="text-xs font-bold text-green-400 uppercase mb-1">Listos</p>
          <p class="text-xl font-bold text-green-700">0</p>
        </div>
        <div class="bg-teal-50 p-4 rounded-xl border border-teal-100">
          <p class="text-xs font-bold text-teal-400 uppercase mb-1">Entregados</p>
          <p class="text-xl font-bold text-teal-700">0</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Pedido / Cliente</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Entrega</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Estado</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Monto / Saldo</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let order of orders" class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900 line-clamp-1">{{order.descripcion || 'Sin descripción'}}</div>
                <div class="text-xs text-teal-600 font-bold">#{{order.id?.slice(-6)}}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{order.fechaEntrega | date:'dd/MM/yyyy'}}
              </td>
              <td class="px-6 py-4">
                <span class="px-2 py-1 bg-yellow-50 text-yellow-700 text-xs rounded-full font-bold uppercase">
                  {{order.estado}}
                </span>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm font-bold text-gray-900">{{ '$' + order.total }}</div>
                <div class="text-xs text-orange-500 font-semibold" *ngIf="order.saldo > 0">Saldo: {{ '$' + order.saldo }}</div>
              </td>
              <td class="px-6 py-4 text-sm font-medium">
                <button class="text-teal-600 hover:text-teal-900 mr-3">Detalle</button>
                <button class="text-teal-600 hover:text-teal-900">Editar</button>
              </td>
            </tr>
            <tr *ngIf="orders.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">
                No hay pedidos registrados.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: []
})
export class OrderListComponent implements OnInit {
  private orderService = inject(OrderService);
  
  orders: Order[] = [];

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.orderService.getOrders().subscribe(orders => {
      this.orders = orders;
    });
  }
}
