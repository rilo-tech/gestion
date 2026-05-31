import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StockService } from '../../core/services/stock.service';
import type { StockShortageGroup } from '../../core/services/order.service';
import { getOrderStockStatusLabel } from '../../core/constants/order-stock-status';
import { getOrderStatusLabel } from '../../core/constants/order-status';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';

@Component({
  selector: 'app-stock-shortages',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div [class]="pageShellClass">
      <a
        routerLink="/stock"
        class="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-900 hover:underline mb-4">
        ← Volver a Stock
      </a>

      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Faltantes de stock</h1>
        <p class="text-sm text-gray-500 mt-1 desc-lg-only">
          Mercadería que falta comprar o ingresar para completar pedidos en curso.
        </p>
      </div>

      <div *ngIf="loading" class="py-12 text-center text-sm text-gray-500">Cargando faltantes...</div>

      <div *ngIf="!loading && groups.length === 0" class="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
        No hay productos faltantes para comprar en pedidos en curso.
      </div>

      <div *ngIf="!loading && groups.length > 0" class="space-y-4">
        <article
          *ngFor="let group of groups"
          class="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            class="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
            (click)="toggle(group.stockItemId)">
            <div class="min-w-0">
              <p class="font-semibold text-gray-900 truncate">{{ group.productoNombre }}</p>
              <p class="text-xs text-gray-500 mt-0.5">
                Pedidos:
                <span *ngFor="let pedido of group.pedidos; let last = last">
                  #{{ pedido.orderLabel }}<span *ngIf="!last">, </span>
                </span>
              </p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs uppercase text-gray-400">Faltante total</p>
              <p class="text-lg font-bold text-orange-600 tabular-nums">{{ group.faltanteTotal }}</p>
            </div>
          </button>

          <div *ngIf="expanded.has(group.stockItemId)" class="border-t border-gray-100 overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-4 py-2 text-left">Pedido</th>
                  <th class="px-4 py-2 text-center">Pedido</th>
                  <th class="px-4 py-2 text-center">Reservado</th>
                  <th class="px-4 py-2 text-center">Faltante</th>
                  <th class="px-4 py-2 text-left">Tipo</th>
                  <th class="px-4 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr *ngFor="let row of group.detalle">
                  <td class="px-4 py-2">
                    <a
                      [routerLink]="['/orders', row.orderId, 'edit']"
                      class="font-medium text-teal-700 hover:text-teal-900 hover:underline">
                      #{{ row.orderLabel }}
                    </a>
                  </td>
                  <td class="px-4 py-2 text-center tabular-nums">{{ row.cantidadPedida }}</td>
                  <td class="px-4 py-2 text-center tabular-nums">{{ row.cantidadReservada }}</td>
                  <td class="px-4 py-2 text-center tabular-nums font-semibold text-orange-600">
                    {{ row.cantidadFaltante }}
                  </td>
                  <td class="px-4 py-2 text-gray-600">
                    {{ row.esEstimado ? 'Estimado' : 'Confirmado' }}
                  </td>
                  <td class="px-4 py-2 text-gray-600">{{ getOrderStatusLabel(row.orderEstado) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </div>
  `,
})
export class StockShortagesComponent implements OnInit {
  private stockService = inject(StockService);

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly getOrderStatusLabel = getOrderStatusLabel;
  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;

  loading = true;
  groups: StockShortageGroup[] = [];
  expanded = new Set<string>();

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.stockService.getShortages().subscribe({
      next: (data) => {
        this.groups = data.grouped;
        this.loading = false;
      },
      error: () => {
        this.groups = [];
        this.loading = false;
      },
    });
  }

  toggle(stockItemId: string) {
    if (this.expanded.has(stockItemId)) {
      this.expanded.delete(stockItemId);
    } else {
      this.expanded.add(stockItemId);
    }
  }
}
