import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  StockItem,
  StockMovement,
  StockOrigenGrupo,
  StockService,
} from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { LucideAngularModule } from 'lucide-angular';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';

type StockTab = 'productos' | 'movimientos';

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule, RouterLink, ConfigSettingsLinkComponent, ConceptRefLinksComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Stock & Inventario</h1>
          <p class="text-sm sm:text-base text-gray-500">Controlá productos, stock actual y movimientos del inventario.</p>
          <app-config-settings-link
            settingsTab="productos"
            message="¿Falta tipo, talle o color?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
        </div>
        <a
          routerLink="/stock/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo producto"
          title="Nuevo producto">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo producto</span>
        </a>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total items</p>
          <p class="text-2xl font-bold">{{ items.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Con stock bajo</p>
          <p class="text-2xl font-bold text-orange-500">{{ lowStockCount }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Valor estimado</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + estimatedStockValue }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Movimientos mes</p>
          <p class="text-2xl font-bold">{{ movementsThisMonth }}</p>
        </div>
      </div>

      <div class="mb-4 flex gap-2 border-b border-gray-100">
        <button
          type="button"
          (click)="setTab('productos')"
          class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
          [class.border-teal-600]="activeTab === 'productos'"
          [class.text-teal-700]="activeTab === 'productos'"
          [class.border-transparent]="activeTab !== 'productos'"
          [class.text-gray-500]="activeTab !== 'productos'">
          Productos
        </button>
        <button
          type="button"
          (click)="setTab('movimientos')"
          class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
          [class.border-teal-600]="activeTab === 'movimientos'"
          [class.text-teal-700]="activeTab === 'movimientos'"
          [class.border-transparent]="activeTab !== 'movimientos'"
          [class.text-gray-500]="activeTab !== 'movimientos'">
          Movimientos
        </button>
      </div>

      <div *ngIf="activeTab === 'productos'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            name="searchQuery"
            placeholder="Buscar producto..."
            class="w-full max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stock</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Costo ref.</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let item of filteredItems"
              (click)="openEditItem(item)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900">{{ item.nombre }}</div>
                <div *ngIf="getItemDetails(item)" class="text-xs text-gray-400">{{ getItemDetails(item) }}</div>
              </td>
              <td class="px-6 py-4">
                <span class="px-2 py-0.5 text-xs rounded-full uppercase font-bold bg-teal-50 text-teal-700">
                  {{ item.tipo || '—' }}
                </span>
              </td>
              <td class="px-6 py-4">
                <div [class]="(item.stockActual || 0) <= (item.stockMinimo || 0) ? 'text-orange-600 font-bold' : 'text-gray-900'">
                  {{ item.stockActual }} u.
                </div>
                <div class="text-xs text-gray-400">Min: {{ item.stockMinimo || 0 }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{ '$' + (item.costo || 0) }}
              </td>
              <td class="px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    (click)="openEditItem(item)"
                    title="Editar"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    type="button"
                    (click)="confirmDeleteItem(item)"
                    title="Eliminar"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="loadingItems">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">Cargando productos...</td>
            </tr>
            <tr *ngIf="!loadingItems && items.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">
                No hay productos cargados. Usá <span class="font-semibold">Nuevo producto</span> para empezar.
              </td>
            </tr>
            <tr *ngIf="!loadingItems && items.length > 0 && filteredItems.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">
                No se encontraron productos para "{{ searchQuery }}".
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div *ngIf="activeTab === 'movimientos'" class="bg-white rounded-xl shadow-sm border border-gray-100">
        <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              [(ngModel)]="movementSearchQuery"
              name="movementSearchQuery"
              placeholder="Buscar por producto o motivo..."
              class="w-full max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <select
              [(ngModel)]="movementTipoFilter"
              name="movementTipoFilter"
              class="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <option value="all">Todos los tipos</option>
              <option value="entrada">Entradas</option>
              <option value="salida">Salidas</option>
            </select>
            <select
              [(ngModel)]="movementOrigenFilter"
              name="movementOrigenFilter"
              class="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <option value="all">Todos los orígenes</option>
              <option value="compra">Compras</option>
              <option value="pedido">Pedidos</option>
              <option value="ajuste">Ajustes</option>
              <option value="carga_inicial">Carga inicial</option>
            </select>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[860px] text-left border-collapse">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Producto</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cantidad</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Motivo</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr *ngFor="let movement of filteredMovements" class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                  {{ formatDate(movement.fecha) }}
                </td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">
                  {{ movement.productoNombre || '—' }}
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    [class.bg-teal-50]="movement.tipo === 'entrada'"
                    [class.text-teal-700]="movement.tipo === 'entrada'"
                    [class.bg-red-50]="movement.tipo === 'salida'"
                    [class.text-red-600]="movement.tipo === 'salida'">
                    {{ movement.tipo === 'entrada' ? 'Entrada' : 'Salida' }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm font-semibold text-right tabular-nums"
                  [class.text-teal-600]="movement.tipo === 'entrada'"
                  [class.text-red-500]="movement.tipo === 'salida'">
                  {{ movement.tipo === 'salida' ? '-' : '+' }}{{ movement.cantidad }}
                </td>
                <td class="px-6 py-4 text-sm text-gray-700">
                  <ng-container *ngIf="movement.pedidoId || movement.ventaId; else motivoFallback">
                    <app-concept-ref-links
                      [text]="movement.motivo || '—'"
                      [pedidoId]="movement.pedidoId"
                      [ventaId]="movement.ventaId"
                      [numeroPedidoLabel]="movement.numeroPedidoLabel"
                      [ventaLabel]="movement.ventaLabel">
                    </app-concept-ref-links>
                  </ng-container>
                  <ng-template #motivoFallback>
                    <ng-container *ngIf="getMotivoLink(movement) as link; else plainMotivo">
                      {{ link.before }}<button
                        *ngIf="link.kind === 'pedido'"
                        type="button"
                        (click)="openOrder(movement)"
                        class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
                        {{ link.ref }}
                      </button><a
                        *ngIf="link.kind === 'compra'"
                        routerLink="/purchases"
                        class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
                        {{ link.ref }}
                      </a>{{ link.after }}
                    </ng-container>
                    <ng-template #plainMotivo>{{ movement.motivo || '—' }}</ng-template>
                  </ng-template>
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    [ngClass]="getOrigenBadgeClass(movement)">
                    {{ getOrigenLabel(movement) }}
                  </span>
                </td>
              </tr>
              <tr *ngIf="loadingMovements">
                <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando movimientos...</td>
              </tr>
              <tr *ngIf="!loadingMovements && movements.length === 0">
                <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                  Todavía no hay movimientos de stock.
                </td>
              </tr>
              <tr *ngIf="!loadingMovements && movements.length > 0 && filteredMovements.length === 0">
                <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                  No se encontraron movimientos con los filtros actuales.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class StockComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;

  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  items: StockItem[] = [];
  movements: StockMovement[] = [];
  searchQuery = '';
  movementSearchQuery = '';
  movementTipoFilter: 'all' | 'entrada' | 'salida' = 'all';
  movementOrigenFilter: 'all' | StockOrigenGrupo = 'all';
  activeTab: StockTab = 'productos';
  loadingItems = true;
  loadingMovements = true;

  ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'movimientos') {
      this.activeTab = 'movimientos';
    }

    this.loadStock();
    this.loadMovements();
  }

  setTab(tab: StockTab) {
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'productos' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  get lowStockCount(): number {
    return this.items.filter((item) => (item.stockActual || 0) <= (item.stockMinimo || 0)).length;
  }

  get estimatedStockValue(): number {
    return this.items.reduce(
      (total, item) => total + (Number(item.stockActual) || 0) * (Number(item.costo) || 0),
      0
    );
  }

  get movementsThisMonth(): number {
    const now = new Date();
    return this.movements.filter((movement) => {
      const date = new Date(movement.fecha);
      return (
        !Number.isNaN(date.getTime()) &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    }).length;
  }

  get filteredItems(): StockItem[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.items;

    return this.items.filter((item) => {
      const searchable = [item.nombre, item.nombreBase, item.tipo, item.categoria, item.talle, item.color]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }

  get filteredMovements(): StockMovement[] {
    let list = this.movements;

    if (this.movementTipoFilter !== 'all') {
      list = list.filter((movement) => movement.tipo === this.movementTipoFilter);
    }

    if (this.movementOrigenFilter !== 'all') {
      list = list.filter(
        (movement) => this.resolveOrigenGrupo(movement) === this.movementOrigenFilter
      );
    }

    const query = this.movementSearchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((movement) => {
      const haystack = [movement.productoNombre, movement.motivo, movement.origenLabel]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  getItemDetails(item: StockItem): string {
    return [item.categoria, item.talle, item.color].filter(Boolean).join(' · ');
  }

  getOrigenLabel(movement: StockMovement): string {
    if (movement.origenLabel) return movement.origenLabel;
    const grupo = this.resolveOrigenGrupo(movement);
    if (grupo === 'compra') return 'Compra';
    if (grupo === 'pedido') return 'Pedido';
    if (grupo === 'ajuste') return 'Ajuste manual';
    if (grupo === 'carga_inicial') return 'Carga inicial';
    return 'Otro';
  }

  getOrigenBadgeClass(movement: StockMovement): Record<string, boolean> {
    const grupo = this.resolveOrigenGrupo(movement);
    return {
      'bg-purple-50 text-purple-700': grupo === 'compra',
      'bg-teal-50 text-teal-700': grupo === 'pedido',
      'bg-gray-100 text-gray-700': grupo === 'ajuste',
      'bg-amber-50 text-amber-700': grupo === 'carga_inicial',
      'bg-slate-100 text-slate-700': grupo === 'otro',
    };
  }

  getMotivoLink(
    movement: StockMovement
  ): { before: string; ref: string; after: string; kind: 'pedido' | 'compra' } | null {
    const motivo = movement.motivo ?? '';
    const pedidoRef = movement.numeroPedidoLabel ? `#${movement.numeroPedidoLabel}` : null;
    if (movement.pedidoId && pedidoRef && motivo.includes(pedidoRef)) {
      const index = motivo.indexOf(pedidoRef);
      return {
        before: motivo.slice(0, index),
        ref: pedidoRef,
        after: motivo.slice(index + pedidoRef.length),
        kind: 'pedido',
      };
    }

    const compraMatch = motivo.match(/^(.*?)(#\S+)(.*)$/);
    if (compraMatch && this.resolveOrigenGrupo(movement) === 'compra') {
      return {
        before: compraMatch[1],
        ref: compraMatch[2],
        after: compraMatch[3],
        kind: 'compra',
      };
    }

    if (movement.pedidoId) {
      const generic = motivo.match(/^(.*?)(#\S+)(.*)$/);
      if (generic) {
        return {
          before: generic[1],
          ref: generic[2],
          after: generic[3],
          kind: 'pedido',
        };
      }
    }

    return null;
  }

  openOrder(movement: StockMovement) {
    if (!movement.pedidoId) return;
    this.router.navigate(['/orders', movement.pedidoId, 'edit']);
  }

  openEditItem(item: StockItem) {
    if (!item.id) return;
    this.router.navigate(['/stock', item.id, 'edit']);
  }

  confirmDeleteItem(item: StockItem) {
    if (!item.id) return;

    this.dialogService
      .confirm({
        title: 'Eliminar producto',
        message: `¿Eliminar ${item.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.stockService.deleteItem(item.id!).subscribe({
          next: () => this.loadStock(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el producto.',
            }),
        });
      });
  }

  private resolveOrigenGrupo(movement: StockMovement): StockOrigenGrupo {
    if (movement.origenGrupo) return movement.origenGrupo;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo === 'compra' || movement.compraId) return 'compra';
    if (tipo.startsWith('pedido')) return 'pedido';
    if (tipo === 'carga_inicial') return 'carga_inicial';
    if (tipo.startsWith('ajuste')) return 'ajuste';
    return 'otro';
  }

  private loadStock() {
    this.loadingItems = true;
    this.stockService.getStock().subscribe({
      next: (items) => {
        this.items = items;
        this.loadingItems = false;
      },
      error: () => {
        this.loadingItems = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los productos.',
        });
      },
    });
  }

  private loadMovements() {
    this.loadingMovements = true;
    this.stockService.getMovements().subscribe({
      next: (movements) => {
        this.movements = movements;
        this.loadingMovements = false;
      },
      error: () => {
        this.loadingMovements = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los movimientos de stock.',
        });
      },
    });
  }
}
