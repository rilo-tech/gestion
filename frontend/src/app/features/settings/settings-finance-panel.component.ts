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
} from '../../shared/components/config-editable-list/config-editable-list.component';
import { ConfigListRemoveButtonComponent } from '../../shared/components/config-editable-list/config-list-remove-button.component';
import {
  CONFIG_EDITABLE_LIST_ROW_BODY_CLASS,
  CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS,
  CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS,
} from '../../shared/components/config-editable-list/config-editable-list.constants';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

const TARJETA_AMBITO_AMBOS_ID = 'ambos';

type FinanceSectionId = 'medios' | 'tarjetas' | 'categorias';

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
    LucideAngularModule,
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
                <div class="relative w-full sm:flex sm:items-start sm:justify-between sm:gap-2">
                  <div [class]="configRowBodyClass">
                    <input
                      [ngModel]="medio.label"
                      (ngModelChange)="onMedioLabelChange(medio.id, $event)"
                      (blur)="persist()"
                      [name]="'medio_label_' + medio.id"
                      [disabled]="saving"
                      class="w-full min-w-0 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <app-config-list-remove-button
                    [disabled]="saving || (!!removalBusyId && removalBusyId !== medio.id)"
                    [loading]="removalBusyId === medio.id"
                    (clicked)="removeMedioById(medio.id)">
                  </app-config-list-remove-button>
                </div>

                <div class="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                  <label class="flex items-start gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      [checked]="medio.generaEgresoCaja === true"
                      (change)="setMedioFlag(medio.id, 'generaEgresoCaja', $any($event.target).checked)"
                      [disabled]="saving"
                      class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                    <span class="leading-snug">Genera egreso de caja al confirmar</span>
                  </label>

                  <div class="flex flex-wrap items-start gap-x-4 gap-y-2 sm:gap-x-6">
                    <label class="flex items-start gap-2 cursor-pointer select-none min-w-0 shrink-0">
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
                      class="flex items-start gap-2 cursor-pointer select-none min-w-0 flex-1">
                      <input
                        type="checkbox"
                        [checked]="medio.requiereCuentaHija === true"
                        (change)="setMedioFlag(medio.id, 'requiereCuentaHija', $any($event.target).checked)"
                        [disabled]="saving"
                        class="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                      <span class="leading-snug">Requiere elegir cuenta (tarjeta, crédito, etc.)</span>
                    </label>
                  </div>
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
          description="Tarjetas y líneas que elegís al comprar (medio de pago de arriba). Definí el nombre y si el gasto va a caja personal, del negocio o a ambos."
          [listCount]="config.finanzas.tarjetas.length"
          [sectionCollapse]="true"
          [listExpanded]="isFinanceSectionOpen('tarjetas')"
          (listExpandedChange)="onFinanceSectionToggle('tarjetas', $event)"
          [cardClass]="cardClass">
          <div configList class="space-y-3">
            <div
              *ngIf="mediosConCuentaHija.length === 0"
              class="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-100 leading-snug">
              Activá en <span class="font-semibold">Medios de pago</span> la opción «Genera cuentas a pagar» y «Requiere elegir cuenta» para poder cargar cuentas acá.
            </div>

            <div class="flex flex-col sm:flex-row gap-1.5">
              <input
                [(ngModel)]="tarjetaNombreDraft"
                name="tarjetaNombreDraft"
                placeholder="Ej. Visa Galicia, OCA Master..."
                [disabled]="saving || mediosConCuentaHija.length === 0"
                (keydown.enter)="addTarjetaFromDraft($event)"
                class="flex-1 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
              <button
                type="button"
                (click)="addTarjetaFromDraft()"
                [disabled]="saving || !tarjetaNombreDraft.trim() || mediosConCuentaHija.length === 0"
                class="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                Agregar cuenta
              </button>
            </div>

            <ul class="space-y-3 m-0 p-0 list-none" *ngIf="config.finanzas.tarjetas.length > 0">
              <li
                *ngFor="let tarjeta of config.finanzas.tarjetas; trackBy: trackTarjetaId"
                class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 overflow-hidden border-l-4"
                [ngClass]="getTarjetaMedioAccentBorder(tarjeta.medioPagoId)">
                <div
                  class="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 relative w-full sm:flex sm:items-center sm:justify-between sm:gap-2">
                  <div [class]="configRowBodyClass">
                    <div [class]="configRowChipsClass">
                      <span
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0"
                        [ngClass]="getTarjetaMedioBadgeClass(tarjeta.medioPagoId)">
                        <i-lucide name="credit-card" class="w-3 h-3"></i-lucide>
                        {{ getTarjetaMedioLabel(tarjeta.medioPagoId) }}
                      </span>
                    </div>
                    <input
                      [ngModel]="tarjeta.label"
                      (ngModelChange)="onTarjetaLabelChange({ id: tarjeta.id, label: $event })"
                      (blur)="persist()"
                      [name]="'tarjeta_label_' + tarjeta.id"
                      [disabled]="saving"
                      class="w-full min-w-0 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-sm font-semibold bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <app-config-list-remove-button
                    [disabled]="saving || (!!removalBusyId && removalBusyId !== tarjeta.id)"
                    [loading]="removalBusyId === tarjeta.id"
                    (clicked)="removeTarjetaById(tarjeta.id)">
                  </app-config-list-remove-button>
                </div>

                <div class="px-3 py-3 space-y-3 text-xs">
                  <div *ngIf="mediosConCuentaHija.length > 1">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                      Medio de pago al comprar
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        *ngFor="let medio of mediosConCuentaHija; trackBy: trackMedioId"
                        (click)="setTarjetaMedio(tarjeta.id, medio.id)"
                        [disabled]="saving"
                        class="px-2.5 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50"
                        [ngClass]="
                          tarjeta.medioPagoId === medio.id
                            ? getTarjetaMedioChipActiveClass(medio.id)
                            : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        ">
                        {{ medio.label }}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                      Impacto del gasto (ámbito por defecto)
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        *ngFor="let chip of tarjetaAmbitoChips"
                        (click)="setTarjetaAmbito(tarjeta.id, chip.id)"
                        [disabled]="saving"
                        class="px-2.5 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50"
                        [ngClass]="
                          isTarjetaAmbitoSelected(tarjeta, chip.id)
                            ? chip.activeClass
                            : chip.idleClass
                        ">
                        {{ chip.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            </ul>

            <p
              *ngIf="config.finanzas.tarjetas.length === 0 && mediosConCuentaHija.length > 0"
              class="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              Agregá la primera cuenta. Al registrar una compra, la elegís en el medio «{{ mediosConCuentaHija[0]?.label }}».
            </p>
          </div>
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
                <span class="block text-xs text-gray-500 dark:text-gray-400">
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
                <span class="block text-xs text-gray-500 dark:text-gray-400">
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
  saving = false;
  saveSuccessMessage = '';
  removalBusyId: string | null = null;
  medioDraft = '';
  tarjetaNombreDraft = '';
  expandedFinanceSection: FinanceSectionId | null = 'medios';
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

  readonly sectionClass = 'space-y-4 sm:space-y-6';
  readonly sectionsListClass = 'flex flex-col gap-2 w-full min-w-0';
  readonly cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 sm:p-4 flex flex-col min-w-0';

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

  get categoriaGastoListItems(): ConfigEditableListItem[] {
    return this.config.finanzas.categoriasGasto.map((cat) => ({
      id: cat.id,
      label: cat.label,
      removable: true,
    }));
  }

  ngOnInit() {
    this.catalog.getAppConfig().subscribe();
    this.configSub = this.catalog.appConfig$.subscribe((config) => {
      this.config = structuredClone(config);
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

  trackTarjetaId(_index: number, tarjeta: { id: string }): string {
    return tarjeta.id;
  }

  getTarjetaMedioLabel(medioPagoId: string): string {
    return (
      this.config.finanzas.mediosPago.find((medio) => medio.id === medioPagoId)?.label ??
      medioPagoId
    );
  }

  getTarjetaMedioAccentBorder(medioPagoId: string): string {
    const accents: Record<string, string> = {
      tarjeta_credito: 'border-l-teal-500',
      cheque: 'border-l-violet-500',
      cuenta_corriente: 'border-l-sky-500',
    };
    return accents[medioPagoId] ?? 'border-l-orange-400';
  }

  getTarjetaMedioBadgeClass(medioPagoId: string): string {
    const badges: Record<string, string> = {
      tarjeta_credito: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
      cheque: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
      cuenta_corriente: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    };
    return badges[medioPagoId] ?? 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200';
  }

  getTarjetaMedioChipActiveClass(medioPagoId: string): string {
    const active: Record<string, string> = {
      tarjeta_credito: 'border-teal-500 bg-teal-600 text-white',
      cheque: 'border-violet-500 bg-violet-600 text-white',
      cuenta_corriente: 'border-sky-500 bg-sky-600 text-white',
    };
    return active[medioPagoId] ?? 'border-orange-400 bg-orange-500 text-white';
  }

  isTarjetaAmbitoSelected(tarjeta: { ambitoDefault: string }, ambitoId: string): boolean {
    return (tarjeta.ambitoDefault || BUSINESS_CASH_AMBITO_ID) === ambitoId;
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
    this.persist();
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
    const row = this.config.finanzas.mediosPago.find((item) => item.id === id);
    if (!row) return;

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

  setTarjetaMedio(tarjetaId: string, medioPagoId: string) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === tarjetaId);
    if (!row || row.medioPagoId === medioPagoId) return;
    row.medioPagoId = medioPagoId;
    this.persist();
  }

  setTarjetaAmbito(tarjetaId: string, ambitoId: string) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === tarjetaId);
    if (!row || row.ambitoDefault === ambitoId) return;
    row.ambitoDefault = ambitoId;
    this.persist();
  }

  onCategoriaGastoLabelChange(event: { id: string; label: string }) {
    const row = this.config.finanzas.categoriasGasto.find((item) => item.id === event.id);
    if (row) row.label = event.label.trim();
  }

  addTarjetaFromDraft(event?: Event) {
    event?.preventDefault();
    const trimmed = this.tarjetaNombreDraft.trim();
    if (!trimmed || this.saving) return;

    const defaultMedio =
      this.mediosConCuentaHija[0]?.id ??
      this.config.finanzas.mediosPago.find((m) => m.id === 'tarjeta_credito')?.id ??
      'tarjeta_credito';

    if (this.mediosConCuentaHija.length === 0) {
      this.dialog.alert({
        title: 'Sin medio compatible',
        message:
          'Activá un medio de pago con “Genera cuentas a pagar” y “Requiere elegir cuenta” antes de agregar cuentas.',
      });
      return;
    }

    const id = slugifyCajaAmbitoId(trimmed);
    if (this.config.finanzas.tarjetas.some((t) => t.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe una cuenta con ese nombre.' });
      return;
    }

    this.config.finanzas.tarjetas = [
      ...this.config.finanzas.tarjetas,
      {
        id,
        label: trimmed,
        ambitoDefault:
          getCajaAmbitos(this.config).find((a) => !isSystemCashAmbito(a))?.id ?? 'negocio',
        medioPagoId: defaultMedio,
        activa: true,
      },
    ].sort((a, b) => a.label.localeCompare(b.label, 'es'));

    this.tarjetaNombreDraft = '';
    this.expandedFinanceSection = 'tarjetas';
    this.persist();
  }

  removeTarjetaById(id: string) {
    const tarjeta = this.config.finanzas.tarjetas.find((item) => item.id === id);
    if (!tarjeta || this.saving || this.removalBusyId) return;
    this.confirmRemoval('finanzas.tarjetas', tarjeta.label, id, () => {
      this.config.finanzas.tarjetas = this.config.finanzas.tarjetas.filter((item) => item.id !== id);
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
    if (this.saving) return;
    this.config.finanzas.mediosPago = this.config.finanzas.mediosPago.map((medio) =>
      syncMedioPagoFlags(medio)
    );
    this.saving = true;
    this.catalog.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (saved) => {
        this.config = structuredClone(saved);
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
