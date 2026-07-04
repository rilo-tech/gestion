import { Component, ViewChild, inject, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { PurchaseFormPanelComponent } from './purchase-form-panel.component';
import {
  formatPurchaseLabel,
  formatPurchaseNumberBadge,
  Purchase,
  PurchaseService,
} from '../../core/services/purchase.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  TransactionFormPageComponent,
  TransactionSummaryPanelComponent,
  TransactionSummaryRowComponent,
  TRANSACTION_FORM_CARD_CLASS,
  TransactionFormSaveEvent,
  buildTransactionSaveHeaderState,
  TransactionFormShellComponent,
} from '../../shared/components/transaction-form';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import {
  purchaseFormDraftMatchesRoute,
  readPurchaseFormDraft,
} from '../../core/utils/form-return-context';
import {
  buildCashReopenQueryParams,
  parseCashReturnContext,
  type CashReturnContext,
} from '../../core/utils/cash-return-context';
import {
  comprobanteBorradorTitulo,
  comprobanteConfirmarLabel,
  comprobanteNuevoTitulo,
  comprobanteRegistrarLabel,
  normalizeComprobanteTipo,
  type ComprobanteTipoId,
} from '../../core/services/catalog-config.service';

type PayablesViewTab = 'month' | 'account' | 'obligation';

function parsePayablesViewTab(value: string | null | undefined): PayablesViewTab | null {
  if (value === 'month' || value === 'account' || value === 'obligation') return value;
  return null;
}

@Component({
  selector: 'app-new-purchase',
  standalone: true,
  imports: [
    CommonModule,
    PurchaseFormPanelComponent,
    TransactionFormPageComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
    RecordActionToolbarComponent,
    TransactionFormShellComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      [titleBadge]="pageTitleBadge"
      [subtitle]="pageSubtitle"
      [backLabel]="backLabel"
      backShortLabel="Volver"
      [backAriaLabel]="backLabel"
      [hasHeaderActions]="hasHeaderActions"
      (backClick)="goBack()">
      <div headerActions *ngIf="hasHeaderActions" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
          activityModule="purchases"
          [activityEntityId]="currentPurchaseId"
          [activityEntityLabel]="activityEntityLabel"
          [showSave]="!readOnlyMode"
          [saveLabel]="purchaseHeaderSave.label"
          [saveDisabled]="purchaseHeaderSave.disabled"
          [saveLoading]="purchaseHeaderSave.loading"
          (saveClick)="purchaseForm?.submitPurchase()"
          [showDuplicate]="canDuplicateCurrent"
          duplicateLabel="Duplicar compra"
          (duplicateClick)="duplicateCurrentPurchase()"
          [showDelete]="canDeleteCurrent"
          deleteLabel="Eliminar compra"
          [deleteDisabled]="purchaseSaving || deletingPurchase"
          (deleteClick)="confirmDeleteCurrentPurchase()"
          [showEdit]="canEditCurrent"
          editLabel="Editar compra"
          (editClick)="editCurrentPurchase()">
        </app-record-action-toolbar>
      </div>
      <section main [class]="formCardClass">
        <app-transaction-form-shell *ngIf="purchaseLoadPending"></app-transaction-form-shell>
        <app-purchase-form-panel
          *ngIf="!purchaseLoadPending"
          #purchaseForm
          [pageLayout]="true"
          [hideInlineSummary]="true"
          [readOnly]="readOnlyMode"
          [initialProveedorId]="proveedorId"
          [initialPurchase]="loadedPurchase"
          [editingDraftId]="editingDraftId"
          [editingConfirmedId]="editingConfirmedId"
          [lockedTipoComprobante]="purchaseLockedTipo"
          (saved)="onSaved($event)"
          (savingChange)="onPurchaseSavingChange($event)"
          (formReadyChange)="onPurchaseFormReadyChange($event)"
          (cancelled)="goBack()">
        </app-purchase-form-panel>
      </section>

      <app-transaction-summary-panel aside *ngIf="purchaseSummaryReady && !purchaseLoadPending">
        <div class="space-y-2 sm:space-y-3 mb-4">
          <app-transaction-summary-row label="Líneas" [value]="'' + purchaseForm.draftLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Productos (stock)" [value]="'' + purchaseForm.stockLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Gastos / servicios" [value]="'' + purchaseForm.expenseLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Total estimado"
            [value]="formatMoney(purchaseForm.draftTotal)"
            [bold]="true"
            [divider]="true"
            size="md"></app-transaction-summary-row>
        </div>

        <div class="p-3 rounded-lg border border-gray-100 bg-gray-50 text-xs sm:text-sm space-y-1">
          <div class="flex justify-between gap-2">
            <span class="text-gray-600">Medio de pago</span>
            <span class="font-medium text-gray-900 text-right">{{ purchaseForm.selectedMedioPagoLabel }}</span>
          </div>
          <p class="text-gray-500 leading-snug m-0">{{ purchaseForm.pagoResumenHint }}</p>
        </div>
      </app-transaction-summary-panel>
    </app-transaction-form-page>
  `,
})
export class NewPurchaseComponent implements OnInit, AfterViewInit {
  @ViewChild('purchaseForm') purchaseForm!: PurchaseFormPanelComponent;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private purchaseService = inject(PurchaseService);
  private dialogService = inject(DialogService);
  private navigationBack = inject(NavigationBackService);

  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;
  proveedorId = '';
  editingDraftId: string | null = null;
  editingConfirmedId: string | null = null;
  readOnlyMode = false;
  loadedPurchase: Purchase | null = null;
  purchaseLoadPending = false;
  purchaseSummaryReady = false;
  savedPurchaseLabel = '';
  purchaseSaving = false;
  deletingPurchase = false;
  private purchaseRouteId: string | null = null;
  private duplicateSourceId: string | null = null;
  private returnTo: 'purchases' | 'payables' | 'cash' = 'purchases';
  private payablesReturnTab: PayablesViewTab | null = null;
  private cashReturnContext: CashReturnContext | null = null;
  private shouldRestoreDraft = false;
  initialTipoComprobante: ComprobanteTipoId = 'factura';

  get purchaseLockedTipo(): ComprobanteTipoId | null {
    if (
      this.purchaseLoadPending ||
      this.editingDraftId ||
      this.editingConfirmedId ||
      this.purchaseRouteId ||
      this.duplicateSourceId ||
      this.loadedPurchase
    ) {
      return null;
    }
    return this.initialTipoComprobante;
  }

  get effectiveTipoComprobante(): ComprobanteTipoId {
    if (this.loadedPurchase?.tipoComprobante) {
      return normalizeComprobanteTipo(this.loadedPurchase.tipoComprobante);
    }
    const locked = this.purchaseLockedTipo;
    if (locked) return locked;
    return this.purchaseForm?.tipoComprobante ?? this.initialTipoComprobante;
  }

  get backLabel(): string {
    if (this.returnTo === 'payables') return 'Volver a cuentas a pagar';
    if (this.returnTo === 'cash') return 'Volver a caja';
    return 'Volver a compras';
  }

  get pageTitle(): string {
    if (this.readOnlyMode) return 'Detalle de compra';
    if (this.editingConfirmedId) return 'Editar compra';
    if (this.editingDraftId) {
      return comprobanteBorradorTitulo(this.effectiveTipoComprobante, 'compras');
    }
    return comprobanteNuevoTitulo(this.effectiveTipoComprobante, 'compras');
  }

  get pageTitleBadge(): string {
    if (this.savedPurchaseLabel) return this.savedPurchaseLabel;
    return formatPurchaseNumberBadge(this.loadedPurchase);
  }

  get pageSubtitle(): string {
    if (this.readOnlyMode && this.loadedPurchase) {
      const proveedor = this.loadedPurchase.proveedor?.trim();
      const factura = this.loadedPurchase.numeroComprobante?.trim();
      if (proveedor && factura) return `${proveedor} · Fact. ${factura}`;
      if (factura) return `Fact. ${factura}`;
      if (proveedor) return proveedor;
    }
    return 'Productos suman stock al registrar. Gastos y servicios solo afectan caja y cuentas.';
  }

  get purchaseHeaderSave() {
    const tipo = this.effectiveTipoComprobante;
    return buildTransactionSaveHeaderState({
      saving: this.purchaseSaving,
      successMessage: this.purchaseForm?.saveSuccessMessage ?? '',
      idleLabel: this.editingConfirmedId
        ? 'Guardar cambios'
        : this.editingDraftId
          ? comprobanteConfirmarLabel(tipo, 'compras')
          : comprobanteRegistrarLabel(tipo, 'compras'),
      savingLabel: 'Registrando...',
    });
  }

  /** Id de la compra/borrador en pantalla, si ya está guardada. */
  get currentPurchaseId(): string | null {
    return this.editingConfirmedId ?? this.editingDraftId ?? this.loadedPurchase?.id ?? null;
  }

  get activityEntityLabel(): string {
    const label = this.savedPurchaseLabel || formatPurchaseNumberBadge(this.loadedPurchase);
    return label ? `Compra ${label}` : 'Compra';
  }

  get canDuplicateCurrent(): boolean {
    return this.auth.canEditRecords && !!this.currentPurchaseId;
  }

  get canDeleteCurrent(): boolean {
    return this.auth.canDeleteRecords && !!this.currentPurchaseId;
  }

  /** Mostrar «Editar» solo cuando estamos viendo una compra confirmada en modo lectura. */
  get canEditCurrent(): boolean {
    return (
      this.readOnlyMode &&
      this.auth.canEditRecords &&
      !!this.loadedPurchase?.id &&
      this.loadedPurchase.estado !== 'borrador'
    );
  }

  get hasHeaderActions(): boolean {
    return !this.readOnlyMode || this.canDuplicateCurrent || this.canDeleteCurrent || this.canEditCurrent;
  }

  duplicateCurrentPurchase() {
    const sourceId = this.currentPurchaseId;
    if (!sourceId || !this.canDuplicateCurrent) return;
    this.router.navigate(['/purchases/new'], {
      queryParams: { duplicate: sourceId, ...this.returnQueryParams() },
    });
  }

  editCurrentPurchase() {
    const id = this.loadedPurchase?.id;
    if (!id || !this.canEditCurrent) return;
    this.router.navigate(['/purchases', id, 'edit'], {
      queryParams: this.returnQueryParams(),
    });
  }

  confirmDeleteCurrentPurchase() {
    const id = this.currentPurchaseId;
    if (!id || !this.canDeleteCurrent) return;

    const isDraft = this.loadedPurchase?.estado === 'borrador' || !!this.editingDraftId;
    const label = this.savedPurchaseLabel || formatPurchaseNumberBadge(this.loadedPurchase);

    this.dialogService
      .confirm({
        title: 'Eliminar compra',
        message: isDraft
          ? '¿Eliminar este borrador de compra?'
          : `¿Eliminar la compra ${label}? Se revertirá el stock ingresado y los movimientos de caja vinculados.`,
        confirmLabel: 'Eliminar',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.deletingPurchase = true;
        this.purchaseService.deletePurchase(id).subscribe({
          next: () => {
            this.deletingPurchase = false;
            this.goBack();
          },
          error: (err) => {
            this.deletingPurchase = false;
            this.dialogService.alert({
              title: 'No se pudo eliminar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar la compra.',
            });
          },
        });
      });
  }

  ngOnInit() {
    if (!this.auth.canViewStockCosts) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.syncReturnContext(this.route.snapshot.queryParamMap);

    this.route.paramMap.subscribe((params) => {
      const routeId = params.get('id')?.trim() || null;
      this.purchaseRouteId = routeId;
      if (routeId) {
        if (this.tryRestorePurchaseDraft(routeId, null)) return;
        this.purchaseLoadPending = true;
        this.loadPurchaseFromRoute(routeId);
        return;
      }
      this.syncNewPurchaseQuery(this.route.snapshot.queryParamMap);
    });

    this.route.queryParamMap.subscribe((params) => {
      this.syncReturnContext(params);
      if (this.purchaseRouteId) return;
      this.syncNewPurchaseQuery(params);
    });
  }

  ngAfterViewInit() {
    this.schedulePurchaseDraftRestore();
  }

  private tryRestorePurchaseDraft(
    routeConfirmedId: string | null,
    draftIdFromQuery: string | null
  ): boolean {
    const draft = readPurchaseFormDraft();
    if (!draft) return false;
    if (!purchaseFormDraftMatchesRoute(draft, routeConfirmedId, draftIdFromQuery)) return false;

    this.shouldRestoreDraft = true;
    this.editingConfirmedId = draft.editingConfirmedId;
    this.editingDraftId = draft.editingDraftId;
    this.loadedPurchase = null;
    this.purchaseLoadPending = false;
    this.readOnlyMode = false;
    this.schedulePurchaseDraftRestore();
    return true;
  }

  private schedulePurchaseDraftRestore() {
    queueMicrotask(() => {
      if (!this.shouldRestoreDraft || !this.purchaseForm) return;
      this.purchaseForm.restoreFromSessionDraft();
      this.shouldRestoreDraft = false;
      this.clearRestoreQueryParams();
    });
  }

  private clearRestoreQueryParams() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { restoreDraft: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private syncReturnContext(params: ParamMap): void {
    if (params.get('returnTo') === 'payables') {
      this.returnTo = 'payables';
      this.payablesReturnTab = parsePayablesViewTab(params.get('tab'));
      this.cashReturnContext = null;
      return;
    }
    const ctx = parseCashReturnContext(params);
    if (ctx) {
      this.returnTo = 'cash';
      this.cashReturnContext = ctx;
      this.payablesReturnTab = null;
      return;
    }
    this.returnTo = 'purchases';
    this.payablesReturnTab = null;
    this.cashReturnContext = null;
  }

  private returnQueryParams(): Record<string, string> {
    if (this.returnTo === 'cash' && this.cashReturnContext) {
      return {
        returnTo: 'cash',
        movementId: this.cashReturnContext.movementId,
        mes: String(this.cashReturnContext.mes),
        anio: String(this.cashReturnContext.anio),
      };
    }
    if (this.returnTo !== 'payables') return {};
    return {
      returnTo: 'payables',
      ...(this.payablesReturnTab ? { tab: this.payablesReturnTab } : {}),
    };
  }

  private syncNewPurchaseQuery(params: { get: (name: string) => string | null }) {
    const draftId = params.get('draftId')?.trim() ?? '';
    if (params.get('restoreDraft') === '1' && this.tryRestorePurchaseDraft(null, draftId || null)) {
      return;
    }

    this.proveedorId = params.get('proveedorId')?.trim() ?? '';
    const duplicateId = params.get('duplicate')?.trim() ?? '';
    if (duplicateId) {
      this.loadPurchaseForDuplicate(duplicateId);
      return;
    }
    if (!draftId) {
      this.editingDraftId = null;
      this.duplicateSourceId = null;
      this.loadedPurchase = null;
      this.purchaseLoadPending = false;
      this.initialTipoComprobante = normalizeComprobanteTipo(
        params.get('tipoComprobante') ?? 'factura'
      );
      return;
    }
    if (this.editingDraftId === draftId && this.loadedPurchase?.id === draftId) {
      this.purchaseLoadPending = false;
      return;
    }
    this.purchaseLoadPending = true;
    this.editingDraftId = draftId;
    this.editingConfirmedId = null;
    this.readOnlyMode = false;
    this.purchaseService.getPurchase(draftId).subscribe({
      next: (purchase) => {
        this.loadedPurchase = purchase;
        this.purchaseLoadPending = false;
      },
      error: () => {
        this.purchaseLoadPending = false;
        this.editingDraftId = null;
        this.loadedPurchase = null;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el borrador de compra.',
        });
        this.goBack();
      },
    });
  }

  private loadPurchaseForDuplicate(sourceId: string) {
    if (this.loadedPurchase && !this.loadedPurchase.id && this.duplicateSourceId === sourceId) {
      return;
    }

    this.editingDraftId = null;
    this.editingConfirmedId = null;
    this.readOnlyMode = false;
    this.duplicateSourceId = sourceId;
    this.purchaseLoadPending = true;

    this.purchaseService.getPurchase(sourceId).subscribe({
      next: (purchase) => {
        this.loadedPurchase = {
          ...purchase,
          id: undefined,
          estado: undefined,
          numeroCompra: undefined,
          compraLabel: undefined,
          numeroComprobante: '',
          fecha: new Date().toISOString(),
          items: (purchase.items ?? []).map((line, index) => ({
            ...line,
            id: line.id ?? `line_${index + 1}`,
          })),
        };
        this.purchaseLoadPending = false;
      },
      error: () => {
        this.purchaseLoadPending = false;
        this.duplicateSourceId = null;
        this.loadedPurchase = null;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la compra a duplicar.',
        });
        this.goBack();
      },
    });
  }

  private loadPurchaseFromRoute(purchaseId: string) {
    const preview = this.readPurchasePreview(purchaseId);
    if (preview) {
      this.applyLoadedPurchase(purchaseId, preview);
      return;
    }

    this.purchaseLoadPending = true;
    this.purchaseService.getPurchase(purchaseId).subscribe({
      next: (purchase) => this.applyLoadedPurchase(purchaseId, purchase),
      error: () => {
        this.purchaseLoadPending = false;
        this.dialogService.alert({
          title: 'Servidor no disponible',
          message:
            'No se pudo cargar la compra. Ejecutá npm run dev en la raíz del proyecto y recargá la página.',
        });
        this.goBack();
      },
    });
  }

  private readPurchasePreview(purchaseId: string): Purchase | null {
    const state = history.state as { purchasePreview?: Purchase } | undefined;
    const preview = state?.purchasePreview;
    if (!preview?.id || preview.id !== purchaseId) return null;
    return preview;
  }

  private applyLoadedPurchase(purchaseId: string, purchase: Purchase) {
    if (purchase.estado === 'borrador') {
      this.purchaseLoadPending = true;
      this.router.navigate(['/purchases/new'], {
        queryParams: { draftId: purchaseId, ...this.returnQueryParams() },
        replaceUrl: true,
      });
      return;
    }

    this.loadedPurchase = purchase;
    this.editingDraftId = null;
    const isEditRoute = this.router.url.includes('/edit');

    if (isEditRoute) {
      if (!this.canEditPurchase(purchase)) {
        this.purchaseLoadPending = false;
        this.router.navigate(['/purchases', purchaseId], {
          queryParams: this.returnQueryParams(),
          replaceUrl: true,
        });
        return;
      }
      this.readOnlyMode = false;
      this.editingConfirmedId = purchaseId;
      this.purchaseLoadPending = false;
      return;
    }

    this.readOnlyMode = true;
    this.editingConfirmedId = null;
    this.purchaseLoadPending = false;
  }

  private canEditPurchase(purchase: Purchase): boolean {
    return (
      this.auth.canEditRecords &&
      !!purchase.id &&
      purchase.estado !== 'borrador'
    );
  }

  onPurchaseSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.purchaseSaving = saving;
    });
  }

  onPurchaseFormReadyChange(ready: boolean) {
    queueMicrotask(() => {
      this.purchaseSummaryReady = ready;
      if (ready) this.schedulePurchaseDraftRestore();
    });
  }

  onSaved(event?: TransactionFormSaveEvent) {
    if (event?.draft) {
      this.purchaseSaving = false;
      if (event.id) {
        this.editingDraftId = event.id;
        this.router.navigate(['/purchases/new'], {
          queryParams: { draftId: event.id, ...this.returnQueryParams() },
          replaceUrl: true,
        });
      }
      return;
    }

    this.purchaseSaving = false;
    const id = event?.id;
    if (!id) return;

    this.purchaseService.getPurchase(id).subscribe({
      next: (purchase) => {
        this.loadedPurchase = purchase;
        this.readOnlyMode = false;
        this.editingDraftId = null;

        if (this.editingConfirmedId !== id) {
          this.editingConfirmedId = id;
          this.router.navigate(['/purchases', id, 'edit'], {
            queryParams: this.returnQueryParams(),
            replaceUrl: true,
          });
          return;
        }

        if (event?.label && event.label !== 'Borrador') {
          this.savedPurchaseLabel = event.label;
        }
      },
      error: () => {
        if (event?.label && event.label !== 'Borrador') {
          this.savedPurchaseLabel = event.label;
        }
      },
    });
  }

  goBack() {
    if (this.returnTo === 'cash' && this.cashReturnContext) {
      void this.router.navigate(['/cash'], {
        queryParams: buildCashReopenQueryParams(this.cashReturnContext),
      });
      return;
    }
    if (this.returnTo === 'payables') {
      void this.router.navigate(['/payables'], {
        queryParams: this.payablesReturnTab ? { tab: this.payablesReturnTab } : {},
      });
      return;
    }
    this.navigationBack.back(['/purchases']);
  }

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }
}
