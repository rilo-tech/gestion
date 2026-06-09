import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  CatalogConfigService,
  buildProductDisplayName,
  findPrefijoOwnerForCodigo,
  getPrefijoForCategoria,
  inferNombreBase,
  shouldAutoAssignProductCode,
} from '../../core/services/catalog-config.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { DialogService } from '../../core/services/dialog.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { AuthService } from '../../core/services/auth.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { PERMISSIONS } from '../../core/constants/permissions';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, combineLatest } from 'rxjs';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';
import { FormFooterComponent } from '../../shared/components/form-shell';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { FormBackButtonComponent } from '../../shared/components/form-shell';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import { StockItem, StockService, getStockEnDeposito } from '../../core/services/stock.service';
import {
  FORM_CONTROL_CLASS,
  FORM_LABEL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';

@Component({
  selector: 'app-new-product',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, SearchableSelectComponent, HasPermissionDirective, SelectOnFocusDirective, FormFooterComponent, RecordActionToolbarComponent, FormBackButtonComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-24 sm:pb-32">
      <div class="mb-6 sm:mb-8 grid grid-cols-[1fr_auto] gap-x-3 sm:gap-x-4 gap-y-2 items-start">
        <h1 class="min-w-0 text-xl sm:text-2xl font-bold text-gray-900 leading-tight">
          {{ isEditing ? 'Editar Producto' : 'Nuevo Producto' }}
        </h1>
        <div class="flex items-center justify-end shrink-0 gap-1.5 sm:gap-4">
          <app-record-action-toolbar
            *ngIf="!formReadOnly || isEditing"
            [showSave]="!formReadOnly"
            [saveLabel]="isEditing ? 'Guardar' : 'Guardar producto'"
            [saveDisabled]="saving"
            [saveSuccess]="!!saveSuccessMessage"
            (saveClick)="submitProduct()"
            [showDuplicate]="isEditing && !formReadOnly"
            duplicateLabel="Duplicar producto"
            (duplicateClick)="duplicateProduct()"
            [showDelete]="isEditing && auth.canDeleteRecords"
            deleteLabel="Eliminar producto"
            (deleteClick)="confirmDeleteProduct()">
          </app-record-action-toolbar>
          <app-form-back-button
            [label]="backLabel"
            shortLabel="Volver"
            [ariaLabel]="backLabel"
            (clicked)="onBackClick()">
          </app-form-back-button>
        </div>
        <div class="min-w-0 col-start-1">
          <p *ngIf="!isEditing" class="text-gray-500 text-sm sm:text-base">
            Cargá un producto o insumo para sumarlo al inventario.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2 space-y-6">
          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3 flex items-center gap-2">
              <i-lucide name="package" class="w-4 h-4 text-teal-600"></i-lucide>
              Datos del item
            </h2>
            <div class="space-y-3">
              <div class="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-x-3 lg:gap-y-3">
                <div class="grid grid-cols-3 gap-3 lg:contents">
                  <div class="col-span-2 lg:col-span-5 min-w-0">
                    <label class="block text-sm font-medium text-gray-700 mb-0.5">
                      <span class="lg:hidden">Producto</span>
                      <span class="hidden lg:inline">Nombre</span>
                    </label>
                    <input [(ngModel)]="nombreBase" name="nombreBase" required
                           placeholder="Ej. Remera básica"
                           [class]="formControlClass">
                  </div>

                  <div class="col-span-1 lg:col-span-3 lg:col-start-10 lg:row-start-1 min-w-0">
                    <label class="block text-sm font-medium text-gray-700 mb-0.5">
                      Código
                      <span *ngIf="!item.categoria?.trim()" class="hidden lg:inline text-xs font-normal text-gray-400"> (opcional)</span>
                    </label>
                    <input
                      [(ngModel)]="codigo"
                      name="codigo"
                      placeholder="Opcional, ej. 1001"
                      (ngModelChange)="onCodigoInput()"
                      (blur)="onCodigoBlur()"
                      [readonly]="!usesCodigoEditable"
                      [disabled]="formReadOnly"
                      [class]="formControlClass + ' tabular-nums' + (!usesCodigoEditable ? ' bg-gray-50 text-gray-700' : '')">
                  </div>
                </div>

                <div
                  *ngIf="codigoFieldHint || codigoPrefijoWarning || codigoDuplicadoWarning"
                  class="-mt-1 space-y-0.5 lg:col-span-12 lg:row-start-2">
                  <p *ngIf="codigoFieldHint" class="text-[11px] text-gray-500 leading-snug">
                    {{ codigoFieldHint }}
                  </p>
                  <p *ngIf="codigoPrefijoWarning" class="text-[11px] text-amber-700 leading-snug">
                    {{ codigoPrefijoWarning }}
                  </p>
                  <p *ngIf="codigoDuplicadoWarning" class="text-[11px] text-amber-700 leading-snug">
                    {{ codigoDuplicadoWarning }}
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3 lg:contents">
                  <div class="lg:col-span-4 lg:row-start-3 min-w-0">
                    <label class="block text-sm font-medium text-gray-700 mb-0.5">Color</label>
                    <app-searchable-select
                      [(ngModel)]="item.color"
                      name="color"
                      [options]="colorOptions"
                      placeholder="Buscar color..."
                      plainPlaceholder="Ej. Negro">
                    </app-searchable-select>
                  </div>
                  <div class="lg:col-span-4 lg:row-start-3 min-w-0">
                    <label class="block text-sm font-medium text-gray-700 mb-0.5">Talle</label>
                    <app-searchable-select
                      [(ngModel)]="item.talle"
                      name="talle"
                      [options]="talleOptions"
                      placeholder="Buscar talle..."
                      plainPlaceholder="Ej. M">
                    </app-searchable-select>
                  </div>
                </div>

                <div class="min-w-0 lg:col-span-4 lg:col-start-6 lg:row-start-1">
                  <label class="block text-sm font-medium text-gray-700 mb-0.5">Categoría</label>
                  <app-searchable-select
                    [(ngModel)]="item.categoria"
                    (ngModelChange)="onCategoriaChange($event)"
                    name="categoria"
                    [options]="categoriaOptions"
                    placeholder="Buscar categoría..."
                    plainPlaceholder="Ej. Indumentaria">
                  </app-searchable-select>
                </div>
              </div>
            </div>
          </section>

          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3 flex items-center gap-2">
              <i-lucide name="bar-chart-3" class="w-4 h-4 text-teal-600"></i-lucide>
              Inventario
            </h2>
            <div class="space-y-3">
              <div
                *ngIf="canAdjustStock"
                class="p-3 rounded-lg border border-teal-100 bg-teal-50/40 space-y-2">
                <p class="text-sm font-semibold text-teal-800 leading-tight">Movimiento de stock</p>
                <p class="text-[11px] text-teal-700 leading-snug">
                  Positivo suma, negativo resta. Guardá para registrar.
                </p>
                <div class="flex flex-wrap items-end gap-2">
                  <div class="flex flex-1 min-w-0 items-end gap-2">
                    <div class="shrink-0">
                      <label class="text-xs font-medium text-gray-600 mb-0.5 block">Cantidad</label>
                      <div
                        class="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-primary disabled:opacity-60">
                        <button
                          type="button"
                          (click)="stepStockAdjustmentQty(-1)"
                          [disabled]="adjustingStock"
                          aria-label="Restar una unidad"
                          title="Restar una unidad"
                          class="shrink-0 inline-flex items-center justify-center w-8 text-gray-600 border-r border-gray-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                          <i-lucide name="minus" class="w-3.5 h-3.5"></i-lucide>
                        </button>
                        <input
                          type="number"
                          [(ngModel)]="stockAdjustmentQty"
                          name="stockAdjustmentQty"
                          step="1"
                          [disabled]="adjustingStock"
                          placeholder="5 o -3"
                          class="w-12 px-1.5 py-1.5 text-sm text-center tabular-nums border-0 bg-transparent outline-none disabled:bg-gray-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                        <button
                          type="button"
                          (click)="stepStockAdjustmentQty(1)"
                          [disabled]="adjustingStock"
                          aria-label="Sumar una unidad"
                          title="Sumar una unidad"
                          class="shrink-0 inline-flex items-center justify-center w-8 text-gray-600 border-l border-gray-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                          <i-lucide name="plus" class="w-3.5 h-3.5"></i-lucide>
                        </button>
                      </div>
                    </div>
                    <div class="flex-1 min-w-0">
                      <label class="text-xs font-medium text-gray-600 mb-0.5 block">Motivo (opcional)</label>
                      <input
                        type="text"
                        [(ngModel)]="stockAdjustmentReason"
                        name="stockAdjustmentReason"
                        [disabled]="adjustingStock"
                        placeholder="Ej. Conteo de depósito"
                        [class]="formControlClass">
                    </div>
                  </div>
                  <button
                    type="button"
                    (click)="applyStockAdjustment()"
                    [disabled]="adjustingStock || !canSubmitStockAdjustment"
                    class="w-full sm:w-auto shrink-0 inline-flex items-center justify-center rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed min-h-[34px]">
                    {{ adjustingStock ? 'Guardando…' : 'Guardar' }}
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div *ngIf="showInventoryFields" class="min-w-0">
                  <label
                    class="block text-sm font-medium mb-0.5"
                    [class.text-gray-700]="!isEditing || canEditStockActualInline"
                    [class.text-gray-400]="isEditing && !canEditStockActualInline">
                    {{ isEditing ? 'Stock actual' : 'Stock inicial' }}
                  </label>
                  <input
                    *ngIf="!isEditing || canEditStockActualInline"
                    type="number"
                    [(ngModel)]="item.stockActual"
                    name="stockActual"
                    [min]="permitirStockNegativo ? undefined : 0"
                    [disabled]="formReadOnly"
                    [class]="formControlClass">
                  <div
                    *ngIf="isEditing && !canEditStockActualInline"
                    class="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-100 text-gray-500 font-medium cursor-not-allowed">
                    {{ item.stockActual || 0 }} u.
                  </div>
                </div>
                <div *ngIf="showInventoryFields" class="min-w-0">
                  <label class="block text-sm font-medium text-gray-700 mb-0.5">Stock mínimo</label>
                  <input
                    type="number"
                    [(ngModel)]="item.stockMinimo"
                    name="stockMinimo"
                    min="0"
                    [disabled]="formReadOnly"
                    [class]="formControlClass">
                </div>
                <div class="min-w-0">
                  <label class="block text-sm font-medium text-gray-700 mb-0.5">Costo</label>
                  <input
                    type="number"
                    [(ngModel)]="item.costo"
                    name="costoCompra"
                    min="0"
                    step="0.01"
                    [disabled]="formReadOnly"
                    [class]="formControlClass">
                </div>
              </div>
              <p
                *ngIf="showInventoryFields && isEditing"
                class="text-[11px] text-gray-400 leading-snug">
                <ng-container *ngIf="canEditStockActualInline">Stock inicial: al guardar no genera movimiento. </ng-container>
                <ng-container *ngIf="!canEditStockActualInline">Stock actual: solo por movimientos. </ng-container>
              </p>
              <p class="text-[11px] text-gray-400 leading-snug">
                Costo base del producto al cargarlo en un pedido.
              </p>
              <div class="space-y-3">
                <label class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="controlaStock"
                    (ngModelChange)="onControlaStockChange()"
                    name="controlaStock"
                    [disabled]="formReadOnly"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-primary">
                  <span>
                    <span class="block text-sm font-medium text-gray-700">Genera movimientos</span>
                    <span class="block text-xs text-gray-500 mt-0.5">
                      Controla cantidades. Desmarcá para servicios (estampado, bordado).
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
                      Permite vender sin stock disponible. Desmarcá para bloquearlo.
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
                       [class]="formControlClass">
              </div>
            </div>
          </section>
          <section *ngIf="!auth.canViewStockCosts" class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4">Precio sugerido</h2>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Precio sugerido</label>
              <input type="number" [(ngModel)]="item.precioSugerido" name="precioSugeridoPublic" min="0"
                     [disabled]="formReadOnly"
                     [class]="formControlClass">
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
                <span>{{ formatMoney(item.costo || 0) }}</span>
              </div>
              <div *appHasPermission="permissions.STOCK_VIEW_COSTS" class="border-t border-gray-800 pt-4 flex justify-between font-bold text-lg">
                <span>Valor en stock</span>
                <span>{{ formatMoney(inventoryValue) }}</span>
              </div>
            </div>

            <div class="pt-4 border-t border-gray-800">
              <app-form-footer
                *ngIf="!formReadOnly"
                mode="sidebar"
                [saveLabel]="isEditing ? 'Guardar' : 'Guardar producto'"
                [saving]="saving"
                [successMessage]="saveSuccessMessage"
                theme="dark"
                (saveClick)="submitProduct()">
              </app-form-footer>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class NewProductComponent implements OnInit, OnDestroy {
  readonly formControlClass = FORM_CONTROL_CLASS;
  readonly formLabelClass = FORM_LABEL_CLASS;
  private stockService = inject(StockService);
  configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private navigationBack = inject(NavigationBackService);
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;
  private configSub?: Subscription;
  private routeSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  categoriaOptions: string[] = [];
  talleOptions: string[] = [];
  colorOptions: string[] = [];
  editingItemId: string | null = null;
  /** Contexto de retorno cuando se abre el producto desde otro formulario. */
  private returnTo: string | null = null;
  private returnOrderId: string | null = null;
  saving = false;
  saveSuccessMessage = '';
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  nombreBase = '';
  controlaStock = true;
  permitirStockNegativo = false;
  stockAdjustmentQty: number | null = null;
  stockAdjustmentReason = '';
  adjustingStock = false;
  /** Stock persistido en servidor; define si el campo queda bloqueado (> 0). */
  private persistedStockActual = 0;
  codigo = '';
  savedCodigo = '';
  savedCategoria = '';
  nextCodePreview = '';
  codigoPrefijoWarning = '';
  codigoDuplicadoWarning = '';
  private previewSub?: Subscription;
  private codigoCheckSub?: Subscription;
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

  /** Cuando hay contexto de retorno usamos navegación explícita al origen. */
  get backLabel(): string {
    return this.returnTo === 'orders' ? 'Volver al pedido' : 'Volver al stock';
  }

  onBackClick(): void {
    if (this.returnTo === 'orders') {
      const commands = this.returnOrderId
        ? ['/orders', this.returnOrderId, 'edit']
        : ['/orders/new'];
      this.router.navigate(commands, { queryParams: { restoreDraft: '1' } });
      return;
    }
    this.navigationBack.back(['/stock']);
  }

  /** Conserva el contexto de retorno al refrescar la URL tras guardar. */
  private returnQueryParams(): Record<string, string> | undefined {
    if (this.returnTo !== 'orders') return undefined;
    return {
      returnTo: 'orders',
      ...(this.returnOrderId ? { orderId: this.returnOrderId } : {}),
    };
  }

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.refreshFieldOptions();
    });
    this.catalogConfigServiceLoad();

    this.routeSub = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, query]) => {
      const id = params.get('id');
      const duplicateId = query.get('duplicate');
      this.returnTo = query.get('returnTo');
      this.returnOrderId = query.get('orderId');

      if (id) {
        this.editingItemId = id;
        this.loadProduct(id);
        return;
      }

    this.editingItemId = null;
    this.persistedStockActual = 0;
    if (duplicateId) {
        this.loadProductForDuplicate(duplicateId);
        return;
      }

      this.resetForm();
    });
  }

  private resetForm() {
    this.nombreBase = '';
    this.codigo = '';
    this.savedCodigo = '';
    this.savedCategoria = '';
    this.nextCodePreview = '';
    this.controlaStock = true;
    this.permitirStockNegativo = false;
    this.persistedStockActual = 0;
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

  private refreshFieldOptions() {
    this.categoriaOptions = this.configService.getFieldOptions(this.appConfig, 'productos.categorias');
    this.talleOptions = this.configService.getFieldOptions(this.appConfig, 'productos.talles');
    this.colorOptions = this.configService.getFieldOptions(this.appConfig, 'productos.colores');
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.previewSub?.unsubscribe();
    this.codigoCheckSub?.unsubscribe();
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
  }

  get usesCodigoAutomatico(): boolean {
    return this.appConfig.productos?.codigo?.automatico === true;
  }

  get canAutoAssignCodigo(): boolean {
    if (!this.item.categoria?.trim()) return false;
    return shouldAutoAssignProductCode(
      this.appConfig.productos.codigo,
      this.item.categoria
    );
  }

  get usesCodigoEditable(): boolean {
    if (!this.item.categoria?.trim()) return true;
    return !this.canAutoAssignCodigo;
  }

  get categoriaChanged(): boolean {
    const current = (this.item.categoria ?? '').trim().toLowerCase();
    const saved = this.savedCategoria.trim().toLowerCase();
    return current !== saved;
  }

  /** Al editar, pide confirmación antes de asignar código automático. */
  get needsAutoCodigoConfirmOnSave(): boolean {
    if (!this.item.categoria?.trim()) return false;
    if (!this.isEditing || !this.canAutoAssignCodigo) {
      return false;
    }
    if (this.categoriaChanged) return true;
    return !this.savedCodigo.trim();
  }

  get oldCategoriaHadAutoPrefijo(): boolean {
    const oldCat = this.savedCategoria.trim();
    if (!oldCat || !this.categoriaChanged) return false;
    return Boolean(getPrefijoForCategoria(this.appConfig.productos.codigo, oldCat));
  }

  get codigoFieldHint(): string {
    if (this.canAutoAssignCodigo) {
      if (this.isEditing && this.categoriaChanged) {
        const categoria = this.item.categoria?.trim() ?? '';
        if (!this.savedCategoria.trim()) {
          return this.nextCodePreview
            ? `Al guardar se asignará ${this.nextCodePreview} en «${categoria}».`
            : `Al guardar se generará un código automático en «${categoria}».`;
        }
        return this.nextCodePreview
          ? `Al guardar se reasignará a ${this.nextCodePreview}.`
          : 'Al guardar se reasignará el código automáticamente.';
      }
      if (this.isEditing && this.codigo.trim()) {
        return 'El código se actualiza solo si cambiás la categoría.';
      }
      if (this.nextCodePreview) {
        return `Se asignará al guardar (próximo: ${this.nextCodePreview}).`;
      }
      return 'Se asignará automáticamente al guardar.';
    }
    if (!this.item.categoria?.trim()) {
      return 'Sin categoría: podés dejar el código vacío o ingresarlo a mano.';
    }
    return 'Esta categoría no tiene prefijo: el código es opcional.';
  }

  private refreshCodigoPrefijoWarning() {
    if (!this.usesCodigoEditable) {
      this.codigoPrefijoWarning = '';
      return;
    }
    const codigo = this.codigo.trim();
    if (!codigo) {
      this.codigoPrefijoWarning = '';
      return;
    }
    const conflict = findPrefijoOwnerForCodigo(
      this.appConfig.productos.codigo,
      codigo,
      this.item.categoria?.trim() || undefined
    );
    this.codigoPrefijoWarning = conflict
      ? `El prefijo «${conflict.prefijo}» está asignado a «${conflict.categoria}». Podés usarlo igual.`
      : '';
  }

  private refreshCodigoAvailability() {
    this.codigoCheckSub?.unsubscribe();
    const codigo = this.codigo.trim();
    if (!codigo || !this.usesCodigoEditable) {
      this.codigoDuplicadoWarning = '';
      return;
    }
    if (this.isEditing && codigo === this.savedCodigo) {
      this.codigoDuplicadoWarning = '';
      return;
    }

    this.codigoCheckSub = this.stockService
      .checkCodigoAvailability(codigo, {
        excludeId: this.editingItemId ?? undefined,
        categoria: this.item.categoria?.trim() || undefined,
      })
      .subscribe({
        next: (result) => {
          this.codigoDuplicadoWarning = result.available
            ? ''
            : `El código «${codigo}» ya existe. Podés guardar sin código o elegir otro.`;
          if (result.prefijoConflict) {
            this.codigoPrefijoWarning = `El prefijo «${result.prefijoConflict.prefijo}» está asignado a «${result.prefijoConflict.categoria}». Podés usarlo igual.`;
          }
        },
        error: () => {
          this.codigoDuplicadoWarning = '';
        },
      });
  }

  private refreshCodigoPreview() {
    this.previewSub?.unsubscribe();
    this.nextCodePreview = '';

    if (!this.usesCodigoAutomatico) return;
    if (!this.canAutoAssignCodigo) return;
    if (this.isEditing && this.codigo.trim() && !this.categoriaChanged) return;

    const categoria = this.item.categoria?.trim();
    if (!categoria) return;

    this.previewSub = this.stockService.previewNextCode(categoria).subscribe({
      next: (result) => {
        this.nextCodePreview = result.codigo;
        if (this.canAutoAssignCodigo && !this.usesCodigoEditable) {
          this.codigo = result.codigo;
        }
      },
      error: () => {
        this.nextCodePreview = '';
      },
    });
  }

  get displayName(): string {
    if (!this.nombreBase.trim()) return '';
    return buildProductDisplayName(this.nombreBase, this.item.color, this.item.talle);
  }

  get inventoryValue(): number {
    if (!this.showInventoryFields) return 0;
    return getStockEnDeposito(this.item) * (this.item.costo || 0);
  }

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  get showInventoryFields(): boolean {
    return this.controlaStock;
  }

  /** Solo producto ya guardado en servidor (no en alta inicial sin id). */
  get canAdjustStock(): boolean {
    return !!this.editingItemId && this.showInventoryFields && !this.formReadOnly;
  }

  /** Editable en edición solo si el stock guardado es 0 o negativo (stock inicial). */
  get canEditStockActualInline(): boolean {
    return this.isEditing && this.persistedStockActual <= 0;
  }

  onCategoriaChange(categoria: string) {
    this.codigoDuplicadoWarning = '';
    if (!categoria?.trim() && !this.isEditing) {
      this.codigo = '';
    }
    this.refreshCodigoPrefijoWarning();
    this.refreshCodigoPreview();
  }

  onCodigoInput() {
    this.codigoDuplicadoWarning = '';
    this.refreshCodigoPrefijoWarning();
  }

  onCodigoBlur() {
    this.refreshCodigoAvailability();
  }

  private shouldSendManualCodigo(): boolean {
    if (!this.item.categoria?.trim()) return true;
    return !this.canAutoAssignCodigo;
  }

  onControlaStockChange() {
    if (!this.controlaStock) {
      this.item.stockActual = 0;
      this.item.stockMinimo = 0;
      this.permitirStockNegativo = false;
      return;
    }
    if (this.permitirStockNegativo === undefined) {
      this.permitirStockNegativo = false;
    }
  }

  get canSubmitStockAdjustment(): boolean {
    const delta = Math.floor(Number(this.stockAdjustmentQty) || 0);
    return delta !== 0;
  }

  stepStockAdjustmentQty(step: number): void {
    if (this.adjustingStock) return;
    const parsed = Math.floor(Number(this.stockAdjustmentQty) || 0);
    const hasValue =
      this.stockAdjustmentQty !== null &&
      this.stockAdjustmentQty !== undefined &&
      String(this.stockAdjustmentQty).trim() !== '';
    this.stockAdjustmentQty = hasValue ? parsed + step : step > 0 ? 1 : -1;
  }

  applyStockAdjustment() {
    if (!this.editingItemId || this.adjustingStock) return;

    const delta = Math.floor(Number(this.stockAdjustmentQty) || 0);
    if (delta === 0) {
      this.dialogService.alert({
        title: 'Cantidad inválida',
        message: 'Ingresá un número distinto de 0 (positivo suma, negativo resta).',
      });
      return;
    }
    if (delta < 0 && !this.permitirStockNegativo && (this.item.stockActual || 0) + delta < 0) {
      this.dialogService.alert({
        title: 'Stock insuficiente',
        message: 'Este producto no permite stock negativo.',
      });
      return;
    }

    const motivo = this.stockAdjustmentReason.trim() || 'Ajuste manual desde edición de producto';
    this.adjustingStock = true;
    this.stockService.adjustStock(this.editingItemId, delta, motivo).subscribe({
      next: (result: { newStock?: number }) => {
        this.adjustingStock = false;
        this.item.stockActual = Number(result?.newStock ?? (this.item.stockActual || 0) + delta) || 0;
        this.persistedStockActual = this.item.stockActual;
        this.stockAdjustmentQty = null;
        this.stockAdjustmentReason = '';
        this.stockService.notifyCatalogChanged({
          item: {
            id: this.editingItemId,
            nombre: this.displayName || this.nombreBase,
            tipo: this.item.tipo,
            stockActual: this.item.stockActual,
            costo: this.item.costo,
            controlaStock: this.controlaStock,
          } as StockItem,
        });
        this.showSaveSuccess(`Stock actualizado (${delta > 0 ? '+' : ''}${delta} u.).`);
      },
      error: (err: HttpErrorResponse) => {
        this.adjustingStock = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            (err.error as { error?: string })?.error ??
            'No se pudo registrar el movimiento de stock.',
        });
      },
    });
  }

  submitProduct() {
    if (!this.nombreBase.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del producto',
      });
      return;
    }

    const manualCodigo = this.getManualCodigoForSave();
    if (manualCodigo && this.codigoDuplicadoWarning) {
      this.confirmSaveWithoutCodigo(manualCodigo, () => this.executeSave(true));
      return;
    }

    if (this.needsAutoCodigoConfirmOnSave) {
      this.confirmAutoCodigoAssignment(() => this.executeSave(false));
      return;
    }

    this.executeSave(false);
  }

  private confirmAutoCodigoAssignment(onConfirm: () => void) {
    const categoria = this.item.categoria?.trim() ?? '';
    const preview = this.nextCodePreview || '…';
    const parts: string[] = [];

    if (this.categoriaChanged && !this.savedCategoria.trim()) {
      parts.push(
        `El producto pasará a la categoría «${categoria}» con código ${preview}.`
      );
    } else if (this.categoriaChanged) {
      parts.push(
        `Se reasignará el código a ${preview} en la categoría «${categoria}».`
      );
    } else {
      parts.push(`Se asignará el código ${preview} de la categoría «${categoria}».`);
    }

    if (this.savedCodigo.trim() && this.categoriaChanged) {
      parts.push(`Reemplazará el código actual «${this.savedCodigo}».`);
    }

    if (this.oldCategoriaHadAutoPrefijo) {
      parts.push(
        `Los demás productos de «${this.savedCategoria.trim()}» se renumerarán para cerrar la secuencia.`
      );
    }

    parts.push('¿Continuar?');

    this.dialogService
      .confirm({
        title: 'Asignar código automático',
        message: parts.join(' '),
        confirmLabel: 'Asignar código',
        cancelLabel: 'Cancelar',
      })
      .subscribe((confirmed) => {
        if (confirmed) onConfirm();
      });
  }

  private getManualCodigoForSave(): string {
    return this.shouldSendManualCodigo() ? this.codigo.trim() : '';
  }

  private confirmSaveWithoutCodigo(codigo: string, onConfirm: () => void) {
    this.dialogService
      .confirm({
        title: 'Código en uso',
        message: `El código «${codigo}» ya existe en el catálogo. ¿Guardar el producto sin código?`,
        confirmLabel: 'Guardar sin código',
        cancelLabel: 'Volver',
      })
      .subscribe((confirmed) => {
        if (confirmed) onConfirm();
      });
  }

  private executeSave(omitCodigo: boolean) {
    const controlsStock = this.controlaStock;
    const stockActual = controlsStock ? Number(this.item.stockActual) || 0 : 0;

    if (
      controlsStock &&
      this.isEditing &&
      this.canEditStockActualInline &&
      !this.permitirStockNegativo &&
      stockActual < 0
    ) {
      this.dialogService.alert({
        title: 'Stock inválido',
        message: 'Este producto no permite stock negativo.',
      });
      return;
    }

    const payload: StockItem = {
      tipo: this.item.tipo?.trim() || '',
      nombreBase: this.nombreBase.trim(),
      nombre: buildProductDisplayName(this.nombreBase, this.item.color, this.item.talle),
      categoria: this.item.categoria?.trim() || undefined,
      talle: this.item.talle?.trim() || undefined,
      color: this.item.color?.trim() || undefined,
      stockActual: stockActual,
      stockMinimo: controlsStock ? Number(this.item.stockMinimo) || 0 : 0,
      controlaStock: controlsStock,
      permitirStockNegativo: controlsStock ? this.permitirStockNegativo !== false : false,
      costo: Number(this.item.costo) || 0,
      precioSugerido: Number(this.item.precioSugerido) || 0,
    };

    if (this.shouldSendManualCodigo() && !omitCodigo) {
      payload.codigo = this.codigo.trim() || undefined;
    }

    if (this.formReadOnly) return;

    const manualCodigoSent = Boolean(payload.codigo);
    this.saving = true;
    const autoCodigoAssigned = this.canAutoAssignCodigo && !omitCodigo;
    const request = this.editingItemId
      ? this.stockService.updateItem(this.editingItemId, payload)
      : this.stockService.createItem(payload);

    request.subscribe({
      next: (result) => {
        this.saving = false;
        if (omitCodigo) {
          this.codigo = '';
          this.savedCodigo = '';
          this.codigoDuplicadoWarning = '';
        }
        if (this.editingItemId) {
          const finishEdit = () => {
            this.persistedStockActual = stockActual;
            this.savedCategoria = this.item.categoria?.trim() ?? '';
            this.stockService.notifyCatalogChanged({
              item: { id: this.editingItemId, ...payload },
            });
            this.showSaveSuccess(
              omitCodigo ? 'Cambios guardados (sin código).' : 'Cambios guardados.'
            );
          };

          if (autoCodigoAssigned) {
            this.stockService.getItem(this.editingItemId).subscribe({
              next: (product) => {
                this.applyProductFields(product);
                finishEdit();
              },
              error: () => finishEdit(),
            });
            return;
          }

          finishEdit();
          return;
        }

        this.stockService.notifyCatalogChanged();
        this.showSaveSuccess(
          omitCodigo ? 'Producto guardado (sin código).' : 'Producto guardado.'
        );
        this.router.navigate(['/stock', result.id, 'edit'], {
          replaceUrl: true,
          queryParams: this.returnQueryParams(),
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        const message =
          (err.error as { error?: string })?.error ??
          (this.isEditing
            ? 'No se pudo actualizar el producto. Reiniciá el dev server si cambiaste la API.'
            : 'No se pudo guardar el producto. Reiniciá el dev server si cambiaste la API.');

        if (
          err.status === 409 &&
          manualCodigoSent &&
          !omitCodigo &&
          /c[oó]digo/i.test(message)
        ) {
          this.confirmSaveWithoutCodigo(this.codigo.trim(), () => this.executeSave(true));
          return;
        }

        this.dialogService.alert({
          title: err.status === 409 ? 'Conflicto' : 'Error',
          message,
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
    const cached = this.stockService.peekItem(sourceId);
    if (cached) {
      this.applyProductFields(cached);
      this.codigo = '';
      this.refreshCodigoPreview();
    }

    this.stockService.getItem(sourceId).subscribe({
      next: (product) => {
        this.applyProductFields(product);
        this.codigo = '';
        this.refreshCodigoPreview();
      },
      error: () => {
        if (cached) return;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el producto a duplicar.',
        });
        this.resetForm();
      },
    });
  }

  private loadProduct(itemId: string) {
    const cached = this.stockService.peekItem(itemId);
    if (cached) {
      this.applyProductFields(cached);
    }

    this.stockService.getItem(itemId).subscribe({
      next: (product) => this.applyProductFields(product),
      error: () => {
        if (cached) return;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el producto.',
        });
        this.router.navigate(['/stock']);
      },
    });
  }

  private applyProductFields(product: StockItem) {
    const color = product.color?.trim() ?? '';
    const talle = product.talle?.trim() ?? '';
    let nombreBase = product.nombreBase?.trim() || '';
    if (!nombreBase || nombreBase === product.nombre?.trim()) {
      nombreBase = inferNombreBase(product.nombre ?? '', color, talle);
    }

    this.nombreBase = nombreBase;
    this.codigo = product.codigo?.trim() ?? '';
    this.savedCodigo = this.codigo;
    this.savedCategoria = product.categoria?.trim() ?? '';
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
    this.persistedStockActual = this.item.stockActual;
    this.controlaStock = product.controlaStock !== false;
    this.permitirStockNegativo = product.permitirStockNegativo !== false;
    if (!this.controlaStock) {
      this.permitirStockNegativo = false;
    }
    this.refreshCodigoPreview();
  }
}
