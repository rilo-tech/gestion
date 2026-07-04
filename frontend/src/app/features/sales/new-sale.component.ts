import { Component, ViewChild, inject, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { StockService } from '../../core/services/stock.service';
import { SaleCounterFormPanelComponent } from './sale-counter-form-panel.component';
import {
  TransactionFormPageComponent,
  TransactionSummaryPanelComponent,
  TransactionSummaryRowComponent,
  TRANSACTION_FORM_CARD_CLASS,
  TransactionFormSaveEvent,
  buildTransactionSaveHeaderState,
} from '../../shared/components/transaction-form';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import {
  comprobanteBorradorTitulo,
  comprobanteNuevoTitulo,
  normalizeComprobanteTipo,
  type ComprobanteTipoId,
} from '../../core/services/catalog-config.service';

@Component({
  selector: 'app-new-sale',
  standalone: true,
  imports: [
    CommonModule,
    SaleCounterFormPanelComponent,
    TransactionFormPageComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
    RecordActionToolbarComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      [subtitle]="pageSubtitle"
      backLabel="Volver a ventas"
      backShortLabel="Volver"
      backAriaLabel="Volver a ventas"
      [hasHeaderActions]="true"
      (backClick)="goBack()">
      <div headerActions class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
          activityModule="sales"
          [activityEntityId]="activityEntityId"
          [activityEntityLabel]="activityEntityLabel"
          [showDuplicate]="canDuplicateCurrent"
          duplicateLabel="Duplicar"
          (duplicateClick)="duplicateCurrentSale()"
          [showSave]="true"
          [saveLabel]="saleHeaderSave.label"
          [saveDisabled]="saleHeaderSave.disabled"
          [saveLoading]="saleHeaderSave.loading"
          (saveClick)="saleForm?.submitSale()">
        </app-record-action-toolbar>
      </div>
      <section main [class]="formCardClass">
        <app-sale-counter-form-panel
          #saleForm
          [pageLayout]="true"
          [hideInlineSummary]="true"
          [editingSaleId]="editingSaleId"
          [lockedTipoComprobante]="newSaleLockedTipo"
          (saved)="onSaved($event)"
          (savingChange)="onSaleSavingChange($event)"
          (formReadyChange)="onSaleFormReadyChange($event)"
          (cancelled)="goBack()">
        </app-sale-counter-form-panel>
      </section>

      <app-transaction-summary-panel aside variant="light" *ngIf="saleSummaryReady">
        <div class="space-y-2 sm:space-y-3">
          <app-transaction-summary-row label="Total venta" [value]="formatMoney(saleForm.draftTotal)"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="auth.canViewEconomics"
            label="Costo estimado"
            [value]="formatMoney(saleForm.draftCostTotal)"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="auth.canViewEconomics"
            label="Ganancia estimada"
            [value]="formatMoney(saleForm.draftProfitTotal)"
            valueTone="teal"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Monto a cobrar"
            [value]="formatMoney(saleForm.montoCobrado ?? 0)"
            [bold]="true"
            [divider]="true"
            size="md"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="saleForm.saldoPendienteEstimado > 0"
            label="Saldo pendiente"
            [value]="formatMoney(saleForm.saldoPendienteEstimado)"
            valueTone="orange"></app-transaction-summary-row>
        </div>
      </app-transaction-summary-panel>
    </app-transaction-form-page>
  `,
})
export class NewSaleComponent implements OnInit, AfterViewInit {
  @ViewChild('saleForm') saleForm!: SaleCounterFormPanelComponent;

  readonly auth = inject(AuthService);
  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialogService = inject(DialogService);
  private stockService = inject(StockService);
  private navigationBack = inject(NavigationBackService);

  editingSaleId: string | null = null;
  saleSaving = false;
  saleSummaryReady = false;
  private pendingRestoreClienteId: string | null = null;
  initialTipoComprobante: ComprobanteTipoId = 'factura';

  get newSaleLockedTipo(): ComprobanteTipoId | null {
    if (this.editingSaleId || this.saleForm?.isDraftSale) return null;
    return this.initialTipoComprobante;
  }

  get effectiveTipoComprobante(): ComprobanteTipoId {
    const locked = this.newSaleLockedTipo;
    if (locked) return locked;
    return this.saleForm?.tipoComprobante ?? this.initialTipoComprobante;
  }

  get isEditing(): boolean {
    return !!this.editingSaleId;
  }

  get pageTitle(): string {
    if (this.saleForm?.isDraftSale) {
      return comprobanteBorradorTitulo(this.effectiveTipoComprobante, 'ventas');
    }
    if (this.isEditing) return 'Venta #' + (this.saleForm?.editingSaleLabel || '—');
    return comprobanteNuevoTitulo(this.effectiveTipoComprobante, 'ventas');
  }

  get pageSubtitle(): string {
    if (this.saleForm?.isDraftSale) {
      return 'Todavía no impacta stock ni caja. Confirmá la venta cuando esté lista.';
    }
    if (this.isEditing) {
      return 'Corregí productos, cantidades o el monto cobrado al registrar la venta.';
    }
    return 'Descuenta stock y registra el cobro en caja.';
  }

  get saleSaveLabel(): string {
    return this.saleForm?.primaryLabel ?? (this.isEditing ? 'Guardar cambios' : 'Registrar venta');
  }

  get saleSavingLabel(): string {
    if (this.saleForm?.isDraftSale) return 'Confirmando...';
    return this.isEditing ? 'Guardando...' : 'Registrando...';
  }

  get saleHeaderSave() {
    return buildTransactionSaveHeaderState({
      saving: this.saleSaving,
      successMessage: this.saleForm?.saveSuccessMessage ?? '',
      idleLabel: this.saleSaveLabel,
      savingLabel: this.saleSavingLabel,
    });
  }

  get canDuplicateCurrent(): boolean {
    return this.saleForm?.canDuplicateCurrent ?? false;
  }

  get activityEntityId(): string | null {
    return this.editingSaleId;
  }

  get activityEntityLabel(): string {
    if (!this.activityEntityId) return '';
    const label = this.saleForm?.editingSaleLabel?.trim();
    return label ? `Venta #${label}` : 'Venta';
  }

  duplicateCurrentSale() {
    this.saleForm?.duplicateCurrentSale();
  }

  ngOnInit() {
    if (!this.auth.canCreateSales) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.editingSaleId = this.route.snapshot.paramMap.get('id');
    this.initialTipoComprobante = this.resolveInitialTipo(this.route.snapshot.queryParamMap);

    if (this.route.snapshot.queryParamMap.get('restoreDraft') === '1') {
      this.pendingRestoreClienteId = this.route.snapshot.queryParamMap.get('clienteId');
    }

    this.route.queryParamMap.subscribe((params) => {
      if (params.get('restoreDraft') !== '1') return;
      this.pendingRestoreClienteId = params.get('clienteId');
      queueMicrotask(() => this.tryRestoreDraft());
    });

    this.route.queryParamMap.subscribe((params) => {
      if (this.editingSaleId || params.get('restoreDraft') === '1') return;
      this.initialTipoComprobante = this.resolveInitialTipo(params);
    });

    if (!this.editingSaleId && !this.route.snapshot.queryParamMap.get('restoreDraft')) {
      this.stockService.getStock().subscribe((items) => {
        if (items.length === 0) {
          this.dialogService.alert({
            title: 'Sin productos',
            message: 'Cargá productos en Stock antes de registrar una venta de mostrador.',
          });
          this.router.navigate(['/sales']);
        }
      });
    }
  }

  ngAfterViewInit() {
    if (this.route.snapshot.queryParamMap.get('restoreDraft') === '1') {
      this.tryRestoreDraft();
    }
  }

  private tryRestoreDraft() {
    if (!this.saleForm || this.route.snapshot.queryParamMap.get('restoreDraft') !== '1') return;

    this.saleForm.restoreFromSessionDraft(this.pendingRestoreClienteId);
    this.pendingRestoreClienteId = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { restoreDraft: null, clienteId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onSaleSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.saleSaving = saving;
    });
  }

  onSaleFormReadyChange(ready: boolean) {
    queueMicrotask(() => {
      this.saleSummaryReady = ready;
    });
  }

  onSaved(event: TransactionFormSaveEvent) {
    this.saleSaving = false;
    if (!event?.id) return;

    if (!this.editingSaleId) {
      this.editingSaleId = event.id;
      this.router.navigate(['/sales', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.navigationBack.back(['/sales']);
  }

  private resolveInitialTipo(params: ParamMap): ComprobanteTipoId {
    return normalizeComprobanteTipo(params.get('tipoComprobante') ?? 'factura');
  }

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }
}
