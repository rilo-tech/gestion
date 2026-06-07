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
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getCategoriasGasto,
  getDefaultCashAmbitoId,
  getMedioPagoConfig,
  getMediosPagoActivos,
  getTarjetasForMedio,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  usesCashAmbitoSeparation,
  type CajaAmbitoConfig,
  type MedioPagoConfig,
  type TarjetaConfig,
} from '../../core/services/catalog-config.service';
import {
  CreatePayableObligationPayload,
  PayableObligation,
  PayableTipo,
  PayablesService,
} from '../../core/services/payables.service';
import { DialogService } from '../../core/services/dialog.service';
import { FormFooterComponent } from '../../shared/components/form-shell';
import {
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
  TransactionFormSaveEvent,
} from '../../shared/components/transaction-form';
import { TRANSACTION_COMPACT_FIELD_CLASS } from '../../shared/components/transaction-form/transaction-form.constants';
import { SegmentedControlComponent } from '../../shared/components/segmented-control/segmented-control.component';
import { Subscription, finalize } from 'rxjs';

@Component({
  selector: 'app-payable-obligation-form-panel',
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

      <p
        *ngIf="editingObligationId"
        class="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-lg px-3 py-2 leading-snug m-0">
        Podés corregir nombre, monto total o cuotas. Las cuotas ya pagadas conservan su estado;
        si ajustás el monto por cuota, se actualizan también el importe pagado y el egreso en caja vinculado.
      </p>

      <div *ngIf="usesAmbitoSeparation">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Etiqueta</label>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-snug">
          Al pagar el gasto, el egreso en caja se registra en el ámbito elegido (Rilo o Personal).
        </p>
        <app-segmented-control
          ariaLabel="Ámbito"
          [options]="cajaAmbitos"
          [(value)]="formAmbito">
        </app-segmented-control>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría (opcional)</label>
          <select
            [(ngModel)]="form.categoriaId"
            name="categoriaId"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">Sin categoría</option>
            <option *ngFor="let cat of categoriasGasto" [ngValue]="cat.id">{{ cat.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Concepto / beneficiario</label>
          <input
            [(ngModel)]="form.beneficiario"
            name="beneficiario"
            required
            placeholder="Ej: Sueldo María, VPS DigitalOcean, EDESUR..."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipo de pago</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label
            class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
            [class.border-teal-500]="form.tipo === 'mensual'"
            [class.bg-teal-50]="form.tipo === 'mensual'"
            [class.border-gray-200]="form.tipo !== 'mensual'">
            <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="mensual" class="mt-1">
            <span>
              <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">Mensual recurrente</span>
              <span class="block text-xs text-gray-500 mt-0.5">Se repite cada mes hasta desactivarlo.</span>
            </span>
          </label>
          <label
            class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
            [class.border-teal-500]="form.tipo === 'unico'"
            [class.bg-teal-50]="form.tipo === 'unico'"
            [class.border-gray-200]="form.tipo !== 'unico'">
            <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="unico" class="mt-1">
            <span>
              <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">Pago único / en cuotas</span>
              <span class="block text-xs text-gray-500 mt-0.5">Una vez o N cuotas (tarjeta, transferencia, etc.).</span>
            </span>
          </label>
        </div>
      </div>

      <div *ngIf="form.tipo === 'unico'" class="space-y-2">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Forma de pago</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 items-start">
          <div class="min-w-0">
            <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Medio de pago</label>
            <select
              [ngModel]="pagoMedioId"
              (ngModelChange)="onPagoMedioChange($event)"
              name="pagoMedioId"
              [class]="fieldClass + ' bg-white dark:bg-gray-900'">
              <option *ngFor="let medio of mediosPago" [ngValue]="medio.id">{{ medio.label }}</option>
            </select>
          </div>
          <div *ngIf="pagoRequiereCuentaVisible" class="min-w-0">
            <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cuenta / tarjeta</label>
            <select
              [(ngModel)]="pagoTarjetaId"
              [name]="'pagoCuenta_' + pagoMedioId"
              [disabled]="cuentasPagoList.length === 0"
              [class]="fieldClass + ' bg-white dark:bg-gray-900'">
              <option value="">Seleccionar...</option>
              <option *ngFor="let cuenta of cuentasPagoList" [ngValue]="cuenta.id">{{ cuenta.label }}</option>
            </select>
          </div>
        </div>
        <p *ngIf="pagoResumenHint" class="text-[11px] text-gray-500 dark:text-gray-400 leading-snug m-0">
          {{ pagoResumenHint }}
        </p>
        <p
          *ngIf="cuentasPagoList.length === 0 && pagoRequiereCuentaVisible"
          class="text-[11px] text-amber-600 dark:text-amber-400 leading-snug m-0">
          Agregá cuentas en Finanzas → Configurar cuentas (medio «{{ pagoMedioLabel }}»).
        </p>
      </div>

      <div
        class="grid grid-cols-1 gap-4"
        [ngClass]="form.tipo === 'unico' ? 'sm:grid-cols-2' : 'sm:grid-cols-2'">
        <div *ngIf="form.tipo === 'unico'" class="min-w-0">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cantidad de pagos / cuotas</label>
          <input
            [(ngModel)]="form.cantidadCuotas"
            name="cantidadCuotas"
            type="number"
            min="1"
            max="120"
            required
            [class]="fieldClass">
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">1 = un solo pago.</p>
        </div>
        <div class="min-w-0">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Primer vencimiento</label>
          <input
            [(ngModel)]="form.fechaPrimerVencimiento"
            name="fechaPrimerVencimiento"
            type="date"
            required
            [class]="fieldClass">
        </div>
      </div>

      <div *ngIf="showsMontoModoSelector" class="space-y-2">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">¿Qué monto vas a ingresar?</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors"
            [class.border-teal-500]="montoModo === 'cuota'"
            [class.bg-teal-50]="montoModo === 'cuota'"
            [class.border-gray-200]="montoModo !== 'cuota'">
            <input type="radio" [(ngModel)]="montoModo" name="montoModo" value="cuota" class="mt-0.5">
            <span>
              <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">Monto por cuota</span>
              <span class="block text-xs text-gray-500 mt-0.5">Cada vencimiento tiene el mismo importe.</span>
            </span>
          </label>
          <label
            class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors"
            [class.border-teal-500]="montoModo === 'total'"
            [class.bg-teal-50]="montoModo === 'total'"
            [class.border-gray-200]="montoModo !== 'total'">
            <input type="radio" [(ngModel)]="montoModo" name="montoModo" value="total" class="mt-0.5">
            <span>
              <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">Monto total</span>
              <span class="block text-xs text-gray-500 mt-0.5">El sistema divide el total entre las cuotas.</span>
            </span>
          </label>
        </div>
      </div>

      <div class="min-w-0">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ montoFieldLabel }}</label>
        <input
          [(ngModel)]="form.monto"
          name="monto"
          type="number"
          step="0.01"
          required
          [class]="fieldClass">
        <p *ngIf="montoFieldHint" class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ montoFieldHint }}</p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
        <input
          [(ngModel)]="form.notas"
          name="notas"
          placeholder="Referencia, CBU, nº de factura..."
          class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
      </div>

      <app-form-footer
        mode="inline"
        [showCancel]="true"
        [saveLabel]="footerSaveLabel"
        [saving]="saveFeedback.saving"
        [saveDisabled]="saveFeedback.saving"
        [successMessage]="saveFeedback.successMessage"
        (cancelClick)="cancelled.emit()"
        (saveClick)="submit()">
      </app-form-footer>
    </form>
  `,
})
export class PayableObligationFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() initialAmbito = '';
  @Input() editingObligationId: string | null = null;
  @Input() initialObligation: PayableObligation | null = null;

  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;

  private payables = inject(PayablesService);
  private catalogConfig = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private cdr = inject(ChangeDetectorRef);

  readonly saveFeedback = new TransactionSaveFeedback();

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  formAmbito = '';
  private configSub?: Subscription;

  pagoMedioId = 'efectivo';
  pagoTarjetaId = '';
  pagoMedioLabel = '';
  pagoRequiereCuentaVisible = false;
  pagoGeneraCuotasVisible = false;
  pagoResumenHint = '';
  cuentasPagoList: TarjetaConfig[] = [];
  montoModo: 'cuota' | 'total' = 'cuota';

  form = {
    presetId: '',
    beneficiario: '',
    monto: null as number | null,
    tipo: 'mensual' as PayableTipo,
    cantidadCuotas: 1,
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

  get mediosPago(): MedioPagoConfig[] {
    return getMediosPagoActivos(this.appConfig);
  }

  get showsMontoModoSelector(): boolean {
    if (this.form.tipo !== 'unico') return false;
    const n = Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1));
    if (n <= 1) return false;
    return !this.pagoGeneraCuotasVisible;
  }

  get montoFieldLabel(): string {
    if (this.form.tipo === 'unico' && this.pagoGeneraCuotasVisible) {
      return 'Monto total';
    }
    if (this.showsMontoModoSelector) {
      return this.montoModo === 'total' ? 'Monto total' : 'Monto por cuota';
    }
    return 'Monto';
  }

  get montoFieldHint(): string | null {
    const n = Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1));
    const monto = Number(this.form.monto);

    if (this.form.tipo === 'unico' && this.pagoGeneraCuotasVisible && n > 1) {
      if (Number.isFinite(monto) && monto > 0) {
        const porCuota = Math.round((monto / n) * 100) / 100;
        return `Total ÷ ${n} = ${n} cuota(s) de $${porCuota} en la tarjeta. Al pagar, saldás cuota por cuota o el resumen mensual.`;
      }
      return `Se divide en ${n} cuota(s) en la cuenta seleccionada (como una compra con tarjeta).`;
    }

    if (this.showsMontoModoSelector && Number.isFinite(monto) && monto > 0) {
      if (this.montoModo === 'total') {
        const porCuota = Math.round((monto / n) * 100) / 100;
        return `Total ÷ ${n} = ${n} cuota(s) de $${porCuota}. Al pagar, registrás una cuota por vez.`;
      }
      const total = Math.round(monto * n * 100) / 100;
      return `${n} cuota(s) de $${monto} = total $${total}. Al pagar, registrás una cuota por vez.`;
    }

    if (this.form.tipo === 'mensual') {
      return 'Monto de cada vencimiento mensual.';
    }
    return null;
  }

  get footerSaveLabel(): string {
    return this.editingObligationId ? 'Guardar cambios' : 'Crear gasto';
  }

  get saveSuccessMessage(): string {
    return this.saveFeedback.successMessage;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialObligation'] || changes['editingObligationId']) {
      const id = this.editingObligationId;
      if (id && this.saveFeedback.consumeSkipReload(id)) {
        return;
      }
      if (this.initialObligation) {
        this.loadFromObligation(this.initialObligation);
      }
    }
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
      const medioInvalid = !this.mediosPago.some((m) => m.id === this.pagoMedioId);
      if (medioInvalid) {
        this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
      }
      this.cdr.markForCheck();
    });
    this.catalogConfig.getAppConfig().subscribe();
    this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.saveFeedback.destroy();
  }

  onPagoMedioChange(medioId: string): void {
    if (medioId === this.pagoMedioId) return;
    this.applyPagoMedioState(medioId);
  }

  submitForm(): void {
    this.submit();
  }

  submit(): void {
    const payload = this.buildPayload();
    if (!payload) {
      this.dialog.alert({
        message: 'Completá beneficiario, monto, fecha y forma de pago (cuenta y cuotas si es crédito).',
      });
      return;
    }
    if (!this.saveFeedback.tryBeginSave()) return;
    this.savingChange.emit(true);

    const editingId = this.editingObligationId?.trim() || null;
    const request$ = editingId
      ? this.payables.updateObligation(editingId, payload)
      : this.payables.createObligation(payload);

    request$
      .pipe(
        finalize(() => {
          this.saveFeedback.endSave();
          this.savingChange.emit(false);
        })
      )
      .subscribe({
        next: (result) => {
          const id = result.obligation.id;
          const message = editingId
            ? 'Gasto / servicio actualizado'
            : 'Gasto / servicio guardado';
          this.saveFeedback.showSuccess(message);
          this.saveFeedback.markSkipReload(id);
          this.saved.emit({ id, freshSave: !editingId });
        },
        error: (err) => {
          const msg =
            typeof err?.error?.error === 'string'
              ? err.error.error
              : editingId
                ? 'No se pudo actualizar la obligación.'
                : 'No se pudo crear la obligación.';
          this.dialog.alert({ message: msg });
        },
      });
  }

  private loadFromObligation(obligation: PayableObligation): void {
    this.form.beneficiario = obligation.beneficiario;
    this.form.tipo = obligation.tipo;
    this.form.cantidadCuotas = Math.max(1, obligation.cantidadCuotas || 1);
    this.form.fechaPrimerVencimiento =
      obligation.fechaPrimerVencimiento?.slice(0, 10) ||
      new Date().toISOString().slice(0, 10);
    this.form.notas = obligation.notas ?? '';
    this.form.categoriaId = obligation.categoriaId ?? '';

    if (this.usesAmbitoSeparation && obligation.ambito) {
      this.formAmbito = obligation.ambito;
    }

    const cuotas = Math.max(1, obligation.cantidadCuotas || 1);
    if (obligation.tipo === 'unico' && cuotas > 1 && obligation.origenTipo !== 'prestamo') {
      this.form.monto = Math.round(obligation.monto * cuotas * 100) / 100;
      this.montoModo = 'total';
    } else {
      this.form.monto = obligation.monto;
      this.montoModo = 'cuota';
    }

    if (obligation.tipo === 'unico' && obligation.medioPagoId) {
      this.applyPagoMedioState(obligation.medioPagoId);
      if (obligation.tarjetaId) {
        this.pagoTarjetaId = obligation.tarjetaId;
      }
    } else {
      this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
    }

    this.cdr.markForCheck();
  }

  private buildPayload(): CreatePayableObligationPayload | null {
    const beneficiario = this.form.beneficiario.trim();
    let monto = Number(this.form.monto);
    const fechaPrimerVencimiento = this.form.fechaPrimerVencimiento?.trim();
    if (!beneficiario || !fechaPrimerVencimiento || !Number.isFinite(monto) || monto === 0) {
      return null;
    }

    const cantidadCuotas =
      this.form.tipo === 'unico'
        ? Math.min(Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1)), 120)
        : 1;

    if (this.form.tipo === 'unico' && cantidadCuotas > 1) {
      if (this.pagoGeneraCuotasVisible || this.montoModo === 'total') {
        monto = Math.round((monto / cantidadCuotas) * 100) / 100;
      }
    }

    const payload: CreatePayableObligationPayload = {
      beneficiario,
      monto,
      tipo: this.form.tipo,
      cantidadCuotas,
      fechaPrimerVencimiento,
      ambito: this.usesAmbitoSeparation ? this.formAmbito : undefined,
      notas: this.form.notas.trim() || undefined,
      categoriaId: this.form.categoriaId.trim() || undefined,
    };

    if (this.form.tipo === 'unico') {
      payload.medioPagoId = this.pagoMedioId;
      if (this.pagoRequiereCuentaVisible) {
        if (!this.pagoTarjetaId.trim()) return null;
        payload.tarjetaId = this.pagoTarjetaId.trim();
        const cuenta = this.cuentasPagoList.find((c) => c.id === payload.tarjetaId);
        payload.tarjetaLabel = cuenta?.label;
      }
      if (this.pagoGeneraCuotasVisible && !fechaPrimerVencimiento) {
        return null;
      }
    }

    return payload;
  }

  private applyPagoMedioState(medioId: string): void {
    this.pagoMedioId = medioId;
    const medio = getMedioPagoConfig(this.appConfig, medioId);
    this.pagoMedioLabel = medio?.label ?? medioId;

    const requiereCuenta = this.resolvePagoRequiereCuenta(medio);
    const generaCuotas = this.resolvePagoGeneraCuotas(medio);
    this.cuentasPagoList = requiereCuenta ? getTarjetasForMedio(this.appConfig, medioId) : [];

    if (!requiereCuenta) {
      this.pagoTarjetaId = '';
    } else if (!this.cuentasPagoList.some((c) => c.id === this.pagoTarjetaId)) {
      this.pagoTarjetaId = this.cuentasPagoList[0]?.id ?? '';
    }

    if (!generaCuotas && this.form.tipo === 'unico') {
      // keep cantidadCuotas from manual field
    }

    this.pagoRequiereCuentaVisible = requiereCuenta;
    this.pagoGeneraCuotasVisible = generaCuotas;
    this.pagoResumenHint = this.resolvePagoResumenHint(medio, generaCuotas);
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
      return 'Las cuotas aparecerán en Cuentas a pagar bajo la tarjeta elegida. Podés saldar el resumen mensual después.';
    }
    if (medio?.generaEgresoCaja === true) {
      return 'Al crear se registra un egreso en caja (si el medio lo indica).';
    }
    return '';
  }

  private resolveDefaultPagoMedioId(): string {
    if (this.mediosPago.some((m) => m.id === 'efectivo')) return 'efectivo';
    return this.mediosPago[0]?.id ?? 'efectivo';
  }
}
