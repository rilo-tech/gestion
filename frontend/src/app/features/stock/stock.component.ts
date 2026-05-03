import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StockService, StockItem } from '../../core/services/stock.service';
import { LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule],
  template: `
    <div class="p-8">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Stock & Inventario</h1>
          <p class="text-gray-500">Controla tus productos base e insumos.</p>
        </div>
        <div class="flex gap-4">
          <button class="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50">
            <i-lucide name="package" class="w-4 h-4"></i-lucide>
            Registrar Compra
          </button>
          <button class="bg-primary text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-opacity-90">
            <i-lucide name="bar-chart-3" class="w-4 h-4"></i-lucide>
            Nuevo Producto
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total Items</p>
          <p class="text-2xl font-bold">{{items.length}}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Con Stock Bajo</p>
          <p class="text-2xl font-bold text-orange-500">{{lowStockCount}}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Valor Estimado</p>
          <p class="text-2xl font-bold text-teal-600">$0</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Movimientos Mes</p>
          <p class="text-2xl font-bold">0</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stock</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Costo Ref.</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let item of items" class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900">{{item.nombre}}</div>
              </td>
              <td class="px-6 py-4">
                <span [class]="item.tipo === 'producto' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'"
                      class="px-2 py-0.5 text-xs rounded-full uppercase font-bold">
                  {{item.tipo}}
                </span>
              </td>
              <td class="px-6 py-4">
                <div [class]="(item.stockActual || 0) <= (item.stockMinimo || 0) ? 'text-orange-600 font-bold' : 'text-gray-900'">
                  {{item.stockActual}} u.
                </div>
                <div class="text-xs text-gray-400">Min: {{item.stockMinimo || 0}}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{ '$' + (item.costo || 0) }}
              </td>
              <td class="px-6 py-4 text-sm font-medium">
                <button class="text-teal-600 hover:text-teal-900 mr-4">Ajustar</button>
                <button class="text-teal-600 hover:text-teal-900">Historial</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: []
})
export class StockComponent implements OnInit {
  private stockService = inject(StockService);
  
  items: StockItem[] = [];

  get lowStockCount() {
    return this.items.filter(i => (i.stockActual || 0) <= (i.stockMinimo || 0)).length;
  }

  ngOnInit() {
    this.loadStock();
  }

  loadStock() {
    this.stockService.getStock().subscribe(items => {
      this.items = items;
    });
  }
}
