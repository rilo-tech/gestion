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
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  syncMedioPagoFlags,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { ConfigSettingCardComponent } from '../../shared/components/config-setting-card/config-setting-card.component';
import { ConfigModuleHeaderComponent } from '../../shared/components/config-module-header/config-module-header.component';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
} from '../../shared/components/config-editable-list/config-editable-list.component';
import { CONFIG_SETTINGS_GRID_CLASS } from '../../shared/components/config-editable-list/config-layout.constants';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings-finance-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ConfigSettingCardComponent,
    ConfigModuleHeaderComponent,
    ConfigEditableListComponent,
    FormSaveFooterComponent,
  ],
  template: `
    <section [class]="sectionClass">
      <app-config-module-header
        title="Finanzas"
        description="Medios de pago, cuentas vinculadas y categorías de gasto. Agregar y quitar guardan al instante; Guardar o el ícono de arriba sincronizan el resto."
        [saving]="saving"
        [saveDisabled]="false"
        saveTitle="Guardar"
        (saveClick)="saveConfiguration()">
      </app-config-module-header>

      <div [class]="gridClass">
        <app-config-setting-card
          title="Medios de pago"
          description="Definí el nombre y si cada medio genera egreso de caja al instante, cuentas a pagar, o ambos según corresponda."
          [listCount]="config.finanzas.mediosPago.length"
          [listExpanded]="isListExpanded('finanzas.medios', config.finanzas.mediosPago.length)"
          (listExpandedChange)="setListExpanded('finanzas.medios', $event)"
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

            <ul class="space-y-2 m-0 p-0 list-none max-h-96 overflow-y-auto">
              <li
                *ngFor="let medio of config.finanzas.mediosPago; trackBy: trackMedioId"
                class="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5 space-y-2">
                <div class="flex gap-2 items-start">
                  <input
                    [ngModel]="medio.label"
                    (ngModelChange)="onMedioLabelChange(medio.id, $event)"
                    (blur)="persist()"
                    [name]="'medio_label_' + medio.id"
                    [disabled]="saving"
                    class="flex-1 min-w-0 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary" />
                  <button
                    type="button"
                    (click)="removeMedioById(medio.id)"
                    [disabled]="saving"
                    class="shrink-0 text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50">
                    Quitar
                  </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                  <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      [checked]="medio.generaEgresoCaja === true"
                      (change)="setMedioFlag(medio.id, 'generaEgresoCaja', $any($event.target).checked)"
                      [disabled]="saving"
                      class="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                    <span>Genera egreso de caja al confirmar</span>
                  </label>
                  <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      [checked]="medio.generaCuentasPagar === true"
                      (change)="setMedioFlag(medio.id, 'generaCuentasPagar', $any($event.target).checked)"
                      [disabled]="saving"
                      class="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                    <span>Genera cuentas a pagar</span>
                  </label>
                  <label
                    *ngIf="medio.generaCuentasPagar"
                    class="inline-flex items-center gap-2 cursor-pointer select-none sm:col-span-2">
                    <input
                      type="checkbox"
                      [checked]="medio.requiereCuentaHija === true"
                      (change)="setMedioFlag(medio.id, 'requiereCuentaHija', $any($event.target).checked)"
                      [disabled]="saving"
                      class="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                    <span>Requiere elegir cuenta (tarjeta, crédito, etc.)</span>
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
          title="Cuentas vinculadas"
          description="Tarjetas, líneas de crédito u otras cuentas bajo un medio que genera cuentas a pagar. Pagá el resumen mensual de una sola vez."
          [listCount]="config.finanzas.tarjetas.length"
          [listExpanded]="isListExpanded('finanzas.tarjetas', config.finanzas.tarjetas.length)"
          (listExpandedChange)="setListExpanded('finanzas.tarjetas', $event)"
          [cardClass]="cardClass">
          <app-config-editable-list
            configList
            [items]="tarjetaListItems"
            labelMode="input"
            addPlaceholder="Ej. Visa Galicia, Crédito proveedor X..."
            emptyMessage="Agregá cuentas para medios que requieren elegir tarjeta o crédito."
            [disabled]="saving"
            inputName="tarjetaDraft"
            (add)="addTarjetaFromList($event)"
            (remove)="removeTarjetaById($event)"
            (labelChange)="onTarjetaLabelChange($event)"
            (selectChange)="onTarjetaMedioChange($event)"
            (select2Change)="onTarjetaAmbitoChange($event)"
            (labelBlur)="persist()">
          </app-config-editable-list>
        </app-config-setting-card>

        <app-config-setting-card
          title="Categorías de gasto"
          description="Para insumos, servicios y gastos resumidos en compras."
          [listCount]="config.finanzas.categoriasGasto.length"
          [listExpanded]="isListExpanded('finanzas.categorias', config.finanzas.categoriasGasto.length)"
          (listExpandedChange)="setListExpanded('finanzas.categorias', $event)"
          [cardClass]="cardClass">
          <app-config-editable-list
            configList
            [items]="categoriaGastoListItems"
            labelMode="input"
            addPlaceholder="Ej. Insumos sublimación"
            [disabled]="saving"
            inputName="categoriaGastoDraft"
            (add)="addCategoriaFromList($event)"
            (remove)="removeCategoriaById($event)"
            (labelChange)="onCategoriaGastoLabelChange($event)"
            (labelBlur)="persist()">
          </app-config-editable-list>
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
  medioDraft = '';
  private listExpanded: Record<string, boolean> = {};
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

  readonly sectionClass = 'space-y-4 sm:space-y-6';
  readonly gridClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex flex-col min-w-0 h-full';

  get cajaAmbitos() {
    return getCajaAmbitos(this.config);
  }

  get mediosConCuentaHija() {
    return getMediosPagoConCuentaHija(this.config);
  }

  get tarjetaListItems(): ConfigEditableListItem[] {
    const medioOptions = this.mediosConCuentaHija.map((medio) => ({
      value: medio.id,
      label: medio.label,
    }));

    return this.config.finanzas.tarjetas.map((tarjeta) => ({
      id: tarjeta.id,
      label: tarjeta.label,
      removable: true,
      selectLabel: 'Medio de pago',
      selectValue: tarjeta.medioPagoId,
      selectOptions: medioOptions,
      select2Label: 'Ámbito por defecto',
      select2Value: tarjeta.ambitoDefault,
      select2Options: this.cajaAmbitos.map((ambito) => ({
        value: ambito.id,
        label: ambito.label,
      })),
    }));
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

  /** Guardado explícito (botón o ícono superior). Siempre ejecutable salvo mientras guarda. */
  saveConfiguration() {
    this.persist();
  }

  trackMedioId(_index: number, medio: MedioPagoConfig): string {
    return medio.id;
  }

  isListExpanded(key: string, count: number): boolean {
    if (Object.prototype.hasOwnProperty.call(this.listExpanded, key)) {
      return this.listExpanded[key];
    }
    return count === 0;
  }

  setListExpanded(key: string, expanded: boolean) {
    this.listExpanded[key] = expanded;
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
    this.listExpanded['finanzas.medios'] = true;
    this.persist();
  }

  removeMedioById(id: string) {
    const medio = this.config.finanzas.mediosPago.find((item) => item.id === id);
    if (!medio || this.saving) return;

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

  onTarjetaMedioChange(event: { id: string; value: string }) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === event.id);
    if (row) row.medioPagoId = event.value;
    this.persist();
  }

  onTarjetaAmbitoChange(event: { id: string; value: string }) {
    const row = this.config.finanzas.tarjetas.find((item) => item.id === event.id);
    if (row) row.ambitoDefault = event.value;
  }

  onCategoriaGastoLabelChange(event: { id: string; label: string }) {
    const row = this.config.finanzas.categoriasGasto.find((item) => item.id === event.id);
    if (row) row.label = event.label.trim();
  }

  addTarjetaFromList(label: string) {
    const trimmed = label.trim();
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

    this.listExpanded['finanzas.tarjetas'] = true;
    this.persist();
  }

  removeTarjetaById(id: string) {
    const tarjeta = this.config.finanzas.tarjetas.find((item) => item.id === id);
    if (!tarjeta || this.saving) return;
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
    this.listExpanded['finanzas.categorias'] = true;
    this.persist();
  }

  removeCategoriaById(id: string) {
    const cat = this.config.finanzas.categoriasGasto.find((item) => item.id === id);
    if (!cat || this.saving) return;
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
    this.catalog.checkConfigUsage(kind, checkValue).subscribe({
      next: ({ usage }) => {
        const active = usage.filter((hit) => hit.count > 0);
        if (active.length === 0) {
          applyRemoval();
          this.persist(false);
          return;
        }

        this.dialog
          .confirm({
            title: 'Opción en uso',
            message: this.buildUsageMessage(displayName, active),
            confirmLabel: 'Quitar igual',
            variant: 'danger',
          })
          .subscribe((confirmed) => {
            if (!confirmed) return;
            applyRemoval();
            this.persist(true);
          });
      },
      error: () => {
        this.dialog.alert({
          title: 'Error',
          message: 'No se pudo verificar si la opción está en uso.',
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
        this.showSaveSuccess('Finanzas guardadas correctamente.');
      },
      error: (error) => {
        this.saving = false;
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
