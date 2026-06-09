import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getMediosPagoActivos,
} from '../../core/services/catalog-config.service';
import { PayableInstallment, PayablesService } from '../../core/services/payables.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import { TransactionSaveBannerComponent } from '../../shared/components/transaction-form';
import { TransactionSaveFeedback } from '../../shared/components/transaction-form/transaction-save-feedback';
import { formatMonthYearLabel } from '../../core/utils/date-format';
import { formatDisplayDate } from '../../core/utils/transaction-date';
import { Subscription, finalize } from 'rxjs';

@Component({
  selector: 'app-payable-cuota-pay-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TransactionModalComponent,
    ModalFormFooterComponent,
    TransactionSaveBannerComponent,
  ],
  template: `
    <app-transaction-modal
      [open]="open"
      title="Registrar pago"
      [subtitle]="modalSubtitle"
      [hideSubtitleOnMobile]="false"
      (closed)="onClose()">
      <div *ngIf="target as row" class="space-y-4">
        <app-transaction-save-banner [message]="saveFeedback.successMessage"></app-transaction-save-banner>
        <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-1">
          <p class="text-base font-bold text-gray-900 dark:text-gray-100">{{ row.beneficiario }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Vence {{ formatDate(row.fechaVencimiento) }} · {{ formatMes(row.fechaVencimiento?.slice(0, 7) ?? '') }}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Detalle</label>
          <input
            [(ngModel)]="detalle"
            name="payCuotaDetalleModal"
            placeholder="Detalle del pago"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Monto a pagar (egreso de caja)
          </label>
          <input
            type="number"
            [(ngModel)]="monto"
            name="payCuotaMontoModal"
            min="0.01"
            step="0.01"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm tabular-nums bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Gasto recurrente: podés ajustar el importe si este mes vino distinto al habitual.
            Monto programado: {{ formatMoney(row.monto) }}.
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago (egreso de caja)</label>
          <select
            [(ngModel)]="medioPagoId"
            name="payCuotaMedioModal"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900">
            <option *ngFor="let medio of mediosPagoCaja" [ngValue]="medio.id">{{ medio.label }}</option>
          </select>
        </div>
        <app-modal-form-footer
          [saving]="saveFeedback.saving"
          [primaryDisabled]="!canSubmit"
          [successMessage]="saveFeedback.successMessage"
          primaryLabel="Confirmar pago de la cuota"
          (cancelClick)="onClose()"
          (primaryClick)="submit()">
        </app-modal-form-footer>
      </div>
    </app-transaction-modal>
  `,
})
export class PayableCuotaPayModalComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() target: PayableInstallment | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paid = new EventEmitter<PayableInstallment>();

  private payables = inject(PayablesService);
  private catalog = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private configSub?: Subscription;

  readonly saveFeedback = new TransactionSaveFeedback();
  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  monto: number | null = null;
  detalle = '';
  medioPagoId = 'transferencia';

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.saveFeedback.destroy();
  }

  constructor() {
    this.configSub = this.catalog.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalog.getAppConfig().subscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['target'] && this.target) {
      this.syncFromTarget(this.target);
    }
  }

  get mediosPagoCaja() {
    return getMediosPagoActivos(this.appConfig).filter((m) => m.comportamiento === 'caja_inmediata');
  }

  get modalSubtitle(): string {
    if (!this.target) return '';
    const mes = this.target.fechaVencimiento?.slice(0, 7) ?? '';
    return `${this.target.beneficiario} · ${this.formatMes(mes)}`;
  }

  get canSubmit(): boolean {
    const value = Number(this.monto);
    return Number.isFinite(value) && value > 0 && !!this.target;
  }

  syncFromTarget(row: PayableInstallment | null): void {
    if (!row) return;
    this.monto = row.monto;
    this.detalle = row.descripcion?.trim() || row.beneficiario?.trim() || '';
    this.medioPagoId = row.medioPagoId ?? this.mediosPagoCaja[0]?.id ?? 'transferencia';
  }

  onClose(): void {
    this.saveFeedback.clearSuccess();
    this.saveFeedback.endSave();
    this.closed.emit();
  }

  submit(): void {
    if (!this.target || !this.canSubmit || !this.saveFeedback.tryBeginSave()) return;

    const montoPago = Math.round(Number(this.monto) * 100) / 100;
    const concepto = this.detalle.trim();

    this.payables
      .setInstallmentPaid(this.target.id, true, this.medioPagoId, {
        montoPago,
        concepto,
      })
      .pipe(finalize(() => this.saveFeedback.endSave()))
      .subscribe({
        next: (updated) => {
          this.saveFeedback.showSuccess(`Cuota pagada · $${updated.monto}`);
          window.setTimeout(() => {
            this.saveFeedback.clearSuccess();
            this.paid.emit(updated);
            this.onClose();
          }, 700);
        },
        error: (err) => {
          this.dialog.alert({
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago.',
          });
        },
      });
  }

  formatMoney(value: number | null | undefined): string {
    return (
      '$' +
      Number(value ?? 0).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  formatDate(value: string): string {
    return formatDisplayDate(value);
  }

  formatMes(mes: string): string {
    return formatMonthYearLabel(mes);
  }
}
