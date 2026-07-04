import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  CreateSalePayload,
  SalesService,
  UpdateSalePayload,
  SaleLine,
  SaleLineExtraCost,
} from '../../core/services/sales.service';
import { Client, ClientService } from '../../core/services/client.service';
import { StockItem, StockService, getStockDisponible, itemControlsStock } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionPartySearchComponent } from '../../shared/components/transaction-party-search/transaction-party-search.component';
import { SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from '../clients/client-form-panel.component';
import { FormFooterComponent } from '../../shared/components/form-shell';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { TransactionProductSearchComponent } from '../../shared/components/transaction-product-search/transaction-product-search.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  TransactionLinesTableComponent,
  buildTransactionTableColumns,
  SALE_FORM_TABLE_COLUMNS,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.component';
import {
  TransactionTableFieldChange,
  TransactionTableLine,
  TransactionTableMetaItem,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.types';
import {
  TransactionExtraCostsFormComponent,
  TransactionExtraCost,
} from '../../shared/components/transaction-extra-costs-form/transaction-extra-costs-form.component';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  OrderExtraCostPreset,
  getComprobantesActivos,
  normalizeComprobanteTipo,
  comprobanteConfirmarLabel,
  comprobanteRegistrarLabel,
  comprobanteTipoHint,
  isComprobanteTipoActivo,
  type ComprobanteTipoId,
  type ComprobanteTipoOption,
} from '../../core/services/catalog-config.service';
import { comprobanteLabel } from '../../../../../shared/comprobantes-config.ts';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { Subscription, finalize, take } from 'rxjs';
import {
  readSalesFormDraft,
  saveSalesFormDraft,
  clearSalesFormDraft,
  SalesFormDraftSnapshot,
} from '../../core/utils/form-return-context';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import { TransactionLinesSectionComponent } from '../../shared/components/transaction-lines-section/transaction-lines-section.component';
import {
  TransactionPartyFieldComponent,
  TransactionPaymentSimpleComponent,
  TransactionNotesFieldComponent,
  TransactionDateFieldComponent,
  TransactionSaveFeedback,
  TransactionFormShellComponent,
} from '../../shared/components/transaction-form';
import { TransactionFormSaveEvent } from '../../shared/components/transaction-form/transaction-form.types';
import {
  dateInputToIso,
  todayDateInputValue,
  toDateInputValue,
} from '../../core/utils/transaction-date';
import { sumLineExtraCosts } from '../../core/utils/line-extra-costs';
import {
  esNotaComprobante,
  esNotaCredito,
  normalizeNotaMotivo,
  NOTA_MOTIVO_OPTIONS,
  notaMotivoRequiresProductLines,
  type NotaMotivoId,
} from '../../../../../shared/comprobantes-config.ts';

interface SaleConceptLine {
  descripcion: string;
  cantidad: number | null;
  precioUnitario: number | null;
}

interface SaleDraftLine {
  stockItemId: string;
  nombre?: string;
  cantidad: number | null;
  precioUnitario: number | null;
  costoUnitario: number;
  costosExtra: SaleLineExtraCost[];
  stockDisponible?: number;
  controlaStock?: boolean;
}

@Component({
  selector: 'app-sale-counter-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TransactionPartySearchComponent,
    ClientFormPanelComponent,
    FormFooterComponent,
    TransactionModalComponent,
    TransactionProductSearchComponent,
    TransactionLinesTableComponent,
    TransactionExtraCostsFormComponent,
    TransactionLinesSectionComponent,
    TransactionPartyFieldComponent,
    TransactionPaymentSimpleComponent,
    TransactionNotesFieldComponent,
    TransactionDateFieldComponent,
    TransactionFormShellComponent,
  ],
  template: `
    <app-transaction-form-shell *ngIf="!formShellReady"></app-transaction-form-shell>

    <div *ngIf="formShellReady && isEditing && editingSaleLoading" class="py-8 text-center text-xs sm:text-sm text-gray-400">
      Cargando venta...
    </div>

    <form
      *ngIf="formShellReady && !(isEditing && editingSaleLoading)"
      (submit)="submitSale(); $event.preventDefault()"
      class="space-y-2 sm:space-y-2.5">
      <div
        *ngIf="isDraftSale"
        class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        role="status">
        Borrador guardado. Revisá los datos y usá
        <span class="font-semibold">{{ draftConfirmActionLabel }}</span>
        para descontar stock y registrar el cobro en caja.
      </div>

      <div
        *ngIf="comprobanteTipoHintText"
        class="rounded-lg border border-amber-200/80 bg-amber-50/70 dark:border-amber-800/80 dark:bg-amber-950/25">
        <button
          type="button"
          (click)="comprobanteHintExpanded = !comprobanteHintExpanded"
          [attr.aria-expanded]="comprobanteHintExpanded"
          class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs font-medium text-amber-800 dark:text-amber-200">
          <span>{{ comprobanteTipoHintTitle }}</span>
          <i-lucide
            [name]="comprobanteHintExpanded ? 'chevron-up' : 'chevron-down'"
            class="w-3.5 h-3.5 shrink-0 opacity-80"></i-lucide>
        </button>
        <p
          *ngIf="comprobanteHintExpanded"
          class="m-0 border-t border-amber-200/80 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:border-amber-800/80 dark:text-amber-100/90">
          {{ comprobanteTipoHintText }}
        </p>
      </div>

      <div class="grid grid-cols-3 gap-2 items-start">
        <div class="min-w-0 col-span-2">
          <app-transaction-party-field
            label="Cliente"
            createActionLabel="+ Nuevo cliente"
            (createClick)="goToNewClientForm()">
            <app-transaction-party-search
              [(ngModel)]="saleClienteId"
              name="saleClienteId"
              inputName="saleClienteId"
              [labeledOptions]="clientOptions"
              [fallbackLabel]="selectedSaleClientLabel"
              [creatable]="true"
              createLabelPrefix="Crear cliente"
              (partySelected)="onSalePartySelected($event)"
              (createRequested)="quickCreateClient($event)"
              (searchChange)="pendingClientName = $event"
              placeholder="Buscar cliente..."
              emptyOptionsMessage="Escribí al menos 2 letras para buscar clientes.">
            </app-transaction-party-search>
          </app-transaction-party-field>
        </div>

        <div class="min-w-0 col-span-1">
          <app-transaction-date-field
            [date]="saleFecha"
            (dateChange)="saleFecha = $event"
            fieldName="saleFecha"
            label="Fecha">
          </app-transaction-date-field>
        </div>
      </div>

      <div *ngIf="isNotaComprobanteSelected" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label class="block min-w-0">
          <span class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5 block">Motivo *</span>
          <select
            [(ngModel)]="motivoNota"
            (ngModelChange)="onMotivoNotaChange($event)"
            name="saleMotivoNota"
            class="form-control w-full">
            <option value="">Elegí motivo</option>
            <option *ngFor="let option of notaMotivoOptions" [ngValue]="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label *ngIf="motivoNota === 'otro'" class="block min-w-0 sm:col-span-2">
          <span class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5 block">Descripción del motivo *</span>
          <input
            [(ngModel)]="descripcionMotivoNota"
            name="saleDescripcionMotivoNota"
            class="form-control w-full"
            placeholder="Ej. Ajuste por error de facturación">
        </label>
      </div>

      <app-transaction-lines-section
        *ngIf="showNotaConceptLines"
        title="Importe del ajuste"
        icon="receipt"
        [lineCount]="conceptLines.length"
        [searchVisible]="false">
        <button
          headerAction
          type="button"
          (click)="addConceptLine()"
          class="text-xs font-semibold text-teal-700 hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-300 hover:underline shrink-0 whitespace-nowrap">
          + Agregar línea
        </button>

        <div class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden -mx-0">
          <div class="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
            <article
              *ngFor="let line of conceptLines; let i = index"
              class="p-2 bg-white dark:bg-gray-900/40">
              <div class="flex items-start justify-between gap-1.5">
                <label class="min-w-0 flex-1 block">
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Descripción
                  </span>
                  <input
                    [(ngModel)]="line.descripcion"
                    [name]="'saleConceptDescMobile' + i"
                    [class]="conceptLineTextInputClass + ' mt-1'">
                </label>
                <button
                  *ngIf="canRemoveConceptLine"
                  type="button"
                  (click)="removeConceptLine(i)"
                  class="shrink-0 inline-flex items-center justify-center w-6 h-6 -mr-0.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded touch-manipulation"
                  title="Quitar línea"
                  aria-label="Quitar línea">
                  ×
                </button>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-1.5">
                <label class="min-w-0 block">
                  <span class="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 block text-center">
                    Cant.
                  </span>
                  <input
                    [(ngModel)]="line.cantidad"
                    [name]="'saleConceptQtyMobile' + i"
                    type="number"
                    min="0"
                    step="1"
                    [class]="conceptLineNumericInputClass + ' mt-1'">
                </label>
                <label class="min-w-0 block">
                  <span class="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 block text-center">
                    Precio
                  </span>
                  <input
                    [(ngModel)]="line.precioUnitario"
                    [name]="'saleConceptPriceMobile' + i"
                    type="number"
                    min="0"
                    step="0.01"
                    [class]="conceptLineNumericInputClass + ' mt-1'">
                </label>
              </div>
            </article>
          </div>

          <table class="hidden sm:table app-data-table w-full table-fixed text-left text-sm">
            <thead class="bg-gray-50 dark:bg-gray-800/80 text-xs uppercase text-gray-400 dark:text-gray-500">
              <tr>
                <th class="px-3 sm:px-4 py-2.5 whitespace-nowrap text-left">Descripción</th>
                <th class="w-[12%] px-3 sm:px-4 py-2.5 whitespace-nowrap text-center">Cant.</th>
                <th class="w-[16%] px-3 sm:px-4 py-2.5 whitespace-nowrap text-center">Precio u.</th>
                <th *ngIf="canRemoveConceptLine" class="w-[10%] px-3 sm:px-4 py-2.5 text-center"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
              <tr *ngFor="let line of conceptLines; let i = index">
                <td class="px-3 sm:px-4 py-2.5 align-top">
                  <input
                    [(ngModel)]="line.descripcion"
                    [name]="'saleConceptDesc' + i"
                    [class]="conceptLineTextInputClass">
                </td>
                <td class="px-3 sm:px-4 py-2.5 align-top text-center">
                  <input
                    [(ngModel)]="line.cantidad"
                    [name]="'saleConceptQty' + i"
                    type="number"
                    min="0"
                    step="1"
                    [class]="conceptLineNumericInputClass">
                </td>
                <td class="px-3 sm:px-4 py-2.5 align-top text-center">
                  <input
                    [(ngModel)]="line.precioUnitario"
                    [name]="'saleConceptPrice' + i"
                    type="number"
                    min="0"
                    step="0.01"
                    [class]="conceptLineNumericInputClass">
                </td>
                <td *ngIf="canRemoveConceptLine" class="px-3 sm:px-4 py-2.5 align-top text-center">
                  <button
                    type="button"
                    (click)="removeConceptLine(i)"
                    class="inline-flex items-center justify-center w-7 h-7 text-base text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                    title="Quitar línea"
                    aria-label="Quitar línea">
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </app-transaction-lines-section>

      <app-transaction-lines-section
        *ngIf="showSaleProductLines"
        title="Productos"
        icon="package"
        [lineCount]="draftLines.length"
        [searchVisible]="true"
        searchTitle="Agregar productos"
        searchHint="Buscá y hacé clic en un producto para agregarlo a la lista.">
        <app-transaction-product-search
          search
          [selectOnRowClick]="true"
          [showAddButton]="false"
          [showBaseCost]="false"
          [addedProductIds]="addedSaleProductIds"
          addedLabel="En la venta"
          [itemMeta]="saleSearchResultSubtitle"
          inputName="saleProductSearch"
          (productSelected)="onSaleProductSelected($event)"
          (productQuantitySelected)="onSaleProductQuantitySelected($event)">
        </app-transaction-product-search>

        <app-transaction-lines-table
          #saleLinesTable
          [hideWhenEmpty]="true"
          [lines]="saleTableLines"
          [columns]="saleTableColumns"
          fieldNamePrefix="saleLine"
          (fieldChange)="onSaleTableFieldChange($event)"
          (removeLine)="removeLine($event)"
          (productClick)="onSaleTableProductClick($event)"
          (metaAction)="onSaleTableMetaAction($event)">
        </app-transaction-lines-table>
      </app-transaction-lines-section>

      <div *ngIf="!hideInlineSummary" class="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1 text-sm">
        <div class="flex justify-between">
          <span class="text-gray-600">Total venta</span>
          <span class="font-bold tabular-nums">{{ formatMoney(draftTotal) }}</span>
        </div>
        <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-gray-500">
          <span>Costo estimado</span>
          <span class="tabular-nums">{{ formatMoney(draftCostTotal) }}</span>
        </div>
        <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-teal-700 font-medium">
          <span>Ganancia estimada</span>
          <span class="tabular-nums">{{ formatMoney(draftProfitTotal) }}</span>
        </div>
      </div>

      <app-transaction-payment-simple
        [amount]="montoCobrado"
        (amountChange)="montoCobrado = $event"
        [method]="medioPago"
        (methodChange)="medioPago = $event"
        [amountLabel]="paymentAmountLabel"
        [amountDisabled]="isEditing && editHasExtraCobros"
        [methodDisabled]="isEditing && editHasExtraCobros"
        [hasAmountFooter]="true">
        <div amountFooter>
          <p *ngIf="montoCobradoError" class="text-[10px] sm:text-xs text-red-600 mt-1">
            {{ montoCobradoError }}
            <button
              *ngIf="montoCobradoExceedsMax"
              type="button"
              (click)="useMaxMontoCobrado()"
              class="ml-1 font-semibold text-teal-700 hover:underline">
              Usar \${{ maxMontoCobrado }}
            </button>
          </p>
        </div>
      </app-transaction-payment-simple>

      <app-transaction-notes-field
        [notes]="saleNotas"
        (notesChange)="saleNotas = $event"
        fieldName="saleNotas">
      </app-transaction-notes-field>

      <app-form-footer
        [mode]="pageLayout ? 'inline' : 'modal'"
        [showCancel]="pageLayout"
        [saveLabel]="primaryLabel"
        [saving]="savingSale"
        [saveDisabled]="savingSale || savingDraft"
        [successMessage]="saveSuccessMessage"
        [secondaryActionLabel]="draftSecondaryLabel"
        [secondarySaving]="savingDraft"
        [secondaryActionDisabled]="savingSale || savingDraft"
        [footerClass]="pageLayout ? '' : 'mt-6 pt-2'"
        (cancelClick)="cancelled.emit()"
        (saveClick)="submitSale()"
        (secondaryActionClick)="saveDraft()">
      </app-form-footer>
    </form>

    <app-transaction-modal
      [open]="extraCostsModalIndex !== null && !!extraCostsModalLine"
      title="Costos de personalización"
      [subtitle]="extraCostsModalLine ? getDraftLineName(extraCostsModalLine) : ''"
      maxWidthClass="max-w-lg"
      zIndexClass="z-[60]"
      [compact]="true"
      (closed)="cancelExtraCostsModal()">
      <app-transaction-extra-costs-form
        *ngIf="extraCostsModalLine as modalLine"
        [presets]="saleExtraCostPresets"
        [initialCosts]="modalLine.costosExtra"
        inputNamePrefix="saleExtraCost"
        priceLabel="Costo/u."
        totalLabel="Total extras"
        (accepted)="acceptExtraCostsModal($event)">
      </app-transaction-extra-costs-form>
    </app-transaction-modal>

    <app-transaction-modal
      *ngIf="!usesInlineFormPage"
      [open]="clientModalOpen"
      title="Nuevo cliente"
      subtitle="Al guardar queda seleccionado en esta venta."
      maxWidthClass="max-w-lg"
      zIndexClass="z-[60]"
      (closed)="closeClientModal()">
      <app-client-form-panel
        [prefillNombre]="clientModalPrefillNombre"
        [showHistorialLink]="false"
        (saved)="onClientSavedFromModal($event)"
        (cancelled)="closeClientModal()">
      </app-client-form-panel>
    </app-transaction-modal>
  `,
})
export class SaleCounterFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() editingSaleId: string | null = null;
  @Input() pageLayout = false;
  @Input() hideInlineSummary = false;
  /** Tipo fijado al crear (desde menú +). Ignorado al editar o restaurar borrador. */
  @Input() lockedTipoComprobante: ComprobanteTipoId | null = null;
  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();
  @Output() formReadyChange = new EventEmitter<boolean>();

  readonly saveFeedback = new TransactionSaveFeedback();

  readonly auth = inject(AuthService);
  readonly usesInlineFormPage = prefersInlineFormPage();

  @ViewChild('saleLinesTable') saleLinesTable?: TransactionLinesTableComponent;

  private salesService = inject(SalesService);
  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private catalogConfig = inject(CatalogConfigService);

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  private configSub?: Subscription;

  clients: Client[] = [];
  private clientOptionsCache: SearchableSelectOption[] = [];
  private comprobanteOptionsCache: ComprobanteTipoOption[] = [];
  private clientsLoading = false;
  private clientsLoaded = false;
  private pendingClientFetchId: string | null = null;
  private afterClientsLoad: Array<() => void> = [];
  selectedSaleClientLabel = '';
  stockItems: StockItem[] = [];
  private addedSaleProductIdsCache: string[] = [];
  private addedSaleProductIdsKey = '';
  saleTableLines: TransactionTableLine[] = [];
  saleTableColumns = buildTransactionTableColumns(SALE_FORM_TABLE_COLUMNS, {
    personalization: false,
  });
  savingDraft = false;

  get savingSale(): boolean {
    return this.saveFeedback.saving;
  }

  get saveSuccessMessage(): string {
    return this.saveFeedback.successMessage;
  }
  isDraftSale = false;
  private activeDraftId: string | null = null;
  editingSaleLabel = '';
  editHasExtraCobros = false;
  editingSaleLoading = false;
  formShellReady = false;

  saleClienteId = '';
  pendingClientName = '';
  creatingClient = false;
  clientModalOpen = false;
  clientModalPrefillNombre = '';
  draftLines: SaleDraftLine[] = [];
  montoCobrado: number | null = null;
  medioPago = 'efectivo';
  saleNotas = '';
  saleFecha = todayDateInputValue();
  tipoComprobante: ComprobanteTipoId = 'factura';
  motivoNota: NotaMotivoId | '' = '';
  descripcionMotivoNota = '';
  comprobanteHintExpanded = false;
  conceptLines: SaleConceptLine[] = [{ descripcion: '', cantidad: 1, precioUnitario: null }];

  readonly notaMotivoOptions = NOTA_MOTIVO_OPTIONS;
  readonly conceptLineTextInputClass =
    'w-full min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm leading-snug outline-none focus:ring-2 focus:ring-teal-500';
  readonly conceptLineNumericInputClass =
    'w-full min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm leading-tight tabular-nums text-center outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  extraCostsModalIndex: number | null = null;

  get canEditSaleLineCosts(): boolean {
    return this.auth.canEditPersonalization || this.auth.canCreateSales;
  }

  get saleExtraCostPresets(): OrderExtraCostPreset[] {
    return this.appConfig.pedidos?.costosExtraPredeterminados ?? [];
  }

  get comprobanteTipoHintText(): string | null {
    return comprobanteTipoHint(this.tipoComprobante, 'ventas');
  }

  get comprobanteTipoHintTitle(): string {
    return `Ayuda · ${comprobanteLabel(this.tipoComprobante)}`;
  }

  get draftConfirmActionLabel(): string {
    return comprobanteConfirmarLabel(this.tipoComprobante, 'ventas');
  }

  private get defaultTipoComprobante(): ComprobanteTipoId {
    const locked = this.lockedTipoComprobante;
    if (locked && isComprobanteTipoActivo(this.appConfig.comprobantes, locked)) {
      return locked;
    }
    return 'factura';
  }

  private rebuildComprobanteOptions(): void {
    this.comprobanteOptionsCache = getComprobantesActivos(this.appConfig, 'ventas');
  }

  get isNotaComprobanteSelected(): boolean {
    return esNotaComprobante(this.tipoComprobante);
  }

  get showSaleProductLines(): boolean {
    if (!this.isNotaComprobanteSelected) return true;
    return notaMotivoRequiresProductLines(this.motivoNota);
  }

  get showNotaConceptLines(): boolean {
    return (
      this.isNotaComprobanteSelected &&
      !!this.motivoNota &&
      !notaMotivoRequiresProductLines(this.motivoNota)
    );
  }

  get canRemoveConceptLine(): boolean {
    return this.conceptLines.length > 1;
  }

  get paymentAmountLabel(): string {
    return esNotaCredito(this.tipoComprobante) ? 'Monto a devolver ahora' : 'Monto a cobrar ahora';
  }

  get isEditing(): boolean {
    return !!this.editingSaleId;
  }

  get primaryLabel(): string {
    if (this.isDraftSale) return comprobanteConfirmarLabel(this.tipoComprobante, 'ventas');
    if (this.isEditing) return 'Guardar cambios';
    return comprobanteRegistrarLabel(this.tipoComprobante, 'ventas');
  }

  get draftSecondaryLabel(): string {
    if (this.isEditing && !this.isDraftSale) return '';
    return 'Guardar borrador';
  }

  get canDuplicateCurrent(): boolean {
    return (
      this.auth.canCreateSales &&
      this.draftLines.some((line) => (Number(line.cantidad) || 0) > 0)
    );
  }

  private get draftId(): string | null {
    return this.editingSaleId ?? this.activeDraftId;
  }

  get clientOptions(): SearchableSelectOption[] {
    return this.clientOptionsCache;
  }

  private rebuildClientOptions(): void {
    this.clientOptionsCache = this.clients
      .filter((client) => client.id)
      .map((client) => ({ value: client.id!, label: client.nombre }));
  }

  private setClients(items: Client[]): void {
    this.clients = items;
    this.rebuildClientOptions();
  }

  get addedSaleProductIds(): string[] {
    return this.addedSaleProductIdsCache;
  }

  private syncAddedSaleProductIds() {
    const key = this.draftLines.map((line) => line.stockItemId).join('\u0001');
    if (key === this.addedSaleProductIdsKey) return;
    this.addedSaleProductIdsKey = key;
    this.addedSaleProductIdsCache = this.draftLines
      .map((line) => line.stockItemId)
      .filter((id): id is string => !!id);
  }

  saleSearchResultSubtitle = (item: StockItem): string => {
    const parts: string[] = [];
    if (this.auth.canViewStockCosts) {
      parts.push(`Costo: $${item.costo || 0}`);
    }
    const suggested = Number(item.precioSugerido);
    if (suggested > 0) {
      parts.push(`Precio sugerido: $${suggested}`);
    }
    parts.push(`Disponible: ${getStockDisponible(item)} u.`);
    return parts.join(' · ');
  };

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  get draftTotal(): number {
    const productTotal = this.showSaleProductLines
      ? this.draftLines.reduce((acc, line) => {
          const qty = Number(line.cantidad) || 0;
          const price = Number(line.precioUnitario) || 0;
          return acc + qty * price;
        }, 0)
      : 0;
    const conceptTotal = this.showNotaConceptLines
      ? this.conceptLines.reduce((acc, line) => {
          const qty = Number(line.cantidad) || 0;
          const price = Number(line.precioUnitario) || 0;
          return acc + qty * price;
        }, 0)
      : 0;
    return productTotal + conceptTotal;
  }

  get draftCostTotal(): number {
    if (!this.showSaleProductLines) return 0;
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const base = qty * (Number(line.costoUnitario) || 0);
      return acc + base + this.getLinePersTotal(line);
    }, 0);
  }

  get draftProfitTotal(): number {
    return Math.round((this.draftTotal - this.draftCostTotal) * 100) / 100;
  }

  get saldoPendienteEstimado(): number {
    const total = this.draftTotal;
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto)) return total;
    return Math.max(0, Math.round((total - monto) * 100) / 100);
  }

  get maxMontoCobrado(): number {
    return this.draftTotal;
  }

  get montoCobradoExceedsMax(): boolean {
    if (this.isEditing && this.editHasExtraCobros) return false;
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto)) return false;
    return monto > this.maxMontoCobrado;
  }

  get montoCobradoError(): string | null {
    if (this.isEditing && this.editHasExtraCobros) return null;
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      return 'Ingresá un monto a cobrar válido.';
    }
    if (this.montoCobradoExceedsMax) {
      return `El monto no puede superar el total de la venta ($${this.maxMontoCobrado}).`;
    }
    return null;
  }

  get extraCostsModalLine(): SaleDraftLine | null {
    if (this.extraCostsModalIndex === null) return null;
    return this.draftLines[this.extraCostsModalIndex] ?? null;
  }

  ngOnInit() {
    this.rebuildComprobanteOptions();
    this.saleTableColumns = buildTransactionTableColumns(SALE_FORM_TABLE_COLUMNS, {
      personalization: this.canEditSaleLineCosts,
    });

    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.rebuildComprobanteOptions();
      if (!this.editingSaleId && !this.isDraftSale) {
        if (!this.comprobanteOptionsCache.some((option) => option.id === this.tipoComprobante)) {
          this.tipoComprobante = this.defaultTipoComprobante;
        }
      }
    });

    this.catalogConfig
      .ensureAppConfigLoaded()
      .pipe(take(1))
      .subscribe(() => {
        this.formShellReady = true;
        queueMicrotask(() => this.formReadyChange.emit(true));
        this.bootstrapSaleForm();
      });
  }

  private bootstrapSaleForm(): void {
    if (!this.auth.canCreateSales) return;

    this.ensureClientsLoaded();
    this.stockService.getStock().subscribe((items) => (this.stockItems = items));

    if (readSalesFormDraft()) {
      return;
    }

    if (this.editingSaleId) {
      this.loadEditingSale(this.editingSaleId);
    } else {
      this.resetNewSaleForm();
    }
  }

  private ensureClientsLoaded(afterLoad?: () => void): void {
    if (afterLoad) {
      if (this.clientsLoaded) {
        afterLoad();
        return;
      }
      this.afterClientsLoad.push(afterLoad);
    }
    if (this.clientsLoading || this.clientsLoaded) return;

    this.clientsLoading = true;
    this.clientService.getClientsPage(120, undefined, { soloActivos: true }).subscribe({
      next: (page) => {
        this.setClients(page.items);
        this.clientsLoaded = true;
        this.clientsLoading = false;
        const callbacks = this.afterClientsLoad.splice(0);
        this.syncSaleClientLabel();
        callbacks.forEach((callback) => callback());
      },
      error: () => {
        this.clientsLoading = false;
        this.afterClientsLoad.splice(0);
      },
    });
  }

  private refreshClientsList(afterLoad?: () => void): void {
    this.clientsLoaded = false;
    this.clientsLoading = false;
    this.ensureClientsLoaded(afterLoad);
  }

  private syncSaleClientLabel(): void {
    this.ensureSaleClient(
      this.saleClienteId,
      this.selectedSaleClientLabel || this.pendingClientName
    );
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.saveFeedback.destroy();
    this.formReadyChange.emit(false);
  }

  private applyFreshSaveSuccess(id: string, label: string | undefined, message: string) {
    this.saveFeedback.markSkipReload(id);
    this.editingSaleLabel = label || '';
    this.isDraftSale = false;
    this.activeDraftId = null;
    this.saveFeedback.showSuccessWithDetail(message, label);
    this.saved.emit({ id, label, freshSave: true });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (
      changes['lockedTipoComprobante'] &&
      !changes['lockedTipoComprobante'].firstChange &&
      !this.editingSaleId &&
      !this.isDraftSale &&
      !readSalesFormDraft()
    ) {
      this.tipoComprobante = this.defaultTipoComprobante;
    }

    if (!changes['editingSaleId'] || changes['editingSaleId'].firstChange) return;

    if (!this.editingSaleId) {
      if (readSalesFormDraft()) return;
      this.resetNewSaleForm();
      return;
    }

    if (this.saveFeedback.consumeSkipReload(this.editingSaleId)) {
      return;
    }

    this.loadEditingSale(this.editingSaleId);
  }

  restoreFromSessionDraft(clienteId: string | null) {
    const draft = readSalesFormDraft();
    if (!draft) return;

    this.applyDraftSnapshot(draft, clienteId);
    clearSalesFormDraft();
  }

  applyDraftSnapshot(draft: SalesFormDraftSnapshot, clienteId: string | null = null) {
    this.saleClienteId = draft.saleClienteId;
    this.pendingClientName = draft.pendingClientName;
    this.selectedSaleClientLabel = draft.pendingClientName?.trim() || this.selectedSaleClientLabel;
    this.draftLines = draft.draftLines.length
      ? structuredClone(draft.draftLines)
      : [];
    this.syncAddedSaleProductIds();
    this.rebuildSaleTableLines();
    this.montoCobrado = draft.montoCobrado;
    this.medioPago = draft.medioPago;
    this.saleNotas = draft.saleNotas;
    if (draft.saleFecha) {
      this.saleFecha = draft.saleFecha;
    }
    if (draft.tipoComprobante) {
      this.tipoComprobante = draft.tipoComprobante as ComprobanteTipoId;
    }
    this.editingSaleLabel = draft.editingSaleLabel;
    this.editHasExtraCobros = draft.editHasExtraCobros;
    this.isDraftSale = false;
    this.activeDraftId = null;

    if (clienteId) {
      this.saleClienteId = clienteId;
      this.pendingClientName = '';
    }

    this.ensureClientsLoaded(() => this.syncSaleClientLabel());
  }

  goToNewClientForm() {
    if (!this.auth.canCreateSales) return;

    this.saveSalesFormDraftForReturn();

    const nombre = this.pendingClientName.trim();
    this.router.navigate(['/clients/new'], {
      queryParams: {
        ...(nombre ? { nombre } : {}),
        returnTo: 'sales',
      },
    });
  }

  duplicateCurrentSale() {
    if (!this.canDuplicateCurrent) return;

    if (!this.editingSaleId) {
      this.editingSaleLabel = '';
      this.editHasExtraCobros = false;
      this.isDraftSale = false;
      this.activeDraftId = null;
      this.saleNotas = '';
      if (this.montoCobrado == null) {
        this.montoCobrado = this.draftTotal;
      }
      return;
    }

    saveSalesFormDraft({
      saleModalMode: 'mostrador',
      saleModalOpen: false,
      saleClienteId: this.saleClienteId,
      pendingClientName: this.pendingClientName,
      draftLines: structuredClone(this.draftLines),
      selectedOrderId: '',
      montoCobrado: this.montoCobrado ?? this.draftTotal,
      medioPago: this.medioPago,
      saleNotas: '',
      saleFecha: this.saleFecha,
      tipoComprobante: this.tipoComprobante,
      editingSaleId: null,
      editingSaleLabel: '',
      editHasExtraCobros: false,
      orderFilterClienteId: '',
    });

    this.router.navigate(['/sales/new'], { queryParams: { restoreDraft: '1' } });
  }

  onSaleTableProductClick(event: { index: number; productId?: string }): void {
    const line = this.draftLines[event.index];
    if (line) this.openSaleLineProduct(line);
  }

  openSaleLineProduct(line: SaleDraftLine): void {
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return;
    this.saveSalesFormDraftForReturn();
    this.router.navigate(['/stock', stockItemId, 'edit'], {
      queryParams: {
        returnTo: 'sales',
        ...(this.editingSaleId ? { saleId: this.editingSaleId } : {}),
      },
    });
  }

  private saveSalesFormDraftForReturn(): void {
    saveSalesFormDraft({
      saleModalMode: this.isEditing ? 'edit' : 'mostrador',
      saleModalOpen: !this.pageLayout,
      saleClienteId: this.saleClienteId,
      pendingClientName: this.pendingClientName,
      draftLines: structuredClone(this.draftLines),
      selectedOrderId: '',
      montoCobrado: this.montoCobrado,
      medioPago: this.medioPago,
      saleNotas: this.saleNotas,
      saleFecha: this.saleFecha,
      tipoComprobante: this.tipoComprobante,
      editingSaleId: this.editingSaleId,
      editingSaleLabel: this.editingSaleLabel,
      editHasExtraCobros: this.editHasExtraCobros,
      orderFilterClienteId: '',
    });
  }

  onSalePartySelected(option: SearchableSelectOption) {
    this.saleClienteId = option.value;
    this.pendingClientName = option.label;
    this.selectedSaleClientLabel = option.label;
    this.mergeClientOption(option.value, option.label);
  }

  quickCreateClient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.creatingClient) return;

    this.creatingClient = true;
    this.clientService.createClient({ nombre: trimmed }).subscribe({
      next: (response) => {
        this.creatingClient = false;
        const client: Client = { id: response.id, nombre: trimmed };
        this.mergeClientOption(response.id, trimmed);
        this.saleClienteId = response.id;
        this.selectedSaleClientLabel = trimmed;
        this.pendingClientName = trimmed;
      },
      error: () => {
        this.creatingClient = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo crear el cliente. Intentá de nuevo o usá «Nuevo cliente» para cargar la ficha completa.',
        });
      },
    });
  }

  useMaxMontoCobrado() {
    this.montoCobrado = this.maxMontoCobrado;
  }

  openClientModal() {
    const fromSearch = this.pendingClientName.trim();
    const fromSelection = this.saleClienteId
      ? (this.clients.find((client) => client.id === this.saleClienteId)?.nombre ?? '').trim()
      : '';
    this.clientModalPrefillNombre = fromSearch || fromSelection;
    this.clientModalOpen = true;
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.clientModalPrefillNombre = '';
  }

  onClientSavedFromModal(event: ClientFormSaveEvent) {
    this.saleClienteId = event.id;
    this.pendingClientName = event.client.nombre ?? '';
    this.selectedSaleClientLabel = event.client.nombre ?? '';
    this.mergeClientOption(event.id, event.client.nombre ?? '');
    this.refreshClientsList(() => this.syncSaleClientLabel());
    this.closeClientModal();
  }

  onSaleProductSelected(item: StockItem) {
    this.addOrIncrementProductFromSearch(item, 1);
  }

  onSaleProductQuantitySelected(event: { item: StockItem; quantity: number }) {
    this.addOrIncrementProductFromSearch(event.item, event.quantity);
  }

  private addOrIncrementProductFromSearch(item: StockItem, quantity: number) {
    if (!item.id || quantity <= 0) return;

    const existingIndex = this.draftLines.findIndex((line) => line.stockItemId === item.id);
    if (existingIndex >= 0) {
      const existing = this.draftLines[existingIndex];
      this.draftLines = [
        ...this.draftLines.slice(0, existingIndex),
        {
          ...existing,
          cantidad: (Number(existing.cantidad) || 0) + quantity,
        },
        ...this.draftLines.slice(existingIndex + 1),
      ];
      this.rebuildSaleTableLines();
      this.onDraftLineChange();
      return;
    }

    this.addProductFromSearch(item, quantity);
  }

  addProductFromSearch(item: StockItem, initialQty = 1) {
    if (!item.id) return;

    if (!this.stockItems.some((entry) => entry.id === item.id)) {
      this.stockItems = [...this.stockItems, item];
    }

    const costoUnitario = Number(item.costo) || 0;
    const precioSugerido = Number(item.precioSugerido) || costoUnitario || 0;

    this.draftLines = [
      ...this.draftLines,
      {
        stockItemId: item.id,
        nombre: item.nombre,
        cantidad: initialQty,
        precioUnitario: precioSugerido,
        costoUnitario,
        costosExtra: [],
        stockDisponible: getStockDisponible(item),
        controlaStock: item.controlaStock !== false,
      },
    ];
    this.syncAddedSaleProductIds();
    this.rebuildSaleTableLines();
    this.onDraftLineChange();
  }

  removeLine(index: number) {
    if (this.extraCostsModalIndex === index) {
      this.cancelExtraCostsModal();
    } else if (this.extraCostsModalIndex !== null && this.extraCostsModalIndex > index) {
      this.extraCostsModalIndex--;
    }
    this.saleLinesTable?.clearNumericDraftsForIndex(index);
    this.draftLines = this.draftLines.filter((_, i) => i !== index);
    this.syncAddedSaleProductIds();
    this.rebuildSaleTableLines();
    if (!this.isEditing) {
      this.montoCobrado = this.draftTotal;
    }
  }

  onDraftLineChange() {
    if (!this.isEditing) {
      this.montoCobrado = this.draftTotal;
    }
  }

  private rebuildSaleTableLines() {
    this.saleTableLines = this.draftLines.map((line) => ({
      productName: this.getDraftLineName(line),
      productId: line.stockItemId,
      productClickable: !!line.stockItemId,
      quantity: line.cantidad,
      unitSale: line.precioUnitario,
      personalization: this.getLinePersTotal(line),
      subtotal: this.getLineSubtotal(line),
      extrasSummary: this.formatDraftLineExtrasSummary(line),
      metaItems: this.buildSaleLineMetaItems(line),
      quantityEditable: true,
      unitSaleEditable: true,
      removable: true,
    }));
  }

  onSaleTableFieldChange(event: TransactionTableFieldChange): void {
    const line = this.draftLines[event.index];
    if (!line) return;
    if (event.field === 'quantity') {
      if (line.cantidad === event.value) return;
      line.cantidad = event.value;
    } else if (event.field === 'unitSale') {
      if (line.precioUnitario === event.value) return;
      line.precioUnitario = event.value;
    }
    this.rebuildSaleTableLines();
    this.onDraftLineChange();
  }

  onSaleTableMetaAction(event: { index: number; action: string }): void {
    if (event.action === 'extraCosts') {
      this.openExtraCostsModal(event.index);
    }
  }

  lineControlsStock(line: SaleDraftLine): boolean {
    if (line.controlaStock === false) return false;
    const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
    return itemControlsStock(item);
  }

  buildSaleLineMetaItems(line: SaleDraftLine): TransactionTableMetaItem[] {
    const items: TransactionTableMetaItem[] = [];
    if (line.stockItemId && this.lineControlsStock(line)) {
      items.push({ kind: 'text', text: `Disp. ${line.stockDisponible ?? 0}` });
    } else if (line.stockItemId && !this.lineControlsStock(line)) {
      items.push({ kind: 'text', text: 'Sin stock', textClass: 'text-gray-400' });
    }
    if (this.canEditSaleLineCosts) {
      items.push({
        kind: 'button',
        text: this.getExtraCostsActionLabel(line),
        action: 'extraCosts',
        buttonClass: 'text-[10px] sm:text-xs text-teal-600 font-medium hover:text-teal-800',
      });
    }
    return items;
  }

  getLineSubtotal(line: SaleDraftLine): number {
    return (Number(line.cantidad) || 0) * (Number(line.precioUnitario) || 0);
  }

  formatDraftLineExtrasSummary(line: SaleDraftLine): string | undefined {
    if (!line.costosExtra.length) return undefined;
    return (
      'Extras: ' +
      line.costosExtra.map((extra) => `${extra.nombre} $${extra.costo}`).join(' · ')
    );
  }

  getExtraCostsActionLabel(line: SaleDraftLine): string {
    return line.costosExtra.length > 0 ? 'Editar costos' : '+ Agregar costo';
  }

  getDraftLineName(line: SaleDraftLine): string {
    const cached = line.nombre?.trim();
    if (cached) return cached;
    const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
    return item?.nombre ?? 'Producto';
  }

  getLinePersTotal(line: SaleDraftLine): number {
    return sumLineExtraCosts(Number(line.cantidad) || 0, line.costosExtra);
  }

  openExtraCostsModal(lineIndex: number) {
    if (!this.canEditSaleLineCosts) return;
    if (!this.draftLines[lineIndex]) return;
    this.extraCostsModalIndex = lineIndex;
  }

  cancelExtraCostsModal() {
    this.extraCostsModalIndex = null;
  }

  acceptExtraCostsModal(costs: TransactionExtraCost[]) {
    const line = this.extraCostsModalLine;
    if (!line) return;
    line.costosExtra = costs.map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.rebuildSaleTableLines();
    this.cancelExtraCostsModal();
  }

  submitSale() {
    if (this.savingSale || this.savingDraft) return;

    this.saveFeedback.clearSuccess();

    this.confirmDonationIfNeeded(() => {
      if (this.isDraftSale && this.draftId) {
        this.confirmDraft();
        return;
      }

      if (this.isEditing) {
        this.submitEditSale();
        return;
      }
      this.submitNewSale();
    });
  }

  private get isDonationSale(): boolean {
    const hasItems = this.draftLines.some((line) => (Number(line.cantidad) || 0) > 0);
    return hasItems && this.draftTotal === 0;
  }

  private confirmDonationIfNeeded(onConfirm: () => void): void {
    if (!this.isDonationSale) {
      onConfirm();
      return;
    }

    this.dialogService
      .confirm({
        title: 'Registrar como donación',
        message:
          'El total es $0. Se descontará stock y la venta quedará en Ventas con ganancia negativa: el costo de los productos se resta de tus ganancias. ¿Continuar?',
        confirmLabel: 'Sí, es donación',
        cancelLabel: 'Volver',
      })
      .subscribe((confirmed) => {
        if (confirmed) onConfirm();
      });
  }

  saveDraft() {
    if (this.savingDraft || this.savingSale) return;
    this.saveFeedback.clearSuccess();

    const payload = this.buildSalePayload(false);
    if (!payload) return;

    payload.draft = true;
    const draftId = this.draftId;
    if (draftId) {
      payload.ventaId = draftId;
    }

    this.savingDraft = true;
    this.savingChange.emit(true);
    this.salesService.createSale(payload).subscribe({
      next: (result) => {
        this.savingDraft = false;
        this.savingChange.emit(false);
        this.isDraftSale = true;
        this.activeDraftId = result.id;
        this.saveFeedback.showSuccess('Borrador guardado');
        this.saved.emit({ id: result.id, label: 'Borrador', draft: true });
      },
      error: (err: HttpErrorResponse) => {
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
    const ventaId = this.draftId;
    if (!ventaId) return;

    const payload = this.buildSalePayload(true);
    if (!payload) return;

    this.setSavingSale(true);
    this.salesService.createSale({ ...payload, draft: true, ventaId }).subscribe({
      next: () => {
        this.salesService
          .confirmSale(ventaId)
          .pipe(finalize(() => this.setSavingSale(false)))
          .subscribe({
            next: (result) => {
              this.applyFreshSaveSuccess(
                result.id,
                result.ventaLabel,
                'Venta registrada'
              );
            },
            error: (err: HttpErrorResponse) => {
              const message =
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo confirmar la venta.';
              this.dialogService.alert({ title: 'Error', message });
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.setSavingSale(false);
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

  private buildSalePayload(strict: boolean): CreateSalePayload | null {
    const monto = Number(this.montoCobrado);

    if (strict && (!Number.isFinite(monto) || monto < 0)) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return null;
    }

    this.resolveSaleClienteId();
    if (!this.saleClienteId) {
      this.dialogService.alert({
        title: 'Cliente requerido',
        message: 'Seleccioná un cliente de la lista o usá «+ Nuevo cliente».',
      });
      return null;
    }

    const notaError = this.validateNotaFields(strict);
    if (notaError) {
      this.dialogService.alert({ title: 'Nota incompleta', message: notaError });
      return null;
    }

    const items = this.buildSaleItems();
    if (strict && items.length === 0) {
      const message = notaMotivoRequiresProductLines(this.motivoNota)
        ? 'Agregá al menos un producto devuelto.'
        : this.isNotaComprobanteSelected
          ? 'Agregá al menos una línea con concepto e importe.'
          : 'Agregá al menos un producto.';
      this.dialogService.alert({
        title: 'Líneas requeridas',
        message,
      });
      return null;
    }

    if (strict && Number.isFinite(monto) && monto > this.draftTotal) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: esNotaCredito(this.tipoComprobante)
          ? 'El monto devuelto no puede superar el total de la nota.'
          : 'El monto cobrado no puede superar el total de la venta.',
      });
      return null;
    }

    return this.appendNotaFields({
      origen: 'mostrador',
      clienteId: this.saleClienteId,
      items,
      montoCobrado: Number.isFinite(monto) && monto >= 0 ? monto : 0,
      medioPago: this.medioPago,
      notas: this.saleNotas.trim(),
      fecha: dateInputToIso(this.saleFecha),
      tipoComprobante: this.tipoComprobante,
    });
  }

  private submitNewSale() {
    if (this.savingSale) return;

    const payload = this.buildSalePayload(true);
    if (!payload) return;

    this.setSavingSale(true);
    this.salesService
      .createSale(payload)
      .pipe(finalize(() => this.setSavingSale(false)))
      .subscribe({
        next: (result) => {
          this.applyFreshSaveSuccess(
            result.id,
            result.ventaLabel,
            'Venta registrada'
          );
        },
        error: (err: HttpErrorResponse) => {
          const message =
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo registrar la venta.';
          this.dialogService.alert({ title: 'Error', message });
        },
      });
  }

  private submitEditSale() {
    if (!this.editingSaleId) return;

    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return;
    }

    this.resolveSaleClienteId();
    if (!this.saleClienteId) {
      this.dialogService.alert({
        title: 'Cliente requerido',
        message: 'Seleccioná un cliente de la lista o usá «+ Nuevo cliente».',
      });
      return;
    }

    const items = this.buildSaleItems();
    if (items.length === 0) {
      this.dialogService.alert({
        title: 'Productos requeridos',
        message: 'Agregá al menos un producto con cantidad.',
      });
      return;
    }

    const draftTotal = items.reduce(
      (acc, line) => acc + line.cantidad * line.precioUnitario,
      0
    );

    if (monto > draftTotal) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: 'El monto cobrado no puede superar el total de la venta.',
      });
      return;
    }

    const payload: UpdateSalePayload = {
      clienteId: this.saleClienteId,
      items,
      notas: this.saleNotas.trim(),
      medioPago: this.medioPago,
      fecha: dateInputToIso(this.saleFecha),
      tipoComprobante: this.tipoComprobante,
    };

    if (!this.editHasExtraCobros) {
      payload.montoCobrado = monto;
    }

    this.setSavingSale(true);
    this.salesService
      .updateSale(this.editingSaleId, payload)
      .pipe(finalize(() => this.setSavingSale(false)))
      .subscribe({
        next: (result) => {
          const label = result.ventaLabel || this.editingSaleLabel;
          this.editingSaleLabel = label;
          this.saveFeedback.showSuccessWithDetail('Cambios guardados', label);
          this.saved.emit({ id: result.id, label });
        },
        error: (err: HttpErrorResponse) => {
          this.dialogService.alert({
            title: 'Error',
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo actualizar la venta.',
          });
        },
      });
  }

  private buildSaleItems() {
    const productItems = this.showSaleProductLines
      ? this.draftLines
          .map((line) => {
            const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
            const costosExtra = (line.costosExtra ?? []).filter(
              (extra) => extra.nombre?.trim() || extra.costo
            );
            const costoPersonalizacion = this.getLinePersTotal(line);
            return {
              tipoLinea: 'producto' as const,
              stockItemId: line.stockItemId,
              nombre: line.nombre ?? item?.nombre ?? '',
              cantidad: Number(line.cantidad) || 0,
              precioUnitario: Number(line.precioUnitario) || 0,
              costoUnitario: Number(line.costoUnitario) || Number(item?.costo) || 0,
              costoPersonalizacion,
              costosExtra: costosExtra.map((extra) => ({
                nombre: extra.nombre.trim(),
                costo: Number(extra.costo) || 0,
              })),
              mueveStock: this.isNotaComprobanteSelected ? line.controlaStock !== false : true,
            };
          })
          .filter((line) => line.stockItemId && line.cantidad > 0)
      : [];

    const conceptItems = this.showNotaConceptLines
      ? this.conceptLines
          .map((line) => ({
            tipoLinea: 'concepto' as const,
            descripcion: line.descripcion.trim(),
            nombre: line.descripcion.trim(),
            cantidad: Number(line.cantidad) || 0,
            precioUnitario: Number(line.precioUnitario) || 0,
            mueveStock: false,
          }))
          .filter((line) => line.descripcion && line.cantidad > 0)
      : [];

    return [...productItems, ...conceptItems];
  }

  onMotivoNotaChange(motivo: NotaMotivoId | ''): void {
    if (notaMotivoRequiresProductLines(motivo)) {
      this.conceptLines = [{ descripcion: '', cantidad: 1, precioUnitario: null }];
      return;
    }

    this.draftLines = [];
    this.syncAddedSaleProductIds();
    if (!motivo) {
      this.conceptLines = [{ descripcion: '', cantidad: 1, precioUnitario: null }];
      return;
    }

    const presetLabel =
      motivo === 'otro'
        ? ''
        : (NOTA_MOTIVO_OPTIONS.find((option) => option.id === motivo)?.label ?? '');
    this.conceptLines = [{ descripcion: presetLabel, cantidad: 1, precioUnitario: null }];
  }

  addConceptLine(): void {
    this.conceptLines = [...this.conceptLines, { descripcion: '', cantidad: 1, precioUnitario: null }];
  }

  removeConceptLine(index: number): void {
    if (this.conceptLines.length <= 1) return;
    this.conceptLines = this.conceptLines.filter((_, i) => i !== index);
  }

  private validateNotaFields(strict: boolean): string | null {
    if (!strict || !this.isNotaComprobanteSelected) return null;
    if (!this.motivoNota) return 'Seleccioná el motivo de la nota.';
    if (this.motivoNota === 'otro' && !this.descripcionMotivoNota.trim()) {
      return 'Describí el motivo cuando elegís «Otro».';
    }
    return null;
  }

  private appendNotaFields<T extends CreateSalePayload>(payload: T): T {
    if (!this.isNotaComprobanteSelected) return payload;
    return {
      ...payload,
      motivo: this.motivoNota,
      descripcionMotivo: this.descripcionMotivoNota.trim(),
    };
  }

  private normalizeSaleDraftLine(line: SaleLine, stockItems: StockItem[]): SaleDraftLine {
    const stockItem = stockItems.find((entry) => entry.id === line.stockItemId);
    const costosExtraRaw = Array.isArray(line.costosExtra) ? line.costosExtra : [];
    const costosExtra = costosExtraRaw.map((extra) => ({
      nombre: String(extra?.nombre ?? '').trim() || 'Extra',
      costo: Number(extra?.costo) || 0,
    }));

    if (costosExtra.length > 0) {
      return {
        stockItemId: line.stockItemId,
        nombre: line.nombre,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        costoUnitario: Number(line.costoUnitario) || 0,
        costosExtra,
        stockDisponible: stockItem ? getStockDisponible(stockItem) : undefined,
        controlaStock: stockItem?.controlaStock !== false,
      };
    }

    const legacyTotal = Number(line.costoPersonalizacion) || 0;
    const qty = Math.max(1, Number(line.cantidad) || 1);
    const legacyUnit = legacyTotal > 0 ? legacyTotal / qty : 0;

    return {
      stockItemId: line.stockItemId,
      nombre: line.nombre,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario,
      costoUnitario: Number(line.costoUnitario) || 0,
      costosExtra:
        legacyTotal > 0 ? [{ nombre: 'Personalización', costo: legacyUnit }] : [],
      stockDisponible: stockItem ? getStockDisponible(stockItem) : undefined,
      controlaStock: stockItem?.controlaStock !== false,
    };
  }

  private loadEditingSale(saleId: string) {
    this.editingSaleLoading = true;
    this.salesService.getSale(saleId).subscribe({
      next: (fullSale) => {
        this.isDraftSale = fullSale.estado === 'borrador';
        if (this.isDraftSale && saleId) {
          this.activeDraftId = saleId;
        }
        this.editingSaleLabel = fullSale.ventaLabel || '';
        this.saleClienteId = fullSale.clienteId ?? '';
        this.ensureSaleClient(fullSale.clienteId, fullSale.clienteNombre);
        this.medioPago = fullSale.medioPago || 'efectivo';
        this.saleNotas = fullSale.notas || '';
        this.saleFecha = toDateInputValue(fullSale.fecha);
        this.tipoComprobante = normalizeComprobanteTipo(fullSale.tipoComprobante);
        this.motivoNota = normalizeNotaMotivo(fullSale.motivo);
        this.descripcionMotivoNota = fullSale.descripcionMotivo ?? '';
        this.montoCobrado = Number(fullSale.montoCobrado) || 0;
        this.editHasExtraCobros = this.saleHasExtraCobros(fullSale);
        const productLines: SaleLine[] = [];
        const conceptLines: SaleConceptLine[] = [{ descripcion: '', cantidad: 1, precioUnitario: null }];
        for (const line of fullSale.items ?? []) {
          if (line.tipoLinea === 'concepto' || (!line.stockItemId && line.descripcion)) {
            conceptLines.push({
              descripcion: line.descripcion ?? line.nombre ?? '',
              cantidad: line.cantidad,
              precioUnitario: line.precioUnitario,
            });
          } else {
            productLines.push(line);
          }
        }
        this.conceptLines =
          conceptLines.length > 1
            ? conceptLines.filter((line) => line.descripcion.trim())
            : [{ descripcion: '', cantidad: 1, precioUnitario: null }];
        this.draftLines = productLines.map((line) =>
          this.normalizeSaleDraftLine(line, this.stockItems)
        );
        if (notaMotivoRequiresProductLines(this.motivoNota)) {
          this.conceptLines = [{ descripcion: '', cantidad: 1, precioUnitario: null }];
        } else if (this.motivoNota) {
          this.draftLines = [];
        }
        this.syncAddedSaleProductIds();
        this.rebuildSaleTableLines();
        this.editingSaleLoading = false;
      },
      error: () => {
        this.editingSaleLoading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la venta para editar.',
        });
        this.cancelled.emit();
      },
    });
  }

  private resetNewSaleForm() {
    this.isDraftSale = false;
    this.activeDraftId = null;
    this.editingSaleLabel = '';
    this.editHasExtraCobros = false;
    this.saleClienteId = '';
    this.selectedSaleClientLabel = '';
    this.pendingClientName = '';
    this.draftLines = [];
    this.syncAddedSaleProductIds();
    this.rebuildSaleTableLines();
    this.medioPago = 'efectivo';
    this.saleNotas = '';
    this.saleFecha = todayDateInputValue();
    this.tipoComprobante = this.defaultTipoComprobante;
    this.motivoNota = '';
    this.descripcionMotivoNota = '';
    this.conceptLines = [{ descripcion: '', cantidad: 1, precioUnitario: null }];
    this.montoCobrado = null;
    this.onDraftLineChange();
  }

  private saleHasExtraCobros(sale: { cobros?: Array<{ monto?: number }> }): boolean {
    return Array.isArray(sale.cobros) && sale.cobros.length > 0;
  }

  private ensureSaleClient(clienteId?: string, clienteNombre?: string) {
    const id = String(clienteId ?? '').trim();
    if (!id) {
      this.selectedSaleClientLabel = '';
      return;
    }

    const cachedName = String(clienteNombre ?? this.pendingClientName ?? '').trim();
    if (cachedName) {
      this.selectedSaleClientLabel = cachedName;
      this.mergeClientOption(id, cachedName);
      return;
    }

    const existing = this.clients.find((client) => client.id === id);
    if (existing?.nombre) {
      this.selectedSaleClientLabel = existing.nombre;
      return;
    }

    if (this.pendingClientFetchId === id) return;
    this.pendingClientFetchId = id;

    this.clientService.getClient(id).subscribe({
      next: (client) => {
        if (this.pendingClientFetchId === id) {
          this.pendingClientFetchId = null;
        }
        if (String(this.saleClienteId ?? '').trim() !== id) return;
        this.selectedSaleClientLabel = client.nombre;
        this.mergeClientOption(id, client.nombre);
      },
      error: () => {
        if (this.pendingClientFetchId === id) {
          this.pendingClientFetchId = null;
        }
      },
    });
  }

  private mergeClientOption(id: string, nombre: string) {
    if (this.clients.some((client) => client.id === id)) return;
    this.clients = [{ id, nombre }, ...this.clients];
    this.rebuildClientOptions();
  }

  private resolveSaleClienteId(): void {
    if (this.saleClienteId) return;
    const query = this.pendingClientName.trim();
    if (!query) return;
    const match = this.clients.find(
      (client) =>
        client.id && client.nombre?.trim().toLowerCase() === query.toLowerCase()
    );
    if (match?.id) {
      this.saleClienteId = match.id;
    }
  }

  private pendingClientNameMatchesClient(): boolean {
    const query = this.pendingClientName.trim();
    if (!query) return false;
    return this.clients.some(
      (client) =>
        client.id && client.nombre?.trim().toLowerCase() === query.toLowerCase()
    );
  }

  private setSavingSale(value: boolean) {
    if (value) {
      this.saveFeedback.saving = true;
      this.saveFeedback.clearSuccess();
    } else {
      this.saveFeedback.endSave();
    }
    this.savingChange.emit(this.saveFeedback.saving);
  }
}
