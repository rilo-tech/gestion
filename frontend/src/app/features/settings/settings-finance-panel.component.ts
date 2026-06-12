import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AppConfig,
  CatalogConfigService,
  ConfigRemovalKind,
  ConfigUsageHit,
  DEFAULT_APP_CONFIG,
  MedioPagoConfig,
  slugifyCajaAmbitoId,
  getCajaAmbitos,
  getMediosPagoConCuentaHija,
  isSystemCashAmbito,
  BUSINESS_CASH_AMBITO_ID,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  syncMedioPagoFlags,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { ConfigSettingCardComponent } from '../../shared/components/config-setting-card/config-setting-card.component';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
  type ConfigEditableListSelectOption,
} from '../../shared/components/config-editable-list/config-editable-list.component';
import { ConfigListRemoveButtonComponent } from '../../shared/components/config-editable-list/config-list-remove-button.component';
import {
  CONFIG_EDITABLE_LIST_ROW_BODY_CLASS,
  CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS,
  CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS,
  CONFIG_SETTING_DESC_CLASS,
} from '../../shared/components/config-editable-list/config-editable-list.constants';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { Subscription } from 'rxjs';

const TARJETA_AMBITO_AMBOS_ID = 'ambos';

type FinanceSectionId = 'medios' | 'tarjetas' | 'conceptosIngreso' | 'categorias' | 'comprobantes';

interface TarjetaMedioGroupView {
  medioId: string;
  medioLabel: string;
  inactiveMedio: boolean;
  items: ConfigEditableListItem[];
}

@Component({
  selector: 'app-settings-finance-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ConfigSettingCardComponent,
    ConfigEditableListComponent,
    ConfigListRemoveButtonComponent,
    FormSaveFooterComponent,
  ],
  template: `
    <section [class]="sectionClass">
      <div [class]="sectionsListClass">
        <app-config-setting-card
          title="Medios de pago"
          description="Definí el nombre y si cada medio genera egreso de caja al instante, cuentas a pagar, o ambos según corresponda."
          [listCount]="config.finanzas.mediosPago.length"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('medios')"
          (listExpandedChange)="onFinanceSectionToggle('medios', $event)"
          [cardClass]="cardClass">
          <div configList class="space-y-2">
            <div class="flex flex-col sm:flex-row gap-1.5">
              <input
                [(ngModel)]="medioDraft"
                name="medioPagoDraft"
                placeholder="Ej. Cheque, Cuenta corriente..."
                [disabled]="saving"
                (keydown.enter)="addMedioFromDraft($event)"
                class="flex-1 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
              <button
                type="button"
                (click)="addMedioFromDraft()"
                [disabled]="saving || !medioDraft.trim()"
                class="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                Agregar
              </button>
            </div>

            <ul class="space-y-2 m-0 p-0 list-none">
              <li
                *ngFor="let medio of config.finanzas.mediosPago; trackBy: trackMedioId"
                class="relative rounded-lg border border-gray-100 dark:border-gray-700 p-2.5 space-y-2">
                <div [class]="configRowShellClass">
                  <input
                    [ngModel]="medio.label"
                    (ngModelChange)="onMedioLabelChange(medio.id, $event)"
                    (blur)="persist()"
                    [name]="'medio_label_' + medio.id"
                    [disabled]="saving"
                    class="flex-1 min-w-0 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
                  <app-config-list-remove-button
                    [disabled]="saving || (!!removalBusyId && removalBusyId !== medio.id)"
                    [loading]="removalBusyId === medio.id"
                    (clicked)="removeMedioById(medio.id)">
                  </app-config-list-remove-button>
                </div>

                <div class="flex flex-col gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <label class="flex items-start gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      [checked]="medio.generaEgresoCaja === true"
                      (change)="setMedioFlag(medio.id, 'generaEgresoCaja', $any($event.target).checked)"
                      [disabled]="saving"
                      class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                    <span class="leading-snug">Genera egreso de caja al confirmar</span>
                  </label>

                  <label class="flex items-start gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      [checked]="medio.generaCuentasPagar === true"
                      (change)="setMedioFlag(medio.id, 'generaCuentasPagar', $any($event.target).checked)"
                      [disabled]="saving"
                      class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                    <span class="leading-snug">Genera cuentas a pagar</span>
                  </label>
                  <label
                    *ngIf="medio.generaCuentasPagar"
                    class="flex items-start gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      [checked]="medio.requiereCuentaHija === true"
                      (change)="setMedioFlag(medio.id, 'requiereCuentaHija', $any($event.target).checked)"
                      [disabled]="saving"
                      class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                    <span class="leading-snug">Requiere elegir cuenta (tarjeta, crédito, etc.)</span>
                  </label>
                </div>

                <p class="text-[10px] text-gray-400 leading-snug m-0">{{ getMedioResumen(medio) }}</p>
              </li>
              <li *ngIf="config.finanzas.mediosPago.length === 0" class="text-xs text-gray-400 py-2">
                Todavía no hay medios de pago configurados.
              </li>
            </ul>
          </div>
        </app-config-setting-card>

        <app-config-setting-card
          title="Configurar cuentas"
          description="Una lista por cada medio de pago que requiere cuenta (arriba). Editá el nombre y el impacto del gasto: negocio, personal o ambos."
          [listCount]="config.finanzas.tarjetas.length"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('tarjetas')"
          (listExpandedChange)="onFinanceSectionToggle('tarjetas', $event)"
          [cardClass]="cardClass">
          <div configList class="space-y-4">
            <div
              *ngIf="tarjetaMedioGroupViews.length === 0"
              class="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-100 leading-snug">
              Activá en <span class="font-semibold">Medios de pago</span> la opción «Genera cuentas a pagar» y «Requiere elegir cuenta» para ver listas acá.
            </div>

            <div
              *ngFor="let group of tarjetaMedioGroupViews; trackBy: trackTarjetaMedioGroup"
              class="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5 sm:p-3 space-y-2">
              <div class="flex items-center justify-between gap-2 min-w-0">
                <div class="min-w-0">
                  <h4 class="text-xs font-bold uppercase tracking-wide text-gray-800 dark:text-gray-100 truncate">
                    {{ group.medioLabel }}
                  </h4>
                  <p
                    *ngIf="group.inactiveMedio"
                    class="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5 leading-snug">
                    Medio desactivado en configuración; las cuentas se conservan.
                  </p>
                </div>
                <span
                  *ngIf="group.items.length > 0"
                  class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 text-[10px] font-bold tabular-nums shrink-0">
                  {{ group.items.length }}
                </span>
              </div>

              <app-config-editable-list
                [items]="group.items"
                labelMode="input"
                [showAdd]="!group.inactiveMedio"
                [addPlaceholder]="'Ej. cuenta de ' + group.medioLabel"
                emptyMessage="Sin cuentas. Agregá una arriba."
                [disabled]="saving || !!removalBusyId"
                [busyRemoveId]="removalBusyId"
                [inputName]="'tarjetaDraft_' + group.medioId"
                [inputNamePrefix]="'tarjeta_' + group.medioId"
                listMaxHeightClass=""
                (add)="addTarjetaForMedio(group.medioId, $event)"
                (remove)="removeTarjetaById($event)"
                (labelChange)="onTarjetaLabelChange($event)"
                (labelBlur)="persist()"
                (selectChange)="onTarjetaAmbitoSelectChange($event)">
              </app-config-editable-list>
            </div>
          </div>
        </app-config-setting-card>

        <app-config-setting-card
          title="Conceptos de ingreso"
          description="Opciones desplegables al registrar ingresos manuales en Caja. Si no cargás ninguno, el concepto queda como texto libre."
          [listCount]="config.finanzas.conceptosIngreso.length"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('conceptosIngreso')"
          (listExpandedChange)="onFinanceSectionToggle('conceptosIngreso', $event)"
          [cardClass]="cardClass">
          <app-config-editable-list
            configList
            [items]="conceptoIngresoListItems"
            labelMode="input"
            addPlaceholder="Ej. Venta mostrador, Diferencia de caja"
            [disabled]="saving || !!removalBusyId"
            [busyRemoveId]="removalBusyId"
            inputName="conceptoIngresoDraft"
            listMaxHeightClass=""
            (add)="addConceptoIngresoFromList($event)"
            (remove)="removeConceptoIngresoById($event)"
            (labelChange)="onConceptoIngresoLabelChange($event)"
            (labelBlur)="persist()">
          </app-config-editable-list>
        </app-config-setting-card>

        <app-config-setting-card
          title="Categorías de gasto"
          description="Compras, cuentas a pagar y egresos rápidos en Caja (envíos, gastos chicos)."
          [listCount]="config.finanzas.categoriasGasto.length"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('categorias')"
          (listExpandedChange)="onFinanceSectionToggle('categorias', $event)"
          [cardClass]="cardClass">
          <app-config-editable-list
            configList
            [items]="categoriaGastoListItems"
            labelMode="input"
            addPlaceholder="Ej. Insumos sublimación"
            [disabled]="saving || !!removalBusyId"
            [busyRemoveId]="removalBusyId"
            inputName="categoriaGastoDraft"
            listMaxHeightClass=""
            (add)="addCategoriaFromList($event)"
            (remove)="removeCategoriaById($event)"
            (labelChange)="onCategoriaGastoLabelChange($event)"
            (labelBlur)="persist()">
          </app-config-editable-list>
        </app-config-setting-card>

        <app-config-setting-card
          title="Notas de crédito y débito"
          description="Habilitá comprobantes adicionales en los formularios de Compras y Ventas. Si están desactivados, los formularios se ven igual que siempre."
          [listCount]="comprobantesActivosCount"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('comprobantes')"
          (listExpandedChange)="onFinanceSectionToggle('comprobantes', $event)"
          [cardClass]="cardClass">
          <div configList class="space-y-3">
            <label class="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                [checked]="config.comprobantes.notaCreditoActiva"
                (change)="setComprobanteFlag('notaCreditoActiva', $any($event.target).checked)"
                [disabled]="saving"
                class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
              <span class="leading-snug text-sm text-gray-700 dark:text-gray-300">
                <span class="font-semibold">Nota de crédito</span>
                <span [class]="configSettingDescClass">
                  Devoluciones: en compras saca stock y baja el saldo; en ventas reingresa stock y genera saldo a favor del cliente.
                </span>
              </span>
            </label>
            <label class="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                [checked]="config.comprobantes.notaDebitoActiva"
                (change)="setComprobanteFlag('notaDebitoActiva', $any($event.target).checked)"
                [disabled]="saving"
                class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
              <span class="leading-snug text-sm text-gray-700 dark:text-gray-300">
                <span class="font-semibold">Nota de débito</span>
                <span [class]="configSettingDescClass">
                  Ajustes que aumentan el saldo. Mueve stock igual que una factura.
                </span>
              </span>
            </label>
          </div>
        </app-config-setting-card>
      </div>

      <div class="mt-6 sm:mt-8">
        <app-form-save-footer
          [saving]="saving"
          [successMessage]="saveSuccessMessage"
          label="Guardar"
          [centerOnLarge]="true"
          (saveClick)="saveConfiguration()">
        </app-form-save-footer>
      </div>
    </section>
  `,
})
export class SettingsFinancePanelComponent implements OnInit, OnDestroy {
  private catalog = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private configSub?: Subscription;

  config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  tarjetaMedioGroupViews: TarjetaMedioGroupView[] = [];
  conceptoIngresoListItems: ConfigEditableListItem[] = [];
  categoriaGastoListItems: ConfigEditableListItem[] = [];
  saving = false;
  saveSuccessMessage = '';
  removalBusyId: string | null = null;
  medioDraft = '';
  expandedFinanceSection: FinanceSectionId | null = null;
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  private applyingConfig = false;
  private tarjetaAmbitoSelectOptionsCache: ConfigEditableListSelectOption[] = [];

  readonly sectionClass = 'space-y-4 sm:space-y-6';
  readonly sectionsListClass = 'flex flex-col gap-2 w-full min-w-0';
  readonly cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 sm:p-4 flex flex-col min-w-0';
  readonly configSettingDescClass = CONFIG_SETTING_DESC_CLASS;

  readonly configRowShellClass = CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS;
  readonly configRowBodyClass = CONFIG_EDITABLE_LIST_ROW_BODY_CLASS;
  readonly configRowChipsClass = CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS;

  get cajaAmbitos() {
    return getCajaAmbitos(this.config);
  }

  get mediosConCuentaHija() {
    return getMediosPagoConCuentaHija(this.config);
  }

  get tarjetaAmbitoChips(): Array<{ id: string; label: string; idleClass: string; activeClass: string }> {
    const chips = getCajaAmbitos(this.config).map((ambito) => {
      const negocio = isSystemCashAmbito(ambito);
      return {
        id: ambito.id,
        label: ambito.label,
        idleClass: negocio
          ? 'border-teal-200 text-teal-800 bg-teal-50/50 dark:border-teal-800 dark:text-teal-200 dark:bg-teal-950/30'
          : 'border-violet-200 text-violet-800 bg-violet-50/50 dark:border-violet-800 dark:text-violet-200 dark:bg-violet-950/30',
        activeClass: negocio
          ? 'border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-600'
          : 'border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-600',
      };
    });
    chips.push({
      id: TARJETA_AMBITO_AMBOS_ID,
      label: 'Ambos',
      idleClass:
        'border-amber-200 text-amber-900 bg-amber-50/60 dark:border-amber-800 dark:text-amber-100 dark:bg-amber-950/30',
      activeClass:
        'border-amber-500 bg-amber-500 text-white dark:border-amber-500 dark:bg-amber-500',
    });
    return chips;
  }

  get comprobantesActivosCount(): number {
    let count = 0;
    if (this.config.comprobantes.notaCreditoActiva) count++;
    if (this.config.comprobantes.notaDebitoActiva) count++;
    return count;
  }

  ngOnInit() {
    this.applyLoadedConfig(this.catalog.appConfig);
    this.catalog.getAppConfig().subscribe();
    this.configSub = this.catalog.appConfig$.subscribe((config) => {
      this.applyLoadedConfig(config);
    });
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
      this.saveSuccessTimeout = undefined;
    }
  }

  isFinanceSectionOpen(section: FinanceSectionId): boolean {
    return this.expandedFinanceSection === section;
  }

  onFinanceSectionToggle(section: FinanceSectionId, expanded: boolean) {
    this.expandedFinanceSection = expanded ? section : null;
  }

  saveConfiguration() {
    this.persist();
  }

  trackMedioId(_index: number, medio: MedioPagoConfig): string {
    return medio.id;
  }

  trackTarjetaMedioGroup(_index: number, group: TarjetaMedioGroupView): string {
    return group.medioId;
  }

  getTarjetaMedioLabel(medioPagoId: string): string {
    return (
      this.config.finanzas.mediosPago.find((medio) => medio.id === medioPagoId)?.label ??
      medioPagoId
    );
  }

  getMedioResumen(medio: MedioPagoConfig): string {
    const synced = syncMedioPagoFlags(medio);
    const parts: string[] = [];
    if (medioPagoGeneratesImmediateCash(synced)) {
      parts.push('egreso de caja al registrar');
    }
    if (medioPagoGeneratesPayables(synced)) {
      parts.push(
        synced.requiereCuentaHija
          ? 'cuotas en cuentas a pagar (con cuenta)'
          : 'deuda en cuentas a pagar'
      );
    }
    if (parts.length === 0) return 'Sin movimiento automático al confirmar la compra.';
    return parts.join(' · ');
  }

  setComprobanteFlag(flag: 'notaCreditoActiva' | 'notaDebitoActiva', checked: boolean) {
    if (this.saving) return;
    this.config.comprobantes = {
      ...this.config.comprobantes,
      [flag]: checked,
    };
  }

  onMedioLabelChange(id: string, label: string) {
    const row = this.config.finanzas.mediosPago.find((item) => item.id === id);
    if (row) row.label = label.trim();
  }

  setMedioFlag(
    id: string,
    flag: 'generaEgresoCaja' | 'generaCuentasPagar' | 'requiereCuentaHija',
    checked: boolean
  ) {
    if (this.applyingConfig || this.saving) return;

    const row = this.config.finanzas.mediosPago.find((item) => item.id === id);
    if (!row) return;

    if (row[flag] === checked) {
      if (flag !== 'generaCuentasPagar' || checked || !row.requiereCuentaHija) {
        return;
      }
    }

    row[flag] = checked;
    if (flag === 'requiereCuentaHija') {
      row.requiereTarjeta = checked;
    }
    if (flag === 'generaCuentasPagar' && !checked) {
      row.requiereCuentaHija = false;
      row.requiereTarjeta = false;
    }

    const index = this.config.finanzas.mediosPago.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.config.finanzas.mediosPago[index] = syncMedioPagoFlags(row);
    }
    this.rebuildDerivedViews();
    this.persist();
  }

  addMedioFromDraft(event?: Event) {
    event?.preventDefault();
    const trimmed = this.medioDraft.trim();
    if (!trimmed || this.saving) return;

    const id = slugifyCajaAmbitoId(trimmed);
    if (this.config.finanzas.mediosPago.some((m) => m.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe un medio con ese nombre.' });
      return;
    }

    this.config.finanzas.mediosPago = [
      ...this.config.finanzas.mediosPago,
      syncMedioPagoFlags({
        id,
        label: trimmed,
        comportamiento: 'caja_inmediata',
        generaEgresoCaja: true,
        generaCuentasPagar: false,
        activo: true,
      }),
    ].sort((a, b) => a.label.localeCompare(b.label, 'es'));

    this.medioDraft = '';
    this.expandedFinanceSection = 'medios';
    this.rebuildDerivedViews();
    this.persist();
  }

  removeMedioById(id: string) {
    const medio = this.config.finanzas.mediosPago.find((item) => item.id === id);
    if (!medio || this.saving || this.removalBusyId) return;

    this.confirmRemoval('finanzas.mediosPago', medio.label, id, () => {
      this.config.finanzas.mediosPago = this.config.finanzas.mediosPago.filter(
        (item) => item.id !== id
      );
    });
  }

  onTarjetaLabelChange(event: { id: string; label: string }) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === event.id);
    if (row) row.label = event.label.trim();
  }

  onTarjetaAmbitoSelectChange(event: { id: string; value: string }) {
    if (this.applyingConfig || this.saving) return;
    this.setTarjetaAmbito(event.id, event.value);
  }

  setTarjetaAmbito(tarjetaId: string, ambitoId: string) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === tarjetaId);
    if (!row || row.ambitoDefault === ambitoId) return;
    row.ambitoDefault = ambitoId;
    this.rebuildDerivedViews();
    this.persist();
  }

  onConceptoIngresoLabelChange(event: { id: string; label: string }) {
    const row = this.config.finanzas.conceptosIngreso.find((item) => item.id === event.id);
    if (row) row.label = event.label.trim();
  }

  onCategoriaGastoLabelChange(event: { id: string; label: string }) {
    const row = this.config.finanzas.categoriasGasto.find((item) => item.id === event.id);
    if (row) row.label = event.label.trim();
  }

  addTarjetaForMedio(medioPagoId: string, label: string, event?: Event) {
    event?.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || this.saving) return;

    if (!this.mediosConCuentaHija.some((medio) => medio.id === medioPagoId)) {
      this.dialog.alert({
        title: 'Medio no disponible',
        message:
          'Ese medio ya no está activo para cuentas. Reactivalo en Medios de pago o mové la cuenta desde otra sección.',
      });
      return;
    }

    const id = slugifyCajaAmbitoId(trimmed);
    if (this.config.finanzas.tarjetas.some((t) => t.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe una cuenta con ese nombre.' });
      return;
    }

    this.config.finanzas.tarjetas = [
      {
        id,
        label: trimmed,
        ambitoDefault:
          getCajaAmbitos(this.config).find((a) => !isSystemCashAmbito(a))?.id ?? 'negocio',
        medioPagoId,
        activa: true,
      },
      ...this.config.finanzas.tarjetas,
    ];

    this.expandedFinanceSection = 'tarjetas';
    this.rebuildDerivedViews();
    this.persist();
  }

  removeTarjetaById(id: string) {
    const tarjeta = this.config.finanzas.tarjetas.find((item) => item.id === id);
    if (!tarjeta || this.saving || this.removalBusyId) return;
    this.confirmRemoval('finanzas.tarjetas', tarjeta.label, id, () => {
      this.config.finanzas.tarjetas = this.config.finanzas.tarjetas.filter((item) => item.id !== id);
    });
  }

  addConceptoIngresoFromList(label: string) {
    const trimmed = label.trim();
    if (!trimmed || this.saving) return;
    const id = slugifyCajaAmbitoId(trimmed);
    if (this.config.finanzas.conceptosIngreso.some((item) => item.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe ese concepto de ingreso.' });
      return;
    }
    this.config.finanzas.conceptosIngreso = [
      ...this.config.finanzas.conceptosIngreso,
      { id, label: trimmed },
    ].sort((a, b) => a.label.localeCompare(b.label, 'es'));
    this.expandedFinanceSection = 'conceptosIngreso';
    this.rebuildDerivedViews();
    this.persist();
  }

  removeConceptoIngresoById(id: string) {
    const concepto = this.config.finanzas.conceptosIngreso.find((item) => item.id === id);
    if (!concepto || this.saving || this.removalBusyId) return;

    this.confirmRemoval('finanzas.conceptosIngreso', concepto.label, concepto.label, () => {
      this.config.finanzas.conceptosIngreso = this.config.finanzas.conceptosIngreso.filter(
        (item) => item.id !== id
      );
    });
  }

  addCategoriaFromList(label: string) {
    const trimmed = label.trim();
    if (!trimmed || this.saving) return;
    const id = slugifyCajaAmbitoId(trimmed);
    if (this.config.finanzas.categoriasGasto.some((c) => c.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe esa categoría.' });
      return;
    }
    this.config.finanzas.categoriasGasto = [
      ...this.config.finanzas.categoriasGasto,
      { id, label: trimmed, ambitoDefault: 'negocio', afectaReporteNegocio: true },
    ].sort((a, b) => a.label.localeCompare(b.label, 'es'));
    this.expandedFinanceSection = 'categorias';
    this.rebuildDerivedViews();
    this.persist();
  }

  removeCategoriaById(id: string) {
    const cat = this.config.finanzas.categoriasGasto.find((item) => item.id === id);
    if (!cat || this.saving || this.removalBusyId) return;

    this.confirmRemoval('finanzas.categoriasGasto', cat.label, id, () => {
      this.config.finanzas.categoriasGasto = this.config.finanzas.categoriasGasto.filter(
        (item) => item.id !== id
      );
    });
  }

  private applyLoadedConfig(config: AppConfig) {
    this.applyingConfig = true;
    this.config = structuredClone(config);
    if (!this.config.finanzas) {
      this.config.finanzas = structuredClone(DEFAULT_APP_CONFIG.finanzas);
    }
    if (!Array.isArray(this.config.finanzas.conceptosIngreso)) {
      this.config.finanzas.conceptosIngreso = [];
    }
    this.config.finanzas.mediosPago = (this.config.finanzas.mediosPago ?? []).map((medio) =>
      syncMedioPagoFlags(medio)
    );
    this.rebuildDerivedViews();
    this.applyingConfig = false;
  }

  private rebuildDerivedViews() {
    this.tarjetaAmbitoSelectOptionsCache = this.tarjetaAmbitoChips.map((chip) => ({
      value: chip.id,
      label: chip.label,
    }));

    const selectOptions = this.tarjetaAmbitoSelectOptionsCache;
    const activeMedioIds = new Set(this.mediosConCuentaHija.map((medio) => medio.id));
    const views: TarjetaMedioGroupView[] = [];

    for (const medio of this.mediosConCuentaHija) {
      views.push(this.buildTarjetaMedioGroupView(medio.id, medio.label, false, selectOptions));
    }

    const orphanMedioIds = [
      ...new Set(
        this.config.finanzas.tarjetas
          .filter((tarjeta) => !activeMedioIds.has(tarjeta.medioPagoId))
          .map((tarjeta) => tarjeta.medioPagoId)
      ),
    ].sort((a, b) =>
      this.getTarjetaMedioLabel(a).localeCompare(this.getTarjetaMedioLabel(b), 'es')
    );

    for (const medioId of orphanMedioIds) {
      views.push(
        this.buildTarjetaMedioGroupView(medioId, this.getTarjetaMedioLabel(medioId), true, selectOptions)
      );
    }

    this.tarjetaMedioGroupViews = views;
    this.conceptoIngresoListItems = this.config.finanzas.conceptosIngreso.map((concepto) => ({
      id: concepto.id,
      label: concepto.label,
      removable: true,
    }));
    this.categoriaGastoListItems = this.config.finanzas.categoriasGasto.map((cat) => ({
      id: cat.id,
      label: cat.label,
      removable: true,
    }));
  }

  private buildTarjetaMedioGroupView(
    medioId: string,
    medioLabel: string,
    inactiveMedio: boolean,
    selectOptions: ConfigEditableListSelectOption[]
  ): TarjetaMedioGroupView {
    const items = this.config.finanzas.tarjetas
      .filter((tarjeta) => tarjeta.medioPagoId === medioId)
      .map((tarjeta) => ({
        id: tarjeta.id,
        label: tarjeta.label,
        removable: true,
        selectValue: tarjeta.ambitoDefault || BUSINESS_CASH_AMBITO_ID,
        selectOptions,
        selectLabel: 'Impacto del gasto',
      }));

    return { medioId, medioLabel, inactiveMedio, items };
  }

  private confirmRemoval(
    kind: ConfigRemovalKind,
    displayName: string,
    checkValue: string,
    applyRemoval: () => void
  ) {
    if (this.removalBusyId) return;
    this.removalBusyId = checkValue;

    this.catalog.checkConfigUsage(kind, checkValue).subscribe({
      next: ({ usage }) => {
        const active = usage.filter((hit) => hit.count > 0);
        if (active.length === 0) {
          applyRemoval();
          this.persist(false);
          return;
        }

        this.removalBusyId = null;
        this.dialog
          .confirm({
            title: 'Opción en uso',
            message: this.buildUsageMessage(displayName, active),
            confirmLabel: 'Quitar igual',
            variant: 'danger',
          })
          .subscribe((confirmed) => {
            if (!confirmed) return;
            this.removalBusyId = checkValue;
            applyRemoval();
            this.persist(true);
          });
      },
      error: () => {
        this.removalBusyId = null;
        this.dialog
          .confirm({
            title: 'No se pudo verificar',
            message:
              'No se pudo comprobar si la opción está en uso. ¿Quitar de la configuración igual?',
            confirmLabel: 'Quitar igual',
            variant: 'danger',
          })
          .subscribe((confirmed) => {
            if (!confirmed) return;
            this.removalBusyId = checkValue;
            applyRemoval();
            this.persist(true);
          });
      },
    });
  }

  private buildUsageMessage(displayName: string, usage: ConfigUsageHit[]): string {
    const lines = usage.map((hit) => `• ${hit.label}: ${hit.count} registro(s)`).join('\n');
    return (
      `"${displayName}" se usa en:\n${lines}\n\n` +
      'Los registros existentes conservarán ese valor. ¿Quitar de la configuración?'
    );
  }

  persist(confirmConfigRemovals = false) {
    if (this.saving || this.applyingConfig) return;
    this.config.finanzas.mediosPago = this.config.finanzas.mediosPago.map((medio) =>
      syncMedioPagoFlags(medio)
    );
    this.saving = true;
    this.catalog.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (saved) => {
        this.applyLoadedConfig(saved);
        this.saving = false;
        this.removalBusyId = null;
        this.showSaveSuccess('Finanzas guardadas correctamente.');
      },
      error: (error) => {
        this.saving = false;
        this.removalBusyId = null;
        this.handleSaveError(error, () => this.persist(true));
      },
    });
  }

  private showSaveSuccess(message: string) {
    this.saveSuccessMessage = message;
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
    this.saveSuccessTimeout = setTimeout(() => {
      this.saveSuccessMessage = '';
      this.saveSuccessTimeout = undefined;
    }, 3500);
  }

  private handleSaveError(error: unknown, retryWithConfirm: () => void) {
    const httpError = error as HttpErrorResponse;
    const body = httpError?.error as {
      usage?: ConfigUsageHit[];
      requiresConfirmation?: boolean;
    };

    if (
      httpError?.status === 409 &&
      body?.requiresConfirmation &&
      Array.isArray(body.usage) &&
      body.usage.length > 0
    ) {
      this.dialog
        .confirm({
          title: 'Opción en uso',
          message: this.buildUsageMessage('Esta opción', body.usage),
          confirmLabel: 'Quitar igual',
          variant: 'danger',
        })
        .subscribe((confirmed) => {
          if (confirmed) retryWithConfirm();
        });
      return;
    }

    this.dialog.alert({
      title: 'Error',
      message:
        typeof body?.error === 'string' && body.error.trim()
          ? body.error
          : 'No se pudo guardar la configuración.',
    });
  }
}
