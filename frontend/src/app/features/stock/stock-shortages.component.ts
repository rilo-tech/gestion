import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StockService } from '../../core/services/stock.service';
import type { StockShortageGroup } from '../../core/services/order.service';
import { getOrderStockStatusLabel } from '../../core/constants/order-stock-status';
import { getOrderStatusLabel } from '../../core/constants/order-status';
import { AuthService } from '../../core/services/auth.service';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { FormBackButtonComponent } from '../../shared/components/form-shell';
import { NavigationBackService } from '../../core/services/navigation-back.service';

type ShortagesView = 'pedidos' | 'lista';

@Component({
  selector: 'app-stock-shortages',
  standalone: true,
  imports: [CommonModule, RouterLink, FormBackButtonComponent],
  template: `
    <div [class]="pageShellClass">
      <app-form-back-button
        class="mb-4"
        label="Volver al stock"
        shortLabel="Volver"
        ariaLabel="Volver al stock"
        (clicked)="goBack()">
      </app-form-back-button>

      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Faltantes de stock</h1>
          <p class="text-sm text-gray-500 mt-1 desc-lg-only">
            Mercadería que falta comprar o ingresar para completar pedidos en curso.
          </p>
        </div>

        <div *ngIf="!loading && groups.length > 0" class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            (click)="copyList()"
            class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            {{ copied ? '¡Copiado!' : 'Copiar lista' }}
          </button>
          <button
            type="button"
            (click)="printList()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700">
            Imprimir lista
          </button>
        </div>
      </div>

      <div
        *ngIf="!loading && groups.length > 0"
        class="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
        <button
          type="button"
          (click)="view = 'lista'"
          [class]="tabClass('lista')">
          Lista para comprar
        </button>
        <button
          type="button"
          (click)="view = 'pedidos'"
          [class]="tabClass('pedidos')">
          Por pedido
        </button>
      </div>

      <div *ngIf="loading" class="py-12 text-center text-sm text-gray-500">Cargando faltantes...</div>

      <div *ngIf="!loading && groups.length === 0" class="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
        No hay productos faltantes para comprar en pedidos en curso.
      </div>

      <!-- Lista consolidada: todo lo que hay que comprar, sin detalle de pedidos. -->
      <div
        *ngIf="!loading && groups.length > 0 && view === 'lista'"
        class="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div class="divide-y divide-gray-100">
          <div
            *ngFor="let group of groups"
            class="px-4 py-3 flex items-center justify-between gap-3">
            <p class="font-medium text-gray-900 truncate min-w-0">{{ group.productoNombre }}</p>
            <p class="text-lg font-bold text-orange-600 tabular-nums shrink-0">{{ group.faltanteTotal }}</p>
          </div>
        </div>
        <div class="border-t border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
          <span class="text-xs font-semibold uppercase text-gray-500">Total de unidades</span>
          <span class="text-lg font-bold text-gray-900 tabular-nums">{{ totalUnidades }}</span>
        </div>
      </div>

      <!-- Vista por pedido: cada producto con su desglose de pedidos. -->
      <div *ngIf="!loading && groups.length > 0 && view === 'pedidos'" class="space-y-4">
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
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-right">
                <p class="text-xs uppercase text-gray-400">Faltante total</p>
                <p class="text-lg font-bold text-orange-600 tabular-nums">{{ group.faltanteTotal }}</p>
              </div>
              <span
                class="text-gray-400 transition-transform"
                [class.rotate-180]="expanded.has(group.stockItemId)">▾</span>
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
  private auth = inject(AuthService);
  private navigationBack = inject(NavigationBackService);

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly getOrderStatusLabel = getOrderStatusLabel;
  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;

  loading = true;
  groups: StockShortageGroup[] = [];
  expanded = new Set<string>();
  view: ShortagesView = 'lista';
  copied = false;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.load();
  }

  goBack(): void {
    this.navigationBack.back(['/stock']);
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

  get totalUnidades(): number {
    return this.groups.reduce((acc, group) => acc + (Number(group.faltanteTotal) || 0), 0);
  }

  tabClass(value: ShortagesView): string {
    const base = 'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors';
    return this.view === value
      ? `${base} bg-white text-teal-700 shadow-sm`
      : `${base} text-gray-500 hover:text-gray-700`;
  }

  toggle(stockItemId: string) {
    if (this.expanded.has(stockItemId)) {
      this.expanded.delete(stockItemId);
    } else {
      this.expanded.add(stockItemId);
    }
  }

  private buildListText(): string {
    return this.groups
      .map((group) => `${group.faltanteTotal} x ${group.productoNombre}`)
      .join('\n');
  }

  copyList() {
    const text = this.buildListText();
    const markCopied = () => {
      this.copied = true;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => (this.copied = false), 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(markCopied).catch(() => this.fallbackCopy(text, markCopied));
      return;
    }
    this.fallbackCopy(text, markCopied);
  }

  private fallbackCopy(text: string, onDone: () => void) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      onDone();
    } finally {
      document.body.removeChild(textarea);
    }
  }

  printList() {
    const rows = this.groups
      .map(
        (group) => `
          <tr>
            <td>${this.escapeHtml(group.productoNombre)}</td>
            <td style="text-align:right;font-weight:600;">${group.faltanteTotal}</td>
          </tr>`
      )
      .join('');

    const today = new Date().toLocaleDateString('es-AR');
    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Lista de compra — Faltantes de stock</title>
<style>
  * { font-family: Arial, Helvetica, sans-serif; }
  body { margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #ddd; padding: 8px 6px; text-align: left; }
  th { text-transform: uppercase; font-size: 11px; color: #555; }
  tfoot td { border-top: 2px solid #333; border-bottom: none; font-weight: 700; padding-top: 10px; }
</style>
</head>
<body>
  <h1>${this.escapeHtml(this.auth.appBrandTitle)} — Lista de compra</h1>
  <div class="meta">Faltantes de stock para pedidos en curso · ${today}</div>
  <table>
    <thead>
      <tr><th>Producto</th><th style="text-align:right;">Cantidad</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td>Total de unidades</td><td style="text-align:right;">${this.totalUnidades}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    this.openPrintDialog(html);
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private openPrintDialog(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!doc || !win) {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    win.onafterprint = cleanup;

    window.setTimeout(() => {
      win.focus();
      win.print();
      window.setTimeout(cleanup, 1000);
    }, 250);
  }
}
