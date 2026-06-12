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
  buildFinanzasPagoConfigKey,
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
import {
  FORM_COMPACT_LABEL_CLASS,
  FORM_COMPACT_LABEL_ROW_CLASS,
  FORM_PAYMENT_PAIR_GRID_CLASS,
} from '../../shared/components/form-shell/form-field.constants';
import { SegmentedControlComponent, SegmentedOption } from '../../shared/components/segmented-control/segmented-control.component';
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
    <form (submit)="submit(); $event.preventDefault()" class="space-y-3 sm:space-y-4">
      <app-transaction-save-banner [message]="saveFeedback.successMessage"></app-transaction-save-banner>

      <p
        *ngIf="editingObligationId"
        class="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-lg px-3 py-1.5 leading-snug m-0">
        Podés corregir nombre, monto o cuotas. Las ya pagadas conservan su estado; si cambiás el monto por cuota,
        se actualiza también el egreso en caja vinculado.
      </p>

      <div
        *ngIf="usesAmbitoSeparation"
        class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,12rem)] sm:items-end gap-2 sm:gap-4">
        <div class="min-w-0">
          <span [class]="compactLabelUpperClass">Etiqueta</span>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 mb-0 leading-snug hidden sm:block">
            Egreso en caja según ámbito al pagar.
          </p>
        </div>
        <app-segmented-control
          ariaLabel="Ámbito"
          size="sm"
          [options]="cajaAmbitos"
          [(value)]="formAmbito">
        </app-segmented-control>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div class="min-w-0">
          <label [class]="compactLabelClass">Categoría (opcional)</label>
          <select
            [(ngModel)]="form.categoriaId"
            name="categoriaId"
            [class]="fieldClass">
            <option value="">Sin categoría</option>
            <option *ngFor="let cat of categoriasGasto" [ngValue]="cat.id">{{ cat.label }}</option>
          </select>
        </div>
        <div class="min-w-0">
          <label [class]="compactLabelClass">Concepto / beneficiario</label>
          <input
            [(ngModel)]="form.beneficiario"
            name="beneficiario"
            required
            placeholder="Ej: Sueldo María, VPS DigitalOcean, EDESUR..."
            [class]="fieldClass">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-end gap-2 sm:gap-4">
        <div class="min-w-0">
          <span [class]="compactLabelUpperClass">Tipo de pago</span>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 mb-0 leading-snug">
            {{ form.tipo === 'mensual' ? 'Se repite cada mes.' : 'Una vez o en cuotas.' }}
          </p>
        </div>
        <app-segmented-control
          ariaLabel="Tipo de pago"
          size="sm"
          [options]="tipoOptions"
          [value]="form.tipo"
          (valueChange)="onTipoChange($event)">
        </app-segmented-control>
      </div>

      <div *ngIf="form.tipo === 'unico'" class="space-y-2">
        <p [class]="compactLabelClass + ' mb-1'">Forma de pago</p>
        <div [class]="paymentPairGridClass">
          <div class="min-w-0" [class.col-span-2]="!pagoRequiereCuentaVisible">
            <label class="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Medio de pago</label>
            <select
              [ngModel]="pagoMedioId"
              (ngModelChange)="onPagoMedioChange($event)"
              name="pagoMedioId"
              [class]="fieldClass + ' bg-white dark:bg-gray-900'">
              <option *ngFor="let medio of mediosPago" [ngValue]="medio.id">{{ medio.label }}</option>
            </select>
          </div>
          <div *ngIf="pagoRequiereCuentaVisible" class="min-w-0">
            <label class="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Cuenta / tarjeta</label>
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

      <div *ngIf="form.tipo === 'unico'" class="min-w-0">
        <label [class]="compactLabelClass">Cantidad de pagos / cuotas</label>
        <input
          [(ngModel)]="form.cantidadCuotas"
          name="cantidadCuotas"
          type="number"
          min="1"
          max="120"
          required
          [class]="fieldClass + ' sm:max-w-[10rem]'">
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">1 = un solo pago.</p>
      </div>

      <div *ngIf="showsMontoModoSelector" class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-end gap-2 sm:gap-4">
        <span [class]="compactLabelUpperClass">¿Qué monto ingresás?</span>
        <app-segmented-control
          ariaLabel="Modo de monto"
          size="sm"
          [options]="montoModoOptions"
          [value]="montoModo"
          (valueChange)="onMontoModoChange($event)">
        </app-segmented-control>
      </div>

      <div [class]="paymentPairGridClass">
        <div class="min-w-0">
          <label [class]="compactLabelClass">Primer vencimiento</label>
          <input
            [(ngModel)]="form.fechaPrimerVencimiento"
            name="fechaPrimerVencimiento"
            type="date"
            required
            [class]="fieldClass">
        </div>
        <div class="min-w-0">
          <label [class]="compactLabelClass">{{ montoFieldLabel }}</label>
          <input
            [(ngModel)]="form.monto"
            name="monto"
            type="number"
            step="0.01"
            required
            [class]="fieldClass">
          <p *ngIf="montoFieldHint" class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
            {{ montoFieldHint }}
          </p>
        </div>
      </div>

      <div class="min-w-0">
        <label [class]="compactLabelClass">Notas (opcional)</label>
        <textarea
          [(ngModel)]="form.notas"
          name="notas"
          rows="3"
          placeholder="Referencia, CBU, nº de factura..."
          [class]="fieldClass + ' resize-y min-h-[4.5rem]'"></textarea>
      </div>

      <app-form-footer
        *ngIf="showFooter"
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
  @Input() showFooter = true;

  @Output() saved = new EventEmitter<TransactionFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  readonly fieldClass = TRANSACTION_COMPACT_FIELD_CLASS;
  readonly paymentPairGridClass = FORM_PAYMENT_PAIR_GRID_CLASS;
  readonly compactLabelClass = FORM_COMPACT_LABEL_CLASS;
  readonly compactLabelUpperClass =
    FORM_COMPACT_LABEL_ROW_CLASS +
    ' text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

  readonly tipoOptions: SegmentedOption[] = [
    { id: 'mensual', label: 'Mensual' },
    { id: 'unico', label: 'Único / cuotas' },
  ];

  readonly montoModoOptions: SegmentedOption[] = [
    { id: 'cuota', label: 'Por cuota' },
    { id: 'total', label: 'Total' },
  ];

  private payables = inject(PayablesService);
  private catalogConfig = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private cdr = inject(ChangeDetectorRef);

  readonly saveFeedback = new TransactionSaveFeedback();

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  formAmbito = '';
  private finanzasPagoConfigKey = '';
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
      this.applyAppConfig(config);
    });
    this.catalogConfig.getAppConfig().subscribe();
    this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
  }

  private applyAppConfig(config: AppConfig): void {
    this.appConfig = config;
    if (!this.formAmbito && this.usesAmbitoSeparation) {
      this.formAmbito = getDefaultCashAmbitoId(config);
    }
    const finanzasKey = buildFinanzasPagoConfigKey(config);
    const finanzasChanged = finanzasKey !== this.finanzasPagoConfigKey;
    if (finanzasChanged) {
      this.finanzasPagoConfigKey = finanzasKey;
    }
    const medioInvalid = !this.mediosPago.some((m) => m.id === this.pagoMedioId);
    if (medioInvalid || finanzasChanged) {
      this.applyPagoMedioState(
        medioInvalid ? this.resolveDefaultPagoMedioId() : this.pagoMedioId
      );
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.saveFeedback.destroy();
  }

  onPagoMedioChange(medioId: string): void {
    if (medioId === this.pagoMedioId) return;
    this.applyPagoMedioState(medioId);
  }

  onTipoChange(value: string): void {
    if (value !== 'mensual' && value !== 'unico') return;
    this.form.tipo = value;
    this.cdr.markForCheck();
  }

  onMontoModoChange(value: string): void {
    if (value !== 'cuota' && value !== 'total') return;
    this.montoModo = value;
    this.cdr.markForCheck();
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

    if (obligation.tipo === 'unico' && obligation.medioPagoId) {
      this.applyPagoMedioState(obligation.medioPagoId);
      if (obligation.tarjetaId) {
        this.pagoTarjetaId = obligation.tarjetaId;
      }
    } else {
      this.applyPagoMedioState(this.resolveDefaultPagoMedioId());
    }

    const cuotas = Math.max(1, obligation.cantidadCuotas || 1);
    if (this.form.tipo === 'unico' && cuotas > 1 && this.pagoGeneraCuotasVisible) {
      // Tarjeta/crédito: el formulario muestra el monto total a dividir.
      this.form.monto = Math.round(obligation.monto * cuotas * 100) / 100;
      this.montoModo = 'total';
    } else {
      this.form.monto = obligation.monto;
      this.montoModo = 'cuota';
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
