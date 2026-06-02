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
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from '../clients/client-form-panel.component';
import { FormFooterComponent } from '../../shared/components/form-shell';
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
} from '../../core/services/catalog-config.service';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
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
} from '../../shared/components/transaction-form';
import { TransactionFormSaveEvent } from '../../shared/components/transaction-form/transaction-form.types';
import {
  dateInputToIso,
  todayDateInputValue,
  toDateInputValue,
} from '../../core/utils/transaction-date';

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
    SearchableSelectComponent,
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
  ],
  template: `
    <div *ngIf="isEditing && editingSaleLoading" class="py-8 text-center text-xs sm:text-sm text-gray-400">
      Cargando venta...
    </div>

    <form *ngIf="!(isEditing && editingSaleLoading)" (submit)="submitSale(); $event.preventDefault()" class="space-y-4">
      <app-transaction-party-field
        label="Cliente"
        createActionLabel="+ Nuevo cliente"
        (createClick)="goToNewClientForm()">
        <app-searchable-select
          [(ngModel)]="saleClienteId"
          name="saleClienteId"
          [labeledOptions]="clientOptions"
          [fallbackLabel]="selectedSaleClientLabel"
          [creatable]="true"
          createLabelPrefix="Crear cliente"
          (createRequested)="quickCreateClient($event)"
          (searchChange)="pendingClientName = $event"
          placeholder="Buscar cliente..."
          emptyOptionsMessage="No hay clientes cargados. Escribí el nombre para crearlo.">
        </app-searchable-select>
      </app-transaction-party-field>

      <app-transaction-date-field
        [date]="saleFecha"
        (dateChange)="saleFecha = $event"
        fieldName="saleFecha"
        label="Fecha">
      </app-transaction-date-field>

      <app-transaction-lines-section
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
          (productSelected)="onSaleProductSelected($event)">
        </app-transaction-product-search>

        <app-transaction-lines-table
          #saleLinesTable
          [hideWhenEmpty]="true"
          [lines]="saleTableLines"
          [columns]="saleTableColumns"
          fieldNamePrefix="saleLine"
          (fieldChange)="onSaleTableFieldChange($event)"
          (removeLine)="removeLine($event)"
          (metaAction)="onSaleTableMetaAction($event)">
        </app-transaction-lines-table>
      </app-transaction-lines-section>

      <div *ngIf="!hideInlineSummary" class="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1 text-sm">
        <div class="flex justify-between">
          <span class="text-gray-600">Total venta</span>
          <span class="font-bold tabular-nums">{{ '$' + draftTotal }}</span>
        </div>
        <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-gray-500">
          <span>Costo estimado</span>
          <span class="tabular-nums">{{ '$' + draftCostTotal }}</span>
        </div>
        <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-teal-700 font-medium">
          <span>Ganancia estimada</span>
          <span class="tabular-nums">{{ '$' + draftProfitTotal }}</span>
        </div>
      </div>

      <app-transaction-payment-simple
        [amount]="montoCobrado"
        (amountChange)="montoCobrado = $event"
        [method]="medioPago"
        (methodChange)="medioPago = $event"
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
          <p *ngIf="!montoCobradoError" class="text-[10px] sm:text-xs text-gray-400 mt-1">
            <ng-container *ngIf="isEditing && editHasExtraCobros">
              El cobro inicial ya no se puede cambiar porque hay cobros posteriores. Usá «Cobrar saldo» para el resto.
            </ng-container>
            <ng-container *ngIf="!(isEditing && editHasExtraCobros)">
              Dejá menos que el total si el cliente paga después.
            </ng-container>
          </p>
        </div>
      </app-transaction-payment-simple>

      <app-transaction-notes-field
        [notes]="saleNotas"
        (notesChange)="saleNotas = $event"
        fieldName="saleNotas">
      </app-transaction-notes-field>

      <p *ngIf="saleSubmitBlockedReason" class="text-sm text-red-600 text-right">
        {{ saleSubmitBlockedReason }}
      </p>

      <app-form-footer
        [mode]="pageLayout ? 'inline' : 'modal'"
        [showCancel]="pageLayout"
        [saveLabel]="primaryLabel"
        [saving]="savingSale"
        [saveDisabled]="!!saleSubmitBlockedReason"
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
        priceLabel="Costo"
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
  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  saveSuccessMessage = '';
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

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
  selectedSaleClientLabel = '';
  stockItems: StockItem[] = [];
  private addedSaleProductIdsCache: string[] = [];
  private addedSaleProductIdsKey = '';
  saleTableLines: TransactionTableLine[] = [];
  saleTableColumns = buildTransactionTableColumns(SALE_FORM_TABLE_COLUMNS, {
    personalization: false,
  });
  savingSale = false;
  savingDraft = false;
  isDraftSale = false;
  private activeDraftId: string | null = null;
  editingSaleLabel = '';
  editHasExtraCobros = false;
  editingSaleLoading = false;

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

  extraCostsModalIndex: number | null = null;

  get canEditSaleLineCosts(): boolean {
    return this.auth.canEditPersonalization || this.auth.canCreateSales;
  }

  get saleExtraCostPresets(): OrderExtraCostPreset[] {
    return this.appConfig.pedidos?.costosExtraPredeterminados ?? [];
  }

  get isEditing(): boolean {
    return !!this.editingSaleId;
  }

  get primaryLabel(): string {
    if (this.isDraftSale) return 'Confirmar venta';
    return this.isEditing ? 'Guardar cambios' : 'Registrar venta';
  }

  get draftSecondaryLabel(): string {
    if (this.isEditing && !this.isDraftSale) return '';
    return 'Guardar borrador';
  }

  private get draftId(): string | null {
    return this.editingSaleId ?? this.activeDraftId;
  }

  get clientOptions() {
    return this.clients
      .filter((client) => client.id)
      .map((client) => ({ value: client.id!, label: client.nombre }));
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

  get draftTotal(): number {
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const price = Number(line.precioUnitario) || 0;
      return acc + qty * price;
    }, 0);
  }

  get draftCostTotal(): number {
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

  get saleSubmitBlockedReason(): string | null {
    if (this.savingSale) return null;
    if (this.montoCobradoError) return this.montoCobradoError;
    if (!this.saleClienteId && !this.pendingClientNameMatchesClient()) {
      if (!this.pendingClientName.trim()) {
        return 'Seleccioná un cliente para la venta.';
      }
      return 'Seleccioná un cliente de la lista o usá «+ Nuevo cliente».';
    }
    const hasItems = this.draftLines.some(
      (line) => line.stockItemId && (Number(line.cantidad) || 0) > 0
    );
    if (!hasItems) {
      return 'Agregá al menos un producto con cantidad.';
    }
    return null;
  }

  get extraCostsModalLine(): SaleDraftLine | null {
    if (this.extraCostsModalIndex === null) return null;
    return this.draftLines[this.extraCostsModalIndex] ?? null;
  }

  ngOnInit() {
    this.saleTableColumns = buildTransactionTableColumns(SALE_FORM_TABLE_COLUMNS, {
      personalization: this.canEditSaleLineCosts,
    });

    this.catalogConfig.getAppConfig().subscribe();
    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });

    if (!this.auth.canCreateSales) return;

    this.clientService.getClientsPage(120).subscribe((page) => {
      this.clients = page.items;
      this.ensureSaleClient(this.saleClienteId, this.selectedSaleClientLabel);
    });
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

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
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

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['editingSaleId'] || changes['editingSaleId'].firstChange) return;

    if (this.editingSaleId) {
      this.loadEditingSale(this.editingSaleId);
    } else {
      this.resetNewSaleForm();
    }
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
    this.draftLines = draft.draftLines.length
      ? structuredClone(draft.draftLines)
      : [];
    this.syncAddedSaleProductIds();
    this.rebuildSaleTableLines();
    this.montoCobrado = draft.montoCobrado;
    this.medioPago = draft.medioPago;
    this.saleNotas = draft.saleNotas;
    this.editingSaleLabel = draft.editingSaleLabel;
    this.editHasExtraCobros = draft.editHasExtraCobros;

    if (clienteId) {
      this.saleClienteId = clienteId;
      this.pendingClientName = '';
      this.ensureSaleClient(clienteId);
    } else {
      this.ensureSaleClient(this.saleClienteId, this.selectedSaleClientLabel);
    }

    this.clientService.getClientsPage(120).subscribe((page) => {
      this.clients = page.items;
      this.ensureSaleClient(this.saleClienteId, this.selectedSaleClientLabel);
    });
  }

  goToNewClientForm() {
    if (!this.auth.canCreateSales) return;

    saveSalesFormDraft({
      saleModalMode: this.isEditing ? 'edit' : 'mostrador',
      saleModalOpen: true,
      saleClienteId: this.saleClienteId,
      pendingClientName: this.pendingClientName,
      draftLines: structuredClone(this.draftLines),
      selectedOrderId: '',
      montoCobrado: this.montoCobrado,
      medioPago: this.medioPago,
      saleNotas: this.saleNotas,
      editingSaleId: this.editingSaleId,
      editingSaleLabel: this.editingSaleLabel,
      editHasExtraCobros: this.editHasExtraCobros,
      orderFilterClienteId: '',
    });

    const nombre = this.pendingClientName.trim();
    this.router.navigate(['/clients/new'], {
      queryParams: {
        ...(nombre ? { nombre } : {}),
        returnTo: 'sales',
      },
    });
  }

  quickCreateClient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.creatingClient) return;

    this.creatingClient = true;
    this.clientService.createClient({ nombre: trimmed }).subscribe({
      next: (response) => {
        this.creatingClient = false;
        const client: Client = { id: response.id, nombre: trimmed };
        this.clients = [...this.clients, client];
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
    this.clientService.getClientsPage(120).subscribe((page) => {
      this.clients = page.items;
      this.ensureSaleClient(this.saleClienteId, this.selectedSaleClientLabel);
    });
    this.closeClientModal();
  }

  onSaleProductSelected(item: StockItem) {
    this.addProductFromSearch(item);
  }

  addProductFromSearch(item: StockItem) {
    if (!item.id || this.addedSaleProductIds.includes(item.id)) return;

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
        cantidad: 1,
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

  getLineCustomizationTotal(line: SaleDraftLine): number {
    return (line.costosExtra ?? []).reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
  }

  getLinePersTotal(line: SaleDraftLine): number {
    return (Number(line.cantidad) || 0) * this.getLineCustomizationTotal(line);
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
    if (this.saleSubmitBlockedReason) return;

    if (this.isDraftSale && this.draftId) {
      this.confirmDraft();
      return;
    }

    if (this.isEditing) {
      this.submitEditSale();
      return;
    }
    this.submitNewSale();
  }

  saveDraft() {
    if (this.savingDraft || this.savingSale) return;

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
        this.showSaveSuccess('Borrador guardado');
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
    this.salesService
      .createSale({ ...payload, draft: true, ventaId })
      .subscribe({
        next: () => {
          this.salesService.confirmSale(ventaId).subscribe({
            next: (result) => {
              this.setSavingSale(false);
              this.isDraftSale = false;
              this.activeDraftId = null;
              this.showSaveSuccess('Venta registrada');
              this.saved.emit({ id: result.id, label: result.ventaLabel });
            },
            error: (err: HttpErrorResponse) => {
              this.setSavingSale(false);
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

    const items = this.buildSaleItems();
    if (strict && items.length === 0) {
      this.dialogService.alert({
        title: 'Productos requeridos',
        message: 'Agregá al menos un producto con cantidad.',
      });
      return null;
    }

    if (strict && Number.isFinite(monto) && monto > this.draftTotal) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: 'El monto cobrado no puede superar el total de la venta.',
      });
      return null;
    }

    return {
      origen: 'mostrador',
      clienteId: this.saleClienteId,
      items,
      montoCobrado: Number.isFinite(monto) && monto >= 0 ? monto : 0,
      medioPago: this.medioPago,
      notas: this.saleNotas.trim(),
      fecha: dateInputToIso(this.saleFecha),
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

  private submitNewSale() {
    const payload = this.buildSalePayload(true);
    if (!payload) return;

    this.setSavingSale(true);
    this.salesService.createSale(payload).subscribe({
      next: (result) => {
        this.setSavingSale(false);
        this.showSaveSuccess('Venta registrada');
        this.saved.emit({ id: result.id, label: result.ventaLabel });
      },
      error: (err: HttpErrorResponse) => {
        this.setSavingSale(false);
        const message =
          typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar la venta.';
        this.offerSaveAsDraft(message);
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
    };

    if (!this.editHasExtraCobros) {
      payload.montoCobrado = monto;
    }

    this.setSavingSale(true);
    this.salesService.updateSale(this.editingSaleId, payload).subscribe({
      next: (result) => {
        this.setSavingSale(false);
        this.showSaveSuccess('Cambios guardados');
        this.saved.emit({ id: result.id, label: result.ventaLabel });
      },
      error: (err: HttpErrorResponse) => {
        this.setSavingSale(false);
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
    return this.draftLines
      .map((line) => {
        const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
        const costosExtra = (line.costosExtra ?? []).filter(
          (extra) => extra.nombre?.trim() || extra.costo
        );
        const costoPersonalizacion = this.getLinePersTotal(line);
        return {
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
        };
      })
      .filter((line) => line.stockItemId && line.cantidad > 0);
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
        this.montoCobrado = Number(fullSale.montoCobrado) || 0;
        this.editHasExtraCobros = this.saleHasExtraCobros(fullSale);
        this.draftLines = (fullSale.items ?? []).map((line) =>
          this.normalizeSaleDraftLine(line, this.stockItems)
        );
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

    const cachedName = String(clienteNombre ?? '').trim();
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

    this.clientService.getClient(id).subscribe({
      next: (client) => {
        if (String(this.saleClienteId ?? '').trim() !== id) return;
        this.selectedSaleClientLabel = client.nombre;
        this.mergeClientOption(id, client.nombre);
      },
    });
  }

  private mergeClientOption(id: string, nombre: string) {
    if (this.clients.some((client) => client.id === id)) return;
    this.clients = [{ id, nombre }, ...this.clients];
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
    this.savingSale = value;
    this.savingChange.emit(value);
  }
}
