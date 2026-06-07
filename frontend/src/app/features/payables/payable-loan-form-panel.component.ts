import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getCategoriasGasto,
  getDefaultCashAmbitoId,
  usesCashAmbitoSeparation,
  type CajaAmbitoConfig,
} from '../../core/services/catalog-config.service';
import {
  CreatePayableLoanPayload,
  PayablesService,
} from '../../core/services/payables.service';
import { DialogService } from '../../core/services/dialog.service';
import { FormFooterComponent } from '../../shared/components/form-shell';
import {
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';
import { SegmentedControlComponent } from '../../shared/components/segmented-control/segmented-control.component';
import { Subscription, finalize } from 'rxjs';

@Component({
  selector: 'app-payable-loan-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FormFooterComponent,
    TransactionSaveBannerComponent,
    SegmentedControlComponent,
  ],
  template: `
    <form (submit)="submit(); $event.preventDefault()" class="space-y-4">
      <app-transaction-save-banner [message]="saveFeedback.successMessage"></app-transaction-save-banner>

      <div *ngIf="usesAmbitoSeparation">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Etiqueta</label>
        <app-segmented-control
          ariaLabel="Ámbito"
          [options]="cajaAmbitos"
          [(value)]="formAmbito">
        </app-segmented-control>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prestamista / concepto</label>
        <input
          [(ngModel)]="form.beneficiario"
          name="loanBeneficiario"
          required
          placeholder="Ej: Banco, familiar, financiera..."
          class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría (opcional)</label>
        <select
          [(ngModel)]="form.categoriaId"
          name="loanCategoriaId"
          class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">Sin categoría</option>
          <option *ngFor="let cat of categoriasGasto" [ngValue]="cat.id">{{ cat.label }}</option>
        </select>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto por cuota</label>
          <input
            [(ngModel)]="form.montoCuota"
            name="loanMontoCuota"
            type="number"
            step="0.01"
            required
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cantidad de cuotas</label>
          <input
            [(ngModel)]="form.cantidadCuotas"
            name="loanCantidadCuotas"
            type="number"
            min="1"
            max="120"
            required
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Primer vencimiento</label>
          <input
            [(ngModel)]="form.fechaPrimerVencimiento"
            name="loanFechaPrimerVencimiento"
            type="date"
            required
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
        <input
          [(ngModel)]="form.notas"
          name="loanNotas"
          placeholder="Capital total, tasa, nº de préstamo..."
          class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
      </div>

      <app-form-footer
        mode="inline"
        [showCancel]="true"
        saveLabel="Crear préstamo"
        [saving]="saveFeedback.saving"
        [saveDisabled]="saveFeedback.saving"
        [successMessage]="saveFeedback.successMessage"
        (cancelClick)="cancelled.emit()"
        (saveClick)="submit()">
      </app-form-footer>
    </form>
  `,
})
export class PayableLoanFormPanelComponent implements OnInit, OnDestroy {
  @Input() initialAmbito = '';

  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private payables = inject(PayablesService);
  private catalogConfig = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private cdr = inject(ChangeDetectorRef);

  readonly saveFeedback = new TransactionSaveFeedback();

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  formAmbito = '';
  private configSub?: Subscription;

  form = {
    beneficiario: '',
    montoCuota: null as number | null,
    cantidadCuotas: 12,
    fechaPrimerVencimiento: new Date().toISOString().slice(0, 10),
    notas: '',
    categoriaId: '',
  };

  get cajaAmbitos(): CajaAmbitoConfig[] {
    return getCajaAmbitos(this.appConfig);
  }

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get categoriasGasto() {
    return getCategoriasGasto(this.appConfig);
  }

  ngOnInit(): void {
    this.formAmbito =
      this.initialAmbito.trim() ||
      (this.usesAmbitoSeparation ? getDefaultCashAmbitoId(this.appConfig) : '');

    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
      if (!this.formAmbito && this.usesAmbitoSeparation) {
        this.formAmbito = getDefaultCashAmbitoId(config);
      }
      this.cdr.markForCheck();
    });
    this.catalogConfig.getAppConfig().subscribe();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.saveFeedback.destroy();
  }

  submit(): void {
    const payload = this.buildPayload();
    if (!payload) {
      this.dialog.alert({
        message: 'Completá prestamista, monto por cuota, cantidad de cuotas y primer vencimiento.',
      });
      return;
    }
    if (!this.saveFeedback.tryBeginSave()) return;

    this.payables
      .createLoan(payload)
      .pipe(finalize(() => this.saveFeedback.endSave()))
      .subscribe({
        next: () => {
          this.saveFeedback.showSuccess('Préstamo creado');
          window.setTimeout(() => {
            this.saveFeedback.clearSuccess();
            this.saved.emit();
          }, 900);
        },
        error: () => {
          this.dialog.alert({ message: 'No se pudo crear el préstamo.' });
        },
      });
  }

  private buildPayload(): CreatePayableLoanPayload | null {
    const beneficiario = this.form.beneficiario.trim();
    const montoCuota = Number(this.form.montoCuota);
    const fechaPrimerVencimiento = this.form.fechaPrimerVencimiento?.trim();
    const cantidadCuotas = Math.min(
      Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1)),
      120
    );
    if (
      !beneficiario ||
      !fechaPrimerVencimiento ||
      !Number.isFinite(montoCuota) ||
      montoCuota === 0
    ) {
      return null;
    }

    return {
      beneficiario,
      montoCuota,
      cantidadCuotas,
      fechaPrimerVencimiento,
      ambito: this.usesAmbitoSeparation ? this.formAmbito : undefined,
      notas: this.form.notas.trim() || undefined,
      categoriaId: this.form.categoriaId.trim() || undefined,
    };
  }
}
