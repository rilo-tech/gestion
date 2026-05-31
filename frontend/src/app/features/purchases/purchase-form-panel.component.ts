import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getCategoriasGasto,
  getMedioPagoConfig,
  getMediosPagoActivos,
  getTarjetasForMedio,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  usesCashAmbitoSeparation,
  type PurchaseLineTipo,
} from '../../core/services/catalog-config.service';
import { CreatePurchasePayload, Purchase, PurchaseService } from '../../core/services/purchase.service';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { StockItem } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  SupplierFormPanelComponent,
  SupplierFormSaveEvent,
} from '../suppliers/supplier-form-panel.component';
import { FormFooterComponent } from '../../shared/components/form-shell';
import { TransactionFormSaveEvent } from '../../shared/components/transaction-form/transaction-form.types';
import { TransactionLinesSectionComponent } from '../../shared/components/transaction-lines-section/transaction-lines-section.component';
import { TransactionProductSearchComponent } from '../../shared/components/transaction-product-search/transaction-product-search.component';
import {
  TransactionLinesTableComponent,
  buildTransactionTableColumns,
  PURCHASE_STOCK_TABLE_COLUMNS,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.component';
import { TransactionTableFieldChange, TransactionTableLine } from '../../shared/components/transaction-lines-table/transaction-lines-table.types';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import {
  TransactionPartyFieldComponent,
  TransactionNotesFieldComponent,
  TransactionPaymentSimpleComponent,
  TransactionPaymentMedioOption,
} from '../../shared/components/transaction-form';

interface PurchaseDraftLine {
  id: string;
  tipoLinea: PurchaseLineTipo;
  ambito: string;
  productoId?: string;
  productoNombre?: string;
  cantidad: number | null;
  costoUnitario: number | null;
  categoriaId?: string;
  descripcion?: string;
  importe: number | null;
}

@Component({
  selector: 'app-purchase-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    SupplierFormPanelComponent,
    FormFooterComponent,
    TransactionModalComponent,
    TransactionLinesSectionComponent,
    TransactionLinesTableComponent,
    TransactionProductSearchComponent,
    TransactionPartyFieldComponent,
    TransactionNotesFieldComponent,
    TransactionPaymentSimpleComponent,
  ],
  template: `
    <form (submit)="submitPurchase(); $event.preventDefault()" class="space-y-4">
      <fieldset [disabled]="readOnly || !!completedPurchaseId" class="space-y-4 border-0 p-0 m-0 min-w-0">
      <app-transaction-party-field
        label="Proveedor"
        [showCreateAction]="!readOnly"
        createActionLabel="+ Nuevo proveedor"
        (createClick)="openNewSupplierModal()">
        <app-searchable-select
          [(ngModel)]="purchaseProveedorId"
          name="purchaseProveedorId"
          [labeledOptions]="supplierOptions"
          [fallbackLabel]="readOnly ? (initialPurchase?.proveedor?.trim() || '—') : ''"
          [creatable]="!readOnly"
          [disabled]="readOnly"
          createLabelPrefix="Crear proveedor"
          (createRequested)="quickCreateSupplier($event)"
          (searchChange)="pendingSupplierName = $event"
          placeholder="Buscar proveedor..."
          plainPlaceholder="Opcional"
          emptyOptionsMessage="No hay proveedores cargados. Escribí el nombre para crearlo."
          listHint="Opcional. Elegí un proveedor o creá uno nuevo.">
        </app-searchable-select>
      </app-transaction-party-field>

      <app-transaction-lines-section
        title="Productos"
        icon="package"
        [lineCount]="stockLineCount"
        [searchVisible]="!readOnly"
        searchTitle="Agregar productos"
        searchHint="Buscá y hacé clic en un producto para agregarlo a la lista."
        emptyMessage="Buscá productos arriba y hacé clic en uno para agregarlo acá.">
        <app-transaction-product-search
          search
          *ngIf="!readOnly"
          [selectOnRowClick]="true"
          [showAddButton]="false"
          [addedProductIds]="addedStockProductIds"
          addedLabel="En la compra"
          inputName="purchaseProductSearch"
          (productSelected)="addProductFromSearch($event)">
        </app-transaction-product-search>

        <app-transaction-lines-table
          [lines]="purchaseStockTableLines"
          [columns]="purchaseStockTableColumns"
          [readOnly]="readOnly"
          fieldNamePrefix="purchaseStock"
          emptyMessage="Buscá productos arriba y hacé clic en uno para agregarlo acá."
          (fieldChange)="onPurchaseStockFieldChange($event)"
          (removeLine)="onPurchaseStockRemove($event)">
          <ng-template #metaRow let-line let-index="index">
            <div *ngIf="usesAmbitoSeparation" class="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span class="text-gray-400">Ámbito:</span>
              <button
                *ngFor="let ambito of cajaAmbitos; trackBy: trackCajaAmbitoId"
                type="button"
                (click)="selectLineAmbito(draftLines[stockLineIndices[index]], ambito.id)"
                [attr.aria-pressed]="isLineAmbitoSelected(draftLines[stockLineIndices[index]], ambito.id)"
                class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[10px] sm:text-xs font-medium touch-manipulation select-none"
                [ngClass]="
                  isLineAmbitoSelected(draftLines[stockLineIndices[index]], ambito.id)
                    ? 'border-teal-500 bg-teal-50 text-teal-800 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                ">
                {{ ambito.label }}
              </button>
            </div>
          </ng-template>
        </app-transaction-lines-table>
      </app-transaction-lines-section>

      <app-transaction-lines-section
        title="Gastos y servicios"
        icon="receipt"
        [lineCount]="expenseLineCount"
        [searchVisible]="false"
        emptyMessage="Opcional. Sumá insumos o servicios que no mueven stock.">
        <button
          headerAction
          *ngIf="!readOnly"
          type="button"
          (click)="addExpenseLine()"
          class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0 whitespace-nowrap">
          + Agregar gasto / servicio
        </button>

        <ng-container *ngFor="let line of draftLines; let i = index">
          <div
            *ngIf="line.tipoLinea !== 'stock'"
            class="px-3 sm:px-4 py-2.5 sm:py-3">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0 space-y-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[10px] font-semibold uppercase text-gray-400">Gasto / servicio</span>
                  <span class="text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No mueve stock</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-12 gap-2 sm:gap-3 items-end">
                  <div class="col-span-1 sm:col-span-4">
                    <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Concepto</label>
                    <select
                      [(ngModel)]="line.categoriaId"
                      (ngModelChange)="onLineCategoriaChange(line)"
                      [name]="'cat_' + i"
                      [class]="lineInputClass + ' bg-white'">
                      <option *ngFor="let cat of categoriasGasto" [ngValue]="cat.id">{{ cat.label }}</option>
                    </select>
                  </div>
                  <div class="col-span-1 sm:col-span-3">
                    <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Importe</label>
                    <input
                      type="number"
                      [(ngModel)]="line.importe"
                      [name]="'importe_' + i"
                      min="0"
                      [class]="lineInputClass">
                  </div>
                  <div class="hidden sm:block sm:col-span-4">
                    <label *ngIf="isFirstVisibleLine(i)" class="block text-xs font-medium text-gray-500 mb-1">Descripción</label>
                    <input
                      [(ngModel)]="line.descripcion"
                      [name]="'desc_' + i"
                      placeholder="Detalle opcional"
                      [class]="lineInputClass">
                  </div>
                </div>
                <input
                  [(ngModel)]="line.descripcion"
                  [name]="'desc_m_' + i"
                  placeholder="Detalle opcional"
                  class="sm:hidden w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary">
                <div *ngIf="usesAmbitoSeparation">
                  <span class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Ámbito</span>
                  <div
                    class="grid gap-1.5"
                    [ngClass]="cajaAmbitos.length > 1 ? 'grid-cols-2 max-w-xs' : 'grid-cols-1 max-w-[10rem]'">
                    <button
                      *ngFor="let ambito of cajaAmbitos; trackBy: trackCajaAmbitoId"
                      type="button"
                      (click)="selectLineAmbito(line, ambito.id)"
                      [attr.aria-pressed]="isLineAmbitoSelected(line, ambito.id)"
                      [class]="lineAmbitoBtnClass"
                      [ngClass]="
                        isLineAmbitoSelected(line, ambito.id)
                          ? 'border-teal-500 bg-teal-50 text-teal-800 font-semibold'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      ">
                      {{ ambito.label }}
                    </button>
                  </div>
                </div>
              </div>
              <button
                *ngIf="!readOnly && canRemoveExpenseLine(line)"
                type="button"
                (click)="removeLine(i)"
                class="shrink-0 p-1.5 sm:p-2 rounded-lg text-red-500 hover:bg-red-50 mt-5 sm:mt-0"
                aria-label="Quitar línea">
                <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
              </button>
            </div>
          </div>
        </ng-container>
      </app-transaction-lines-section>

      <app-transaction-payment-simple
        title="Pago"
        [showAmount]="false"
        [method]="pagoMedioId"
        (methodChange)="onPagoMedioChange($event)"
        [medios]="purchaseMedioOptions"
        [methodDisabled]="readOnly"
        methodFieldName="pagoMedioId">
        <ng-container extraFields>
          <div *ngIf="pagoRequiereCuenta">
            <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">{{ pagoCuentaLabel }}</label>
            <select
              [(ngModel)]="pagoTarjetaId"
              name="pagoTarjetaId"
              [class]="lineInputClass + ' bg-white'">
              <option value="">Seleccionar...</option>
              <option *ngFor="let cuenta of cuentasPago" [ngValue]="cuenta.id">{{ cuenta.label }}</option>
            </select>
            <p *ngIf="cuentasPago.length === 0" class="text-[10px] sm:text-[11px] text-amber-600 mt-0.5 sm:mt-1 leading-snug">
              Agregá cuentas en Finanzas → Cuentas vinculadas (medio «{{ pagoMedioConfig?.label }}»).
            </p>
          </div>
          <div *ngIf="pagoGeneraCuotas">
            <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Cuotas</label>
            <input
              type="number"
              [(ngModel)]="pagoCuotas"
              name="pagoCuotas"
              min="1"
              max="120"
              [class]="lineInputClass">
          </div>
          <div *ngIf="pagoGeneraCuotas">
            <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Primer vencimiento</label>
            <input
              type="date"
              [(ngModel)]="pagoFechaPrimerVencimiento"
              name="pagoFechaPrimerVencimiento"
              [class]="lineInputClass">
          </div>
        </ng-container>
        <p footer class="text-[11px] text-gray-500 leading-snug">{{ pagoResumenHint }}</p>
      </app-transaction-payment-simple>

      <app-transaction-notes-field
        [notes]="purchaseNotas"
        (notesChange)="purchaseNotas = $event"
        fieldName="purchaseNotas"
        placeholder="Observaciones de la compra...">
      </app-transaction-notes-field>

      <div *ngIf="!hideInlineSummary" class="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
        <div class="flex justify-between gap-4">
          <span class="text-gray-600">Total estimado</span>
          <span class="font-bold tabular-nums text-teal-700">{{ '$' + draftTotal }}</span>
        </div>
      </div>

      <app-form-footer
        *ngIf="!readOnly && !completedPurchaseId"
        [mode]="pageLayout ? 'inline' : 'modal'"
        [showCancel]="pageLayout"
        [saveLabel]="primarySaveLabel"
        [saving]="savingPurchase"
        [saveDisabled]="savingPurchase"
        [successMessage]="saveSuccessMessage"
        [secondaryActionLabel]="draftSecondaryLabel"
        [secondarySaving]="savingDraft"
        [secondaryActionDisabled]="savingPurchase || savingDraft"
        [footerClass]="pageLayout ? '' : 'purchase-form-footer mt-2 sm:mt-6'"
        (cancelClick)="cancelled.emit()"
        (saveClick)="submitPurchase()"
        (secondaryActionClick)="saveDraft()">
      </app-form-footer>
      <p
        *ngIf="!readOnly && completedPurchaseId && saveSuccessMessage"
        class="text-sm font-medium text-teal-700 dark:text-teal-400 text-right pt-2"
        role="status"
        aria-live="polite">
        {{ saveSuccessMessage }}
      </p>
      </fieldset>
    </form>

    <app-transaction-modal
      *ngIf="!usesInlineFormPage"
      [open]="supplierModalOpen"
      title="Nuevo proveedor"
      subtitle="Al guardar queda seleccionado en esta compra."
      maxWidthClass="max-w-lg"
      (closed)="closeSupplierModal()">
      <app-supplier-form-panel
        *ngIf="supplierModalOpen"
        [prefillNombre]="supplierPrefillNombre"
        (saved)="onSupplierSavedFromModal($event)"
        (cancelled)="closeSupplierModal()">
      </app-supplier-form-panel>
    </app-transaction-modal>
  `,
})
export class PurchaseFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() pageLayout = false;
  @Input() hideInlineSummary = false;
  @Input() readOnly = false;
  @Input() initialProveedorId = '';
  @Input() initialPurchase: Purchase | null = null;
  @Input() editingDraftId: string | null = null;
  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  completedPurchaseId: string | null = null;
  saveSuccessMessage = '';
  private saveSuccessTimeout: ReturnType<typeof setTimeout> | null = null;

  private purchaseService = inject(PurchaseService);
  private supplierService = inject(SupplierService);
  private dialogService = inject(DialogService);
  private catalogConfig = inject(CatalogConfigService);
  private router = inject(Router);

  appConfig: AppConfig = DEFAULT_APP_CONFIG;

  suppliers: Supplier[] = [];
  supplierModalOpen = false;
  supplierPrefillNombre = '';
  pendingSupplierName = '';
  creatingSupplier = false;
  savingPurchase = false;
  savingDraft = false;
  purchaseProveedorId = '';
  purchaseNotas = '';
  draftLines: PurchaseDraftLine[] = [];
  private addedStockProductIdsCache: string[] = [];
  private addedStockProductIdsKey = '';
  private supplierOptionsCache: { value: string; label: string }[] = [];
  private supplierOptionsKey = '';
  private purchaseMedioOptionsCache: TransactionPaymentMedioOption[] = [];
  private purchaseMedioOptionsKey = '';
  private stockLineIndicesCache: number[] = [];
  private purchaseStockTableLinesCache: TransactionTableLine[] = [];
  private purchaseStockTableLinesKey = '';
  pagoMedioId = 'efectivo';
  pagoTarjetaId = '';
  pagoCuotas = 1;
  pagoFechaPrimerVencimiento = '';
  private lineCounter = 0;
  private configSub?: Subscription;

  readonly usesInlineFormPage = prefersInlineFormPage();

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get cajaAmbitos() {
    return getCajaAmbitos(this.appConfig);
  }

  get mediosPago() {
    return getMediosPagoActivos(this.appConfig);
  }

  get purchaseMedioOptions(): TransactionPaymentMedioOption[] {
    return this.purchaseMedioOptionsCache;
  }

  get categoriasGasto() {
    return getCategoriasGasto(this.appConfig);
  }

  get pagoMedioConfig() {
    return getMedioPagoConfig(this.appConfig, this.pagoMedioId);
  }

  get cuentasPago() {
    return getTarjetasForMedio(this.appConfig, this.pagoMedioId);
  }

  get pagoRequiereCuenta(): boolean {
    return medioPagoRequiereCuentaHija(this.pagoMedioConfig);
  }

  get pagoCuentaLabel(): string {
    const id = this.pagoMedioId;
    if (id === 'tarjeta_credito') return 'Tarjeta';
    if (id === 'credito') return 'Línea de crédito';
    return 'Cuenta';
  }

  readonly lineInputClass =
    'w-full px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-gray-200 text-[11px] sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  readonly lineAmbitoBtnClass =
    'inline-flex items-center justify-center rounded-lg border-2 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium min-h-[34px] sm:min-h-[40px] truncate bg-white touch-manipulation select-none';

  get pagoGeneraEgresoCaja(): boolean {
    return this.pagoMedioConfig?.generaEgresoCaja === true;
  }

  get pagoGeneraCuotas(): boolean {
    return medioPagoGeneratesPayables(this.pagoMedioConfig);
  }

  get defaultAmbito(): string {
    return this.cajaAmbitos[0]?.id ?? 'negocio';
  }

  get supplierOptions() {
    return this.supplierOptionsCache;
  }

  get draftTotal(): number {
    return this.draftLines.reduce((acc, line) => acc + this.lineSubtotal(line), 0);
  }

  get draftLineCount(): number {
    return this.draftLines.length;
  }

  get stockLineCount(): number {
    return this.draftLines.filter((line) => line.tipoLinea === 'stock').length;
  }

  get expenseLineCount(): number {
    return this.draftLines.filter((line) => line.tipoLinea !== 'stock').length;
  }

  readonly purchaseStockTableColumns = buildTransactionTableColumns(PURCHASE_STOCK_TABLE_COLUMNS);

  get stockLineIndices(): number[] {
    return this.stockLineIndicesCache;
  }

  get purchaseStockTableLines(): TransactionTableLine[] {
    return this.purchaseStockTableLinesCache;
  }

  onPurchaseStockFieldChange(event: TransactionTableFieldChange): void {
    const draftIndex = this.stockLineIndices[event.index];
    const line = this.draftLines[draftIndex];
    if (!line) return;
    if (event.field === 'quantity') {
      line.cantidad = event.value;
    } else if (event.field === 'unitCost') {
      line.costoUnitario = event.value;
    }
    this.syncPurchaseStockTableLines();
  }

  onPurchaseStockRemove(tableIndex: number): void {
    const draftIndex = this.stockLineIndices[tableIndex];
    if (draftIndex != null) {
      this.removeLine(draftIndex);
    }
  }

  get addedStockProductIds(): string[] {
    return this.addedStockProductIdsCache;
  }

  private syncAddedStockProductIds(): void {
    const key = this.draftLines
      .filter((line) => line.tipoLinea === 'stock')
      .map((line) => line.productoId ?? '')
      .join('\u0001');
    if (key === this.addedStockProductIdsKey) return;
    this.addedStockProductIdsKey = key;
    this.addedStockProductIdsCache = this.draftLines
      .filter((line) => line.tipoLinea === 'stock' && line.productoId)
      .map((line) => line.productoId!);
  }

  isFirstVisibleLine(index: number): boolean {
    const firstStockIndex = this.draftLines.findIndex((line) => line.tipoLinea === 'stock');
    return firstStockIndex >= 0 ? index === firstStockIndex : index === 0;
  }

  get pagoResumenHint(): string {
    if (this.pagoGeneraCuotas) {
      return 'Las cuotas van a Cuentas a pagar. Podés saldar el resumen mensual después.';
    }
    if (this.pagoGeneraEgresoCaja) {
      return 'Al confirmar se registra el egreso en caja.';
    }
    return 'Este medio no genera movimientos automáticos al confirmar.';
  }

  get selectedMedioPagoLabel(): string {
    return this.pagoMedioConfig?.label ?? this.pagoMedioId;
  }

  get isDraftMode(): boolean {
    return !!this.editingDraftId || this.initialPurchase?.estado === 'borrador';
  }

  get primarySaveLabel(): string {
    return this.isDraftMode ? 'Confirmar compra' : 'Registrar compra';
  }

  get draftSecondaryLabel(): string {
    return this.readOnly || this.completedPurchaseId ? '' : 'Guardar borrador';
  }

  private syncSupplierOptions(): void {
    const key = this.suppliers
      .filter((supplier) => supplier.id)
      .map((supplier) => `${supplier.id}\u0001${supplier.nombre}`)
      .join('\u0002');
    if (key === this.supplierOptionsKey) return;
    this.supplierOptionsKey = key;
    this.supplierOptionsCache = this.suppliers
      .filter((supplier) => supplier.id)
      .map((supplier) => ({
        value: supplier.id!,
        label: supplier.nombre,
      }));
  }

  private syncPurchaseMedioOptions(): void {
    const key = this.mediosPago.map((medio) => `${medio.id}\u0001${medio.label}`).join('\u0002');
    if (key === this.purchaseMedioOptionsKey) return;
    this.purchaseMedioOptionsKey = key;
    this.purchaseMedioOptionsCache = this.mediosPago.map((medio) => ({
      value: medio.id,
      label: medio.label,
    }));
  }

  private syncPurchaseStockTableLines(): void {
    const key = this.draftLines
      .map(
        (line, index) =>
          `${index}:${line.tipoLinea}:${line.productoId ?? ''}:${line.cantidad}:${line.costoUnitario}:${line.productoNombre ?? ''}`
      )
      .join('\u0001');
    if (key === this.purchaseStockTableLinesKey) return;
    this.purchaseStockTableLinesKey = key;
    this.stockLineIndicesCache = this.draftLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.tipoLinea === 'stock')
      .map(({ index }) => index);
    this.purchaseStockTableLinesCache = this.stockLineIndicesCache.map((index) => {
      const line = this.draftLines[index];
      return {
        productName: `${line.productoNombre || 'Producto'} · Stock`,
        quantity: line.cantidad,
        unitCost: line.costoUnitario,
        subtotal: (Number(line.cantidad) || 0) * (Number(line.costoUnitario) || 0),
        quantityEditable: !this.readOnly,
        unitCostEditable: !this.readOnly,
        removable: !this.readOnly,
      };
    });
  }

  ngOnInit() {
    this.loadSuppliers();
    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.applyAppConfig(config);
    });
    this.catalogConfig.getAppConfig().subscribe();
    if (this.initialPurchase) {
      this.loadFromPurchase(this.initialPurchase);
    } else {
      this.resetForm();
    }
  }

  private applyAppConfig(config: AppConfig): void {
    this.appConfig = config;
    this.syncPurchaseMedioOptions();
    const nextMedioId = this.mediosPago.some((medio) => medio.id === this.pagoMedioId)
      ? this.pagoMedioId
      : (this.mediosPago[0]?.id ?? 'efectivo');
    if (nextMedioId !== this.pagoMedioId) {
      this.pagoMedioId = nextMedioId;
      this.onMedioPagoChange();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['initialProveedorId'] && !changes['initialProveedorId'].firstChange && !this.readOnly) {
      this.purchaseProveedorId = this.initialProveedorId.trim();
    }
    if (changes['initialPurchase'] && this.initialPurchase) {
      this.loadFromPurchase(this.initialPurchase);
      if (this.initialPurchase.estado === 'borrador' && this.initialPurchase.id) {
        this.editingDraftId = this.initialPurchase.id;
      }
    }
    if (changes['editingDraftId'] && this.editingDraftId && !this.initialPurchase) {
      this.purchaseService.getPurchase(this.editingDraftId).subscribe({
        next: (purchase) => this.loadFromPurchase(purchase),
      });
    }
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
  }

  private resetForm() {
    this.purchaseProveedorId = this.initialProveedorId.trim();
    this.purchaseNotas = '';
    this.pendingSupplierName = '';
    this.draftLines = [];
    this.pagoMedioId = this.mediosPago[0]?.id ?? 'efectivo';
    this.pagoTarjetaId = '';
    this.pagoCuotas = 1;
    this.pagoFechaPrimerVencimiento = '';
    this.lineCounter = 0;
    this.syncAddedStockProductIds();
    this.syncPurchaseStockTableLines();
  }

  private loadFromPurchase(purchase: Purchase) {
    this.purchaseProveedorId = purchase.proveedorId?.trim() ?? '';
    this.pendingSupplierName = purchase.proveedor?.trim() ?? '';
    this.purchaseNotas = purchase.notas?.trim() ?? '';
    this.pagoMedioId = purchase.pago?.medioPagoId ?? this.mediosPago[0]?.id ?? 'efectivo';
    this.pagoTarjetaId = purchase.pago?.tarjetaId ?? '';
    this.pagoCuotas = purchase.pago?.cuotas ?? 1;
    this.pagoFechaPrimerVencimiento = purchase.pago?.fechaPrimerVencimiento?.slice(0, 10) ?? '';
    this.onMedioPagoChange();

    this.draftLines = (purchase.items ?? []).map((line, index) => {
      const tipoLinea = this.resolvePurchaseLineTipo(line);
      if (tipoLinea === 'stock') {
        return {
          id: line.id ?? `line_${index + 1}`,
          tipoLinea: 'stock' as PurchaseLineTipo,
          ambito: line.ambito ?? this.defaultAmbito,
          productoId: line.productoId,
          productoNombre: line.productoNombre,
          cantidad: line.cantidad ?? 0,
          costoUnitario: line.costoUnitario ?? 0,
          importe: line.importe ?? null,
        };
      }
      return {
        id: line.id ?? `line_${index + 1}`,
        tipoLinea,
        ambito: line.ambito ?? this.defaultAmbito,
        categoriaId: line.categoriaId,
        descripcion: line.descripcion,
        importe: line.importe ?? line.subtotal ?? 0,
        cantidad: null,
        costoUnitario: null,
      };
    });

    this.lineCounter = this.draftLines.length;
    this.syncAddedStockProductIds();
    this.syncPurchaseStockTableLines();
  }

  private resolvePurchaseLineTipo(line: Purchase['items'][number]): PurchaseLineTipo {
    const raw = String(line.tipoLinea ?? '').trim().toLowerCase();
    if (raw === 'stock' || raw === 'insumo' || raw === 'servicio' || raw === 'personal') {
      return raw as PurchaseLineTipo;
    }
    return line.productoId ? 'stock' : 'insumo';
  }

  private loadSuppliers() {
    this.supplierService.getSuppliers().subscribe({
      next: (suppliers) => {
        this.suppliers = suppliers;
        this.syncSupplierOptions();
      },
    });
  }

  private lineSubtotal(line: PurchaseDraftLine): number {
    if (line.tipoLinea === 'stock') {
      const qty = Number(line.cantidad) || 0;
      const cost = Number(line.costoUnitario) || 0;
      return qty * cost;
    }
    return Number(line.importe) || 0;
  }

  private nextLineId(): string {
    this.lineCounter += 1;
    return `line_${this.lineCounter}`;
  }

  onPagoMedioChange(medioId: string) {
    if (medioId === this.pagoMedioId) return;
    this.pagoMedioId = medioId;
    this.onMedioPagoChange();
  }

  onMedioPagoChange() {
    if (!this.pagoRequiereCuenta) {
      if (this.pagoTarjetaId !== '') {
        this.pagoTarjetaId = '';
      }
    } else {
      const cuentas = this.cuentasPago;
      const nextTarjetaId = cuentas.some((cuenta) => cuenta.id === this.pagoTarjetaId)
        ? this.pagoTarjetaId
        : (cuentas[0]?.id ?? '');
      if (nextTarjetaId !== this.pagoTarjetaId) {
        this.pagoTarjetaId = nextTarjetaId;
      }
    }
    if (!this.pagoGeneraCuotas) {
      if (this.pagoCuotas !== 1) {
        this.pagoCuotas = 1;
      }
      if (this.pagoFechaPrimerVencimiento !== '') {
        this.pagoFechaPrimerVencimiento = '';
      }
    }
  }

  canRemoveExpenseLine(line: PurchaseDraftLine): boolean {
    const importe = Number(line.importe) || 0;
    const descripcion = (line.descripcion ?? '').trim();
    return importe > 0 || descripcion.length > 0;
  }

  addExpenseLine() {
    const categoria = this.categoriasGasto[0];
    this.draftLines = [
      ...this.draftLines,
      {
        id: this.nextLineId(),
        tipoLinea: this.deriveTipoLineaFromCategoria(categoria?.id),
        ambito: categoria?.ambitoDefault ?? this.defaultAmbito,
        categoriaId: categoria?.id,
        descripcion: '',
        importe: null,
        cantidad: null,
        costoUnitario: null,
      },
    ];
  }

  trackCajaAmbitoId = (_index: number, ambito: { id: string }) => ambito.id;

  selectLineAmbito(line: PurchaseDraftLine, ambitoId: string) {
    line.ambito = ambitoId;
  }

  isLineAmbitoSelected(line: PurchaseDraftLine, ambitoId: string): boolean {
    return line.ambito === ambitoId;
  }

  onLineCategoriaChange(line: PurchaseDraftLine) {
    const categoria = this.categoriasGasto.find((cat) => cat.id === line.categoriaId);
    if (categoria?.ambitoDefault) {
      line.ambito = categoria.ambitoDefault;
    }
    line.tipoLinea = this.deriveTipoLineaFromCategoria(line.categoriaId);
  }

  private deriveTipoLineaFromCategoria(categoriaId?: string): PurchaseLineTipo {
    const id = String(categoriaId ?? '').trim();
    if (id === 'gasto_personal') return 'personal';
    if (id.startsWith('servicios_')) return 'servicio';
    return 'insumo';
  }

  addProductFromSearch(item: StockItem) {
    if (!item.id || this.addedStockProductIds.includes(item.id)) return;

    this.draftLines = [
      ...this.draftLines,
      {
        id: this.nextLineId(),
        tipoLinea: 'stock',
        ambito: this.defaultAmbito,
        productoId: item.id,
        productoNombre: item.nombre,
        cantidad: 1,
        costoUnitario: Number(item.costo) || 0,
        importe: null,
      },
    ];
    this.syncAddedStockProductIds();
    this.syncPurchaseStockTableLines();
  }

  removeLine(index: number) {
    this.draftLines = this.draftLines.filter((_, i) => i !== index);
    this.syncAddedStockProductIds();
    this.syncPurchaseStockTableLines();
  }

  submitPurchase() {
    if (this.readOnly || this.savingPurchase) return;

    if (this.isDraftMode && this.editingDraftId) {
      this.confirmDraft();
      return;
    }

    const payload = this.buildPurchasePayload(true);
    if (!payload) return;

    this.setSavingPurchase(true);
    this.purchaseService.createPurchase(payload).subscribe({
      next: (result) => {
        this.setSavingPurchase(false);
        this.completedPurchaseId = result.id;
        this.showSaveSuccess('Compra registrada');
        this.saved.emit({ id: result.id, label: result.compraLabel });
      },
      error: (err) => {
        this.setSavingPurchase(false);
        const message =
          typeof err.error?.error === 'string'
            ? err.error.error
            : 'No se pudo registrar la compra.';
        this.offerSaveAsDraft(message);
      },
    });
  }

  saveDraft() {
    if (this.readOnly || this.savingDraft || this.savingPurchase) return;

    const payload = this.buildPurchasePayload(false);
    if (!payload) return;

    payload.draft = true;
    if (this.editingDraftId) {
      payload.compraId = this.editingDraftId;
    }

    this.savingDraft = true;
    this.savingChange.emit(true);
    this.purchaseService.createPurchase(payload).subscribe({
      next: (result) => {
        this.savingDraft = false;
        this.savingChange.emit(false);
        this.editingDraftId = result.id;
        this.showSaveSuccess('Borrador guardado');
        this.saved.emit({ id: result.id, label: 'Borrador', draft: true });
      },
      error: (err) => {
        this.savingDraft = false;
        this.savingChange.emit(false);
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo guardar el borrador.',
        });
      },
    });
  }

  private confirmDraft() {
    if (!this.editingDraftId) return;

    const payload = this.buildPurchasePayload(true);
    if (!payload) return;

    this.setSavingPurchase(true);
    this.purchaseService.createPurchase({ ...payload, draft: true, compraId: this.editingDraftId }).subscribe({
      next: () => {
        this.purchaseService.confirmPurchase(this.editingDraftId!).subscribe({
          next: (result) => {
            this.setSavingPurchase(false);
            this.completedPurchaseId = result.id;
            this.editingDraftId = null;
            this.showSaveSuccess('Compra registrada');
            this.saved.emit({ id: result.id, label: result.compraLabel });
          },
          error: (err) => {
            this.setSavingPurchase(false);
            const message =
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo confirmar la compra.';
            this.dialogService.alert({ title: 'Error', message });
          },
        });
      },
      error: (err) => {
        this.setSavingPurchase(false);
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo actualizar el borrador antes de confirmar.',
        });
      },
    });
  }

  private buildPurchasePayload(strict: boolean): CreatePurchasePayload | null {
    const items = this.draftLines
      .map((line) => {
        if (line.tipoLinea === 'stock') {
          const cantidad = Number(line.cantidad) || 0;
          const costoUnitario = Number(line.costoUnitario) || 0;
          if (!line.productoId || cantidad <= 0) return null;
          return {
            id: line.id,
            tipoLinea: line.tipoLinea,
            ambito: line.ambito,
            productoId: line.productoId,
            productoNombre: line.productoNombre,
            cantidad,
            costoUnitario,
            importe: cantidad * costoUnitario,
          };
        }

        const importe = Number(line.importe) || 0;
        if (importe <= 0 || !line.categoriaId) return null;
        return {
          id: line.id,
          tipoLinea: this.deriveTipoLineaFromCategoria(line.categoriaId),
          ambito: line.ambito,
          categoriaId: line.categoriaId,
          descripcion: line.descripcion?.trim() || undefined,
          importe,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (items.length === 0 && strict) {
      this.dialogService.alert({
        title: 'Datos incompletos',
        message: 'Agregá al menos una línea con concepto e importe válidos.',
      });
      return null;
    }

    if (strict && this.pagoRequiereCuenta && !this.pagoTarjetaId.trim()) {
      this.dialogService.alert({
        title: `${this.pagoCuentaLabel} requerida`,
        message: `Seleccioná ${this.pagoCuentaLabel.toLowerCase()} para este medio de pago.`,
      });
      return null;
    }

    if (strict && this.pagoGeneraCuotas && !this.pagoFechaPrimerVencimiento.trim()) {
      this.dialogService.alert({
        title: 'Vencimiento requerido',
        message: 'Indicá la fecha del primer vencimiento.',
      });
      return null;
    }

    return {
      proveedorId: this.purchaseProveedorId.trim() || undefined,
      notas: this.purchaseNotas.trim(),
      items,
      pago: {
        medioPagoId: this.pagoMedioId,
        tarjetaId: this.pagoTarjetaId.trim() || undefined,
        cuotas: this.pagoGeneraCuotas ? Math.max(1, Number(this.pagoCuotas) || 1) : 1,
        fechaPrimerVencimiento: this.pagoGeneraCuotas
          ? this.pagoFechaPrimerVencimiento
          : undefined,
      },
    };
  }

  private offerSaveAsDraft(message: string) {
    this.dialogService
      .confirm({
        title: 'No se pudo registrar',
        message: `${message}\n\n¿Guardar como borrador? No mueve stock ni caja hasta que confirmes.`,
        confirmLabel: 'Guardar borrador',
      })
      .subscribe((confirmed) => {
        if (confirmed) this.saveDraft();
      });
  }

  openNewSupplierModal() {
    const nombre = this.pendingSupplierName.trim();
    if (prefersInlineFormPage()) {
      this.router.navigate(['/suppliers/new'], {
        queryParams: {
          returnTo: 'purchases',
          ...(nombre ? { nombre } : {}),
        },
      });
      return;
    }

    this.supplierPrefillNombre = nombre;
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

  private setSavingPurchase(value: boolean) {
    this.savingPurchase = value;
    this.savingChange.emit(value);
  }

  private showSaveSuccess(message: string) {
    this.saveSuccessMessage = message;
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
    this.saveSuccessTimeout = setTimeout(() => {
      this.saveSuccessMessage = '';
    }, 2500);
  }
}
