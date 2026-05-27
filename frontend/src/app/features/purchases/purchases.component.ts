import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PurchaseService, CreatePurchasePayload, Purchase } from '../../core/services/purchase.service';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  SupplierFormPanelComponent,
  SupplierFormSaveEvent,
} from '../suppliers/supplier-form-panel.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import {
  IconActionComponent,
  NATIVE_COMPACT_TABLE_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import { LucideAngularModule } from 'lucide-angular';

interface PurchaseDraftLine {
  productoId: string;
  cantidad: number | null;
  costoUnitario: number | null;
}

@Component({
  selector: 'app-purchases',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, TransactionModalComponent, SearchableSelectComponent, SupplierFormPanelComponent, IconActionComponent, ActivityLogTriggerComponent, ModalFormFooterComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Compras</h1>
          <p class="text-sm sm:text-base text-gray-500">Registrá entradas de mercadería e insumos al inventario.</p>
          <p class="text-xs text-gray-400 mt-1">
            Los movimientos de stock se ven en
            <a routerLink="/stock" class="text-teal-600 hover:underline">Stock → Movimientos</a>.
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="purchases"></app-activity-log-trigger>
          <app-icon-action label="Nueva compra" (clicked)="openPurchaseModal()">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

      <div *ngIf="auth.canViewEconomics" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8 w-full">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Compras registradas</p>
          <p class="text-2xl font-bold text-gray-900">{{ purchases.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total comprado</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalComprado }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Este mes</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + totalMes }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[560px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Compra</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Proveedor</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Items</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let purchase of purchases"
              (click)="openPurchaseDetail(purchase)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(purchase.fecha) }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-teal-700">
                #{{ purchase.compraLabel || purchase.id?.slice(-6) }}
                <div class="text-xs font-normal text-gray-400 sm:hidden">{{ formatDate(purchase.fecha) }}</div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-700">
                <div class="truncate">{{ purchase.proveedor?.trim() || '—' }}</div>
                <div class="text-xs text-gray-400 sm:hidden">{{ purchase.items?.length || 0 }} producto(s)</div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                {{ purchase.items?.length || 0 }} producto(s)
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (purchase.total || 0) }}
              </td>
            </tr>
            <tr *ngIf="loading" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">Cargando compras...</td>
            </tr>
            <tr *ngIf="loading" class="hidden sm:table-row">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">Cargando compras...</td>
            </tr>
            <tr *ngIf="!loading && purchases.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                Todavía no hay compras. Usá <span class="font-semibold">Nueva compra</span> para sumar stock.
              </td>
            </tr>
            <tr *ngIf="!loading && purchases.length === 0" class="hidden sm:table-row">
              <td colspan="5" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay compras. Usá <span class="font-semibold">Nueva compra</span> para sumar stock.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <div class="px-4 sm:px-6 pb-4" *ngIf="purchasesHasMore">
          <button
            type="button"
            (click)="loadMorePurchases()"
            [disabled]="loadingMorePurchases"
            class="w-full sm:w-auto rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            {{ loadingMorePurchases ? 'Cargando...' : 'Cargar más compras' }}
          </button>
        </div>
      </div>
    </div>

    <app-transaction-modal
      [open]="purchaseModalOpen"
      title="Nueva compra"
      subtitle="Acción rápida desde el listado. Sumá stock al inventario automáticamente."
      (closed)="closePurchaseModal()">

        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div class="flex items-center justify-between gap-3 mb-1">
                <label class="block text-sm font-medium text-gray-700">Proveedor</label>
                <button
                  type="button"
                  (click)="openNewSupplierModal()"
                  class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0">
                  + Nuevo proveedor
                </button>
              </div>
              <app-searchable-select
                [(ngModel)]="purchaseProveedorId"
                name="purchaseProveedorId"
                [labeledOptions]="supplierOptions"
                [creatable]="true"
                createLabelPrefix="Crear proveedor"
                (createRequested)="quickCreateSupplier($event)"
                (searchChange)="pendingSupplierName = $event"
                placeholder="Buscar proveedor..."
                plainPlaceholder="Opcional"
                emptyOptionsMessage="No hay proveedores cargados. Escribí el nombre para crearlo."
                listHint="Opcional. Elegí un proveedor o creá uno nuevo.">
              </app-searchable-select>
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

        <app-modal-form-footer
          [saving]="savingPurchase"
          primaryLabel="Registrar compra"
          (cancelClick)="closePurchaseModal()"
          (primaryClick)="submitPurchase()">
        </app-modal-form-footer>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="supplierModalOpen"
      title="Nuevo proveedor"
      subtitle="Al guardar queda seleccionado en esta compra."
      maxWidthClass="max-w-lg"
      (closed)="closeSupplierModal()">
      <app-supplier-form-panel
        [prefillNombre]="supplierPrefillNombre"
        (saved)="onSupplierSavedFromModal($event)"
        (cancelled)="closeSupplierModal()">
      </app-supplier-form-panel>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="detailModalOpen"
      [title]="detailModalTitle"
      subtitle="Detalle de la compra registrada. No se puede modificar después de cargar."
      maxWidthClass="max-w-2xl"
      (closed)="closePurchaseDetail()">
      <div *ngIf="detailPurchase as purchase" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Fecha</p>
            <p class="text-gray-900">{{ formatDate(purchase.fecha) }}</p>
          </div>
          <div>
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Proveedor</p>
            <p class="text-gray-900">{{ purchase.proveedor?.trim() || '—' }}</p>
          </div>
        </div>
        <div *ngIf="purchase.notas?.trim()" class="text-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Notas</p>
          <p class="text-gray-700">{{ purchase.notas }}</p>
        </div>
        <div class="rounded-xl border border-gray-100 overflow-hidden">
          <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700">
            Productos
          </div>
          <div class="divide-y divide-gray-50">
            <div
              *ngFor="let line of purchase.items"
              class="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
              <div class="min-w-0">
                <p class="font-medium text-gray-900 truncate">{{ line.productoNombre || 'Producto' }}</p>
                <p class="text-xs text-gray-500 tabular-nums">
                  {{ line.cantidad }} × {{ '$' + line.costoUnitario }}
                </p>
              </div>
              <a
                *ngIf="line.productoId"
                [routerLink]="['/stock', line.productoId, 'edit']"
                (click)="$event.stopPropagation()"
                class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0">
                Ver producto
              </a>
            </div>
          </div>
        </div>
        <div class="flex justify-between items-center rounded-xl bg-gray-50 px-4 py-3">
          <span class="text-sm text-gray-500">Total</span>
          <span class="text-lg font-bold text-gray-900 tabular-nums">{{ '$' + (purchase.total || 0) }}</span>
        </div>
      </div>
    </app-transaction-modal>
  `,
})
export class PurchasesComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly auth = inject(AuthService);

  private purchaseService = inject(PurchaseService);
  private supplierService = inject(SupplierService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  purchases: Purchase[] = [];
  suppliers: Supplier[] = [];
  stockItems: StockItem[] = [];
  loading = true;
  loadingMorePurchases = false;
  purchasesHasMore = false;
  purchasesCursor: string | null = null;
  readonly listPageSize = 80;

  purchaseModalOpen = false;
  detailModalOpen = false;
  detailPurchase: Purchase | null = null;
  supplierModalOpen = false;
  supplierPrefillNombre = '';
  pendingSupplierName = '';
  creatingSupplier = false;
  savingPurchase = false;
  purchaseProveedorId = '';
  purchaseNotas = '';
  draftLines: PurchaseDraftLine[] = [this.emptyLine()];

  get supplierOptions() {
    return this.suppliers
      .filter((supplier) => supplier.id)
      .map((supplier) => ({
        value: supplier.id!,
        label: supplier.nombre,
      }));
  }

  get detailModalTitle(): string {
    if (!this.detailPurchase) return 'Detalle de compra';
    const label = this.detailPurchase.compraLabel || this.detailPurchase.id?.slice(-6);
    return label ? `Compra #${label}` : 'Detalle de compra';
  }

  ngOnInit() {
    if (!this.auth.canViewStockCosts) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loadPurchases();
    this.loadSuppliers();
    this.stockService.getStock().subscribe({
      next: (items) => (this.stockItems = items),
    });

    this.route.queryParamMap.subscribe((params) => {
      const detailId = params.get('detail');
      if (!detailId) return;
      this.openPurchaseDetailById(detailId);
    });
  }

  private tryOpenDetailFromQuery() {
    const detailId = this.route.snapshot.queryParamMap.get('detail');
    if (!detailId) return;
    this.openPurchaseDetailById(detailId);
  }

  private loadSuppliers() {
    this.supplierService.getSuppliers().subscribe({
      next: (suppliers) => (this.suppliers = suppliers),
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

    this.purchaseProveedorId = '';
    this.purchaseNotas = '';
    this.pendingSupplierName = '';
    this.draftLines = [this.emptyLine()];
    this.purchaseModalOpen = true;
  }

  openPurchaseDetail(purchase: Purchase) {
    this.detailPurchase = purchase;
    this.detailModalOpen = true;
  }

  openPurchaseDetailById(purchaseId: string) {
    const purchase = this.purchases.find((entry) => entry.id === purchaseId);
    if (purchase) {
      this.openPurchaseDetail(purchase);
      this.clearDetailQueryParam();
    }
  }

  closePurchaseDetail() {
    this.detailModalOpen = false;
    this.detailPurchase = null;
    this.clearDetailQueryParam();
  }

  private clearDetailQueryParam() {
    if (!this.route.snapshot.queryParamMap.get('detail')) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { detail: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  closePurchaseModal() {
    this.purchaseModalOpen = false;
    this.pendingSupplierName = '';
    this.closeSupplierModal();
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
      proveedorId: this.purchaseProveedorId.trim() || undefined,
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

  openNewSupplierModal() {
    this.supplierPrefillNombre = this.pendingSupplierName.trim();
    this.supplierModalOpen = true;
  }

  quickCreateSupplier(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.creatingSupplier) return;

    this.creatingSupplier = true;
    this.supplierService.createSupplier({ nombre: trimmed }).subscribe({
      next: (response) => {
        this.creatingSupplier = false;
        const supplier: Supplier = { id: response.id, nombre: trimmed };
        this.suppliers = [...this.suppliers, supplier];
        this.purchaseProveedorId = response.id;
        this.pendingSupplierName = trimmed;
      },
      error: () => {
        this.creatingSupplier = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo crear el proveedor. Intentá de nuevo o usá «Nuevo proveedor» para cargar la ficha completa.',
        });
      },
    });
  }

  closeSupplierModal() {
    this.supplierModalOpen = false;
    this.supplierPrefillNombre = '';
  }

  onSupplierSavedFromModal(event: SupplierFormSaveEvent) {
    this.suppliers = [...this.suppliers.filter((s) => s.id !== event.id), event.supplier];
    this.purchaseProveedorId = event.id;
    this.closeSupplierModal();
  }

  private loadPurchases() {
    this.loading = true;
    this.purchaseService.getPurchasesPage(this.listPageSize).subscribe({
      next: (page) => {
        this.purchases = page.items;
        this.purchasesHasMore = page.hasMore;
        this.purchasesCursor = page.nextCursor;
        this.loading = false;
        this.tryOpenDetailFromQuery();
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

  loadMorePurchases() {
    if (!this.purchasesHasMore || this.loadingMorePurchases) return;
    this.loadingMorePurchases = true;
    this.purchaseService
      .getPurchasesPage(this.listPageSize, this.purchasesCursor ?? undefined)
      .subscribe({
        next: (page) => {
          this.purchases = [...this.purchases, ...page.items];
          this.purchasesHasMore = page.hasMore;
          this.purchasesCursor = page.nextCursor;
          this.loadingMorePurchases = false;
        },
        error: () => {
          this.loadingMorePurchases = false;
        },
      });
  }

  private emptyLine(): PurchaseDraftLine {
    return { productoId: '', cantidad: 1, costoUnitario: 0 };
  }
}
