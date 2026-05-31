import { Component, ViewChild, inject, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
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
} from '../../shared/components/transaction-form';
import { IconToolbarButtonComponent } from '../../shared/components/icon-toolbar';

@Component({
  selector: 'app-new-sale',
  standalone: true,
  imports: [
    CommonModule,
    SaleCounterFormPanelComponent,
    TransactionFormPageComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
    IconToolbarButtonComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="isEditing ? ('Venta #' + (saleForm?.editingSaleLabel || '—')) : 'Venta de mostrador'"
      [subtitle]="isEditing
        ? 'Corregí productos, cantidades o el monto cobrado al registrar la venta.'
        : 'Descuenta stock y registra el cobro en caja.'"
      backLabel="Volver a ventas"
      backShortLabel="Volver"
      backAriaLabel="Volver a ventas"
      [hasHeaderActions]="true"
      (backClick)="goBack()">
      <div headerActions>
        <app-icon-toolbar-button
          class="sm:hidden"
          icon="save"
          [label]="saleSaveLabel"
          variant="primary"
          [disabled]="saleSaving"
          [loading]="saleSaving"
          (clicked)="saleForm?.submitSale()">
        </app-icon-toolbar-button>
      </div>
      <section main [class]="formCardClass">
        <app-sale-counter-form-panel
          #saleForm
          [pageLayout]="true"
          [hideInlineSummary]="true"
          [editingSaleId]="editingSaleId"
          (saved)="onSaved($event)"
          (savingChange)="onSaleSavingChange($event)"
          (cancelled)="goBack()">
        </app-sale-counter-form-panel>
      </section>

      <app-transaction-summary-panel aside *ngIf="saleForm">
        <div class="space-y-2 sm:space-y-3">
          <app-transaction-summary-row label="Total venta" [value]="'$' + saleForm.draftTotal"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="auth.canViewEconomics"
            label="Costo estimado"
            [value]="'$' + saleForm.draftCostTotal"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="auth.canViewEconomics"
            label="Ganancia estimada"
            [value]="'$' + saleForm.draftProfitTotal"
            valueTone="teal"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Monto a cobrar"
            [value]="'$' + (saleForm.montoCobrado ?? 0)"
            [bold]="true"
            [divider]="true"
            size="md"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="saleForm.saldoPendienteEstimado > 0"
            label="Saldo pendiente"
            [value]="'$' + saleForm.saldoPendienteEstimado"
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

  editingSaleId: string | null = null;
  saleSaving = false;
  private shouldRestoreDraft = false;
  private pendingRestoreClienteId: string | null = null;

  get isEditing(): boolean {
    return !!this.editingSaleId;
  }

  get saleSaveLabel(): string {
    return this.isEditing ? 'Guardar cambios' : 'Registrar venta';
  }

  ngOnInit() {
    if (!this.auth.canCreateSales) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.editingSaleId = this.route.snapshot.paramMap.get('id');

    if (this.route.snapshot.queryParamMap.get('restoreDraft') === '1') {
      this.shouldRestoreDraft = true;
      this.pendingRestoreClienteId = this.route.snapshot.queryParamMap.get('clienteId');
    }

    if (!this.editingSaleId && !this.shouldRestoreDraft) {
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
    if (!this.shouldRestoreDraft) return;

    this.saleForm.restoreFromSessionDraft(this.pendingRestoreClienteId);
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

  onSaved(event: TransactionFormSaveEvent) {
    if (!this.editingSaleId && event?.id) {
      this.editingSaleId = event.id;
      this.router.navigate(['/sales', event.id, 'edit'], { replaceUrl: true });
    }
    this.saleSaving = false;
  }

  goBack() {
    this.router.navigate(['/sales']);
  }
}
