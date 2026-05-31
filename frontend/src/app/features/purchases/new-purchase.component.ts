import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PurchaseFormPanelComponent } from './purchase-form-panel.component';
import { formatPurchaseLabel } from '../../core/services/purchase.service';
import { AuthService } from '../../core/services/auth.service';
import {
  TransactionFormPageComponent,
  TransactionSummaryPanelComponent,
  TransactionSummaryRowComponent,
  TRANSACTION_FORM_CARD_CLASS,
  TransactionFormSaveEvent,
} from '../../shared/components/transaction-form';
import { IconToolbarButtonComponent } from '../../shared/components/icon-toolbar';

@Component({
  selector: 'app-new-purchase',
  standalone: true,
  imports: [
    CommonModule,
    PurchaseFormPanelComponent,
    TransactionFormPageComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
    IconToolbarButtonComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      subtitle="Productos suman stock al registrar. Gastos y servicios solo afectan caja y cuentas."
      backLabel="Volver a compras"
      backShortLabel="Volver"
      backAriaLabel="Volver a compras"
      [hasHeaderActions]="true"
      (backClick)="goBack()">
      <div headerActions>
        <app-icon-toolbar-button
          *ngIf="!purchaseCompleted"
          class="sm:hidden"
          icon="save"
          label="Registrar compra"
          variant="primary"
          [disabled]="purchaseSaving"
          [loading]="purchaseSaving"
          (clicked)="purchaseForm?.submitPurchase()">
        </app-icon-toolbar-button>
      </div>
      <section main [class]="formCardClass">
        <app-purchase-form-panel
          #purchaseForm
          [pageLayout]="true"
          [hideInlineSummary]="true"
          [initialProveedorId]="proveedorId"
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

        <div class="p-3 bg-gray-800/60 rounded-lg border border-gray-700 text-xs sm:text-sm space-y-1">
          <div class="flex justify-between gap-2">
            <span class="text-gray-400">Medio de pago</span>
            <span class="font-medium text-right">{{ purchaseForm.selectedMedioPagoLabel }}</span>
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

  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;
  proveedorId = '';
  savedPurchaseLabel = '';
  purchaseSaving = false;
  purchaseCompleted = false;

  get pageTitle(): string {
    if (this.savedPurchaseLabel) {
      return `Compra #${this.savedPurchaseLabel}`;
    }
    return 'Nueva compra';
  }

  ngOnInit() {
    if (!this.auth.canViewStockCosts) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.route.queryParamMap.subscribe((params) => {
      this.proveedorId = params.get('proveedorId')?.trim() ?? '';
    });
  }

  onPurchaseSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.purchaseSaving = saving;
    });
  }

  onSaved(event?: TransactionFormSaveEvent) {
    const label = event?.label || (event?.id ? formatPurchaseLabel({ id: event.id }) : '');
    if (label) {
      this.savedPurchaseLabel = label;
    }
    this.purchaseSaving = false;
    this.purchaseCompleted = true;
  }

  goBack() {
    this.router.navigate(['/purchases']);
  }
}
