import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CreatePurchasePayload,
  Purchase,
  PurchaseService,
} from '../../core/services/purchase.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { LucideAngularModule } from 'lucide-angular';

interface PurchaseDraftLine {
  productoId: string;
  cantidad: number | null;
  costoUnitario: number | null;
}

@Component({
  selector: 'app-purchases',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink],
  template: `
    <div class="p-8">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Compras</h1>
          <p class="text-gray-500">Registrá entradas de mercadería e insumos al inventario.</p>
          <p class="text-xs text-gray-400 mt-1">
            Los movimientos de stock se ven en
            <a routerLink="/stock" class="text-teal-600 hover:underline">Stock → Movimientos</a>.
          </p>
        </div>
        <button
          type="button"
          (click)="openPurchaseModal()"
          class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          Nueva compra
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Compras registradas</p>
          <p class="text-2xl font-bold text-gray-900">{{ purchases.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total comprado</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalComprado }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Este mes</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + totalMes }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Compra</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Proveedor</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Items</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let purchase of purchases" class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(purchase.fecha) }}
              </td>
              <td class="px-6 py-4 text-sm font-semibold text-teal-700">
                #{{ purchase.compraLabel || purchase.id?.slice(-6) }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-700">
                {{ purchase.proveedor?.trim() || '—' }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{ purchase.items?.length || 0 }} producto(s)
              </td>
              <td class="px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (purchase.total || 0) }}
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">Cargando compras...</td>
            </tr>
            <tr *ngIf="!loading && purchases.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay compras. Usá <span class="font-semibold">Nueva compra</span> para sumar stock.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      *ngIf="purchaseModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="closePurchaseModal()">
      </button>
      <div class="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl p-6">
        <h2 class="text-lg font-bold text-gray-900 mb-1">Nueva compra</h2>
        <p class="text-sm text-gray-500 mb-4">Sumá stock al inventario y registrá el movimiento automáticamente.</p>

        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
              <input
                [(ngModel)]="purchaseProveedor"
                name="purchaseProveedor"
                placeholder="Opcional"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <input
                [(ngModel)]="purchaseNotas"
                name="purchaseNotas"
                placeholder="Opcional"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            </div>
          </div>

          <div class="rounded-xl border border-gray-100 overflow-hidden">
            <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-700">Productos</span>
              <button
                type="button"
                (click)="addLine()"
                class="text-sm font-medium text-teal-600 hover:text-teal-800">
                + Agregar línea
              </button>
            </div>
            <div class="divide-y divide-gray-50">
              <div *ngFor="let line of draftLines; let i = index" class="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div class="sm:col-span-5">
                  <label class="block text-xs font-medium text-gray-500 mb-1">Producto</label>
                  <select
                    [(ngModel)]="line.productoId"
                    [name]="'productoId_' + i"
                    (ngModelChange)="onProductSelected(line)"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Seleccionar...</option>
                    <option *ngFor="let item of stockItems" [value]="item.id">
                      {{ item.nombre }}
                    </option>
                  </select>
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-gray-500 mb-1">Cantidad</label>
                  <input
                    type="number"
                    [(ngModel)]="line.cantidad"
                    [name]="'cantidad_' + i"
                    min="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                </div>
                <div class="sm:col-span-3">
                  <label class="block text-xs font-medium text-gray-500 mb-1">Costo unitario</label>
                  <input
                    type="number"
                    [(ngModel)]="line.costoUnitario"
                    [name]="'costo_' + i"
                    min="0"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                </div>
                <div class="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    (click)="removeLine(i)"
                    [disabled]="draftLines.length === 1"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-between items-center rounded-xl bg-gray-50 px-4 py-3">
            <span class="text-sm text-gray-500">Total estimado</span>
            <span class="text-lg font-bold text-gray-900">{{ '$' + draftTotal }}</span>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            type="button"
            (click)="closePurchaseModal()"
            class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="submitPurchase()"
            [disabled]="savingPurchase"
            class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ savingPurchase ? 'Guardando...' : 'Registrar compra' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class PurchasesComponent implements OnInit {
  private purchaseService = inject(PurchaseService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);

  purchases: Purchase[] = [];
  stockItems: StockItem[] = [];
  loading = true;

  purchaseModalOpen = false;
  savingPurchase = false;
  purchaseProveedor = '';
  purchaseNotas = '';
  draftLines: PurchaseDraftLine[] = [this.emptyLine()];

  ngOnInit() {
    this.loadPurchases();
    this.stockService.getStock().subscribe({
      next: (items) => (this.stockItems = items),
    });
  }

  get totalComprado(): number {
    return this.purchases.reduce((acc, purchase) => acc + (Number(purchase.total) || 0), 0);
  }

  get totalMes(): number {
    const now = new Date();
    return this.purchases
      .filter((purchase) => {
        const date = new Date(purchase.fecha);
        return (
          !Number.isNaN(date.getTime()) &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce((acc, purchase) => acc + (Number(purchase.total) || 0), 0);
  }

  get draftTotal(): number {
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const cost = Number(line.costoUnitario) || 0;
      return acc + qty * cost;
    }, 0);
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  openPurchaseModal() {
    if (this.stockItems.length === 0) {
      this.dialogService.alert({
        title: 'Sin productos',
        message: 'Cargá productos en Stock antes de registrar una compra.',
      });
      return;
    }

    this.purchaseProveedor = '';
    this.purchaseNotas = '';
    this.draftLines = [this.emptyLine()];
    this.purchaseModalOpen = true;
  }

  closePurchaseModal() {
    this.purchaseModalOpen = false;
  }

  addLine() {
    this.draftLines = [...this.draftLines, this.emptyLine()];
  }

  removeLine(index: number) {
    if (this.draftLines.length === 1) return;
    this.draftLines = this.draftLines.filter((_, i) => i !== index);
  }

  onProductSelected(line: PurchaseDraftLine) {
    const item = this.stockItems.find((entry) => entry.id === line.productoId);
    if (!item) return;
    if (line.costoUnitario == null || line.costoUnitario === 0) {
      line.costoUnitario = Number(item.costo) || 0;
    }
  }

  submitPurchase() {
    const items = this.draftLines
      .map((line) => {
        const item = this.stockItems.find((entry) => entry.id === line.productoId);
        return {
          productoId: line.productoId,
          productoNombre: item?.nombre ?? '',
          cantidad: Number(line.cantidad) || 0,
          costoUnitario: Number(line.costoUnitario) || 0,
        };
      })
      .filter((line) => line.productoId && line.cantidad > 0);

    if (items.length === 0) {
      this.dialogService.alert({
        title: 'Datos incompletos',
        message: 'Seleccioná al menos un producto con cantidad.',
      });
      return;
    }

    const payload: CreatePurchasePayload = {
      proveedor: this.purchaseProveedor.trim(),
      notas: this.purchaseNotas.trim(),
      items,
    };

    this.savingPurchase = true;
    this.purchaseService.createPurchase(payload).subscribe({
      next: () => {
        this.savingPurchase = false;
        this.closePurchaseModal();
        this.loadPurchases();
      },
      error: (err) => {
        this.savingPurchase = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo registrar la compra.',
        });
      },
    });
  }

  private loadPurchases() {
    this.loading = true;
    this.purchaseService.getPurchases().subscribe({
      next: (purchases) => {
        this.purchases = purchases;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las compras.',
        });
      },
    });
  }

  private emptyLine(): PurchaseDraftLine {
    return { productoId: '', cantidad: 1, costoUnitario: 0 };
  }
}
