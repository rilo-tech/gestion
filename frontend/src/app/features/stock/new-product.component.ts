import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  applyCategoriaStockReglaToForm,
  getCategoriaStockRegla,
  normalizeCategoriasStock,
} from '../../core/utils/stock-product';
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
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { DuplicateActionButtonComponent } from '../../shared/components/duplicate-action-button/duplicate-action-button.component';

@Component({
  selector: 'app-new-product',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, SearchableSelectComponent, ConfigSettingsLinkComponent, HasPermissionDirective, SelectOnFocusDirective, FormSaveFooterComponent, DuplicateActionButtonComponent],
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
                  (ngModelChange)="onCategoriaChange($event)"
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
              <div *ngIf="showInventoryFields">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ isEditing ? 'Stock actual' : 'Stock inicial' }}
                </label>
                <input type="number" [(ngModel)]="item.stockActual" name="stockActual" min="0"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
              <div *ngIf="showInventoryFields">
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
              <p
                *ngIf="categoriaStockHint"
                class="text-xs text-teal-700 sm:col-span-3 p-3 rounded-lg border border-teal-100 bg-teal-50/50">
                {{ categoriaStockHint }}
              </p>
              <div class="sm:col-span-3 space-y-3">
                <label class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="controlaStock"
                    (ngModelChange)="onControlaStockChange()"
                    name="controlaStock"
                    [disabled]="formReadOnly"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-primary">
                  <span>
                    <span class="block text-sm font-medium text-gray-700">Controla stock</span>
                    <span class="block text-xs text-gray-500 mt-0.5">
                      Movimientos, reservas y faltantes. Desmarcá para servicios (estampado, bordado): solo precio en el pedido, sin cantidades.
                    </span>
                  </span>
                </label>
                <label
                  *ngIf="controlaStock"
                  class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="permitirStockNegativo"
                    name="permitirStockNegativo"
                    [disabled]="formReadOnly"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-primary">
                  <span>
                    <span class="block text-sm font-medium text-gray-700">Permitir stock negativo</span>
                    <span class="block text-xs text-gray-500 mt-0.5">
                      Podés cargar pedidos aunque no alcance el depósito; al descontar puede quedar en negativo. Desmarcá para bloquear reservas y descuentos sin stock.
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
                <span>{{ showInventoryFields ? (item.stockActual || 0) + ' u.' : '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Control de stock</span>
                <span>{{ controlaStock ? 'Sí' : 'No (servicio)' }}</span>
              </div>
              <div *ngIf="controlaStock" class="flex justify-between text-sm">
                <span class="text-gray-400">Stock negativo</span>
                <span>{{ permitirStockNegativo ? 'Permitido' : 'Bloqueado' }}</span>
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
              <app-form-save-footer
                *ngIf="!formReadOnly"
                [label]="isEditing ? 'Guardar' : 'Guardar producto'"
                [saving]="saving"
                [successMessage]="saveSuccessMessage"
                theme="dark"
                (saveClick)="submitProduct()">
              </app-form-save-footer>
              <div
                *ngIf="isEditing && (!formReadOnly || auth.canDeleteRecords)"
                class="flex gap-2">
                <app-duplicate-action-button
                  *ngIf="!formReadOnly"
                  variant="dark"
                  [iconOnly]="false"
                  label="Duplicar"
                  (duplicateClick)="duplicateProduct()">
                </app-duplicate-action-button>
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
  saving = false;
  saveSuccessMessage = '';
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  nombreBase = '';
  controlaStock = true;
  permitirStockNegativo = true;
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
      if (!this.appConfig.productos.categoriasStock) {
        this.appConfig.productos.categoriasStock = {};
      }
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
    this.permitirStockNegativo = true;
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
    if (!this.showInventoryFields) return 0;
    return (this.item.stockActual || 0) * (this.item.costo || 0);
  }

  get showInventoryFields(): boolean {
    return this.controlaStock;
  }

  get categoriaStockHint(): string {
    const regla = getCategoriaStockRegla(
      this.appConfig.productos?.categoriasStock,
      this.item.categoria
    );
    if (!regla) {
      return this.item.categoria?.trim()
        ? 'Esta categoría no tiene reglas de stock: configurá este producto manualmente.'
        : '';
    }
    return 'Esta categoría tiene reglas de stock. Los valores de abajo se sugieren al elegirla; podés cambiarlos solo para este producto.';
  }

  onCategoriaChange(categoria: string) {
    const regla = getCategoriaStockRegla(
      normalizeCategoriasStock(
        this.appConfig.productos?.categoriasStock,
        this.appConfig.productos?.categorias ?? [],
        this.appConfig.productos?.categoriasSinStock ?? []
      ),
      categoria
    );
    if (!regla) return;

    const apply = () => {
      const next = applyCategoriaStockReglaToForm(regla);
      this.controlaStock = next.controlaStock;
      this.permitirStockNegativo = next.permitirStockNegativo;
      if (!next.controlaStock) {
        this.item.stockActual = 0;
        this.item.stockMinimo = 0;
      }
    };

    if (!this.isEditing) {
      apply();
      return;
    }

    this.dialogService
      .confirm({
        title: 'Aplicar reglas de la categoría',
        message: `¿Usar las reglas de stock de «${categoria.trim()}» en este producto?`,
        confirmLabel: 'Aplicar',
        cancelLabel: 'Mantener actual',
      })
      .subscribe((confirmed) => {
        if (confirmed) apply();
      });
  }

  onControlaStockChange() {
    if (!this.controlaStock) {
      this.item.stockActual = 0;
      this.item.stockMinimo = 0;
      this.permitirStockNegativo = false;
      return;
    }
    if (this.permitirStockNegativo === undefined) {
      this.permitirStockNegativo = true;
    }
  }

  submitProduct() {
    if (!this.nombreBase.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del producto',
      });
      return;
    }

    const controlsStock = this.controlaStock;

    const payload: StockItem = {
      tipo: this.item.tipo?.trim() || '',
      nombreBase: this.nombreBase.trim(),
      nombre: buildProductDisplayName(this.nombreBase, this.item.color, this.item.talle),
      categoria: this.item.categoria?.trim() || undefined,
      talle: this.item.talle?.trim() || undefined,
      color: this.item.color?.trim() || undefined,
      stockActual: controlsStock ? Number(this.item.stockActual) || 0 : 0,
      stockMinimo: controlsStock ? Number(this.item.stockMinimo) || 0 : 0,
      controlaStock: controlsStock,
      permitirStockNegativo: controlsStock ? this.permitirStockNegativo !== false : false,
      costo: Number(this.item.costo) || 0,
      precioSugerido: Number(this.item.precioSugerido) || 0,
    };

    if (this.formReadOnly) return;

    this.saving = true;
    const request = this.editingItemId
      ? this.stockService.updateItem(this.editingItemId, payload)
      : this.stockService.createItem(payload);

    request.subscribe({
      next: (result) => {
        this.saving = false;
        if (this.editingItemId) {
          this.showSaveSuccess('Cambios guardados.');
          return;
        }

        this.showSaveSuccess('Producto guardado.');
        this.router.navigate(['/stock', result.id, 'edit'], { replaceUrl: true });
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        this.dialogService.alert({
          title: err.status === 409 ? 'Producto duplicado' : 'Error',
          message:
            (err.error as { error?: string })?.error ??
            (this.isEditing
              ? 'No se pudo actualizar el producto. Reiniciá el dev server si cambiaste la API.'
              : 'No se pudo guardar el producto. Reiniciá el dev server si cambiaste la API.'),
        });
      },
    });
  }

  duplicateProduct(_event?: Event) {
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
    this.item = {
      categoria: product.categoria ?? '',
      talle: product.talle ?? '',
      color: product.color ?? '',
      stockActual: Number(product.stockActual) || 0,
      stockMinimo: Number(product.stockMinimo) || 0,
      costo: Number(product.costo) || 0,
      precioSugerido: Number(product.precioSugerido) || 0,
    };
    this.controlaStock = product.controlaStock !== false;
    this.permitirStockNegativo = product.permitirStockNegativo !== false;
    if (!this.controlaStock) {
      this.permitirStockNegativo = false;
    }
  }
}
