import {
  ChangeDetectorRef,
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
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  usesCashAmbitoSeparation,
  getComprobantesActivos,
  usesComprobantesExtra,
  normalizeComprobanteTipo,
  type PurchaseLineTipo,
  type TarjetaConfig,
  type ComprobanteTipoId,
  type ComprobanteTipoOption,
} from '../../core/services/catalog-config.service';
import {
  CreatePurchasePayload,
  Purchase,
  PurchaseService,
  formatPurchaseNumberBadge,
} from '../../core/services/purchase.service';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionPartySearchComponent } from '../../shared/components/transaction-party-search/transaction-party-search.component';
import { SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';
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
import { Subscription, finalize } from 'rxjs';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import {
  TransactionPartyFieldComponent,
  TransactionNotesFieldComponent,
  TransactionDateFieldComponent,
  TransactionPaymentMedioOption,
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';
import {
  TRANSACTION_COMPACT_FIELD_CLASS,
  TRANSACTION_COMPACT_LABEL_CLASS,
  TRANSACTION_COMPACT_LABEL_INLINE_CLASS,
  TRANSACTION_COMPACT_LABEL_ROW_CLASS,
} from '../../shared/components/transaction-form/transaction-form.constants';
import { todayDateInputValue, toDateInputValue } from '../../core/utils/transaction-date';

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
  enOferta?: boolean;
  descuentoOfertaPct?: number | null;
  /** Costo guardado del producto en stock al momento de agregarlo (referencia para ofertas). */
  costoGuardado?: number;
}

@Component({
  selector: 'app-purchase-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TransactionPartySearchComponent,
    SupplierFormPanelComponent,
    FormFooterComponent,
    TransactionModalComponent,
    TransactionLinesSectionComponent,
    TransactionLinesTableComponent,
    TransactionProductSearchComponent,
    TransactionPartyFieldComponent,
    TransactionNotesFieldComponent,
    TransactionDateFieldComponent,
    TransactionSaveBannerComponent,
  ],
  template: `
    <form (submit)="submitPurchase(); $event.preventDefault()" class="space-y-4">
      <app-transaction-save-banner [message]="saveSuccessMessage"></app-transaction-save-banner>
      <fieldset [disabled]="readOnly" class="space-y-4 border-0 p-0 m-0 min-w-0">
      <div *ngIf="showComprobanteSelector" class="min-w-0">
        <label [class]="fieldLabelClass">Tipo de comprobante</label>
        <select
          [(ngModel)]="tipoComprobante"
          name="purchaseTipoComprobante"
          [disabled]="readOnly"
          [class]="fieldClass + ' bg-white dark:bg-gray-900'">
          <option *ngFor="let option of comprobanteOptions" [ngValue]="option.id">
            {{ option.label }}
          </option>
        </select>
        <p *ngIf="tipoComprobante === 'nota_credito'" class="text-[11px] text-amber-600 dark:text-amber-400 mt-1 m-0 leading-snug">
          Nota de crédito: la mercadería sale del stock (devolución al proveedor).
        </p>
      </div>
      <div class="relative z-50 overflow-visible grid grid-cols-[minmax(0,1fr)_8.5rem] sm:grid-cols-[minmax(0,1fr)_10.5rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_10.5rem] gap-2 sm:gap-4 items-start">
        <div class="min-w-0 overflow-visible">
          <app-transaction-party-field
            label="Proveedor"
            [showCreateAction]="!readOnly"
            createActionLabel="+ Nuevo proveedor"
            (createClick)="openNewSupplierModal()">
            <app-transaction-party-search
              [(ngModel)]="purchaseProveedorId"
              inputName="purchaseProveedorId"
              [labeledOptions]="supplierOptions"
              [fallbackLabel]="readOnly ? (initialPurchase?.proveedor?.trim() || '—') : ''"
              [creatable]="!readOnly"
              [disabled]="readOnly"
              createLabelPrefix="Crear proveedor"
              (partySelected)="onPurchasePartySelected($event)"
              (createRequested)="quickCreateSupplier($event)"
              (searchChange)="pendingSupplierName = $event"
              placeholder="Buscar proveedor..."
              emptyOptionsMessage="Escribí al menos 2 letras para buscar proveedores."
              listHint="Opcional. Escribí para buscar, elegí un proveedor o creá uno nuevo.">
            </app-transaction-party-search>
          </app-transaction-party-field>
        </div>

        <div class="min-w-0 order-3 col-span-2 lg:order-2 lg:col-span-1">
          <label [class]="fieldLabelClass">N° factura del proveedor</label>
          <input
            type="text"
            [(ngModel)]="purchaseNumeroComprobante"
            name="purchaseNumeroComprobante"
            [disabled]="readOnly"
            [class]="fieldClass"
            placeholder="Opcional — ej. 0001-00045678"
            autocomplete="off"
            maxlength="80" />
          <p *ngIf="!readOnly" class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 m-0 leading-snug">
            Comprobante de la factura del proveedor. El n° de compra del sistema se asigna al registrar.
          </p>
        </div>

        <div class="min-w-0 order-2 lg:order-3">
          <app-transaction-date-field
            [date]="purchaseFecha"
            (dateChange)="purchaseFecha = $event"
            fieldName="purchaseFecha"
            label="Fecha"
            [disabled]="readOnly">
          </app-transaction-date-field>
        </div>
      </div>

      <div *ngIf="purchaseSystemNumberLabel" class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 items-start">
        <div class="min-w-0">
          <label [class]="fieldLabelClass">N° compra (sistema)</label>
          <p class="mt-1 text-sm font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
            #{{ purchaseSystemNumberLabel }}
          </p>
        </div>
      </div>

      <app-transaction-lines-section
        title="Productos"
        icon="package"
        [lineCount]="stockLineCount"
        [searchVisible]="!readOnly"
        searchTitle="Agregar productos"
        searchHint="Buscá y hacé clic en un producto para agregarlo a la lista.">
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
          [hideWhenEmpty]="true"
          [lines]="purchaseStockTableLines"
          [columns]="purchaseStockTableColumns"
          [readOnly]="readOnly"
          fieldNamePrefix="purchaseStock"
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
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              <label
                class="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium text-gray-600 select-none cursor-pointer">
                <input
                  type="checkbox"
                  [ngModel]="draftLines[stockLineIndices[index]].enOferta"
                  (ngModelChange)="onLineOfertaToggle(draftLines[stockLineIndices[index]], $event)"
                  [name]="'oferta_' + index"
                  [disabled]="readOnly"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500">
                Compra en oferta (no cambia el costo del producto)
              </label>
              <ng-container *ngIf="draftLines[stockLineIndices[index]].enOferta">
                <span
                  *ngIf="lineIsRealOferta(draftLines[stockLineIndices[index]])"
                  class="text-[10px] sm:text-xs font-semibold text-amber-700">
                  {{ lineOfertaPct(draftLines[stockLineIndices[index]]) }}% menos que tu costo
                  ({{ '$' + lineOfertaCostoGuardado(draftLines[stockLineIndices[index]]) }}/u)
                  · ahorro {{ '$' + lineOfertaAhorro(draftLines[stockLineIndices[index]]) }}
                </span>
                <span
                  *ngIf="!lineIsRealOferta(draftLines[stockLineIndices[index]])"
                  class="text-[10px] sm:text-xs text-gray-400">
                  Poné un costo menor a tu costo guardado para que cuente como oferta
                </span>
              </ng-container>
            </div>
          </ng-template>
        </app-transaction-lines-table>
      </app-transaction-lines-section>

      <app-transaction-lines-section
        title="Gastos y servicios"
        icon="receipt"
        [lineCount]="expenseLineCount"
        [searchVisible]="false">
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
                    <label class="block text-[11px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
                      Importe
                      <span class="font-normal text-gray-400">(− crédito)</span>
                    </label>
                    <input
                      type="number"
                      [(ngModel)]="line.importe"
                      [name]="'importe_' + i"
                      [class]="lineInputClass"
                      placeholder="Ej. −7524">
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

      <div class="space-y-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 items-start">
          <div class="min-w-0">
            <div [class]="paymentLabelRowClass">
              <label [class]="paymentInlineLabelClass">Medio de pago</label>
            </div>
            <select
              [ngModel]="pagoMedioId"
              (ngModelChange)="onPagoMedioChange($event)"
              name="pagoMedioId"
              [disabled]="readOnly"
              [class]="paymentFieldClass + ' bg-white dark:bg-gray-900'">
              <option *ngFor="let option of purchaseMedioOptions" [ngValue]="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div *ngIf="pagoRequiereCuentaVisible" class="min-w-0">
            <div [class]="paymentLabelRowClass">
              <label [class]="paymentInlineLabelClass">Cuenta</label>
            </div>
            <select
              [(ngModel)]="pagoTarjetaId"
              [name]="'purchaseCuenta_' + pagoMedioId"
              [disabled]="readOnly || cuentasPagoList.length === 0"
              [class]="paymentFieldClass + ' bg-white dark:bg-gray-900'">
              <option value="">Seleccionar...</option>
              <option *ngFor="let cuenta of cuentasPagoList" [ngValue]="cuenta.id">
                {{ cuenta.label }}
              </option>
            </select>
            <p
              *ngIf="cuentasPagoList.length === 0"
              class="text-[10px] sm:text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 sm:mt-1 leading-snug">
              Agregá cuentas en Finanzas → Configurar cuentas (medio «{{ pagoMedioLabel }}»).
            </p>
          </div>

          <div *ngIf="pagoGeneraCuotasVisible" class="min-w-0">
            <div [class]="paymentLabelRowClass">
              <label [class]="paymentInlineLabelClass">Cuotas</label>
            </div>
            <input
              type="number"
              [(ngModel)]="pagoCuotas"
              name="pagoCuotas"
              min="1"
              max="120"
              [disabled]="readOnly"
              [class]="paymentFieldClass">
          </div>

          <div *ngIf="pagoGeneraCuotasVisible" class="min-w-0">
            <div [class]="paymentLabelRowClass">
              <label [class]="paymentInlineLabelClass">Primer vencimiento</label>
            </div>
            <input
              type="date"
              [(ngModel)]="pagoFechaPrimerVencimiento"
              name="pagoFechaPrimerVencimiento"
              [disabled]="readOnly"
              [class]="paymentFieldClass">
          </div>
        </div>
        <p
          *ngIf="pagoResumenHintText"
          class="text-[11px] text-gray-500 dark:text-gray-400 leading-snug m-0">
          {{ pagoResumenHintText }}
        </p>
      </div>

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
        *ngIf="!readOnly"
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
  @Input() editingConfirmedId: string | null = null;
  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  readonly saveFeedback = new TransactionSaveFeedback();

  get savingPurchase(): boolean {
    return this.saveFeedback.saving;
  }

  get saveSuccessMessage(): string {
    return this.saveFeedback.successMessage;
  }

  private purchaseService = inject(PurchaseService);
  private supplierService = inject(SupplierService);
  private dialogService = inject(DialogService);
  private catalogConfig = inject(CatalogConfigService);
  private stockService = inject(StockService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  appConfig: AppConfig = DEFAULT_APP_CONFIG;

  suppliers: Supplier[] = [];
  supplierModalOpen = false;
  supplierPrefillNombre = '';
  pendingSupplierName = '';
  creatingSupplier = false;
  savingDraft = false;
  purchaseProveedorId = '';
  purchaseNotas = '';
  purchaseNumeroComprobante = '';
  purchaseFecha = todayDateInputValue();
  tipoComprobante: ComprobanteTipoId = 'factura';
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
  pagoRequiereCuentaVisible = false;
  pagoGeneraCuotasVisible = false;
  pagoResumenHintText = '';
  pagoMedioLabel = '';
  cuentasPagoList: TarjetaConfig[] = [];
  private finanzasPagoConfigKey = '';
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

  get showComprobanteSelector(): boolean {
    return usesComprobantesExtra(this.appConfig);
  }

  get comprobanteOptions(): ComprobanteTipoOption[] {
    return getComprobantesActivos(this.appConfig, 'compras');
  }

  get purchaseMedioOptions(): TransactionPaymentMedioOption[] {
    return this.purchaseMedioOptionsCache;
  }

  get categoriasGasto() {
    return getCategoriasGasto(this.appConfig);
  }

  readonly paymentLabelRowClass = TRANSACTION_COMPACT_LABEL_ROW_CLASS;
  readonly paymentInlineLabelClass = TRANSACTION_COMPACT_LABEL_INLINE_CLASS;

  readonly lineInputClass =
    'w-full px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-gray-200 text-[11px] sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;
  readonly fieldLabelClass = TRANSACTION_COMPACT_LABEL_CLASS;
  readonly paymentFieldClass = TRANSACTION_COMPACT_FIELD_CLASS;

  readonly lineAmbitoBtnClass =
    'inline-flex items-center justify-center rounded-lg border-2 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium min-h-[34px] sm:min-h-[40px] truncate bg-white touch-manipulation select-none';

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
      line.importe = (Number(line.cantidad) || 0) * event.value;
    }
    this.syncPurchaseStockTableLines();
  }

  onLineOfertaToggle(line: PurchaseDraftLine, enabled: boolean): void {
    line.enOferta = enabled;
  }

  private reconstructCostoGuardado(line: PurchaseLine): number {
    const costo = Number(line.costoUnitario) || 0;
    const cantidad = Number(line.cantidad) || 0;
    const ahorro = Number(line.ahorroOferta) || 0;
    if (line.enOferta && cantidad > 0 && ahorro > 0) {
      return Math.round((costo + ahorro / cantidad) * 100) / 100;
    }
    return costo;
  }

  /** True cuando la línea está marcada en oferta y el costo ingresado es menor al guardado. */
  lineIsRealOferta(line: PurchaseDraftLine): boolean {
    if (!line.enOferta) return false;
    const guardado = Number(line.costoGuardado) || 0;
    const costo = Number(line.costoUnitario) || 0;
    return guardado > 0 && costo > 0 && costo < guardado;
  }

  lineOfertaAhorro(line: PurchaseDraftLine): number {
    if (!this.lineIsRealOferta(line)) return 0;
    const guardado = Number(line.costoGuardado) || 0;
    const costo = Number(line.costoUnitario) || 0;
    const cantidad = Number(line.cantidad) || 0;
    return Math.round((guardado - costo) * cantidad * 100) / 100;
  }

  lineOfertaPct(line: PurchaseDraftLine): number {
    if (!this.lineIsRealOferta(line)) return 0;
    const guardado = Number(line.costoGuardado) || 0;
    const costo = Number(line.costoUnitario) || 0;
    return Math.round((1 - costo / guardado) * 100 * 10) / 10;
  }

  lineOfertaCostoGuardado(line: PurchaseDraftLine): number {
    return Math.round((Number(line.costoGuardado) || 0) * 100) / 100;
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

  get selectedMedioPagoLabel(): string {
    return this.pagoMedioLabel || this.pagoMedioId;
  }

  get isDraftMode(): boolean {
    return !!this.editingDraftId || this.initialPurchase?.estado === 'borrador';
  }

  get isEditingConfirmed(): boolean {
    return !!this.editingConfirmedId && !this.isDraftMode;
  }

  /** Número interno de compra (no es la factura del proveedor). */
  get purchaseSystemNumberLabel(): string {
    return formatPurchaseNumberBadge(this.initialPurchase);
  }

  get primarySaveLabel(): string {
    if (this.isEditingConfirmed) return 'Guardar cambios';
    return this.isDraftMode ? 'Confirmar compra' : 'Registrar compra';
  }

  get draftSecondaryLabel(): string {
    if (this.readOnly || this.isEditingConfirmed) return '';
    return 'Guardar borrador';
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
    if (!this.comprobanteOptions.some((option) => option.id === this.tipoComprobante)) {
      this.tipoComprobante = 'factura';
    }
    const finanzasKey = this.buildFinanzasPagoConfigKey();
    const finanzasChanged = finanzasKey !== this.finanzasPagoConfigKey;
    if (finanzasChanged) {
      this.finanzasPagoConfigKey = finanzasKey;
    }
    const medioInvalid = !this.mediosPago.some((medio) => medio.id === this.pagoMedioId);
    if (medioInvalid || finanzasChanged) {
      this.applyPagoMedioState(medioInvalid ? this.resolveDefaultPagoMedioId() : this.pagoMedioId);
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
    this.saveFeedback.destroy();
  }

  private resetForm() {
    this.purchaseProveedorId = this.initialProveedorId.trim();
    this.purchaseNotas = '';
    this.purchaseNumeroComprobante = '';
    this.purchaseFecha = todayDateInputValue();
    this.tipoComprobante = 'factura';
    this.pendingSupplierName = '';
    this.draftLines = [];
    this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
    this.lineCounter = 0;
    this.syncAddedStockProductIds();
    this.syncPurchaseStockTableLines();
  }

  private loadFromPurchase(purchase: Purchase) {
    this.purchaseProveedorId = purchase.proveedorId?.trim() ?? '';
    this.pendingSupplierName = purchase.proveedor?.trim() ?? '';
    this.purchaseNotas = purchase.notas?.trim() ?? '';
    this.purchaseNumeroComprobante = purchase.numeroComprobante?.trim() ?? '';
    this.purchaseFecha = toDateInputValue(purchase.fecha);
    this.tipoComprobante = normalizeComprobanteTipo(purchase.tipoComprobante);
    this.pagoCuotas = purchase.pago?.cuotas ?? 1;
    this.pagoFechaPrimerVencimiento = purchase.pago?.fechaPrimerVencimiento?.slice(0, 10) ?? '';
    this.pagoTarjetaId = purchase.pago?.tarjetaId?.trim() ?? '';
    this.applyPagoMedioState(purchase.pago?.medioPagoId ?? this.resolveDefaultPagoMedioId(), {
      preserveCuotas: true,
      preserveFechaVencimiento: true,
    });

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
          enOferta: line.enOferta === true,
          descuentoOfertaPct: line.descuentoOfertaPct ?? null,
          costoGuardado: this.reconstructCostoGuardado(line),
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
    this.applyPagoMedioState(medioId);
  }

  private applyPagoMedioState(
    medioId: string,
    options?: { preserveCuotas?: boolean; preserveFechaVencimiento?: boolean }
  ): void {
    this.pagoMedioId = medioId;
    const medio = getMedioPagoConfig(this.appConfig, medioId);
    this.pagoMedioLabel = medio?.label ?? medioId;

    const requiereCuenta = this.resolvePagoRequiereCuenta(medio);
    const generaCuotas = this.resolvePagoGeneraCuotas(medio);
    this.cuentasPagoList = requiereCuenta ? getTarjetasForMedio(this.appConfig, medioId) : [];

    if (!requiereCuenta) {
      this.pagoTarjetaId = '';
    } else {
      const cuentaValida = this.cuentasPagoList.some((cuenta) => cuenta.id === this.pagoTarjetaId);
      if (!cuentaValida) {
        this.pagoTarjetaId = this.cuentasPagoList[0]?.id ?? '';
      }
    }

    if (!generaCuotas) {
      if (!options?.preserveCuotas) {
        this.pagoCuotas = 1;
      }
      if (!options?.preserveFechaVencimiento) {
        this.pagoFechaPrimerVencimiento = '';
      }
    } else if (!options?.preserveFechaVencimiento || !this.pagoFechaPrimerVencimiento.trim()) {
      this.pagoFechaPrimerVencimiento = todayDateInputValue();
    }

    this.pagoRequiereCuentaVisible = requiereCuenta;
    this.pagoGeneraCuotasVisible = generaCuotas;
    this.pagoResumenHintText = this.resolvePagoResumenHint(medio, generaCuotas);
    this.cdr.markForCheck();
  }

  private resolvePagoRequiereCuenta(medio: ReturnType<typeof getMedioPagoConfig>): boolean {
    if (!medioPagoRequiereCuentaHija(medio)) return false;
    if (medioPagoGeneratesImmediateCash(medio) && !medioPagoGeneratesPayables(medio)) {
      return false;
    }
    return true;
  }

  private resolvePagoGeneraCuotas(medio: ReturnType<typeof getMedioPagoConfig>): boolean {
    if (!medioPagoGeneratesPayables(medio)) return false;
    if (medioPagoGeneratesImmediateCash(medio) && !medioPagoRequiereCuentaHija(medio)) {
      return false;
    }
    return true;
  }

  private resolvePagoResumenHint(
    medio: ReturnType<typeof getMedioPagoConfig>,
    generaCuotas: boolean
  ): string {
    if (generaCuotas) {
      return 'Las cuotas van a Cuentas a pagar. Podés saldar el resumen mensual después.';
    }
    if (medio?.generaEgresoCaja === true) {
      return 'Al confirmar se registra el egreso en caja.';
    }
    return '';
  }

  private buildFinanzasPagoConfigKey(): string {
    const medios = this.appConfig.finanzas?.mediosPago ?? [];
    const tarjetas = this.appConfig.finanzas?.tarjetas ?? [];
    const medioPart = medios
      .map(
        (medio) =>
          `${medio.id}:${medio.activo === false ? 0 : 1}:${medio.generaEgresoCaja ? 1 : 0}:${medio.generaCuentasPagar ? 1 : 0}:${medio.requiereCuentaHija ? 1 : 0}`
      )
      .join('|');
    const tarjetaPart = tarjetas
      .map((tarjeta) => `${tarjeta.id}:${tarjeta.medioPagoId}:${tarjeta.activa === false ? 0 : 1}`)
      .join('|');
    return `${medioPart}\u0001${tarjetaPart}`;
  }

  private resolveDefaultPagoMedioId(): string {
    if (this.mediosPago.some((medio) => medio.id === 'efectivo')) {
      return 'efectivo';
    }
    return this.mediosPago[0]?.id ?? 'efectivo';
  }

  canRemoveExpenseLine(line: PurchaseDraftLine): boolean {
    const importe = Number(line.importe) || 0;
    const descripcion = (line.descripcion ?? '').trim();
    return importe !== 0 || descripcion.length > 0;
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
        costoGuardado: Number(item.costo) || 0,
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
    if (this.readOnly || this.savingPurchase || this.savingDraft) return;
    this.saveFeedback.clearSuccess();

    if (this.isDraftMode && this.editingDraftId) {
      this.confirmDraft();
      return;
    }

    if (this.isEditingConfirmed && this.editingConfirmedId) {
      this.confirmUpdateConfirmed();
      return;
    }

    this.askOfferDifferenceThen(() => this.proceedCreatePurchase());
  }

  /**
   * Si hay líneas con costo menor al guardado y sin marcar "en oferta", pregunta
   * si guardar la diferencia como ganancia o sobrescribir el costo. Luego ejecuta `proceed`.
   * Si no hay diferencias, ejecuta `proceed` directamente. Si se cancela, no hace nada.
   */
  private askOfferDifferenceThen(proceed: () => void): void {
    const diffLines = this.getOfferDifferenceLines();
    if (diffLines.length === 0) {
      proceed();
      return;
    }

    const detalle = diffLines
      .map((line) => {
        const guardado = Number(line.costoGuardado) || 0;
        const costo = Number(line.costoUnitario) || 0;
        return `• ${line.productoNombre || 'Producto'}: guardado ${this.formatMoneyShort(guardado)} → comprado ${this.formatMoneyShort(costo)}`;
      })
      .join('\n');
    const ahorroTotal = diffLines.reduce((acc, line) => {
      const guardado = Number(line.costoGuardado) || 0;
      const costo = Number(line.costoUnitario) || 0;
      const cantidad = Number(line.cantidad) || 0;
      return acc + (guardado - costo) * cantidad;
    }, 0);

    this.dialogService
      .choose({
        title: 'Precio más bajo que el guardado',
        message: `No marcaste "en oferta" y compraste más barato que el costo guardado:\n\n${detalle}\n\nSi no lo guardás como oferta, se va a SOBRESCRIBIR el costo guardado.\n\nElegí: guardar la diferencia (${this.formatMoneyShort(ahorroTotal)}) como ganancia sin tocar el costo, o sobrescribir el costo.`,
        options: [
          { id: 'ganancia', label: 'Guardar como ganancia (no cambia el costo)' },
          { id: 'costo', label: 'Sobrescribir el costo guardado' },
        ],
        cancelLabel: 'Cancelar',
      })
      .subscribe((choice) => {
        if (!choice) return;
        const asGanancia = choice === 'ganancia';
        diffLines.forEach((line) => (line.enOferta = asGanancia));
        proceed();
      });
  }

  private getOfferDifferenceLines(): PurchaseDraftLine[] {
    return this.draftLines.filter((line) => {
      if (line.tipoLinea !== 'stock' || !line.productoId) return false;
      if (line.enOferta) return false;
      const cantidad = Number(line.cantidad) || 0;
      const costo = Number(line.costoUnitario) || 0;
      const guardado = Number(line.costoGuardado) || 0;
      return cantidad > 0 && costo > 0 && guardado > 0 && costo < guardado;
    });
  }

  private formatMoneyShort(value: number): string {
    return `$${Number(value ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }

  private proceedCreatePurchase() {
    const payload = this.buildPurchasePayload(true);
    if (!payload) return;

    this.setSavingPurchase(true);
    this.purchaseService
      .createPurchase(payload)
      .pipe(finalize(() => this.setSavingPurchase(false)))
      .subscribe({
        next: (result) => {
          this.refreshStockCostsAfterPurchase();
          this.saveFeedback.showSuccessWithDetail('Compra registrada', result.compraLabel);
          this.saved.emit({ id: result.id, label: result.compraLabel, freshSave: true });
        },
        error: (err) => {
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
    this.saveFeedback.clearSuccess();

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
        this.saveFeedback.showSuccess('Borrador guardado');
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

  private confirmUpdateConfirmed() {
    if (!this.editingConfirmedId) return;
    this.askOfferDifferenceThen(() => this.proceedUpdateConfirmed());
  }

  private proceedUpdateConfirmed() {
    if (!this.editingConfirmedId) return;

    const payload = this.buildPurchasePayload(true);
    if (!payload) return;

    const label =
      this.initialPurchase?.compraLabel ||
      (this.initialPurchase?.numeroCompra
        ? String(this.initialPurchase.numeroCompra).padStart(5, '0')
        : this.editingConfirmedId.slice(-6).toUpperCase());

    this.dialogService
      .confirm({
        title: 'Guardar cambios en la compra',
        message: `¿Guardar los cambios en la compra #${label}?\n\nSe ajustarán el stock del depósito, los movimientos de caja y las cuentas a pagar vinculadas a esta compra (según el medio de pago). Si ya pagaste cuotas de tarjeta de esta compra, no podrás editarla.`,
        confirmLabel: 'Guardar cambios',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.setSavingPurchase(true);
        this.purchaseService
          .updatePurchase(this.editingConfirmedId!, payload)
          .pipe(finalize(() => this.setSavingPurchase(false)))
          .subscribe({
            next: (result) => {
              this.refreshStockCostsAfterPurchase();
              this.saveFeedback.showSuccessWithDetail('Compra actualizada', result.compraLabel);
              this.reloadConfirmedPurchase();
              this.saved.emit({ id: result.id, label: result.compraLabel });
            },
            error: (err) => {
              this.dialogService.alert({
                title: 'Error',
                message:
                  typeof err.error?.error === 'string'
                    ? err.error.error
                    : 'No se pudo guardar los cambios de la compra.',
              });
            },
          });
      });
  }

  private confirmDraft() {
    if (!this.editingDraftId) return;
    this.askOfferDifferenceThen(() => this.proceedConfirmDraft());
  }

  private proceedConfirmDraft() {
    if (!this.editingDraftId) return;

    const payload = this.buildPurchasePayload(true);
    if (!payload) return;

    this.setSavingPurchase(true);
    this.purchaseService.createPurchase({ ...payload, draft: true, compraId: this.editingDraftId }).subscribe({
      next: () => {
        this.purchaseService
          .confirmPurchase(this.editingDraftId!)
          .pipe(finalize(() => this.setSavingPurchase(false)))
          .subscribe({
            next: (result) => {
              this.editingDraftId = null;
              this.refreshStockCostsAfterPurchase();
              this.saveFeedback.showSuccessWithDetail('Compra registrada', result.compraLabel);
              this.saved.emit({ id: result.id, label: result.compraLabel, freshSave: true });
            },
            error: (err) => {
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

  private refreshStockCostsAfterPurchase(): void {
    this.stockService.clearListCaches();
    this.stockService.notifyCatalogChanged();
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
            enOferta: line.enOferta === true,
          };
        }

        const importe = Number(line.importe) || 0;
        if (importe === 0 || !line.categoriaId) return null;
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
        message:
          'Agregá al menos una línea con concepto e importe distinto de cero (usá importe negativo para un crédito o devolución en cuotas).',
      });
      return null;
    }

    if (strict && this.pagoRequiereCuentaVisible && !this.pagoTarjetaId.trim()) {
      this.dialogService.alert({
        title: `${this.pagoCuentaLabel} requerida`,
        message: `Seleccioná ${this.pagoCuentaLabel.toLowerCase()} para este medio de pago.`,
      });
      return null;
    }

    if (strict && this.pagoGeneraCuotasVisible && !this.pagoFechaPrimerVencimiento.trim()) {
      this.dialogService.alert({
        title: 'Vencimiento requerido',
        message: 'Indicá la fecha del primer vencimiento.',
      });
      return null;
    }

    return {
      proveedorId: this.purchaseProveedorId.trim() || undefined,
      notas: this.purchaseNotas.trim(),
      numeroComprobante: this.purchaseNumeroComprobante.trim(),
      tipoComprobante: this.tipoComprobante,
      fecha: this.purchaseFecha,
      items,
      pago: {
        medioPagoId: this.pagoMedioId,
        tarjetaId: this.pagoTarjetaId.trim() || undefined,
        cuotas: this.pagoGeneraCuotasVisible ? Math.max(1, Number(this.pagoCuotas) || 1) : 1,
        fechaPrimerVencimiento: this.pagoGeneraCuotasVisible
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

  onPurchasePartySelected(option: SearchableSelectOption) {
    this.purchaseProveedorId = option.value;
    this.pendingSupplierName = option.label;
    if (!this.suppliers.some((supplier) => supplier.id === option.value)) {
      this.suppliers = [{ id: option.value, nombre: option.label }, ...this.suppliers];
    }
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

  private reloadConfirmedPurchase() {
    if (!this.editingConfirmedId) return;
    this.purchaseService.getPurchase(this.editingConfirmedId).subscribe({
      next: (purchase) => this.loadFromPurchase(purchase),
    });
  }

  private setSavingPurchase(value: boolean) {
    if (value) {
      this.saveFeedback.saving = true;
      this.saveFeedback.clearSuccess();
    } else {
      this.saveFeedback.endSave();
    }
    this.savingChange.emit(this.saveFeedback.saving);
  }
}
