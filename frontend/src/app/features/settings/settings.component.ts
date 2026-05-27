import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  AppConfig,
  ConfigFieldKey,
  ConfigRemovalKind,
  ConfigUsageHit,
  DEFAULT_APP_CONFIG,
  FieldInputMode,
  CatalogConfigService,
  CajaConcepto,
  CajaConceptoTipo,
  CategoriaStockRegla,
  getCajaConceptoTipoLabel,
  slugifyOrigenGrupo,
  DEFAULT_STOCK_TIPOS,
  normalizeCajaAmbitos,
  slugifyCajaAmbitoId,
  isSystemCashAmbito,
  BUSINESS_CASH_AMBITO_ID,
  DEFAULT_ORDER_ESTADOS,
  getOrderStockTriggerOptions,
  getOrderStatusLabelFromConfig,
} from '../../core/services/catalog-config.service';
import {
  type OrderEstadoConfig,
  type OrderPhysicalStockScope,
  normalizeDescuentoFisicoPorEstado,
  normalizeEstadosExigenStockCompleto,
  normalizeOrderPedidosConfig,
  getOrderPhysicalStockScopeLabel,
} from '../../core/constants/order-config';
import { normalizeStockTipos } from '../../core/constants/stock-movimientos';
import { normalizeCategoriasStock } from '../../core/utils/stock-product';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsUsersPanelComponent } from './settings-users-panel.component';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { ConfigStringListComponent } from '../../shared/components/config-string-list/config-string-list.component';

interface ConfigSection {
  key: ConfigFieldKey;
  title: string;
  description: string;
  placeholder: string;
}

interface ConfigModule {
  id: 'productos' | 'clientes' | 'proveedores' | 'caja' | 'stock' | 'pedidos' | 'usuarios';
  title: string;
  description: string;
  sections: ConfigSection[];
  supervisorOnly?: boolean;
  everyone?: boolean;
}

interface PedidoStockRuleRow {
  estadoValue: string;
  label: string;
  scope: OrderPhysicalStockScope;
  exigeStock: boolean;
  exigeStockDisabled: boolean;
  mobileSummary: string;
}

const SAVE_BUTTON_COOLDOWN_MS = 1800;
const SAVE_SUCCESS_DISPLAY_MS = 3500;

const DEFAULT_CATEGORIA_STOCK_REGLA: CategoriaStockRegla = {
  configurado: false,
  controlaStock: true,
  permitirStockNegativo: true,
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, SettingsUsersPanelComponent, FormSaveFooterComponent, ConfigStringListComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 w-full">
      <div class="mb-6 sm:mb-8">
        <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Configuración</h1>
        <p [class]="configDescClass">
          Agregar y Quitar guardan al instante. Guardar confirma el resto de la configuración.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 mb-6 sm:mb-8">
        <button
          type="button"
          *ngFor="let module of visibleModules"
          (click)="selectModule(module.id)"
          class="px-4 py-2 rounded-lg border text-sm font-medium transition-colors"
          [class.bg-primary]="activeModuleId === module.id"
          [class.text-white]="activeModuleId === module.id"
          [class.border-primary]="activeModuleId === module.id"
          [class.bg-white]="activeModuleId !== module.id"
          [class.text-gray-700]="activeModuleId !== module.id"
          [class.border-gray-200]="activeModuleId !== module.id"
          [class.hover:bg-gray-50]="activeModuleId !== module.id">
          {{ module.title }}
        </button>
      </div>

      <section *ngIf="activeModuleId === 'pedidos'" [class]="configSectionClass">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Pedidos</h2>
          <p [class]="configDescClass">
            Estados del flujo (en ese orden), stock, impresión y costos de personalización.
          </p>
        </div>

        <div [class]="configGridTripleClass">
          <div [class]="pedidosColumnClass">
            <article [class]="configCardClass">
              <header class="mb-2">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-sm font-bold text-gray-900">Estados · inicio</h3>
                  <span class="text-[10px] font-semibold text-gray-500 tabular-nums">1–4</span>
                </div>
              </header>
              <ol class="space-y-1 m-0 p-0 list-none">
                <li
                  *ngFor="let estado of config.pedidos.estados; let i = index; trackBy: trackPedidosEstadoRow"
                  class="flex items-center gap-2 min-w-0"
                  [class.hidden]="i >= 4">
                  <span
                    class="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-md border border-primary/30 bg-primary/10 text-[11px] font-bold tabular-nums text-primary"
                    aria-hidden="true">
                    {{ i + 1 }}
                  </span>
                  <input
                    [(ngModel)]="config.pedidos.estados[i].label"
                    [name]="'pedidoEstadoLabel' + estado.value"
                    [disabled]="savingPedidos"
                    (blur)="schedulePedidosPersist()"
                    class="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary bg-white">
                </li>
              </ol>
            </article>

            <article [class]="configCardClass">
              <header class="mb-2">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-sm font-bold text-gray-900">Estados · cierre</h3>
                  <span class="text-[10px] font-semibold text-gray-500 tabular-nums">5–7</span>
                </div>
              </header>
              <ol class="space-y-1 m-0 p-0 list-none">
                <li
                  *ngFor="let estado of config.pedidos.estados; let i = index; trackBy: trackPedidosEstadoRow"
                  class="flex items-center gap-2 min-w-0"
                  [class.hidden]="i < 4">
                  <span
                    class="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-md border border-primary/30 bg-primary/10 text-[11px] font-bold tabular-nums text-primary"
                    aria-hidden="true">
                    {{ i + 1 }}
                  </span>
                  <input
                    [(ngModel)]="config.pedidos.estados[i].label"
                    [name]="'pedidoEstadoLabelTail' + estado.value"
                    [disabled]="savingPedidos"
                    (blur)="schedulePedidosPersist()"
                    class="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary bg-white">
                </li>
              </ol>
            </article>
          </div>

          <div [class]="pedidosColumnClass">
            <article [class]="configCardClass">
              <header class="mb-2">
                <h3 class="text-sm font-bold text-gray-900">Stock · modo</h3>
                <p class="text-xs text-gray-500 mt-0.5">Desde qué estado baja el depósito.</p>
              </header>

            <div class="grid grid-cols-1 gap-1.5 mb-2">
              <label class="flex items-center gap-2 cursor-pointer rounded-md border border-gray-100 px-2 py-1.5 hover:bg-gray-50">
                <input
                  type="radio"
                  name="pedidosModoStock"
                  value="reservado"
                  [(ngModel)]="config.pedidos.modoStock"
                  [disabled]="savingPedidos"
                  (change)="onPedidosModoStockChange()"
                  class="h-3.5 w-3.5 border-gray-300 text-primary focus:ring-primary">
                <span class="text-xs font-medium text-gray-900">Reservado</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer rounded-md border border-gray-100 px-2 py-1.5 hover:bg-gray-50">
                <input
                  type="radio"
                  name="pedidosModoStock"
                  value="directo"
                  [(ngModel)]="config.pedidos.modoStock"
                  [disabled]="savingPedidos"
                  (change)="onPedidosModoStockChange()"
                  class="h-3.5 w-3.5 border-gray-300 text-primary focus:ring-primary">
                <span class="text-xs font-medium text-gray-900">Directo</span>
              </label>
            </div>

            <label class="block text-[11px] font-semibold text-gray-700 mb-0.5">Desde el estado</label>
            <select
              [(ngModel)]="config.pedidos.estadoDescuentaStock"
              name="pedidosEstadoDescuentaStock"
              [disabled]="savingPedidos"
              (change)="onPedidosEstadoDescuentaStockChange()"
              class="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary bg-white">
              <option *ngFor="let option of orderStockTriggerOptionsList; trackBy: trackPedidosEstadoOption" [ngValue]="option.value">
                {{ option.label }}
              </option>
            </select>
            <p class="text-[11px] rounded-md px-2 py-1 mt-2 leading-snug" [ngClass]="configStatusBadgeClass(true)">
              {{ pedidosStockModeSummary }}
            </p>
            </article>

            <article [class]="configCardClass">
              <ng-container *ngIf="config.pedidos.modoStock === 'reservado'; else pedidosStockDirecto">
                <header class="mb-2">
                  <h3 class="text-sm font-bold text-gray-900">Al cambiar estado</h3>
                </header>
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.permitirElegirAlcanceDescuento"
                    name="pedidosPermitirElegirAlcance"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="text-xs text-gray-700 leading-snug">
                    Preguntar si descontar solo lo reservado o todo el pedido pendiente.
                  </span>
                </label>
                <p class="text-[11px] text-gray-500 mt-2 leading-snug">
                  Las reglas por estado están en el panel de abajo.
                </p>
              </ng-container>
              <ng-template #pedidosStockDirecto>
                <header class="mb-2">
                  <h3 class="text-sm font-bold text-gray-900">Modo directo</h3>
                </header>
                <p class="text-xs text-gray-500 leading-snug">
                  El depósito baja según el estado elegido arriba, sin reserva previa.
                </p>
              </ng-template>
            </article>
          </div>

          <div [class]="pedidosColumnClass">
            <article [class]="configCardClass">
              <header class="mb-2">
                <h3 class="text-sm font-bold text-gray-900">Impresión</h3>
              </header>
              <div class="space-y-2">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionDosVias"
                    name="pedidosImpresionDosVias"
                    [disabled]="savingPedidos"
                    (change)="onImpresionDosViasChange()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="text-xs font-medium text-gray-900">Dos vías en A4</span>
                </label>
                <label
                  *ngIf="!config.pedidos.impresionDosVias"
                  class="flex items-center gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionDosViasHorizontal"
                    name="pedidosImpresionDosViasHorizontal"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="text-xs font-medium text-gray-900">Hoja apaisada</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionCasillasProductos"
                    name="pedidosImpresionCasillasProductos"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="text-xs font-medium text-gray-900">Casillas en productos</span>
                </label>
              </div>
              <p class="text-[11px] rounded-md px-2 py-1 mt-2 leading-snug" [ngClass]="configStatusBadgeClass(true)">
                {{
                  config.pedidos.impresionDosVias
                    ? 'Dual horizontal'
                    : config.pedidos.impresionDosViasHorizontal
                      ? 'Simple apaisada'
                      : 'Simple vertical'
                }}
              </p>
            </article>

            <article [class]="configCardClass">
              <header class="mb-2 flex items-center justify-between gap-2">
                <h3 class="text-sm font-bold text-gray-900">Costos extra</h3>
                <label class="flex items-center gap-1.5 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.costosPersonalizacionDetallados"
                    name="pedidosCostosDetallados"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="text-[11px] text-gray-700">Detallados</span>
                </label>
              </header>

              <ng-container *ngIf="config.pedidos.costosPersonalizacionDetallados; else pedidosCostosSimple">
                <p class="text-[11px] text-gray-500 mb-2">
                  {{ config.pedidos.costosExtraPredeterminados?.length ?? 0 }} precargado{{
                    (config.pedidos.costosExtraPredeterminados?.length ?? 0) === 1 ? '' : 's'
                  }}
                </p>
                <div class="flex gap-1.5 mb-2">
                  <input
                    [(ngModel)]="pedidoExtraCostPresetNombre"
                    name="pedidoExtraCostPresetNombre"
                    placeholder="Concepto"
                    [disabled]="savingPedidos"
                    (keyup.enter)="addPedidoExtraCostPreset()"
                    class="flex-1 min-w-0 px-2 py-1 rounded-md border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary bg-white">
                  <input
                    type="number"
                    [(ngModel)]="pedidoExtraCostPresetCosto"
                    name="pedidoExtraCostPresetCosto"
                    placeholder="$"
                    min="0"
                    [disabled]="savingPedidos"
                    (keyup.enter)="addPedidoExtraCostPreset()"
                    class="w-14 px-2 py-1 rounded-md border border-gray-200 text-xs text-right tabular-nums outline-none focus:ring-2 focus:ring-primary bg-white">
                  <button
                    type="button"
                    (click)="addPedidoExtraCostPreset()"
                    [disabled]="savingPedidos"
                    class="shrink-0 px-2 py-1 rounded-md bg-primary text-white text-[11px] font-semibold hover:bg-opacity-90 disabled:opacity-50">
                    +
                  </button>
                </div>
                <ul class="space-y-1 max-h-32 overflow-y-auto">
                  <li
                    *ngFor="let preset of config.pedidos.costosExtraPredeterminados; let i = index"
                    class="flex items-center justify-between gap-1.5 px-2 py-1 rounded-md border border-gray-100 bg-gray-50/80">
                    <span class="text-xs text-gray-800 truncate min-w-0">{{ preset.nombre }}</span>
                    <span class="text-[11px] font-semibold text-teal-800 tabular-nums shrink-0">{{ '$' + preset.costo }}</span>
                    <button
                      type="button"
                      (click)="removePedidoExtraCostPreset(i)"
                      [disabled]="savingPedidos"
                      class="shrink-0 text-[10px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
                      ×
                    </button>
                  </li>
                  <li
                    *ngIf="!(config.pedidos.costosExtraPredeterminados?.length ?? 0)"
                    class="text-[11px] text-gray-400 px-2 py-2 text-center border border-dashed border-gray-200 rounded-md">
                    Ej. Bordado $500
                  </li>
                </ul>
              </ng-container>
              <ng-template #pedidosCostosSimple>
                <p class="text-xs text-gray-500 leading-snug">
                  Activá «Detallados» para casillas por producto y conceptos precargados.
                </p>
              </ng-template>
            </article>
          </div>
        </div>

        <article *ngIf="config.pedidos.modoStock === 'reservado'" [class]="configCardClass">
          <header class="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-gray-900">Reglas de stock por estado</h3>
              <p [class]="configDescClass">
                Qué baja del depósito y si el pedido debe tener todo el stock antes de permitir el cambio.
              </p>
            </div>
          </header>

          <div class="rounded-xl border border-gray-100 overflow-hidden">
            <div
              class="hidden md:grid md:grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.5fr)_10rem] gap-3 px-4 py-2.5 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span>Estado destino</span>
              <span>Descuento en depósito</span>
              <span class="text-center">Exigir stock completo</span>
            </div>
            <div
              *ngFor="let row of pedidoStockRuleRows; let last = last; trackBy: trackPedidoStockRuleRow"
              class="px-4 py-3 md:grid md:grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.5fr)_10rem] md:items-center gap-3"
              [class.border-t]="!last"
              [class.border-gray-100]="!last">
              <div class="min-w-0 mb-2 md:mb-0">
                <p class="text-sm font-semibold text-gray-900">{{ row.label }}</p>
                <p class="text-xs text-gray-500 mt-0.5 md:hidden">{{ row.mobileSummary }}</p>
              </div>
              <select
                [ngModel]="row.scope"
                (ngModelChange)="onPedidoStockRuleScopeChange(row, $event)"
                [name]="'pedidoDescuentoScopeWide_' + row.estadoValue"
                [disabled]="savingPedidos"
                class="w-full md:max-w-xs px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary mb-2 md:mb-0">
                <option value="solo_reservado">Solo lo reservado</option>
                <option value="pedido_completo">Todo el pedido pendiente</option>
              </select>
              <label
                class="flex items-center md:justify-center gap-2 cursor-pointer"
                [class.opacity-50]="row.exigeStockDisabled"
                [title]="row.exigeStockDisabled ? 'Solo aplica con descuento de pedido completo' : ''">
                <input
                  type="checkbox"
                  [ngModel]="row.exigeStock"
                  (ngModelChange)="onPedidoStockRuleExigeChange(row, $event)"
                  [name]="'pedidoExigeStockWide_' + row.estadoValue"
                  [disabled]="savingPedidos || row.exigeStockDisabled"
                  class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
                <span class="text-sm text-gray-700 md:sr-only">Exigir stock completo</span>
              </label>
            </div>
          </div>
        </article>
      </section>

      <section *ngIf="activeModuleId === 'caja'" [class]="configSectionClass">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Caja</h2>
          <p [class]="configDescClass">
            Conceptos, orígenes y opciones de la grilla de caja.
          </p>
        </div>

        <div [class]="configGridTripleClass">
        <article [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">Etiquetas de caja</h3>
            <p [class]="configDescClass">
              Siempre hay una caja principal del negocio (pedidos, ventas y cobros automáticos van ahí). Podés renombrarla y agregar otras pestañas para movimientos manuales.
            </p>
          </header>

          <p class="mb-2" [ngClass]="configStatusBadgeClass(true)">
            1 principal
            <ng-container *ngIf="extraCajaAmbitosCount > 0">
              · {{ extraCajaAmbitosCount }} adicional{{ extraCajaAmbitosCount === 1 ? '' : 'es' }}
            </ng-container>
            · pestañas en Caja y Cuentas a pagar
          </p>

          <div class="flex flex-col sm:flex-row gap-2 mb-2">
            <input
              [(ngModel)]="cajaAmbitoDraft"
              name="cajaAmbitoDraft"
              placeholder="Ej. Personal, Caja chica..."
              [disabled]="savingCajaAmbito"
              (keyup.enter)="addCajaAmbito()"
              [class]="configInputClass + ' flex-1'">
            <button
              type="button"
              (click)="addCajaAmbito()"
              [disabled]="savingCajaAmbito"
              [class]="configAddButtonClass">
              Agregar
            </button>
          </div>

          <ul class="space-y-2">
            <li
              *ngFor="let ambito of config.caja.ambitos"
              [class]="configListItemClass">
              <div class="min-w-0 flex-1">
                <input
                  [(ngModel)]="ambito.label"
                  [name]="'cajaAmbitoLabel' + ambito.id"
                  (change)="persistCajaAmbitos()"
                  [disabled]="savingCajaAmbito"
                  class="w-full px-2 py-1 rounded-md border border-transparent bg-white/80 text-sm font-medium text-teal-900 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-200">
                <p *ngIf="isSystemCashAmbito(ambito)" [class]="configDescClass">
                  Principal · movimientos automáticos · solo podés cambiar el nombre
                </p>
              </div>
              <button
                *ngIf="!isSystemCashAmbito(ambito)"
                type="button"
                (click)="removeCajaAmbito(ambito)"
                [disabled]="savingCajaAmbito"
                [class]="configRemoveButtonClass">
                Quitar
              </button>
            </li>
          </ul>
        </article>

        <article [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">Orígenes</h3>
            <p [class]="configDescClass">
              Etiquetas del combobox de filtro. Por defecto: Ventas, Pedidos y Compra.
            </p>
          </header>

          <p class="mb-2" [ngClass]="configStatusBadgeClass(config.caja.origenes.length > 0)">
            {{ config.caja.origenes.length }} origen{{ config.caja.origenes.length === 1 ? '' : 'es' }} configurado{{ config.caja.origenes.length === 1 ? '' : 's' }} · visible en Caja
          </p>

          <div class="flex flex-col sm:flex-row gap-2 mb-2">
            <input
              [(ngModel)]="cajaOrigenDraft"
              name="cajaOrigenDraft"
              placeholder="Ej. Gastos fijos"
              [disabled]="isSavingCajaOrigenes"
              (keyup.enter)="addCajaOrigen()"
              [class]="configInputClass + ' flex-1'">
            <button
              type="button"
              (click)="addCajaOrigen()"
              [disabled]="isSavingCajaOrigenes"
              [class]="configAddButtonClass">
              Agregar
            </button>
          </div>

          <ul class="space-y-2 flex-1">
            <li
              *ngFor="let origen of config.caja.origenes"
              [class]="configListItemClass">
              <div class="min-w-0 flex-1">
                <input
                  [(ngModel)]="origen.nombre"
                  [name]="'origenNombre' + origen.grupo"
                  (change)="persistCajaOrigenes()"
                  [disabled]="isSavingCajaOrigenes"
                  class="w-full px-2 py-1 rounded-md border border-transparent bg-white/80 text-sm font-medium text-teal-900 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-200">
              </div>
              <button
                type="button"
                (click)="removeCajaOrigen(origen)"
                [disabled]="isSavingCajaOrigenes"
                [class]="configRemoveButtonClass">
                Quitar
              </button>
            </li>
            <li *ngIf="config.caja.origenes.length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg">
              Todavía no hay opciones cargadas.
            </li>
          </ul>
        </article>

        <article [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">Conceptos</h3>
            <p [class]="configDescClass">
              Ej. Venta mostrador (ingreso), Compra insumos (egreso), Diferencia (ambos).
            </p>
          </header>

          <p class="mb-2" [ngClass]="configStatusBadgeClass(config.caja.conceptos.length > 0)">
            {{ getCajaConceptosHint() }}
          </p>

          <div class="flex flex-col gap-2 mb-2">
            <input
              [(ngModel)]="cajaConceptoDraft"
              name="cajaConceptoDraft"
              placeholder="Ej. Diferencia"
              [disabled]="isSavingCajaConceptos"
              (keyup.enter)="addCajaConcepto()"
              [class]="configInputClass">
            <div class="flex flex-col sm:flex-row gap-2">
              <select
                [(ngModel)]="cajaConceptoTipoDraft"
                name="cajaConceptoTipoDraft"
                [disabled]="isSavingCajaConceptos"
                class="w-full sm:w-40 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 bg-white">
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
                <option value="ambos">Ambos</option>
              </select>
              <button
                type="button"
                (click)="addCajaConcepto()"
                [disabled]="isSavingCajaConceptos"
                [class]="configAddButtonClass">
                Agregar
              </button>
            </div>
          </div>

          <ul class="space-y-2 flex-1">
            <li
              *ngFor="let concepto of config.caja.conceptos"
              [class]="configListItemClass">
              <div class="min-w-0">
                <span class="text-sm font-medium text-teal-800 break-words">
                  {{ concepto.nombre }}
                </span>
                <span class="ml-2 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold border border-primary/35 bg-primary/15 text-primary">
                  {{ getCajaConceptoTipoLabel(concepto.tipo) }}
                </span>
              </div>
              <button
                type="button"
                (click)="removeCajaConcepto(concepto)"
                [disabled]="isSavingCajaConceptos"
                [class]="configRemoveButtonClass">
                Quitar
              </button>
            </li>
            <li *ngIf="config.caja.conceptos.length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg">
              Todavía no hay opciones cargadas.
            </li>
          </ul>
        </article>
        </div>
      </section>

      <section *ngIf="activeModuleId === 'stock'" [class]="configSectionClass">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Stock</h2>
          <p [class]="configDescClass">
            Etiquetas de tipos y orígenes en la grilla de movimientos de inventario.
          </p>
        </div>

        <div [class]="configGridPairClass">
          <article [class]="configCardClass">
            <header class="mb-2">
              <h3 class="text-sm font-bold text-gray-900">Tipos</h3>
              <p [class]="configDescClass">
                Entrada y salida son fijos; podés cambiar solo el nombre visible.
              </p>
            </header>

            <p class="mb-2" [ngClass]="configStatusBadgeClass(true)">
              2 tipos · visible en Movimientos de stock
            </p>

            <ul class="space-y-2 flex-1">
              <li
                *ngFor="let tipo of config.stock.tipos"
                [class]="configListItemClass">
                <div class="min-w-0 flex-1">
                  <input
                    [(ngModel)]="tipo.nombre"
                    [name]="'stockTipoNombre' + tipo.grupo"
                    (change)="persistStockTipos()"
                    [disabled]="isSavingStockTipos"
                    class="w-full px-2 py-1 rounded-md border border-transparent bg-white/80 text-sm font-medium text-teal-900 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-200">
                </div>
              </li>
            </ul>
          </article>

          <article [class]="configCardClass">
            <header class="mb-2">
              <h3 class="text-sm font-bold text-gray-900">Orígenes</h3>
              <p [class]="configDescClass">
                Etiquetas del combobox de filtro. Por defecto: Compras, Pedidos/ventas, Carga inicial y Ajuste.
              </p>
            </header>

            <p class="mb-2" [ngClass]="configStatusBadgeClass(config.stock.origenes.length > 0)">
              {{ config.stock.origenes.length }} origen{{ config.stock.origenes.length === 1 ? '' : 'es' }} configurado{{ config.stock.origenes.length === 1 ? '' : 's' }} · visible en Stock
            </p>

            <div class="flex flex-col sm:flex-row gap-2 mb-2">
              <input
                [(ngModel)]="stockOrigenDraft"
                name="stockOrigenDraft"
                placeholder="Ej. Devoluciones"
                [disabled]="isSavingStockOrigenes"
                (keyup.enter)="addStockOrigen()"
                [class]="configInputClass + ' flex-1'">
              <button
                type="button"
                (click)="addStockOrigen()"
                [disabled]="isSavingStockOrigenes"
                [class]="configAddButtonClass">
                Agregar
              </button>
            </div>

            <ul class="space-y-2 flex-1">
              <li
                *ngFor="let origen of config.stock.origenes"
                [class]="configListItemClass">
                <div class="min-w-0 flex-1">
                  <input
                    [(ngModel)]="origen.nombre"
                    [name]="'stockOrigenNombre' + origen.grupo"
                    (change)="persistStockOrigenes()"
                    [disabled]="isSavingStockOrigenes"
                    class="w-full px-2 py-1 rounded-md border border-transparent bg-white/80 text-sm font-medium text-teal-900 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-200">
                </div>
                <button
                  type="button"
                  (click)="removeStockOrigen(origen)"
                  [disabled]="isSavingStockOrigenes"
                  [class]="configRemoveButtonClass">
                  Quitar
                </button>
              </li>
              <li *ngIf="config.stock.origenes.length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg">
                Todavía no hay opciones cargadas.
              </li>
            </ul>
          </article>
        </div>
      </section>

      <app-settings-users-panel *ngIf="activeModuleId === 'usuarios'"></app-settings-users-panel>

      <section *ngIf="activeModuleId === 'productos'" [class]="configSectionClass">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Productos</h2>
          <p [class]="configDescClass">
            Categorías con reglas de stock opcionales (se heredan a productos nuevos). Talles y colores abajo.
          </p>
        </div>

        <div [class]="configGridTripleClass">
        <article [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">Categoría</h3>
            <p [class]="configDescClass">
              Podés definir stock por categoría. Si no configurás reglas, cada producto se define solo.
            </p>
          </header>

          <div class="flex flex-col gap-2 mb-2">
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                [(ngModel)]="categoriaDraft"
                name="productoCategoriaNew"
                placeholder="Ej. Personalización"
                [disabled]="savingCategoriasStock"
                (keyup.enter)="addCategoria()"
                [class]="configInputClass + ' flex-1'">
              <button type="button" (click)="addCategoria()" [disabled]="savingCategoriasStock" [class]="configAddButtonClass">
                Agregar
              </button>
            </div>
          </div>

          <ul [class]="configOptionListClass">
            <li
              *ngFor="let categoria of config.productos.categorias"
              class="flex flex-col gap-1.5 px-2 py-1.5 rounded-md border border-gray-200">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2 min-w-0">
                  <span [class]="configOptionTextClass">{{ categoria }}</span>
                  <span [ngClass]="categoriaReglaBadgeClass(isCategoriaStockConfigurada(categoria))">
                    {{ isCategoriaStockConfigurada(categoria) ? 'Con reglas' : 'Sin reglas' }}
                  </span>
                </div>
                <button
                  type="button"
                  (click)="removeCategoria(categoria)"
                  [disabled]="savingCategoriasStock"
                  [class]="configRemoveButtonClass">
                  Quitar
                </button>
              </div>
              <label class="flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  [checked]="isCategoriaStockConfigurada(categoria)"
                  [disabled]="savingCategoriasStock"
                  (change)="toggleCategoriaStockConfigurada(categoria, $any($event.target).checked)"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                <span class="text-xs text-gray-700">Configurar stock de la categoría</span>
              </label>
              <div
                *ngIf="isCategoriaStockConfigurada(categoria)"
                class="flex flex-col gap-1.5 pl-5 ml-1 border-l-2 border-primary/25 pt-1">
                <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 rounded-md px-1 py-0.5 hover:bg-gray-50/80">
                  <input
                    type="checkbox"
                    [checked]="getCategoriaRegla(categoria).controlaStock"
                    [disabled]="savingCategoriasStock"
                    (change)="setCategoriaReglaField(categoria, 'controlaStock', $any($event.target).checked)"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  Controla stock
                </label>
                <label
                  *ngIf="getCategoriaRegla(categoria).controlaStock"
                  class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 rounded-md px-1 py-0.5 hover:bg-gray-50/80">
                  <input
                    type="checkbox"
                    [checked]="getCategoriaRegla(categoria).permitirStockNegativo"
                    [disabled]="savingCategoriasStock"
                    (change)="setCategoriaReglaField(categoria, 'permitirStockNegativo', $any($event.target).checked)"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                  Permitir stock negativo
                </label>
              </div>
            </li>
            <li
              *ngIf="config.productos.categorias.length === 0"
              class="text-xs text-gray-400 px-1 py-4 text-center border border-dashed border-gray-200 rounded-lg">
              Todavía no hay categorías cargadas.
            </li>
          </ul>
        </article>

          <article *ngFor="let section of productosCatalogSections" [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">{{ section.title }}</h3>
              <p [class]="configDescClass">{{ section.description }}</p>
            </header>
            <p class="mb-2" [ngClass]="configStatusBadgeClass(getList(section.key).length > 0)">
              {{ getSectionHint(section.key) }}
            </p>
            <app-config-string-list
              [items]="getList(section.key)"
              [placeholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (addItem)="addValueFromList(section.key, $event)"
              (removeItem)="removeValue(section.key, $event)">
            </app-config-string-list>
          </article>
        </div>
      </section>

      <section *ngIf="activeModule && activeModuleId !== 'pedidos' && activeModuleId !== 'caja' && activeModuleId !== 'stock' && activeModuleId !== 'usuarios' && activeModuleId !== 'productos'" [class]="configSectionClass">
        <div>
          <h2 class="text-xl font-bold text-gray-900">{{ activeModule!.title }}</h2>
          <p [class]="configDescClass">{{ activeModule!.description }}</p>
        </div>

        <div [class]="configGridMultiClass">
          <article
            *ngFor="let section of activeModule!.sections"
            [class]="configCardClass">
          <header class="mb-2">
            <h3 class="text-sm font-bold text-gray-900">{{ section.title }}</h3>
              <p [class]="configDescClass">{{ section.description }}</p>
            </header>

            <p class="mb-2" [ngClass]="configStatusBadgeClass(getList(section.key).length > 0)">
              {{ getSectionHint(section.key) }}
            </p>

            <app-config-string-list
              [items]="getList(section.key)"
              [placeholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (addItem)="addValueFromList(section.key, $event)"
              (removeItem)="removeValue(section.key, $event)">
            </app-config-string-list>
          </article>
        </div>
      </section>

      <div class="mt-6 sm:mt-8">
        <app-form-save-footer
          [saving]="saving"
          [successMessage]="saveSuccessMessage"
          (saveClick)="saveConfig()">
        </app-form-save-footer>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit, OnDestroy {
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  activeModuleId: ConfigModule['id'] = 'productos';
  saving = false;
  savingPedidos = false;
  saveSuccessMessage = '';
  optionDrafts: Record<string, string> = {};
  savingFields = new Set<string>();
  savingCajaConceptos = false;
  savingCajaOrigenes = false;
  savingCajaAmbito = false;
  savingStockTipos = false;
  savingStockOrigenes = false;
  savingCategoriasStock = false;
  categoriaDraft = '';

  cajaConceptoDraft = '';
  cajaOrigenDraft = '';
  cajaAmbitoDraft = '';
  stockOrigenDraft = '';
  cajaConceptoTipoDraft: CajaConceptoTipo = 'ingreso';
  pedidoExtraCostPresetNombre = '';
  pedidoExtraCostPresetCosto: number | null = null;
  private pedidosPersistTimer?: ReturnType<typeof setTimeout>;
  private pedidosPersistSeq = 0;
  private static readonly PEDIDOS_PERSIST_DEBOUNCE_MS = 400;
  orderStockTriggerOptionsList: OrderEstadoConfig[] = [];
  orderStockScopeEstadoOptionsList: OrderEstadoConfig[] = [];
  pedidoStockRuleRows: PedidoStockRuleRow[] = [];
  pedidosStockModeSummary = '';
  getCajaConceptoTipoLabel = getCajaConceptoTipoLabel;
  readonly isSystemCashAmbito = isSystemCashAmbito;

  get extraCajaAmbitosCount(): number {
    return this.config.caja.ambitos.filter((item) => !isSystemCashAmbito(item)).length;
  }

  readonly configSectionClass = 'space-y-3';
  readonly configDescClass = 'block text-xs text-gray-500 mt-0.5 desc-lg-only leading-snug';
  readonly configCodeClass = 'mt-1 text-[11px] text-primary/80 desc-lg-only';
  readonly configCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col min-w-0';
  readonly configToggleCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-3 max-w-3xl';
  readonly configGridPairClass =
    'grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch';
  readonly configGridTripleClass =
    'grid grid-cols-1 xl:grid-cols-3 gap-3 items-start';
  readonly pedidosColumnClass = 'flex flex-col gap-3 min-w-0';
  readonly configGridMultiClass =
    'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-start';
  readonly configInputClass =
    'w-full min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400';
  readonly configAddButtonClass =
    'w-full sm:w-auto shrink-0 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-opacity-90 disabled:opacity-60 whitespace-nowrap';
  readonly configListItemClass =
    'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-gray-200';
  readonly configOptionListClass = 'space-y-1 max-h-52 overflow-y-auto';
  readonly configOptionListItemClass =
    'flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-gray-200';
  readonly configOptionTextClass = 'text-xs font-medium text-gray-900 break-words min-w-0 leading-tight';
  readonly configRemoveButtonClass =
    'shrink-0 text-teal-600 text-xs font-semibold hover:text-teal-700 disabled:opacity-50';

  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  private saveCooldownTimeout?: ReturnType<typeof setTimeout>;

  modules: ConfigModule[] = [
    {
      id: 'productos',
      title: 'Productos',
      description: 'Talles y colores al cargar productos. El stock se define por categoría (opcional) o por producto.',
      sections: [
        {
          key: 'productos.talles',
          title: 'Talle',
          description: 'Ej. S, M, L. Al agregar, Nuevo producto usa buscador.',
          placeholder: 'Ej. M',
        },
        {
          key: 'productos.colores',
          title: 'Color',
          description: 'Ej. Negro, Blanco. Al agregar, Nuevo producto usa buscador.',
          placeholder: 'Ej. Negro',
        },
      ],
    },
    {
      id: 'clientes',
      title: 'Clientes',
      description: 'Opciones para etiquetar clientes.',
      sections: [
        {
          key: 'clientes.etiquetas',
          title: 'Etiquetas',
          description: 'Ej. VIP, Mayorista. Al agregar, Clientes usa buscador.',
          placeholder: 'Ej. VIP',
        },
      ],
    },
    {
      id: 'proveedores',
      title: 'Proveedores',
      description: 'Opciones para etiquetar proveedores.',
      sections: [
        {
          key: 'proveedores.etiquetas',
          title: 'Etiquetas',
          description: 'Ej. Mayorista, Local. Al agregar, Proveedores usa buscador.',
          placeholder: 'Ej. Mayorista',
        },
      ],
    },
    {
      id: 'caja',
      title: 'Caja',
      description: 'Conceptos manuales y orígenes del filtro.',
      sections: [],
    },
    {
      id: 'stock',
      title: 'Stock',
      description: 'Tipos y orígenes de los movimientos de inventario.',
      sections: [],
    },
    {
      id: 'pedidos',
      title: 'Pedidos',
      description: 'Estados, stock, costos de personalización e impresión.',
      sections: [],
    },
    {
      id: 'usuarios',
      title: 'Usuarios',
      description: 'Permisos por usuario.',
      sections: [],
      supervisorOnly: true,
    },
  ];

  trackPedidosEstadoOption(_index: number, option: OrderEstadoConfig): string {
    return option.value;
  }

  trackPedidosEstadoRow(_index: number, estado: OrderEstadoConfig): string {
    return estado.value;
  }

  trackPedidoStockRuleRow(_index: number, row: PedidoStockRuleRow): string {
    return row.estadoValue;
  }

  private refreshPedidosViewState(): void {
    this.refreshPedidosOptionLists();
    this.refreshPedidosStockModeSummary();
  }

  private refreshPedidosOptionLists(): void {
    this.ensurePedidosDescuentoFisicoMap();
    const trigger = getOrderStockTriggerOptions(this.config.pedidos);
    this.orderStockTriggerOptionsList = trigger;
    this.orderStockScopeEstadoOptionsList = trigger.filter(
      (option) => option.value !== 'entregado' && option.value !== 'entregado_con_saldo'
    );
    this.refreshPedidosStockRuleRows();
  }

  private ensurePedidosDescuentoFisicoMap(): void {
    this.config.pedidos.descuentoFisicoPorEstado = normalizeDescuentoFisicoPorEstado(
      this.config.pedidos.descuentoFisicoPorEstado
    );
  }

  private refreshPedidosStockRuleRows(): void {
    const exigeSet = new Set(
      normalizeEstadosExigenStockCompleto(
        this.config.pedidos.estadosExigenStockCompleto,
        this.config.pedidos.estados
      )
    );
    const options = this.orderStockScopeEstadoOptionsList;

    if (
      this.pedidoStockRuleRows.length !== options.length ||
      this.pedidoStockRuleRows.some((row, index) => row.estadoValue !== options[index]?.value)
    ) {
      this.pedidoStockRuleRows = this.buildPedidoStockRuleRows(options, exigeSet);
      return;
    }

    for (let index = 0; index < options.length; index++) {
      const option = options[index];
      const row = this.pedidoStockRuleRows[index];
      const scope = this.config.pedidos.descuentoFisicoPorEstado?.[option.value] ?? 'solo_reservado';
      const exigeStockDisabled = scope === 'solo_reservado';
      row.label = option.label;
      row.scope = scope;
      row.exigeStockDisabled = exigeStockDisabled;
      row.exigeStock = !exigeStockDisabled && exigeSet.has(option.value);
      row.mobileSummary = this.buildPedidoStockRuleSummary(row);
    }
  }

  private buildPedidoStockRuleRows(
    options: OrderEstadoConfig[],
    exigeSet: Set<string>
  ): PedidoStockRuleRow[] {
    return options.map((option) => {
      const scope = this.config.pedidos.descuentoFisicoPorEstado?.[option.value] ?? 'solo_reservado';
      const exigeStockDisabled = scope === 'solo_reservado';
      const row: PedidoStockRuleRow = {
        estadoValue: option.value,
        label: option.label,
        scope,
        exigeStock: !exigeStockDisabled && exigeSet.has(option.value),
        exigeStockDisabled,
        mobileSummary: '',
      };
      row.mobileSummary = this.buildPedidoStockRuleSummary(row);
      return row;
    });
  }

  private refreshPedidosStockModeSummary(): void {
    const modo = this.config.pedidos.modoStock === 'reservado' ? 'Reservado' : 'Directo';
    const desde = getOrderStatusLabelFromConfig(
      this.config.pedidos.estadoDescuentaStock,
      this.config.pedidos
    );
    this.pedidosStockModeSummary = `${modo} · desde «${desde}» en adelante`;
  }

  private buildPedidoStockRuleSummary(row: PedidoStockRuleRow): string {
    const scope = getOrderPhysicalStockScopeLabel(row.scope);
    if (row.exigeStockDisabled) {
      return `${scope} · no exige stock completo`;
    }
    if (row.exigeStock) {
      return `${scope} · exige stock completo`;
    }
    return `${scope} · permite faltante`;
  }

  onPedidoStockRuleScopeChange(row: PedidoStockRuleRow, scope: OrderPhysicalStockScope) {
    if (row.scope === scope) return;
    row.scope = scope;
    this.config.pedidos.descuentoFisicoPorEstado[row.estadoValue] = scope;
    if (scope === 'solo_reservado') {
      row.exigeStockDisabled = true;
      if (row.exigeStock) {
        row.exigeStock = false;
        this.syncEstadosExigenStockFromRuleRows();
      }
    } else {
      row.exigeStockDisabled = false;
    }
    row.mobileSummary = this.buildPedidoStockRuleSummary(row);
    this.schedulePedidosPersist();
  }

  onPedidoStockRuleExigeChange(row: PedidoStockRuleRow, checked: boolean) {
    if (row.exigeStock === checked || row.exigeStockDisabled) return;
    row.exigeStock = checked;
    this.syncEstadosExigenStockFromRuleRows();
    row.mobileSummary = this.buildPedidoStockRuleSummary(row);
    this.schedulePedidosPersist();
  }

  private syncEstadosExigenStockFromRuleRows(): void {
    this.config.pedidos.estadosExigenStockCompleto = this.pedidoStockRuleRows
      .filter((row) => row.exigeStock && !row.exigeStockDisabled)
      .map((row) => row.estadoValue);
  }

  get visibleModules(): ConfigModule[] {
    return this.modules.filter((module) => {
      if (module.supervisorOnly) return this.auth.canManageUsers;
      return this.auth.canManageSettings;
    });
  }

  get activeModule(): ConfigModule | undefined {
    return this.modules.find((module) => module.id === this.activeModuleId);
  }

  get productosCatalogSections(): ConfigSection[] {
    return this.modules.find((module) => module.id === 'productos')?.sections ?? [];
  }

  get isSavingCajaConceptos(): boolean {
    return this.savingCajaConceptos;
  }

  get isSavingCajaOrigenes(): boolean {
    return this.savingCajaOrigenes;
  }

  get isSavingStockTipos(): boolean {
    return this.savingStockTipos;
  }

  get isSavingStockOrigenes(): boolean {
    return this.savingStockOrigenes;
  }

  configStatusBadgeClass(active: boolean): string {
    const tone = active
      ? 'text-[11px] rounded-md px-2 py-0.5 border border-primary/35 bg-primary/15 text-primary font-medium'
      : 'text-[11px] rounded-md px-2 py-0.5 border border-gray-500/50 bg-gray-800/40 text-gray-200 font-medium';
    return `${tone} desc-lg-only`;
  }

  categoriaReglaBadgeClass(configurada: boolean): string {
    return configurada
      ? 'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border border-primary/40 bg-primary/20 text-primary shrink-0'
      : 'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border border-gray-500/60 bg-gray-800/60 text-gray-200 shrink-0';
  }

  getCajaConceptosHint(): string {
    const count = this.config.caja.conceptos.length;
    if (count > 0) {
      return `${count} opción${count === 1 ? '' : 'es'} · buscador activo en Caja`;
    }
    return 'Sin opciones · texto libre en Caja';
  }

  addCajaConcepto() {
    const nombre = this.cajaConceptoDraft.trim();
    if (!nombre || this.savingCajaConceptos) return;

    const exists = this.config.caja.conceptos.some(
      (concepto) => concepto.nombre.toLowerCase() === nombre.toLowerCase()
    );
    if (exists) {
      this.cajaConceptoDraft = '';
      return;
    }

    this.config.caja.conceptos = [
      ...this.config.caja.conceptos,
      { nombre, tipo: this.cajaConceptoTipoDraft },
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    this.syncCajaConceptosMode();
    this.cajaConceptoDraft = '';
    this.persistCajaConceptos();
  }

  removeCajaConcepto(concepto: CajaConcepto) {
    if (this.savingCajaConceptos) return;

    this.confirmConfigRemoval(
      'caja.conceptos',
      concepto.nombre,
      () => {
        this.config.caja.conceptos = this.config.caja.conceptos.filter(
          (item) => item !== concepto
        );
        this.syncCajaConceptosMode();
      },
      (confirm) => this.persistCajaConceptos(confirm)
    );
  }

  private syncCajaConceptosMode() {
    this.config.caja.modo.conceptos =
      this.config.caja.conceptos.length > 0 ? 'lista' : 'texto';
  }

  private persistCajaConceptos(confirmConfigRemovals = false) {
    this.savingCajaConceptos = true;
    this.syncCajaConceptosMode();

    this.catalogConfigService.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (config) => {
        this.config = config;
        this.syncCajaConceptosMode();
        this.savingCajaConceptos = false;
      },
      error: (error) => {
        this.savingCajaConceptos = false;
        this.handleConfigSaveError(error, () => this.persistCajaConceptos(true));
      },
    });
  }

  addCajaOrigen() {
    const nombre = this.cajaOrigenDraft.trim();
    if (!nombre || this.savingCajaOrigenes) return;

    let grupo = slugifyOrigenGrupo(nombre);
    if (this.config.caja.origenes.some((item) => item.grupo === grupo)) {
      let suffix = 2;
      while (this.config.caja.origenes.some((item) => item.grupo === `${grupo}_${suffix}`)) {
        suffix += 1;
      }
      grupo = `${grupo}_${suffix}`;
    }

    this.config.caja.origenes = [
      ...this.config.caja.origenes,
      { grupo, nombre },
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    this.cajaOrigenDraft = '';
    this.persistCajaOrigenes();
  }

  removeCajaOrigen(origen: { grupo: string; nombre: string }) {
    if (this.savingCajaOrigenes) return;

    this.confirmConfigRemoval(
      'caja.origenes',
      origen.nombre,
      () => {
        this.config.caja.origenes = this.config.caja.origenes.filter((item) => item !== origen);
      },
      (confirm) => this.persistCajaOrigenes(confirm),
      origen.grupo
    );
  }

  persistCajaOrigenes(confirmConfigRemovals = false) {
    this.savingCajaOrigenes = true;
    this.config.caja.origenes = this.config.caja.origenes
      .map((item) => ({
        grupo: item.grupo.trim().toLowerCase(),
        nombre: item.nombre.trim(),
      }))
      .filter((item) => item.grupo && item.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    this.catalogConfigService.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (config) => {
        this.config = config;
        this.savingCajaOrigenes = false;
      },
      error: (error) => {
        this.savingCajaOrigenes = false;
        this.handleConfigSaveError(error, () => this.persistCajaOrigenes(true));
      },
    });
  }

  persistCajaAmbitos(confirmConfigRemovals = false) {
    this.savingCajaAmbito = true;
    this.config.caja.ambitos = normalizeCajaAmbitos(this.config.caja);
    this.catalogConfigService.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (config) => {
        this.config = config;
        this.savingCajaAmbito = false;
      },
      error: (error) => {
        this.savingCajaAmbito = false;
        this.handleConfigSaveError(error, () => this.persistCajaAmbitos(true));
      },
    });
  }

  addCajaAmbito() {
    const label = this.cajaAmbitoDraft.trim();
    if (!label || this.savingCajaAmbito) return;

    const exists = this.config.caja.ambitos.some(
      (item) => item.label.trim().toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      this.cajaAmbitoDraft = '';
      return;
    }

    let id = slugifyCajaAmbitoId(label);
    if (id === BUSINESS_CASH_AMBITO_ID) {
      this.dialogService.alert({
        title: 'Nombre reservado',
        message:
          'Esa etiqueta corresponde a la caja principal del negocio. Renombrala en la fila de arriba o elegí otro nombre.',
      });
      return;
    }
    if (this.config.caja.ambitos.some((item) => item.id === id)) {
      let suffix = 2;
      while (this.config.caja.ambitos.some((item) => item.id === `${id}_${suffix}`)) {
        suffix += 1;
      }
      id = `${id}_${suffix}`;
    }

    this.config.caja.ambitos = [...this.config.caja.ambitos, { id, label }].sort((a, b) =>
      a.label.localeCompare(b.label, 'es')
    );
    this.cajaAmbitoDraft = '';
    this.persistCajaAmbitos();
  }

  removeCajaAmbito(ambito: { id: string; label: string; sistema?: boolean }) {
    if (this.savingCajaAmbito || isSystemCashAmbito(ambito)) return;

    this.confirmConfigRemoval(
      'caja.ambitos',
      ambito.label,
      () => {
        this.config.caja.ambitos = this.config.caja.ambitos.filter((item) => item.id !== ambito.id);
      },
      (confirm) => this.persistCajaAmbitos(confirm),
      ambito.id
    );
  }

  persistStockTipos() {
    this.savingStockTipos = true;
    this.config.stock.tipos = normalizeStockTipos(this.config.stock.tipos);

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.savingStockTipos = false;
      },
      error: () => {
        this.savingStockTipos = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron guardar los tipos de movimiento.',
        });
      },
    });
  }

  addStockOrigen() {
    const nombre = this.stockOrigenDraft.trim();
    if (!nombre || this.savingStockOrigenes) return;

    let grupo = slugifyOrigenGrupo(nombre);
    if (this.config.stock.origenes.some((item) => item.grupo === grupo)) {
      let suffix = 2;
      while (this.config.stock.origenes.some((item) => item.grupo === `${grupo}_${suffix}`)) {
        suffix += 1;
      }
      grupo = `${grupo}_${suffix}`;
    }

    this.config.stock.origenes = [
      ...this.config.stock.origenes,
      { grupo, nombre },
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    this.stockOrigenDraft = '';
    this.persistStockOrigenes();
  }

  removeStockOrigen(origen: { grupo: string; nombre: string }) {
    if (this.savingStockOrigenes) return;

    this.confirmConfigRemoval(
      'stock.origenes',
      origen.nombre,
      () => {
        this.config.stock.origenes = this.config.stock.origenes.filter((item) => item !== origen);
      },
      (confirm) => this.persistStockOrigenes(confirm),
      origen.grupo
    );
  }

  persistStockOrigenes(confirmConfigRemovals = false) {
    this.savingStockOrigenes = true;
    this.config.stock.origenes = this.config.stock.origenes
      .map((item) => ({
        grupo: item.grupo.trim().toLowerCase(),
        nombre: item.nombre.trim(),
      }))
      .filter((item) => item.grupo && item.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    this.catalogConfigService.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (config) => {
        this.config = config;
        this.savingStockOrigenes = false;
      },
      error: (error) => {
        this.savingStockOrigenes = false;
        this.handleConfigSaveError(error, () => this.persistStockOrigenes(true));
      },
    });
  }

  private confirmConfigRemoval(
    kind: ConfigRemovalKind,
    displayName: string,
    applyRemoval: () => void,
    persist: (confirmConfigRemovals: boolean) => void,
    checkValue?: string
  ) {
    const value = (checkValue ?? displayName).trim();
    this.catalogConfigService.checkConfigUsage(kind, value).subscribe({
      next: ({ usage }) => {
        const active = usage.filter((hit) => hit.count > 0);
        if (active.length === 0) {
          applyRemoval();
          persist(false);
          return;
        }

        this.dialogService
          .confirm({
            title: 'Opción en uso',
            message: this.buildConfigUsageMessage(displayName, active),
            confirmLabel: 'Quitar igual',
          })
          .subscribe((confirmed) => {
            if (!confirmed) return;
            applyRemoval();
            persist(true);
          });
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo verificar si la opción está en uso.',
        });
      },
    });
  }

  private buildConfigUsageMessage(displayName: string, usage: ConfigUsageHit[]): string {
    const lines = usage.map((hit) => `• ${hit.label}: ${hit.count} registro(s)`).join('\n');
    return (
      `"${displayName}" se usa en:\n${lines}\n\n` +
      'Los registros existentes conservarán ese valor, pero dejará de aparecer en las listas. ' +
      '¿Quitar de la configuración?'
    );
  }

  private handleConfigSaveError(error: unknown, retryWithConfirm: () => void) {
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
      this.dialogService
        .confirm({
          title: 'Opción en uso',
          message: this.buildConfigUsageMessage('Esta opción', body.usage),
          confirmLabel: 'Quitar igual',
        })
        .subscribe((confirmed) => {
          if (confirmed) retryWithConfirm();
        });
      return;
    }

    this.dialogService.alert({
      title: 'Error',
      message: 'No se pudo guardar. Verificá que el servidor y el emulador estén corriendo.',
    });
  }

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');

      if (!this.auth.canManageSettings) {
        this.router.navigate(['/dashboard']);
        return;
      }

      if (
        tab === 'caja' ||
        tab === 'stock' ||
        tab === 'clientes' ||
        tab === 'proveedores' ||
        tab === 'productos' ||
        tab === 'pedidos' ||
        tab === 'usuarios'
      ) {
        if (this.activeModuleId !== tab) {
          this.cancelPedidosPersist();
          this.clearSaveFeedback();
        }
        this.activeModuleId = tab;
      }
    });

    this.catalogConfigService.getAppConfig().subscribe({
      next: (config) => {
        this.config = config;
        if (!this.config.pedidos?.estados?.length) {
          this.config.pedidos.estados = structuredClone(DEFAULT_ORDER_ESTADOS);
        }
        if (!this.config.pedidos.costosExtraPredeterminados) {
          this.config.pedidos.costosExtraPredeterminados = [];
        }
        if (this.config.pedidos.permitirStockNegativo === undefined) {
          this.config.pedidos.permitirStockNegativo = true;
        }
        const pedidosNormalized = normalizeOrderPedidosConfig(this.config.pedidos);
        this.config.pedidos = { ...this.config.pedidos, ...pedidosNormalized };
        this.refreshPedidosViewState();
        if (!this.config.productos.categoriasSinStock) {
          this.config.productos.categoriasSinStock = [];
        }
        this.config.productos.categoriasStock = normalizeCategoriasStock(
          this.config.productos.categoriasStock,
          this.config.productos.categorias,
          this.config.productos.categoriasSinStock
        );
        this.syncAllFieldModes();
        this.syncCajaConceptosMode();
        this.config.caja.ambitos = normalizeCajaAmbitos(this.config.caja);
        if (!this.config.caja.origenes?.length) {
          this.config.caja.origenes = structuredClone(DEFAULT_APP_CONFIG.caja.origenes);
        }
        if (!this.config.stock?.tipos?.length) {
          this.config.stock = structuredClone(DEFAULT_APP_CONFIG.stock);
        } else {
          this.config.stock.tipos = normalizeStockTipos(this.config.stock.tipos);
        }
        if (!this.config.stock?.origenes?.length) {
          this.config.stock.origenes = structuredClone(DEFAULT_APP_CONFIG.stock.origenes);
        }
      },
      error: () => {
        if (!this.auth.canManageSettings) return;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la configuración.',
        });
      },
    });
  }

  getDraft(key: ConfigFieldKey): string {
    return this.optionDrafts[key] ?? '';
  }

  setDraft(key: ConfigFieldKey, value: string) {
    this.optionDrafts = { ...this.optionDrafts, [key]: value };
  }

  clearDraft(key: ConfigFieldKey) {
    this.optionDrafts = { ...this.optionDrafts, [key]: '' };
  }

  isSavingField(key: ConfigFieldKey): boolean {
    return this.savingFields.has(key);
  }

  getList(key: ConfigFieldKey): string[] {
    const [module, field] = key.split('.') as [keyof AppConfig, string];
    return (this.config[module] as Record<string, string[]>)[field] ?? [];
  }

  setList(key: ConfigFieldKey, values: string[]) {
    const [module, field] = key.split('.') as [keyof AppConfig, string];
    (this.config[module] as Record<string, string[]>)[field] = values;
  }

  getSectionHint(key: ConfigFieldKey): string {
    const count = this.getList(key).length;
    if (count > 0) {
      return `${count} opción${count === 1 ? '' : 'es'} · buscador activo`;
    }
    return 'Sin opciones · texto libre';
  }

  private ensureCategoriasStockMap() {
    this.config.productos.categoriasStock = normalizeCategoriasStock(
      this.config.productos.categoriasStock,
      this.config.productos.categorias,
      this.config.productos.categoriasSinStock
    );
  }

  getCategoriaRegla(categoria: string): CategoriaStockRegla {
    return this.config.productos.categoriasStock?.[categoria] ?? DEFAULT_CATEGORIA_STOCK_REGLA;
  }

  isCategoriaStockConfigurada(categoria: string): boolean {
    return this.getCategoriaRegla(categoria).configurado;
  }

  addCategoria() {
    const value = this.categoriaDraft.trim();
    if (!value || this.savingCategoriasStock) return;

    const current = [...this.config.productos.categorias];
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) {
      this.categoriaDraft = '';
      return;
    }

    this.config.productos.categorias = [...current, value].sort((a, b) =>
      a.localeCompare(b, 'es')
    );
    this.ensureCategoriasStockMap();
    this.config.productos.categoriasStock[value] = {
      configurado: false,
      controlaStock: true,
      permitirStockNegativo: false,
    };
    this.syncFieldMode('productos.categorias');

    this.categoriaDraft = '';
    this.persistCategoriasStock();
  }

  toggleCategoriaStockConfigurada(categoria: string, configurado: boolean) {
    if (this.savingCategoriasStock) return;
    if (this.isCategoriaStockConfigurada(categoria) === configurado) return;
    this.ensureCategoriasStockMap();
    const current = this.getCategoriaRegla(categoria);
    this.config.productos.categoriasStock[categoria] = {
      ...current,
      configurado,
      permitirStockNegativo: configurado && current.controlaStock ? current.permitirStockNegativo : false,
    };
    this.persistCategoriasStock(configurado ? categoria : undefined);
  }

  setCategoriaReglaField(
    categoria: string,
    field: 'controlaStock' | 'permitirStockNegativo',
    value: boolean
  ) {
    if (this.savingCategoriasStock) return;
    this.ensureCategoriasStockMap();
    const current = this.config.productos.categoriasStock[categoria] ?? {
      ...DEFAULT_CATEGORIA_STOCK_REGLA,
      configurado: true,
    };
    if (current[field] === value) return;
    const next: CategoriaStockRegla = {
      ...current,
      configurado: true,
      [field]: value,
    } as CategoriaStockRegla;
    if (field === 'controlaStock' && !value) {
      next.permitirStockNegativo = false;
    }
    this.config.productos.categoriasStock[categoria] = next;
    this.persistCategoriasStock(categoria);
  }

  removeCategoria(categoria: string) {
    if (this.savingCategoriasStock) return;

    this.confirmConfigRemoval(
      'productos.categorias',
      categoria,
      () => {
        this.config.productos.categorias = this.config.productos.categorias.filter(
          (item) => item !== categoria
        );
        this.ensureCategoriasStockMap();
        delete this.config.productos.categoriasStock[categoria];
        this.config.productos.categoriasSinStock = (
          this.config.productos.categoriasSinStock ?? []
        ).filter((item) => item.trim().toLowerCase() !== categoria.trim().toLowerCase());
        this.syncFieldMode('productos.categorias');
      },
      (confirm) => this.persistCategoriasStock(undefined, confirm)
    );
  }

  private persistCategoriasStock(syncCategoria?: string, confirmConfigRemovals = false) {
    this.savingCategoriasStock = true;
    this.ensureCategoriasStockMap();

    const save = (sync?: string) => {
      this.catalogConfigService
        .updateAppConfig(this.config, {
          confirmConfigRemovals,
          syncCategoriaStock: sync,
        })
        .subscribe({
          next: (config) => {
            this.config = config;
            this.ensureCategoriasStockMap();
            this.savingCategoriasStock = false;
          },
          error: (err: HttpErrorResponse) => {
            this.savingCategoriasStock = false;
            this.handleConfigSaveError(err, () => this.persistCategoriasStock(syncCategoria, true));
          },
        });
    };

    if (!syncCategoria) {
      save();
      return;
    }

    this.dialogService
      .confirm({
        title: 'Aplicar a productos existentes',
        message: `¿Actualizar todos los productos de «${syncCategoria}» con estas reglas de stock? Podés seguir ajustando productos individuales después.`,
        confirmLabel: 'Aplicar a productos',
        cancelLabel: 'Solo guardar reglas',
      })
      .subscribe((confirmed) => {
        save(confirmed ? syncCategoria : undefined);
      });
  }

  addValue(section: ConfigSection) {
    const value = this.getDraft(section.key).trim();
    if (!value || this.isSavingField(section.key)) return;

    const current = this.getList(section.key);
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) {
      this.clearDraft(section.key);
      return;
    }

    this.setList(
      section.key,
      [...current, value].sort((a, b) => a.localeCompare(b, 'es'))
    );
    this.syncFieldMode(section.key);
    this.clearDraft(section.key);
    this.persistField(section.key);
  }

  addValueFromList(key: ConfigFieldKey, value: string) {
    const trimmed = value.trim();
    if (!trimmed || this.isSavingField(key)) return;

    const current = this.getList(key);
    if (current.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;

    this.setList(key, [...current, trimmed].sort((a, b) => a.localeCompare(b, 'es')));
    this.syncFieldMode(key);
    this.persistField(key);
  }

  removeValue(key: ConfigFieldKey, value: string) {
    if (this.isSavingField(key)) return;

    this.confirmConfigRemoval(
      key,
      value,
      () => {
        this.setList(
          key,
          this.getList(key).filter((item) => item !== value)
        );
        this.syncFieldMode(key);
      },
      (confirm) => this.persistField(key, confirm)
    );
  }

  private syncFieldMode(key: ConfigFieldKey) {
    const [module, field] = key.split('.') as [keyof AppConfig, string];
    (this.config[module] as { modo: Record<string, FieldInputMode> }).modo[field] =
      this.getList(key).length > 0 ? 'lista' : 'texto';
  }

  private syncAllFieldModes() {
    for (const module of this.modules) {
      for (const section of module.sections) {
        this.syncFieldMode(section.key);
      }
    }
    this.syncFieldMode('productos.categorias');
  }

  selectModule(moduleId: ConfigModule['id']) {
    if (this.activeModuleId === moduleId) return;
    this.cancelPedidosPersist();
    this.clearSaveFeedback();
    this.activeModuleId = moduleId;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: moduleId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  saveConfig() {
    this.persistConfig(true);
  }

  onPedidosModoStockChange() {
    this.refreshPedidosViewState();
    this.schedulePedidosPersist();
  }

  onPedidosEstadoDescuentaStockChange() {
    this.refreshPedidosStockModeSummary();
    this.schedulePedidosPersist();
  }

  onImpresionDosViasChange() {
    this.persistPedidosSettings();
  }

  persistPedidosSettings() {
    this.schedulePedidosPersist();
  }

  schedulePedidosPersist() {
    if (this.activeModuleId !== 'pedidos') return;
    if (this.pedidosPersistTimer) {
      clearTimeout(this.pedidosPersistTimer);
    }
    this.pedidosPersistTimer = setTimeout(() => {
      this.pedidosPersistTimer = undefined;
      this.flushPedidosPersist();
    }, SettingsComponent.PEDIDOS_PERSIST_DEBOUNCE_MS);
  }

  private flushPedidosPersist(confirmConfigRemovals = false) {
    if (this.activeModuleId !== 'pedidos') return;
    this.runPedidosOnlyPersist(confirmConfigRemovals);
  }

  private runPedidosOnlyPersist(confirmConfigRemovals = false) {
    const seq = ++this.pedidosPersistSeq;
    this.savingPedidos = true;
    this.catalogConfigService
      .updateAppConfig(this.config, { confirmConfigRemovals })
      .subscribe({
        next: (config) => {
          if (seq !== this.pedidosPersistSeq) return;
          this.config = config;
          this.refreshPedidosViewState();
          this.savingPedidos = false;
        },
        error: (error) => {
          if (seq !== this.pedidosPersistSeq) return;
          this.savingPedidos = false;
          this.handleConfigSaveError(error, () => {
            if (seq === this.pedidosPersistSeq) {
              this.runPedidosOnlyPersist(true);
            }
          });
        },
      });
  }

  private cancelPedidosPersist() {
    if (this.pedidosPersistTimer) {
      clearTimeout(this.pedidosPersistTimer);
      this.pedidosPersistTimer = undefined;
    }
    this.pedidosPersistSeq++;
    this.savingPedidos = false;
  }

  addPedidoExtraCostPreset() {
    const nombre = this.pedidoExtraCostPresetNombre.trim();
    const costo = Number(this.pedidoExtraCostPresetCosto);
    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el concepto del costo.',
      });
      return;
    }
    if (
      this.pedidoExtraCostPresetCosto === null ||
      Number.isNaN(costo) ||
      costo < 0
    ) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un precio válido.',
      });
      return;
    }

    const key = nombre.toLowerCase();
    const exists = (this.config.pedidos.costosExtraPredeterminados ?? []).some(
      (item) => item.nombre.trim().toLowerCase() === key
    );
    if (exists) {
      this.dialogService.alert({
        title: 'Concepto duplicado',
        message: 'Ese concepto ya está en la lista.',
      });
      return;
    }

    if (!this.config.pedidos.costosExtraPredeterminados) {
      this.config.pedidos.costosExtraPredeterminados = [];
    }
    this.config.pedidos.costosExtraPredeterminados.push({ nombre, costo });
    this.pedidoExtraCostPresetNombre = '';
    this.pedidoExtraCostPresetCosto = null;
    this.persistPedidosSettings();
  }

  removePedidoExtraCostPreset(index: number) {
    this.config.pedidos.costosExtraPredeterminados.splice(index, 1);
    this.persistPedidosSettings();
  }

  private persistField(key: ConfigFieldKey, confirmConfigRemovals = false) {
    this.persistConfig(false, key, false, confirmConfigRemovals);
  }

  private persistConfig(
    showSavingState = false,
    fieldKey?: ConfigFieldKey,
    pedidosOnly = false,
    confirmConfigRemovals = false
  ) {
    if (showSavingState) {
      this.clearSaveSuccess();
      this.saving = true;
    }
    if (fieldKey) {
      this.savingFields.add(fieldKey);
    }
    if (pedidosOnly) {
      this.savingPedidos = true;
    }
    if (!pedidosOnly) {
      this.syncAllFieldModes();
      this.syncCajaConceptosMode();
    }

    this.catalogConfigService.updateAppConfig(this.config, { confirmConfigRemovals }).subscribe({
      next: (config) => {
        this.config = config;
        this.ensureCategoriasStockMap();
        if (pedidosOnly || this.activeModuleId === 'pedidos') {
          this.refreshPedidosViewState();
        }
        if (!pedidosOnly) {
          this.syncAllFieldModes();
          this.syncCajaConceptosMode();
        }
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
        if (pedidosOnly) {
          this.savingPedidos = false;
        }
        if (showSavingState) {
          this.scheduleSaveSuccessAfterCooldown();
        } else {
          this.saving = false;
        }
      },
      error: (error) => {
        this.cancelSaveCooldown();
        this.saving = false;
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
        if (pedidosOnly) {
          this.savingPedidos = false;
        }
        this.handleConfigSaveError(error, () =>
          this.persistConfig(showSavingState, fieldKey, pedidosOnly, true)
        );
      },
    });
  }

  ngOnDestroy() {
    this.cancelPedidosPersist();
    this.clearSaveFeedback();
  }

  private scheduleSaveSuccessAfterCooldown() {
    this.cancelSaveCooldown();
    this.saveCooldownTimeout = setTimeout(() => {
      this.saving = false;
      this.saveCooldownTimeout = undefined;
      this.showSaveSuccess('Configuración guardada correctamente.');
    }, SAVE_BUTTON_COOLDOWN_MS);
  }

  private cancelSaveCooldown() {
    if (this.saveCooldownTimeout) {
      clearTimeout(this.saveCooldownTimeout);
      this.saveCooldownTimeout = undefined;
    }
  }

  private clearSaveSuccess() {
    this.saveSuccessMessage = '';
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
      this.saveSuccessTimeout = undefined;
    }
  }

  private clearSaveFeedback() {
    this.clearSaveSuccess();
    this.cancelSaveCooldown();
    this.saving = false;
  }

  private showSaveSuccess(message: string) {
    this.saveSuccessMessage = message;
    if (this.saveSuccessTimeout) {
      clearTimeout(this.saveSuccessTimeout);
    }
    this.saveSuccessTimeout = setTimeout(() => {
      this.saveSuccessMessage = '';
      this.saveSuccessTimeout = undefined;
    }, SAVE_SUCCESS_DISPLAY_MS);
  }
}
