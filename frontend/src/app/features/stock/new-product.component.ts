import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { StockService, StockItem } from '../../core/services/stock.service';
import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  CatalogConfigService,
  buildProductDisplayName,
} from '../../core/services/catalog-config.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { PERMISSIONS } from '../../core/constants/permissions';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, combineLatest } from 'rxjs';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';

@Component({
  selector: 'app-new-product',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, SearchableSelectComponent, ConfigSettingsLinkComponent, HasPermissionDirective, SelectOnFocusDirective],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-24 sm:pb-32">
      <div class="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">{{ isEditing ? 'Editar Producto' : 'Nuevo Producto' }}</h1>
          <p class="text-gray-500">
            {{ isEditing ? 'Modificá los datos del producto en inventario.' : 'Cargá un producto o insumo para sumarlo al inventario.' }}
          </p>
          <app-config-settings-link
            settingsTab="productos"
            message="¿Falta categoría, talle o color?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
        </div>
        <button
          routerLink="/stock"
          class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
          <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
          Volver al stock
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2 space-y-8">
          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
              <i-lucide name="package" class="w-5 h-5 text-teal-600"></i-lucide>
              Datos del item
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input [(ngModel)]="nombreBase" name="nombreBase" required
                       placeholder="Ej. Remera básica"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary">
              </div>

              <div class="md:col-span-1">
                <label class="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                <app-searchable-select
                  [(ngModel)]="item.categoria"
                  name="categoria"
                  [options]="configService.getFieldOptions(appConfig, 'productos.categorias')"
                  placeholder="Buscar categoría..."
                  plainPlaceholder="Ej. Indumentaria">
                </app-searchable-select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Talle</label>
                <app-searchable-select
                  [(ngModel)]="item.talle"
                  name="talle"
                  [options]="configService.getFieldOptions(appConfig, 'productos.talles')"
                  placeholder="Buscar talle..."
                  plainPlaceholder="Ej. M">
                </app-searchable-select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <app-searchable-select
                  [(ngModel)]="item.color"
                  name="color"
                  [options]="configService.getFieldOptions(appConfig, 'productos.colores')"
                  placeholder="Buscar color..."
                  plainPlaceholder="Ej. Negro">
                </app-searchable-select>
              </div>
            </div>
          </section>

          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
              <i-lucide name="bar-chart-3" class="w-5 h-5 text-teal-600"></i-lucide>
              Inventario
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ isEditing ? 'Stock actual' : 'Stock inicial' }}
                </label>
                <input type="number" [(ngModel)]="item.stockActual" name="stockActual" min="0"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Stock mínimo</label>
                <input type="number" [(ngModel)]="item.stockMinimo" name="stockMinimo" min="0"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Costo de compra</label>
                <input
                  type="number"
                  [(ngModel)]="item.costo"
                  name="costoCompra"
                  min="0"
                  step="0.01"
                  [disabled]="formReadOnly"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none disabled:bg-gray-50">
              </div>
              <p class="text-xs text-gray-500 sm:col-span-3">
                El costo de compra es el costo base del producto al cargarlo en un pedido.
              </p>
              <div class="sm:col-span-3">
                <label class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="controlaStock"
                    name="controlaStock"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-primary">
                  <span>
                    <span class="block text-sm font-medium text-gray-700">Controla stock</span>
                    <span class="block text-xs text-gray-500 mt-0.5">
                      Si está activo, el producto usa stock físico y reservas. Podés cargar pedidos igual; lo que falte queda en Faltantes para comprar.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section *appHasPermission="permissions.STOCK_VIEW_COSTS" class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4">Precio de venta</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Precio sugerido</label>
                <input type="number" [(ngModel)]="item.precioSugerido" name="precioSugerido" min="0"
                       [disabled]="formReadOnly"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
            </div>
          </section>
          <section *ngIf="!auth.canViewStockCosts" class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4">Precio sugerido</h2>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Precio sugerido</label>
              <input type="number" [(ngModel)]="item.precioSugerido" name="precioSugeridoPublic" min="0"
                     [disabled]="formReadOnly"
                     class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
            </div>
          </section>
        </div>

        <div class="space-y-6">
          <div class="bg-gray-900 text-white p-5 sm:p-6 rounded-2xl shadow-xl sticky top-8">
            <h2 class="text-lg font-bold mb-4 text-teal-400">Resumen</h2>
            <div class="space-y-3 mb-5">
              <div class="flex justify-between text-sm gap-4">
                <span class="text-gray-400 shrink-0">Item final</span>
                <span class="text-right font-medium">{{ displayName || '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Categoría</span>
                <span>{{ item.categoria || '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">{{ isEditing ? 'Stock actual' : 'Stock inicial' }}</span>
                <span>{{ item.stockActual || 0 }} u.</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Control de stock</span>
                <span>{{ controlaStock ? 'Sí' : 'No' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Costo de compra</span>
                <span>{{ '$' + (item.costo || 0) }}</span>
              </div>
              <div *appHasPermission="permissions.STOCK_VIEW_COSTS" class="border-t border-gray-800 pt-4 flex justify-between font-bold text-lg">
                <span>Valor en stock</span>
                <span>{{ '$' + inventoryValue }}</span>
              </div>
            </div>

            <div class="space-y-2 pt-4 border-t border-gray-800">
              <button
                *ngIf="!formReadOnly"
                type="button"
                (click)="submitProduct()"
                class="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 text-gray-900 text-sm font-semibold py-2.5 px-3 hover:bg-teal-400 transition-colors">
                <i-lucide name="save" class="w-4 h-4"></i-lucide>
                {{ isEditing ? 'Guardar' : 'Guardar producto' }}
              </button>
              <p
                *ngIf="saveSuccessMessage"
                class="text-center text-xs font-medium text-teal-300"
                role="status">
                {{ saveSuccessMessage }}
              </p>
              <div
                *ngIf="isEditing && (!formReadOnly || auth.canDeleteRecords)"
                class="flex gap-2">
                <button
                  *ngIf="!formReadOnly"
                  type="button"
                  (click)="duplicateProduct()"
                  class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 text-xs font-medium py-2 px-2.5 hover:bg-gray-800 transition-colors">
                  <i-lucide name="copy" class="w-3.5 h-3.5"></i-lucide>
                  Duplicar
                </button>
                <button
                  *ngIf="auth.canDeleteRecords"
                  type="button"
                  (click)="confirmDeleteProduct()"
                  class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/70 bg-red-950/25 text-red-300 text-xs font-medium py-2 px-2.5 hover:bg-red-950/45 transition-colors"
                  [class.flex-1]="!formReadOnly">
                  <i-lucide name="trash-2" class="w-3.5 h-3.5"></i-lucide>
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class NewProductComponent implements OnInit, OnDestroy {
  private stockService = inject(StockService);
  configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;
  private configSub?: Subscription;
  private routeSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  editingItemId: string | null = null;
  saveSuccessMessage = '';
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  nombreBase = '';
  controlaStock = true;
  item = {
    tipo: '',
    categoria: '',
    talle: '',
    color: '',
    stockActual: 0,
    stockMinimo: 0,
    costo: 0,
    precioSugerido: 0,
  };

  get isEditing(): boolean {
    return !!this.editingItemId;
  }

  get formReadOnly(): boolean {
    return this.isEditing && !this.auth.canEditRecords;
  }

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalogConfigServiceLoad();

    this.routeSub = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, query]) => {
      const id = params.get('id');
      const duplicateId = query.get('duplicate');

      if (id) {
        this.editingItemId = id;
        this.loadProduct(id);
        return;
      }

      this.editingItemId = null;
      if (duplicateId) {
        this.loadProductForDuplicate(duplicateId);
        return;
      }

      this.resetForm();
    });
  }

  private resetForm() {
    this.nombreBase = '';
    this.controlaStock = true;
    this.item = {
      categoria: '',
      talle: '',
      color: '',
      stockActual: 0,
      stockMinimo: 0,
      costo: 0,
      precioSugerido: 0,
    };
  }

  private catalogConfigServiceLoad() {
    this.configService.getAppConfig().subscribe();
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
  }

  get displayName(): string {
    if (!this.nombreBase.trim()) return '';
    return buildProductDisplayName(this.nombreBase, this.item.color, this.item.talle);
  }

  get inventoryValue(): number {
    return (this.item.stockActual || 0) * (this.item.costo || 0);
  }

  submitProduct() {
    if (!this.nombreBase.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del producto',
      });
      return;
    }

    const payload: StockItem = {
      nombreBase: this.nombreBase.trim(),
      nombre: buildProductDisplayName(this.nombreBase, this.item.color, this.item.talle),
      categoria: this.item.categoria?.trim() || undefined,
      talle: this.item.talle?.trim() || undefined,
      color: this.item.color?.trim() || undefined,
      stockActual: Number(this.item.stockActual) || 0,
      stockMinimo: Number(this.item.stockMinimo) || 0,
      controlaStock: this.controlaStock !== false,
      costo: Number(this.item.costo) || 0,
      precioSugerido: Number(this.item.precioSugerido) || 0,
    };

    if (this.formReadOnly) return;

    const request = this.editingItemId
      ? this.stockService.updateItem(this.editingItemId, payload)
      : this.stockService.createItem(payload);

    request.subscribe({
      next: (result) => {
        if (this.editingItemId) {
          this.showSaveSuccess('Cambios guardados.');
          return;
        }

        this.showSaveSuccess('Producto guardado.');
        this.router.navigate(['/stock', result.id, 'edit'], { replaceUrl: true });
      },
      error: (err: HttpErrorResponse) =>
        this.dialogService.alert({
          title: err.status === 409 ? 'Producto duplicado' : 'Error',
          message:
            (err.error as { error?: string })?.error ??
            (this.isEditing
              ? 'No se pudo actualizar el producto. Reiniciá el dev server si cambiaste la API.'
              : 'No se pudo guardar el producto. Reiniciá el dev server si cambiaste la API.'),
        }),
    });
  }

  duplicateProduct() {
    if (!this.editingItemId) return;
    this.router.navigate(['/stock/new'], {
      queryParams: { duplicate: this.editingItemId },
    });
  }

  private showSaveSuccess(message: string) {
    this.saveSuccessMessage = message;
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
    this.saveSuccessTimeout = setTimeout(() => {
      this.saveSuccessMessage = '';
    }, 3500);
  }

  confirmDeleteProduct() {
    if (!this.editingItemId) return;
    const name = this.displayName || this.nombreBase || 'este producto';

    this.dialogService
      .confirm({
        title: 'Eliminar producto',
        message: `¿Eliminar ${name}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.stockService.deleteItem(this.editingItemId!).subscribe({
          next: () => this.router.navigate(['/stock']),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el producto. Reiniciá el dev server si cambiaste la API.',
            }),
        });
      });
  }

  private loadProductForDuplicate(sourceId: string) {
    this.stockService.getItem(sourceId).subscribe({
      next: (product) => this.applyProductFields(product),
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el producto a duplicar.',
        });
        this.resetForm();
      },
    });
  }

  private loadProduct(itemId: string) {
    this.stockService.getItem(itemId).subscribe({
      next: (product) => this.applyProductFields(product),
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el producto.',
        });
        this.router.navigate(['/stock']);
      },
    });
  }

  private applyProductFields(product: StockItem) {
    const nombreBase = product.nombreBase?.trim() || product.nombre?.trim() || '';

    this.nombreBase = nombreBase;
    this.controlaStock = product.controlaStock !== false;
    this.item = {
      categoria: product.categoria ?? '',
      talle: product.talle ?? '',
      color: product.color ?? '',
      stockActual: Number(product.stockActual) || 0,
      stockMinimo: Number(product.stockMinimo) || 0,
      costo: Number(product.costo) || 0,
      precioSugerido: Number(product.precioSugerido) || 0,
    };
  }
}
