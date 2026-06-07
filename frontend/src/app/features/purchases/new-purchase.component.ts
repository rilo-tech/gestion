import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
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
} from '../../shared/components/transaction-form';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { NavigationBackService } from '../../core/services/navigation-back.service';

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
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      [titleBadge]="pageTitleBadge"
      [subtitle]="pageSubtitle"
      backLabel="Volver a compras"
      backShortLabel="Volver"
      backAriaLabel="Volver a compras"
      [hasHeaderActions]="hasHeaderActions"
      (backClick)="goBack()">
      <div headerActions *ngIf="hasHeaderActions" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
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
        <app-purchase-form-panel
          #purchaseForm
          [pageLayout]="true"
          [hideInlineSummary]="true"
          [readOnly]="readOnlyMode"
          [initialProveedorId]="proveedorId"
          [initialPurchase]="loadedPurchase"
          [editingDraftId]="editingDraftId"
          [editingConfirmedId]="editingConfirmedId"
          (saved)="onSaved($event)"
          (savingChange)="onPurchaseSavingChange($event)"
          (cancelled)="goBack()">
        </app-purchase-form-panel>
      </section>

      <app-transaction-summary-panel aside *ngIf="purchaseForm">
        <div class="space-y-2 sm:space-y-3 mb-4">
          <app-transaction-summary-row label="Líneas" [value]="'' + purchaseForm.draftLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Productos (stock)" [value]="'' + purchaseForm.stockLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Gastos / servicios" [value]="'' + purchaseForm.expenseLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Total estimado"
            [value]="'$' + purchaseForm.draftTotal"
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
export class NewPurchaseComponent implements OnInit {
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
  savedPurchaseLabel = '';
  purchaseSaving = false;
  deletingPurchase = false;
  private purchaseRouteId: string | null = null;
  private duplicateSourceId: string | null = null;

  get pageTitle(): string {
    if (this.readOnlyMode) return 'Detalle de compra';
    if (this.editingConfirmedId) return 'Editar compra';
    if (this.editingDraftId) return 'Borrador de compra';
    return 'Nueva compra';
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
    return buildTransactionSaveHeaderState({
      saving: this.purchaseSaving,
      successMessage: this.purchaseForm?.saveSuccessMessage ?? '',
      idleLabel: this.editingConfirmedId
        ? 'Guardar cambios'
        : this.editingDraftId
          ? 'Confirmar compra'
          : 'Registrar compra',
      savingLabel: 'Registrando...',
    });
  }

  /** Id de la compra/borrador en pantalla, si ya está guardada. */
  private get currentPurchaseId(): string | null {
    return this.editingConfirmedId ?? this.editingDraftId ?? this.loadedPurchase?.id ?? null;
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
    this.router.navigate(['/purchases/new'], { queryParams: { duplicate: sourceId } });
  }

  editCurrentPurchase() {
    const id = this.loadedPurchase?.id;
    if (!id || !this.canEditCurrent) return;
    this.router.navigate(['/purchases', id, 'edit']);
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

    this.route.paramMap.subscribe((params) => {
      const routeId = params.get('id')?.trim() || null;
      this.purchaseRouteId = routeId;
      if (routeId) {
        this.loadPurchaseFromRoute(routeId);
        return;
      }
      this.syncNewPurchaseQuery(this.route.snapshot.queryParamMap);
    });

    this.route.queryParamMap.subscribe((params) => {
      if (this.purchaseRouteId) return;
      this.syncNewPurchaseQuery(params);
    });
  }

  private syncNewPurchaseQuery(params: { get: (name: string) => string | null }) {
    this.proveedorId = params.get('proveedorId')?.trim() ?? '';
    const duplicateId = params.get('duplicate')?.trim() ?? '';
    if (duplicateId) {
      this.loadPurchaseForDuplicate(duplicateId);
      return;
    }
    const draftId = params.get('draftId')?.trim() ?? '';
    if (!draftId) {
      this.editingDraftId = null;
      this.duplicateSourceId = null;
      this.loadedPurchase = null;
      return;
    }
    if (this.editingDraftId === draftId && this.loadedPurchase?.id === draftId) return;
    this.editingDraftId = draftId;
    this.editingConfirmedId = null;
    this.readOnlyMode = false;
    this.purchaseService.getPurchase(draftId).subscribe({
      next: (purchase) => {
        this.loadedPurchase = purchase;
      },
      error: () => {
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
      },
      error: () => {
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

    this.purchaseService.getPurchase(purchaseId).subscribe({
      next: (purchase) => this.applyLoadedPurchase(purchaseId, purchase),
      error: () => {
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
      this.router.navigate(['/purchases/new'], {
        queryParams: { draftId: purchaseId },
        replaceUrl: true,
      });
      return;
    }

    this.loadedPurchase = purchase;
    this.editingDraftId = null;
    const isEditRoute = this.router.url.includes('/edit');

    if (isEditRoute) {
      if (!this.canEditPurchase(purchase)) {
        this.router.navigate(['/purchases', purchaseId], { replaceUrl: true });
        return;
      }
      this.readOnlyMode = false;
      this.editingConfirmedId = purchaseId;
      return;
    }

    this.readOnlyMode = true;
    this.editingConfirmedId = null;
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

  onSaved(event?: TransactionFormSaveEvent) {
    if (event?.draft) {
      this.purchaseSaving = false;
      if (event.id) {
        this.editingDraftId = event.id;
        this.router.navigate(['/purchases/new'], {
          queryParams: { draftId: event.id },
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
          this.router.navigate(['/purchases', id, 'edit'], { replaceUrl: true });
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
    this.navigationBack.back(['/purchases']);
  }
}
