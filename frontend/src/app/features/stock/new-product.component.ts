import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-new-product',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, SearchableSelectComponent, ConfigSettingsLinkComponent],
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
            message="¿Falta tipo, talle o color?"
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
                <label class="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <app-searchable-select
                  [(ngModel)]="item.tipo"
                  name="tipo"
                  [options]="configService.getFieldOptions(appConfig, 'productos.tipos')"
                  placeholder="Buscar tipo..."
                  plainPlaceholder="Ej. Producto">
                </app-searchable-select>
              </div>

              <div>
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
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div class="md:col-span-2">
                <label class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="controlaStock"
                    name="controlaStock"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-primary">
                  <span>
                    <span class="block text-sm font-medium text-gray-700">Controla stock</span>
                    <span class="block text-xs text-gray-500 mt-0.5">
                      Si está activo, no podés confirmar un pedido que deje este producto con stock negativo.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4">Costos y precio</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Costo unitario</label>
                <input type="number" [(ngModel)]="item.costo" name="costo" min="0"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Precio sugerido</label>
                <input type="number" [(ngModel)]="item.precioSugerido" name="precioSugerido" min="0"
                       class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              </div>
            </div>
          </section>
        </div>

        <div class="space-y-6">
          <div class="bg-gray-900 text-white p-8 rounded-2xl shadow-xl sticky top-8">
            <h2 class="text-xl font-bold mb-6 text-teal-400">Resumen</h2>
            <div class="space-y-4 mb-8">
              <div class="flex justify-between text-sm gap-4">
                <span class="text-gray-400 shrink-0">Item final</span>
                <span class="text-right font-medium">{{ displayName || '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Tipo</span>
                <span>{{ item.tipo || '—' }}</span>
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
                <span class="text-gray-400">Costo unitario</span>
                <span>{{ '$' + (item.costo || 0) }}</span>
              </div>
              <div class="border-t border-gray-800 pt-4 flex justify-between font-bold text-lg">
                <span>Valor en stock</span>
                <span>{{ '$' + inventoryValue }}</span>
              </div>
            </div>
            <button (click)="submitProduct()"
                    class="w-full bg-teal-500 text-gray-900 font-bold py-4 rounded-xl hover:bg-teal-400 transition-all">
              {{ isEditing ? 'Guardar cambios' : 'Guardar producto' }}
            </button>
            <button
              *ngIf="isEditing"
              type="button"
              (click)="confirmDeleteProduct()"
              class="w-full mt-3 py-3 rounded-xl border border-red-400 text-red-300 font-medium hover:bg-red-950/40 transition-all">
              Eliminar producto
            </button>
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
  private configSub?: Subscription;
  private routeSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  editingItemId: string | null = null;
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

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalogConfigServiceLoad();

    this.routeSub = this.route.paramMap.subscribe((params) => {
      this.editingItemId = params.get('id');
      if (this.editingItemId) {
        this.loadProduct(this.editingItemId);
      } else {
        this.resetForm();
      }
    });
  }

  private resetForm() {
    this.nombreBase = '';
    this.controlaStock = true;
    this.item = {
      tipo: '',
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
      tipo: this.item.tipo?.trim() || undefined,
      categoria: this.item.categoria?.trim() || undefined,
      talle: this.item.talle?.trim() || undefined,
      color: this.item.color?.trim() || undefined,
      stockActual: Number(this.item.stockActual) || 0,
      stockMinimo: Number(this.item.stockMinimo) || 0,
      controlaStock: this.controlaStock !== false,
      costo: Number(this.item.costo) || 0,
      precioSugerido: Number(this.item.precioSugerido) || 0,
    };

    const request = this.editingItemId
      ? this.stockService.updateItem(this.editingItemId, payload)
      : this.stockService.createItem(payload);

    request.subscribe({
      next: () => this.router.navigate(['/stock']),
      error: () =>
        this.dialogService.alert({
          title: 'Error',
          message: this.isEditing
            ? 'No se pudo actualizar el producto. Reiniciá el dev server si cambiaste la API.'
            : 'No se pudo guardar el producto. Reiniciá el dev server si cambiaste la API.',
        }),
    });
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

  private loadProduct(itemId: string) {
    this.stockService.getItem(itemId).subscribe({
      next: (product) => {
        this.nombreBase = product.nombreBase?.trim() || product.nombre?.trim() || '';
        this.controlaStock = product.controlaStock !== false;
        this.item = {
          tipo: product.tipo ?? '',
          categoria: product.categoria ?? '',
          talle: product.talle ?? '',
          color: product.color ?? '',
          stockActual: Number(product.stockActual) || 0,
          stockMinimo: Number(product.stockMinimo) || 0,
          costo: Number(product.costo) || 0,
          precioSugerido: Number(product.precioSugerido) || 0,
        };
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el producto.',
        });
        this.router.navigate(['/stock']);
      },
    });
  }
}
