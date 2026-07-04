import { Component, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
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
  getPrefijoForCategoria,
  findCategoriaByPrefijo,
  validateUniquePrefijos,
  normalizeProductosCodigo,
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
  normalizeOrderPhotoRetentionDays,
  getOrderPhysicalStockScopeLabel,
  ORDER_STATUS_CARD_LIMIT,
  canRemoveOrderEstado,
  slugifyOrderEstadoValue,
} from '../../core/constants/order-config';
import { normalizeStockTipos } from '../../core/constants/stock-movimientos';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsUsersPanelComponent } from './settings-users-panel.component';
import { SettingsFinancePanelComponent } from './settings-finance-panel.component';
import { SettingsCollaboratorsPanelComponent } from './settings-collaborators-panel.component';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { ConfigStringListComponent } from '../../shared/components/config-string-list/config-string-list.component';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
} from '../../shared/components/config-editable-list/config-editable-list.component';
import { ConfigListRemoveButtonComponent } from '../../shared/components/config-editable-list/config-list-remove-button.component';
import {
  CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS,
  CONFIG_EDITABLE_LIST_CHECK_LABEL_CLASS,
  CONFIG_EDITABLE_LIST_ITEM_CLASS,
  CONFIG_EDITABLE_LIST_ROW_BODY_CLASS,
  CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS,
  CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS,
  CONFIG_MODULE_HEADER_DESC_CLASS,
  CONFIG_MODULE_LIST_DESC_CLASS,
  CONFIG_SETTING_DESC_CLASS,
} from '../../shared/components/config-editable-list/config-editable-list.constants';
import { ConfigSettingCardComponent } from '../../shared/components/config-setting-card/config-setting-card.component';
import { FormBackButtonComponent } from '../../shared/components/form-shell/form-back-button.component';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';

interface ConfigSection {
  key: ConfigFieldKey;
  title: string;
  description: string;
  placeholder: string;
}

interface ConfigModule {
  id: 'productos' | 'clientes' | 'proveedores' | 'caja' | 'finanzas' | 'stock' | 'pedidos' | 'colaboradores' | 'usuarios';
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

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SettingsUsersPanelComponent,
    SettingsFinancePanelComponent,
    SettingsCollaboratorsPanelComponent,
    FormSaveFooterComponent,
    ConfigStringListComponent,
    ConfigEditableListComponent,
    ConfigListRemoveButtonComponent,
    ConfigSettingCardComponent,
    FormBackButtonComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div [class]="settingsShellClass">
      <div [class]="activeModuleId ? 'mb-4' : 'mb-6 sm:mb-8'">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              <ng-container *ngIf="!activeModuleId">Configuración</ng-container>
              <ng-container *ngIf="activeModule">Configuración de {{ activeModule.title }}</ng-container>
            </h1>
            <p *ngIf="!activeModuleId" [class]="configDescClass">
              Elegí una sección para editar listas, reglas y opciones del sistema.
            </p>
            <p *ngIf="activeModule" [class]="activeModuleDescClass">{{ activeModule.description }}</p>
          </div>
          <div class="flex items-center gap-1 shrink-0 mt-0.5">
            <button
              *ngIf="showActiveModuleSave"
              type="button"
              (click)="saveActiveModule()"
              [disabled]="isActiveModuleSaving()"
              title="Guardar"
              aria-label="Guardar configuración"
              class="p-1.5 rounded-lg text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <i-lucide
                [name]="isActiveModuleSaving() ? 'loader-circle' : 'save'"
                class="w-5 h-5"
                [class.animate-spin]="isActiveModuleSaving()">
              </i-lucide>
            </button>
            <app-form-back-button
              *ngIf="activeModuleId"
              label="Volver"
              shortLabel="Volver"
              ariaLabel="Volver al listado de configuración"
              (clicked)="backToModuleList()">
            </app-form-back-button>
          </div>
        </div>
      </div>

      <nav
        *ngIf="!activeModuleId"
        class="space-y-2 mb-6"
        aria-label="Secciones de configuración">
        <button
          type="button"
          *ngFor="let module of visibleModules"
          (click)="selectModule(module.id)"
          class="w-full flex items-center gap-3 sm:gap-4 p-4 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm text-left transition-colors hover:border-teal-200 hover:bg-teal-50/50 dark:hover:border-teal-800 dark:hover:bg-teal-950/30">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
            <i-lucide [name]="getModuleIcon(module.id)" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">{{ module.title }}</span>
            <span [class]="configModuleListDescClass">{{ module.description }}</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 shrink-0 text-gray-400 dark:text-gray-500"></i-lucide>
        </button>
      </nav>

      <section *ngIf="activeModuleId === 'pedidos'" [class]="configSectionClass">
        <div [class]="configSectionsListClass">
            <app-config-setting-card
              title="Estados del pedido"
              description="Seis estados fijos del flujo. Solo podés personalizar los nombres; no se pueden agregar ni quitar."
              [listCount]="config.pedidos.estados.length"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.estados')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.estados', $event)"
              [cardClass]="configCardClass">
              <app-config-editable-list
                configList
                [items]="pedidoEstadoListItems"
                labelMode="input"
                [showIndex]="true"
                [showAdd]="false"
                listMaxHeightClass=""
                [disabled]="savingPedidos"
                [footer]="'Las tarjetas del listado usan los estados 1 a ' + orderStatusCardPreviewCount + ' en este orden.'"
                (labelChange)="onPedidoEstadoLabelChange($event)"
                (labelBlur)="onPedidoEstadoLabelBlurById($event)">
              </app-config-editable-list>
            </app-config-setting-card>

            <app-config-setting-card
              title="Stock · modo"
              description="Desde qué estado baja el depósito."
              [listCount]="null"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.stockModo')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.stockModo', $event)"
              [cardClass]="configCardClass">
              <div configList>
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
              </div>
            </app-config-setting-card>

            <app-config-setting-card
              *ngIf="config.pedidos.modoStock === 'reservado'"
              title="Al cambiar estado"
              description="Opciones al pasar de un estado a otro con stock reservado."
              [listCount]="null"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.stockAlCambiar')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.stockAlCambiar', $event)"
              [cardClass]="configCardClass">
              <div configList>
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
              </div>
            </app-config-setting-card>

            <app-config-setting-card
              title="Impresión"
              description="Formato de la hoja del pedido."
              [listCount]="null"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.impresion')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.impresion', $event)"
              [cardClass]="configCardClass">
              <div configList class="space-y-2">
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionDosVias"
                    name="pedidosImpresionDosVias"
                    [disabled]="savingPedidos"
                    (change)="onImpresionDosViasChange()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Dos vías en A4</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Imprime dos copias iguales (9,5 cm cada una) lado a lado en la parte superior de una hoja vertical.
                    </span>
                  </span>
                </label>
                <label
                  *ngIf="!config.pedidos.impresionDosVias"
                  class="flex items-start gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionDosViasHorizontal"
                    name="pedidosImpresionDosViasHorizontal"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Hoja apaisada</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Solo con una vía: usa A4 horizontal en lugar de vertical.
                    </span>
                  </span>
                </label>
                <label class="flex items-start gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.impresionCasillasProductos"
                    name="pedidosImpresionCasillasProductos"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Casillas en productos</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Imprime un cuadrado □ al lado de cada ítem en la hoja del pedido para marcar con lápiz lo que ya está listo o entregado.
                    </span>
                  </span>
                </label>
              </div>
            </app-config-setting-card>

            <app-config-setting-card
              *ngIf="auth.hasModule('order_photos')"
              title="Fotos de referencia"
              description="Adjuntar imágenes al pedido y limpieza automática."
              [listCount]="null"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.fotos')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.fotos', $event)"
              [cardClass]="configCardClass">
              <div configList class="space-y-2">
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.fotosReferenciaHabilitadas"
                    name="pedidosFotosReferenciaHabilitadas"
                    [disabled]="savingPedidos"
                    (change)="onFotosReferenciaSettingsChange()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Usar fotos en pedidos</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Muestra el adjunto de fotos en el formulario del pedido.
                    </span>
                  </span>
                </label>
                <label
                  *ngIf="config.pedidos.fotosReferenciaHabilitadas"
                  class="flex items-start gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.fotosReferenciaEnImpresion"
                    name="pedidosFotosReferenciaEnImpresion"
                    [disabled]="savingPedidos"
                    (change)="persistPedidosSettings()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Imprimir fotos en hoja A4</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Las incluye abajo del imprimible, en la misma hoja A4.
                    </span>
                  </span>
                </label>
                <label
                  *ngIf="config.pedidos.fotosReferenciaHabilitadas"
                  class="flex items-start gap-2 cursor-pointer pl-5">
                  <input
                    type="checkbox"
                    [(ngModel)]="config.pedidos.fotosEliminacionAutomatica"
                    name="pedidosFotosEliminacionAutomatica"
                    [disabled]="savingPedidos"
                    (change)="onFotosRetencionSettingsChange()"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary mt-0.5">
                  <span>
                    <span class="block text-xs font-medium text-gray-900">Eliminar fotos automáticamente</span>
                    <span class="block text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Un proceso diario borra las fotos más viejas que el plazo indicado (Storage y referencia en el pedido).
                    </span>
                  </span>
                </label>
                <div
                  *ngIf="config.pedidos.fotosReferenciaHabilitadas && config.pedidos.fotosEliminacionAutomatica"
                  class="pl-5 flex flex-wrap items-center gap-2">
                  <label class="text-xs font-medium text-gray-700" for="pedidosFotosRetencionDias">
                    Conservar durante
                  </label>
                  <input
                    id="pedidosFotosRetencionDias"
                    type="number"
                    min="7"
                    max="365"
                    step="1"
                    [(ngModel)]="config.pedidos.fotosRetencionDias"
                    name="pedidosFotosRetencionDias"
                    [disabled]="savingPedidos"
                    (change)="onFotosRetencionSettingsChange()"
                    class="w-20 px-2 py-1 rounded-md border border-gray-200 text-xs tabular-nums">
                  <span class="text-xs text-gray-500">días (mín. 7, máx. 365)</span>
                </div>
              </div>
            </app-config-setting-card>

            <app-config-setting-card
              title="Costos extra"
              description="Conceptos precargados al personalizar productos."
              [listCount]="config.pedidos.costosExtraPredeterminados?.length ?? 0"
              [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('pedidos.costos')"
              (listExpandedChange)="onConfigSectionOpenChange('pedidos.costos', $event)"
              [cardClass]="configCardClass">
              <div configList>
              <label class="flex items-center gap-1.5 cursor-pointer shrink-0 mb-2">
                <input
                  type="checkbox"
                  [(ngModel)]="config.pedidos.costosPersonalizacionDetallados"
                  name="pedidosCostosDetallados"
                  [disabled]="savingPedidos"
                  (change)="persistPedidosSettings()"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary">
                <span class="text-xs font-medium text-gray-900">Costos detallados por producto</span>
              </label>

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
                    [disabled]="savingPedidos || !pedidoExtraCostPresetNombre.trim() || pedidoExtraCostPresetCosto === null || pedidoExtraCostPresetCosto < 0"
                    [class]="configAddButtonClass + ' !w-auto px-2'">
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
                <p [class]="configSettingDescClass">
                  Activá «Costos detallados» para casillas por producto y conceptos precargados.
                </p>
              </ng-template>
              </div>
            </app-config-setting-card>

            <app-config-setting-card
          *ngIf="config.pedidos.modoStock === 'reservado'"
          [cardClass]="configCardClass"
          title="Reglas de stock por estado"
          description="Al pasar a cada estado: cuánto se descuenta del depósito (solo reservado o todo el pedido) y si exige tener el stock completo antes del cambio."
          [listCount]="pedidoStockRuleRows.length"
          [sectionCollapse]="true"
          [listExpanded]="isConfigSectionOpen('pedidos.stockReglas')"
          (listExpandedChange)="onConfigSectionOpenChange('pedidos.stockReglas', $event)">
          <div configList class="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
            <div
              *ngFor="let row of pedidoStockRuleRows; trackBy: trackPedidoStockRuleRow"
              class="px-4 py-3 flex flex-col gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ row.label }}</p>
                <p [class]="configSettingDescClass">{{ row.mobileSummary }}</p>
              </div>
              <div class="w-full min-w-0">
                <label class="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">
                  Descuento en depósito
                </label>
                <select
                  [ngModel]="row.scope"
                  (ngModelChange)="onPedidoStockRuleScopeChange(row, $event)"
                  [name]="'pedidoDescuentoScopeWide_' + row.estadoValue"
                  [disabled]="savingPedidos"
                  class="w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
                  <option value="solo_reservado">Solo lo reservado</option>
                  <option value="pedido_completo">Todo el pedido pendiente</option>
                </select>
              </div>
              <label
                class="flex items-center gap-2 cursor-pointer w-full min-w-0"
                [class.opacity-50]="row.exigeStockDisabled"
                [title]="row.exigeStockDisabled ? 'Solo aplica con descuento de pedido completo' : ''">
                <input
                  type="checkbox"
                  [ngModel]="row.exigeStock"
                  (ngModelChange)="onPedidoStockRuleExigeChange(row, $event)"
                  [name]="'pedidoExigeStockWide_' + row.estadoValue"
                  [disabled]="savingPedidos || row.exigeStockDisabled"
                  class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0">
                <span class="text-sm text-gray-700 dark:text-gray-300">Exigir stock completo</span>
              </label>
            </div>
          </div>
        </app-config-setting-card>
        </div>
      </section>

      <section *ngIf="activeModuleId === 'caja'" [class]="configSectionClass">
        <div [class]="configSectionsListClass">
        <app-config-setting-card
          title="Etiquetas de caja"
          [description]="cajaAmbitosCardDescription"
          [listCount]="config.caja.ambitos.length"
          [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('caja.ambitos')"
          (listExpandedChange)="onConfigSectionOpenChange('caja.ambitos', $event)"
          [cardClass]="configCardClass">
          <app-config-editable-list
            configList
            [items]="cajaAmbitoListItems"
            labelMode="input"
            addPlaceholder="Ej. Personal, Caja chica..."
            [disabled]="savingCajaAmbito || !canAddCajaAmbito"
            inputName="cajaAmbitoDraft"
            (add)="addCajaAmbitoFromList($event)"
            (remove)="removeCajaAmbitoById($event)"
            (labelChange)="onCajaAmbitoLabelChange($event)"
            (labelBlur)="onCajaAmbitoLabelBlur()">
          </app-config-editable-list>
        </app-config-setting-card>
        </div>
      </section>

      <section *ngIf="activeModuleId === 'stock'" [class]="configSectionClass">
        <div [class]="configSectionsListClass">
          <app-config-setting-card
            title="Tipos"
            description="Entrada y salida son fijos; podés cambiar solo el nombre visible."
            [listCount]="config.stock.tipos.length"
            [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('stock.tipos')"
            (listExpandedChange)="onConfigSectionOpenChange('stock.tipos', $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="stockTipoListItems"
              labelMode="input"
              [showAdd]="false"
              [disabled]="isSavingStockTipos"
              (labelChange)="onStockTipoLabelChange($event)"
              (labelBlur)="onStockTipoLabelBlur()">
            </app-config-editable-list>
          </app-config-setting-card>

          <app-config-setting-card
            title="Orígenes"
            description="Etiquetas del combobox de filtro. Por defecto: Compras, Pedidos/ventas, Carga inicial y Ajuste."
            [listCount]="config.stock.origenes.length"
            [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen('stock.origenes')"
            (listExpandedChange)="onConfigSectionOpenChange('stock.origenes', $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="stockOrigenListItems"
              labelMode="input"
              addPlaceholder="Ej. Devoluciones"
              [disabled]="isSavingStockOrigenes"
              inputName="stockOrigenDraft"
              (add)="addStockOrigenFromList($event)"
              (remove)="removeStockOrigenById($event)"
              (labelChange)="onStockOrigenLabelChange($event)"
              (labelBlur)="onStockOrigenLabelBlur()">
            </app-config-editable-list>
          </app-config-setting-card>
        </div>
      </section>

      <app-settings-users-panel *ngIf="activeModuleId === 'usuarios'"></app-settings-users-panel>

      <app-settings-finance-panel *ngIf="activeModuleId === 'finanzas'"></app-settings-finance-panel>

      <app-settings-collaborators-panel *ngIf="activeModuleId === 'colaboradores'"></app-settings-collaborators-panel>

      <section *ngIf="activeModuleId === 'productos'" [class]="configSectionClass">
        <div [class]="configSectionsListClass">
        <app-config-setting-card
          title="Categorías y códigos"
          description="Códigos automáticos por categoría con un prefijo único (10, 20…). Sin prefijo, el código es manual."
          [cardClass]="configCardClass"
          [listCount]="config.productos.categorias.length"
          [sectionCollapse]="true"
          [listExpanded]="isConfigSectionOpen('productos.categorias')"
          (listExpandedChange)="onConfigSectionOpenChange('productos.categorias', $event)"
          [hasConfigAdd]="true">
          <div configList class="space-y-3">
            <div
              configAdd
              class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-2.5 sm:p-2 space-y-2">
              <div class="flex items-center gap-2 min-w-0">
                <input
                  [(ngModel)]="categoriaDraft"
                  name="productoCategoriaNew"
                  placeholder="Nueva categoría, ej. Personalización"
                  [disabled]="savingCategorias"
                  (keyup.enter)="addCategoria()"
                  [class]="configInputClass + ' flex-1 min-w-0'">
                <button
                  type="button"
                  (click)="addCategoria()"
                  [disabled]="!canAddCategoria"
                  [class]="configAddButtonClass + ' shrink-0 sm:hidden'">
                  Agregar
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-gray-200/80 dark:border-gray-700/80 pt-2">
                <label [class]="configCheckLabelClass + ' py-0 shrink-0'">
                  <input
                    type="checkbox"
                    [(ngModel)]="categoriaDraftUsesAuto"
                    (ngModelChange)="onCategoriaDraftUsesAutoChange()"
                    name="productoCategoriaAutoNew"
                    [disabled]="savingCategorias"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0">
                  <span class="leading-snug text-xs whitespace-nowrap">Código auto</span>
                </label>
                <div
                  *ngIf="categoriaDraftUsesAuto"
                  class="flex items-center gap-1 shrink-0">
                  <span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-teal-200 text-teal-800 bg-teal-50/70 dark:border-teal-800 dark:text-teal-200 dark:bg-teal-950/40">
                    Prefijo
                  </span>
                  <input
                    [(ngModel)]="categoriaPrefijoDraft"
                    (ngModelChange)="onAddPrefijoInput()"
                    name="productoCategoriaPrefijoNew"
                    type="text"
                    inputmode="numeric"
                    maxlength="4"
                    placeholder="10"
                    [disabled]="savingCategorias"
                    (keyup.enter)="addCategoria()"
                    [class]="configInputClass + ' w-10 sm:w-12 max-w-[3rem] tabular-nums text-center border-teal-200 focus:ring-teal-500 dark:border-teal-700 py-1 px-1'">
                  <span class="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    Ej. {{ getPrefijoEjemploFromDraft() }}
                  </span>
                </div>
                <button
                  type="button"
                  (click)="addCategoria()"
                  [disabled]="!canAddCategoria"
                  [class]="configAddButtonClass + ' hidden sm:inline-flex shrink-0 sm:ml-auto'">
                  Agregar
                </button>
              </div>
              <p
                *ngIf="categoriaDraftUsesAuto && categoriaAddPrefijoError"
                class="text-[11px] text-amber-700 dark:text-amber-300 leading-snug m-0">
                {{ categoriaAddPrefijoError }}
              </p>
            </div>

            <ul class="space-y-2.5 m-0 p-0 list-none">
              <li
                *ngFor="let categoria of config.productos.categorias; let i = index; trackBy: trackCategoria"
                class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-2.5 sm:p-2 space-y-2">
                <div class="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    [ngModel]="getCategoriaDisplayName(categoria)"
                    (ngModelChange)="onCategoriaNameInput(categoria, $event)"
                    (blur)="onCategoriaNameBlur(categoria)"
                    [name]="'categoria-nombre-' + categoria"
                    [disabled]="savingCategorias"
                    [class]="configInputClass + ' flex-1 min-w-0 min-h-0 font-medium'">
                  <app-config-list-remove-button
                    position="inline"
                    [compact]="true"
                    [disabled]="savingCategorias"
                    (clicked)="removeCategoria(categoria)">
                  </app-config-list-remove-button>
                </div>

                <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-gray-200/80 dark:border-gray-700/80 pt-2">
                  <label [class]="configCheckLabelClass + ' py-0 shrink-0 text-xs text-gray-700 dark:text-gray-300'">
                    <input
                      type="checkbox"
                      [checked]="categoriaUsesAutoCodigo(categoria)"
                      (change)="setCategoriaUsesAutoCodigo(categoria, $any($event.target).checked)"
                      [disabled]="savingCategorias"
                      class="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0">
                    <span class="leading-snug whitespace-nowrap">Código auto</span>
                  </label>
                  <div
                    *ngIf="categoriaUsesAutoCodigo(categoria)"
                    class="flex items-center gap-1 shrink-0 rounded-md px-1 py-0.5"
                    [ngClass]="getCategoriaPrefijoTone(i).panelBorder">
                    <span [ngClass]="getCategoriaPrefijoTone(i).chip">Prefijo</span>
                    <input
                      type="text"
                      inputmode="numeric"
                      maxlength="4"
                      [ngModel]="getCategoriaPrefijoDisplay(categoria)"
                      (ngModelChange)="onCategoriaPrefijoInput(categoria, $event)"
                      (blur)="onCategoriaPrefijoBlur(categoria)"
                      [name]="'prefijo-' + categoria"
                      placeholder="10"
                      [disabled]="savingCategorias"
                      [class]="configInputClass + ' w-10 sm:w-12 max-w-[3rem] tabular-nums text-center min-h-0 py-1 px-1 ' + getCategoriaPrefijoTone(i).input">
                    <span class="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      Ej. {{ getCategoriaPrefijoEjemplo(categoria, i) }}
                    </span>
                  </div>
                </div>

                <p
                  *ngIf="categoriaUsesAutoCodigo(categoria) && getCategoriaPrefijoConflict(categoria)"
                  class="text-[11px] text-amber-700 dark:text-amber-300 leading-snug m-0">
                  {{ getCategoriaPrefijoConflict(categoria) }}
                </p>
              </li>
              <li
                *ngIf="config.productos.categorias.length === 0"
                class="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                Todavía no hay categorías cargadas.
              </li>
            </ul>
          </div>
        </app-config-setting-card>

          <app-config-setting-card
            *ngFor="let section of productosCatalogSections"
            [title]="section.title"
            [description]="section.description"
            [listCount]="getList(section.key).length"
            [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen(section.key)"
            (listExpandedChange)="onConfigSectionOpenChange(section.key, $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="getStringListItems(section.key)"
              labelMode="input"
              [addPlaceholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (add)="addValueFromList(section.key, $event)"
              (remove)="removeStringListItemFromList(section.key, $event)"
              (labelChange)="onStringListLabelChange(section.key, $event)"
              (labelBlur)="onStringListLabelBlur(section.key, $event)">
            </app-config-editable-list>
          </app-config-setting-card>
        </div>
      </section>

      <section *ngIf="activeModule && activeModuleId !== 'pedidos' && activeModuleId !== 'caja' && activeModuleId !== 'stock' && activeModuleId !== 'usuarios' && activeModuleId !== 'productos' && activeModuleId !== 'finanzas'" [class]="configSectionClass">
        <div [class]="configSectionsListClass">
          <app-config-setting-card
            *ngFor="let section of activeModule!.sections"
            [title]="section.title"
            [description]="section.description"
            [listCount]="getList(section.key).length"
            [sectionCollapse]="true"
              [listExpanded]="isConfigSectionOpen(section.key)"
            (listExpandedChange)="onConfigSectionOpenChange(section.key, $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="getStringListItems(section.key)"
              labelMode="input"
              [addPlaceholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (add)="addValueFromList(section.key, $event)"
              (remove)="removeStringListItemFromList(section.key, $event)"
              (labelChange)="onStringListLabelChange(section.key, $event)"
              (labelBlur)="onStringListLabelBlur(section.key, $event)">
            </app-config-editable-list>
          </app-config-setting-card>
        </div>
      </section>

      <div
        *ngIf="activeModuleId && activeModuleId !== 'usuarios' && activeModuleId !== 'finanzas' && activeModuleId !== 'colaboradores'"
        class="mt-6 sm:mt-8">
        <app-form-save-footer
          [saving]="isActiveModuleSaving()"
          [successMessage]="saveSuccessMessage"
          [centerOnLarge]="true"
          (saveClick)="saveConfig()">
        </app-form-save-footer>
      </div>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit, OnDestroy {
  @ViewChild(SettingsFinancePanelComponent)
  financePanel?: SettingsFinancePanelComponent;

  @ViewChild(SettingsCollaboratorsPanelComponent)
  collaboratorsPanel?: SettingsCollaboratorsPanelComponent;

  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly auth = inject(AuthService);

  config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  activeModuleId: ConfigModule['id'] | null = null;
  saving = false;
  savingPedidos = false;
  saveSuccessMessage = '';
  optionDrafts: Record<string, string> = {};
  savingFields = new Set<string>();
  savingCajaAmbito = false;
  savingStockTipos = false;
  savingStockOrigenes = false;
  savingCategorias = false;
  categoriaDraft = '';
  categoriaPrefijoDraft = '';
  categoriaDraftUsesAuto = false;
  categoriaAddPrefijoError = '';
  private categoriaAutoEnabled: Record<string, boolean> = {};
  private prefijoConflictByCategoria: Record<string, string> = {};
  private categoriaEditDrafts: Record<string, string> = {};
  /** Renombre de categoría pendiente de confirmarse en el servidor (migra productos). */
  private pendingCategoriaRename: { from: string; to: string } | null = null;
  /** Edición en curso de un ítem de lista de texto (clave `key@index`). */
  private stringListEditDrafts: Record<string, string> = {};
  /** Renombre de talle/color pendiente de confirmarse (migra productos). */
  private pendingFieldRename: { key: ConfigFieldKey; from: string; to: string } | null = null;
  private prefijoEditDrafts: Record<string, string> = {};
  private savedPrefijosSnapshot: Record<string, string> = {};

  cajaAmbitoDraft = '';
  stockOrigenDraft = '';
  pedidoExtraCostPresetNombre = '';
  pedidoExtraCostPresetCosto: number | null = null;
  pedidoEstadoDraft = '';
  private pedidosPersistTimer?: ReturnType<typeof setTimeout>;
  private pedidosPersistSeq = 0;
  private static readonly PEDIDOS_PERSIST_DEBOUNCE_MS = 400;
  orderStockTriggerOptionsList: OrderEstadoConfig[] = [];
  orderStockScopeEstadoOptionsList: OrderEstadoConfig[] = [];
  pedidoStockRuleRows: PedidoStockRuleRow[] = [];
  pedidosStockModeSummary = '';
  readonly isSystemCashAmbito = isSystemCashAmbito;

  get extraCajaAmbitosCount(): number {
    return this.config.caja.ambitos.filter((item) => !isSystemCashAmbito(item)).length;
  }

  readonly pageShellClass = PAGE_SHELL_CLASS;
  /** Columna centrada en pantallas grandes (como antes). */
  readonly settingsShellClass = 'w-full max-w-4xl mx-auto min-w-0';
  readonly configSectionClass = 'space-y-4 sm:space-y-6';
  readonly configDescClass = 'block text-xs text-gray-500 mt-0.5 desc-lg-only leading-snug';
  readonly activeModuleDescClass = CONFIG_MODULE_HEADER_DESC_CLASS;
  readonly configCodeClass = 'mt-1 text-[11px] text-primary/80 desc-lg-only';
  readonly configCardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 sm:p-4 flex flex-col min-w-0';
  readonly configToggleCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-3 w-full';
  readonly configSectionsListClass = 'flex flex-col gap-2 w-full min-w-0';

  readonly configModuleListDescClass = CONFIG_MODULE_LIST_DESC_CLASS;
  readonly configSettingDescClass = CONFIG_SETTING_DESC_CLASS;

  private expandedConfigSectionKey: string | null = null;
  private readonly defaultConfigSectionByModule: Partial<Record<ConfigModule['id'], string>> = {
    caja: 'caja.ambitos',
    stock: 'stock.tipos',
    clientes: 'clientes.etiquetas',
    proveedores: 'proveedores.etiquetas',
  };
  readonly configInputClass = CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS;
  readonly configAddButtonClass =
    'w-full sm:w-auto shrink-0 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500 whitespace-nowrap';
  readonly configOptionListClass = 'space-y-2 m-0 p-0 list-none';
  readonly configOptionListItemClass =
    'flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-gray-200';
  readonly configOptionTextClass = 'text-xs font-medium text-gray-900 break-words min-w-0 leading-tight';
  readonly configListItemClass = CONFIG_EDITABLE_LIST_ITEM_CLASS;
  readonly configRowShellClass = CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS;
  readonly configRowBodyClass = CONFIG_EDITABLE_LIST_ROW_BODY_CLASS;
  readonly configRowChipsClass = CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS;
  readonly configCheckLabelClass = CONFIG_EDITABLE_LIST_CHECK_LABEL_CLASS;

  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  private saveCooldownTimeout?: ReturnType<typeof setTimeout>;

  modules: ConfigModule[] = [
    {
      id: 'productos',
      title: 'Productos',
      description: 'Prefijos de código, talles y colores del catálogo.',
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
      description: 'Ámbitos en la grilla de caja.',
      sections: [],
    },
    {
      id: 'finanzas',
      title: 'Finanzas',
      description:
        'Medios de pago, cuentas vinculadas, conceptos de ingreso y categorías de gasto.',
      sections: [],
    },
    {
      id: 'stock',
      title: 'Stock',
      description: 'Tipos y orígenes en la grilla de movimientos de stock.',
      sections: [],
    },
    {
      id: 'pedidos',
      title: 'Pedidos',
      description: 'Estados, stock, costos de personalización e impresión.',
      sections: [],
    },
    {
      id: 'colaboradores',
      title: 'Colaboradores',
      description: 'Tipos de extra al registrar pagos (reparto, premio, etc.).',
      sections: [],
    },
    {
      id: 'usuarios',
      title: 'Usuarios',
      description: 'Operadores, permisos y acceso al sistema.',
      sections: [],
      supervisorOnly: true,
    },
  ];

  trackPedidosEstadoOption(_index: number, option: OrderEstadoConfig): string {
    return option.value;
  }

  trackCategoria(_index: number, categoria: string): string {
    return categoria;
  }

  private readonly categoriaPrefijoTones = [
    {
      chip: 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-teal-200 text-teal-800 bg-teal-50/70 dark:border-teal-800 dark:text-teal-200 dark:bg-teal-950/40',
      input: 'border-teal-200 focus:ring-teal-500 dark:border-teal-700',
      panelBorder: 'border-teal-100 dark:border-teal-900/50',
    },
    {
      chip: 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-violet-200 text-violet-800 bg-violet-50/70 dark:border-violet-800 dark:text-violet-200 dark:bg-violet-950/40',
      input: 'border-violet-200 focus:ring-violet-500 dark:border-violet-700',
      panelBorder: 'border-violet-100 dark:border-violet-900/50',
    },
    {
      chip: 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-amber-200 text-amber-900 bg-amber-50/70 dark:border-amber-800 dark:text-amber-100 dark:bg-amber-950/40',
      input: 'border-amber-200 focus:ring-amber-500 dark:border-amber-700',
      panelBorder: 'border-amber-100 dark:border-amber-900/50',
    },
    {
      chip: 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-sky-200 text-sky-800 bg-sky-50/70 dark:border-sky-800 dark:text-sky-200 dark:bg-sky-950/40',
      input: 'border-sky-200 focus:ring-sky-500 dark:border-sky-700',
      panelBorder: 'border-sky-100 dark:border-sky-900/50',
    },
  ] as const;

  getCategoriaPrefijoTone(index: number) {
    return this.categoriaPrefijoTones[index % this.categoriaPrefijoTones.length];
  }

  getCategoriaPrefijoEjemplo(categoria: string, index: number): string {
    const prefijo = this.getCategoriaPrefijoDisplay(categoria).trim();
    if (prefijo) return `${prefijo}01`;
    return `${String((index + 1) * 10).padStart(2, '0')}01`;
  }

  getPrefijoEjemploFromDraft(): string {
    const prefijo = this.normalizePrefijoInput(this.categoriaPrefijoDraft);
    return prefijo ? `${prefijo}01` : '1001';
  }

  get canAddCategoria(): boolean {
    if (!this.categoriaDraft.trim() || this.savingCategorias) return false;
    if (!this.categoriaDraftUsesAuto) return true;
    const prefijo = this.normalizePrefijoInput(this.categoriaPrefijoDraft);
    return Boolean(prefijo) && !this.categoriaAddPrefijoError;
  }

  categoriaUsesAutoCodigo(categoria: string): boolean {
    if (this.categoriaAutoEnabled[categoria] !== undefined) {
      return this.categoriaAutoEnabled[categoria];
    }
    return Boolean(this.getCategoriaPrefijo(categoria));
  }

  getCategoriaPrefijoConflict(categoria: string): string {
    return this.prefijoConflictByCategoria[categoria] ?? '';
  }

  onCategoriaDraftUsesAutoChange() {
    if (!this.categoriaDraftUsesAuto) {
      this.categoriaPrefijoDraft = '';
      this.categoriaAddPrefijoError = '';
      return;
    }
    this.onAddPrefijoInput();
  }

  onAddPrefijoInput() {
    this.categoriaAddPrefijoError = this.validatePrefijoDraft(
      this.categoriaPrefijoDraft
    );
  }

  setCategoriaUsesAutoCodigo(categoria: string, enabled: boolean) {
    this.categoriaAutoEnabled[categoria] = enabled;
    delete this.prefijoConflictByCategoria[categoria];

    if (!enabled) {
      delete this.prefijoEditDrafts[categoria];
      if (this.getCategoriaPrefijo(categoria)) {
        this.applyPrefijoToConfig(categoria, '');
        this.syncProductosAutomaticoFlag();
        this.persistProductosCodigoConfig();
      }
    }
  }

  trackPedidosEstadoRow(_index: number, estado: OrderEstadoConfig): string {
    return estado.value;
  }

  get orderStatusCardPreviewCount(): number {
    return Math.min(this.config.pedidos.estados.length, ORDER_STATUS_CARD_LIMIT);
  }

  canRemovePedidoEstado(estado: OrderEstadoConfig): boolean {
    return canRemoveOrderEstado(estado, this.config.pedidos.estados);
  }

  get pedidoEstadoListItems(): ConfigEditableListItem[] {
    return this.config.pedidos.estados.map((estado) => ({
      id: estado.value,
      label: estado.label,
      removable: false,
    }));
  }

  get cajaAmbitoListItems(): ConfigEditableListItem[] {
    return this.config.caja.ambitos.map((ambito) => ({
      id: ambito.id,
      label: ambito.label,
      removable: !isSystemCashAmbito(ambito),
      hint: isSystemCashAmbito(ambito)
        ? 'Principal · movimientos automáticos · solo podés cambiar el nombre'
        : undefined,
    }));
  }

  get effectiveMaxCajaAmbitos(): number {
    const limit =
      this.auth.currentBusiness?.limitesEfectivos?.maxAmbitosCaja ??
      this.auth.currentBusiness?.plan?.maxAmbitosCaja;
    if (limit == null) return 99;
    if (limit <= 0) return 1;
    return limit;
  }

  get canAddCajaAmbito(): boolean {
    return this.config.caja.ambitos.length < this.effectiveMaxCajaAmbitos;
  }

  get cajaAmbitosCardDescription(): string {
    const base =
      'Caja principal del negocio (pedidos, ventas y cobros automáticos). Podés renombrarla y agregar pestañas para movimientos manuales.';
    const used = this.config.caja.ambitos.length;
    const max = this.effectiveMaxCajaAmbitos;
    return `${base} Tu plan permite hasta ${max} etiqueta${max === 1 ? '' : 's'} (${used}/${max}).`;
  }

  get stockTipoListItems(): ConfigEditableListItem[] {
    return this.config.stock.tipos.map((tipo) => ({
      id: tipo.grupo,
      label: tipo.nombre,
      removable: false,
    }));
  }

  get stockOrigenListItems(): ConfigEditableListItem[] {
    return this.config.stock.origenes.map((origen) => ({
      id: origen.grupo,
      label: origen.nombre,
      removable: true,
    }));
  }

  getStringListItems(key: ConfigFieldKey): ConfigEditableListItem[] {
    return this.getList(key).map((label, index) => {
      const draft = this.stringListEditDrafts[this.stringListItemId(key, index)];
      return {
        id: this.stringListItemId(key, index),
        label: draft ?? label,
        removable: true,
      };
    });
  }

  private stringListItemId(key: ConfigFieldKey, index: number): string {
    return `${key}@${index}`;
  }

  private parseStringListItemIndex(itemId: string): number {
    const separator = itemId.lastIndexOf('@');
    if (separator < 0) return -1;
    const index = Number(itemId.slice(separator + 1));
    return Number.isFinite(index) ? index : -1;
  }

  removeStringListItemFromList(key: ConfigFieldKey, itemId: string) {
    const idx = this.parseStringListItemIndex(itemId);
    const list = this.getList(key);
    const value = idx >= 0 && idx < list.length ? list[idx] : itemId;
    this.removeValue(key, value);
  }

  addPedidoEstadoFromList(label: string) {
    this.pedidoEstadoDraft = label;
    this.addPedidoEstado();
  }

  removePedidoEstadoById(value: string) {
    const estado = this.config.pedidos.estados.find((item) => item.value === value);
    if (estado) this.removePedidoEstado(estado);
  }

  onPedidoEstadoLabelBlurById(event: { id: string; label: string }) {
    const index = this.config.pedidos.estados.findIndex((item) => item.value === event.id);
    if (index < 0) return;
    this.config.pedidos.estados[index].label = event.label;
    this.onPedidoEstadoLabelBlur(index);
  }

  onPedidoEstadoLabelChange(event: { id: string; label: string }) {
    const row = this.config.pedidos.estados.find((item) => item.value === event.id);
    if (row) row.label = event.label;
  }

  addCajaAmbitoFromList(label: string) {
    this.cajaAmbitoDraft = label;
    this.addCajaAmbito();
  }

  removeCajaAmbitoById(id: string) {
    const ambito = this.config.caja.ambitos.find((item) => item.id === id);
    if (ambito) this.removeCajaAmbito(ambito);
  }

  onCajaAmbitoLabelChange(event: { id: string; label: string }) {
    const row = this.config.caja.ambitos.find((item) => item.id === event.id);
    if (row) row.label = event.label;
  }

  onCajaAmbitoLabelBlur() {
    this.persistCajaAmbitos();
  }

  onStringListLabelChange(key: ConfigFieldKey, event: { id: string; label: string }) {
    // Guardamos la edición en un draft sin tocar la lista guardada, así
    // conservamos el valor original para detectar el renombre al perder foco.
    this.stringListEditDrafts[event.id] = event.label;
  }

  onStringListLabelBlur(key: ConfigFieldKey, event: { id: string; label: string }) {
    const idx = this.parseStringListItemIndex(event.id);
    const hadDraft = this.stringListEditDrafts[event.id] !== undefined;
    delete this.stringListEditDrafts[event.id];

    if (this.isSavingField(key)) return;
    const list = [...this.getList(key)];
    if (idx < 0 || idx >= list.length) return;

    const trimmed = event.label.trim();
    const previous = list[idx];

    // Sin cambios reales: nada que hacer (el draft ya se descartó).
    if (!trimmed || trimmed === previous.trim()) return;

    if (list.some((item, i) => i !== idx && item.toLowerCase() === trimmed.toLowerCase())) {
      this.dialogService.alert({
        title: 'Nombre duplicado',
        message: `Ya existe «${trimmed}» en la lista.`,
      });
      return;
    }

    list[idx] = trimmed;
    this.setList(key, list.sort((a, b) => a.localeCompare(b, 'es')));
    this.syncFieldMode(key);

    // Talle y color se guardan como un valor por producto: al renombrarlos
    // hay que migrar los productos que los usan para no dejar datos huérfanos.
    if (
      hadDraft &&
      (key === 'productos.talles' || key === 'productos.colores') &&
      previous.trim().toLowerCase() !== trimmed.toLowerCase()
    ) {
      this.pendingFieldRename = { key, from: previous, to: trimmed };
    }

    this.persistField(key);
  }

  onStockTipoLabelChange(event: { id: string; label: string }) {
    const row = this.config.stock.tipos.find((item) => item.grupo === event.id);
    if (row) row.nombre = event.label;
  }

  onStockTipoLabelBlur() {
    this.persistStockTipos();
  }

  addStockOrigenFromList(nombre: string) {
    this.stockOrigenDraft = nombre;
    this.addStockOrigen();
  }

  removeStockOrigenById(grupo: string) {
    const origen = this.config.stock.origenes.find((item) => item.grupo === grupo);
    if (origen) this.removeStockOrigen(origen);
  }

  onStockOrigenLabelChange(event: { id: string; label: string }) {
    const row = this.config.stock.origenes.find((item) => item.grupo === event.id);
    if (row) row.nombre = event.label;
  }

  onStockOrigenLabelBlur() {
    this.persistStockOrigenes();
  }

  addPedidoEstado() {
    return;
  }

  removePedidoEstado(_estado: OrderEstadoConfig) {
    return;
  }

  onPedidoEstadoLabelBlur(index: number) {
    const row = this.config.pedidos.estados[index];
    if (!row) return;
    row.label = row.label.trim();
    if (!row.label) {
      const defaults = DEFAULT_ORDER_ESTADOS.find((item) => item.value === row.value);
      row.label = defaults?.label ?? row.value;
    }
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

    const scopeLabel = getOrderPhysicalStockScopeLabel(scope);
    const explanation =
      scope === 'solo_reservado'
        ? 'Al pasar a este estado se descuenta del depósito solo lo que ya estaba reservado para el pedido.'
        : 'Al pasar a este estado se descuenta del depósito todo lo que aún falta entregar del pedido, aunque no estuviera reservado.';

    this.dialogService
      .confirm({
        title: `Descuento en «${row.label}»`,
        message: `¿Usar «${scopeLabel}»?\n\n${explanation}`,
        confirmLabel: 'Aplicar',
        cancelLabel: 'Cancelar',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

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
      });
  }

  onPedidoStockRuleExigeChange(row: PedidoStockRuleRow, checked: boolean) {
    if (row.exigeStock === checked || row.exigeStockDisabled) return;
    row.exigeStock = checked;
    this.syncEstadosExigenStockFromRuleRows();
    row.mobileSummary = this.buildPedidoStockRuleSummary(row);
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

  get showActiveModuleSave(): boolean {
    return (
      !!this.activeModuleId &&
      this.activeModuleId !== 'usuarios'
    );
  }

  get productosCatalogSections(): ConfigSection[] {
    return this.modules.find((module) => module.id === 'productos')?.sections ?? [];
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

  private syncCajaConceptosMode() {
    this.config.caja.modo.conceptos =
      this.config.caja.conceptos.length > 0 ? 'lista' : 'texto';
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

    if (!this.canAddCajaAmbito) {
      this.dialogService.alert({
        title: 'Límite del plan',
        message: `Tu plan permite hasta ${this.effectiveMaxCajaAmbitos} etiqueta${
          this.effectiveMaxCajaAmbitos === 1 ? '' : 's'
        } de caja. Contactá al administrador de plataforma para ampliarlo.`,
      });
      return;
    }

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

      const knownTabs: ConfigModule['id'][] = [
        'caja',
        'stock',
        'clientes',
        'proveedores',
        'productos',
        'pedidos',
        'usuarios',
        'finanzas',
        'colaboradores',
      ];
      let nextModuleId: ConfigModule['id'] | null =
        tab && knownTabs.includes(tab as ConfigModule['id']) ? (tab as ConfigModule['id']) : null;
      if (nextModuleId === 'usuarios' && !this.auth.canManageUsers) {
        nextModuleId = null;
      }
      if (this.activeModuleId !== nextModuleId) {
        this.cancelPedidosPersist();
        this.clearSaveFeedback();
        this.resetConfigSectionAccordion();
      }
      this.activeModuleId = nextModuleId;
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
        this.ensureProductosCodigo();
        this.syncPrefijosSnapshot();
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
        if (!this.config.finanzas?.mediosPago?.length) {
          this.config.finanzas = structuredClone(DEFAULT_APP_CONFIG.finanzas);
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

  isConfigSectionOpen(sectionKey: string): boolean {
    if (this.expandedConfigSectionKey === sectionKey) return true;
    if (this.expandedConfigSectionKey !== null) return false;
    const moduleId = this.activeModuleId;
    if (!moduleId) return false;
    return this.defaultConfigSectionByModule[moduleId] === sectionKey;
  }

  onConfigSectionOpenChange(sectionKey: string, expanded: boolean) {
    this.expandedConfigSectionKey = expanded ? sectionKey : null;
  }

  private resetConfigSectionAccordion() {
    this.expandedConfigSectionKey = null;
  }

  saveActiveModule() {
    if (this.activeModuleId === 'pedidos') {
      this.config.pedidos.fotosRetencionDias = normalizeOrderPhotoRetentionDays(
        this.config.pedidos.fotosRetencionDias
      );
      this.flushPedidosPersist();
      return;
    }
    if (this.activeModuleId === 'finanzas') {
      this.financePanel?.saveConfiguration();
      return;
    }
    if (this.activeModuleId === 'colaboradores') {
      this.collaboratorsPanel?.saveConfiguration();
      return;
    }
    if (this.activeModuleId === 'usuarios') {
      return;
    }
    this.saveConfig();
  }

  isActiveModuleSaving(): boolean {
    if (this.activeModuleId === 'pedidos') return this.savingPedidos;
    if (this.activeModuleId === 'finanzas') return this.financePanel?.saving ?? false;
    if (this.activeModuleId === 'colaboradores') return this.collaboratorsPanel?.saving ?? false;
    return this.saving;
  }

  saveCategoriasSection() {
    this.saveConfig();
  }

  private ensureProductosCodigo() {
    this.config.productos.codigo = normalizeProductosCodigo(this.config.productos.codigo);
  }

  private syncProductosAutomaticoFlag() {
    this.ensureProductosCodigo();
    const hasPrefijos = Object.values(this.config.productos.codigo.prefijosPorCategoria).some(
      (value) => this.normalizePrefijoInput(String(value ?? ''))
    );
    this.config.productos.codigo.automatico = hasPrefijos;
  }

  private normalizePrefijoInput(value: string): string {
    return String(value ?? '')
      .replace(/\D/g, '')
      .slice(0, 4);
  }

  private validatePrefijoDraft(prefijo: string, excludeCategoria?: string): string {
    const normalized = this.normalizePrefijoInput(prefijo);
    if (!normalized) {
      return 'Ingresá el prefijo numérico (ej. 10, 20).';
    }
    const owner = findCategoriaByPrefijo(
      this.config.productos.codigo,
      normalized,
      excludeCategoria
    );
    if (owner) {
      return `El prefijo «${normalized}» ya lo usa «${owner}». Elegí otro.`;
    }
    return '';
  }

  private getPrefijoConflictMessage(prefijo: string, excludeCategoria?: string): string {
    const normalized = this.normalizePrefijoInput(prefijo);
    if (!normalized) return '';
    const owner = findCategoriaByPrefijo(
      this.config.productos.codigo,
      normalized,
      excludeCategoria
    );
    return owner ? `El prefijo «${normalized}» ya lo usa «${owner}».` : '';
  }

  getCategoriaPrefijo(categoria: string): string {
    return getPrefijoForCategoria(this.config.productos.codigo, categoria) ?? '';
  }

  getCategoriaPrefijoDisplay(categoria: string): string {
    if (this.prefijoEditDrafts[categoria] !== undefined) {
      return this.prefijoEditDrafts[categoria];
    }
    return this.getCategoriaPrefijo(categoria);
  }

  onCategoriaPrefijoInput(categoria: string, value: string) {
    this.prefijoEditDrafts[categoria] = value;
    this.prefijoConflictByCategoria[categoria] = this.getPrefijoConflictMessage(
      value,
      categoria
    );
  }

  onCategoriaPrefijoBlur(categoria: string) {
    const previous = this.getSavedPrefijo(categoria);
    const raw = (this.prefijoEditDrafts[categoria] ?? previous).trim();
    delete this.prefijoEditDrafts[categoria];
    const next = this.normalizePrefijoInput(raw);

    if (next === previous) {
      delete this.prefijoConflictByCategoria[categoria];
      return;
    }

    if (next) {
      const conflict = this.getPrefijoConflictMessage(next, categoria);
      if (conflict) {
        this.prefijoConflictByCategoria[categoria] = conflict;
        this.dialogService.alert({
          title: 'Prefijo duplicado',
          message: conflict,
        });
        return;
      }
    }

    delete this.prefijoConflictByCategoria[categoria];
    this.applyPrefijoToConfig(categoria, next);
    this.syncProductosAutomaticoFlag();

    if (!next) {
      this.categoriaAutoEnabled[categoria] = false;
      this.persistProductosCodigoConfig();
      return;
    }

    this.categoriaAutoEnabled[categoria] = true;

    if (!previous) {
      this.dialogService
        .confirm({
          title: 'Generar códigos',
          message: `Asignaste el prefijo ${next} a «${categoria}». ¿Generar códigos para los productos existentes de esa categoría?`,
          confirmLabel: 'Generar códigos',
          cancelLabel: 'Solo guardar prefijo',
        })
        .subscribe((confirmed) => {
          this.persistProductosCodigoConfig(confirmed ? categoria : undefined);
        });
      return;
    }

    this.dialogService
      .confirm({
        title: 'Regenerar códigos',
        message: `Cambiaste el prefijo de «${categoria}» de ${previous} a ${next}. ¿Regenerar los códigos de los productos de esa categoría?`,
        confirmLabel: 'Regenerar códigos',
        cancelLabel: 'Solo guardar prefijo',
      })
      .subscribe((confirmed) => {
        this.persistProductosCodigoConfig(confirmed ? categoria : undefined);
      });
  }

  private getSavedPrefijo(categoria: string): string {
    return (
      this.savedPrefijosSnapshot[categoria] ??
      getPrefijoForCategoria(this.config.productos.codigo, categoria) ??
      ''
    );
  }

  private applyPrefijoToConfig(categoria: string, prefijo: string) {
    this.ensureProductosCodigo();
    if (!prefijo) {
      delete this.config.productos.codigo.prefijosPorCategoria[categoria];
      return;
    }
    this.config.productos.codigo.prefijosPorCategoria[categoria] = prefijo;
  }

  private syncPrefijosSnapshot() {
    this.ensureProductosCodigo();
    this.savedPrefijosSnapshot = {
      ...this.config.productos.codigo.prefijosPorCategoria,
    };
  }

  private persistProductosCodigoConfig(regenerateCodigosCategoria?: string) {
    this.savingCategorias = true;
    this.ensureProductosCodigo();
    this.syncProductosAutomaticoFlag();

    const duplicatePrefijoError = validateUniquePrefijos(
      this.config.productos.codigo.prefijosPorCategoria
    );
    if (duplicatePrefijoError) {
      this.savingCategorias = false;
      this.dialogService.alert({
        title: 'Prefijos duplicados',
        message: duplicatePrefijoError,
      });
      return;
    }

    this.catalogConfigService
      .updateAppConfig(this.config, { regenerateCodigosCategoria })
      .subscribe({
        next: (config) => {
          this.config = config;
          this.ensureProductosCodigo();
          this.syncPrefijosSnapshot();
          this.savingCategorias = false;
        },
        error: (err: HttpErrorResponse) => {
          this.savingCategorias = false;
          this.handleConfigSaveError(err, () =>
            this.persistProductosCodigoConfig(regenerateCodigosCategoria)
          );
        },
      });
  }

  setCategoriaPrefijo(categoria: string, value: string) {
    this.applyPrefijoToConfig(
      categoria,
      String(value ?? '')
        .replace(/\D/g, '')
        .slice(0, 4)
    );
  }

  getCategoriaDisplayName(categoria: string): string {
    return this.categoriaEditDrafts[categoria] ?? categoria;
  }

  onCategoriaNameInput(currentKey: string, value: string) {
    this.categoriaEditDrafts[currentKey] = value;
  }

  onCategoriaNameBlur(currentKey: string) {
    const draft = (this.categoriaEditDrafts[currentKey] ?? currentKey).trim();
    delete this.categoriaEditDrafts[currentKey];
    if (!draft || draft === currentKey) return;

    const duplicate = this.config.productos.categorias.some(
      (item) => item.trim().toLowerCase() === draft.toLowerCase() && item !== currentKey
    );
    if (duplicate) {
      this.dialogService.alert({
        title: 'Nombre duplicado',
        message: `Ya existe la categoría «${draft}».`,
      });
      return;
    }

    this.renameCategoria(currentKey, draft);
    // Si ya había un renombre pendiente que empezaba en este origen, encadenarlo.
    const renameFrom =
      this.pendingCategoriaRename &&
      this.pendingCategoriaRename.to.trim().toLowerCase() === currentKey.trim().toLowerCase()
        ? this.pendingCategoriaRename.from
        : currentKey;
    this.pendingCategoriaRename = { from: renameFrom, to: draft };
    this.persistCategorias(undefined, false, this.pendingCategoriaRename);
  }

  private renameCategoria(from: string, to: string) {
    this.ensureProductosCodigo();

    const idx = this.config.productos.categorias.indexOf(from);
    if (idx < 0) return;

    const categorias = [...this.config.productos.categorias];
    categorias[idx] = to;
    this.config.productos.categorias = categorias.sort((a, b) => a.localeCompare(b, 'es'));

    this.migrateCategoriaConfigKey(this.config.productos.codigo.prefijosPorCategoria, from, to);
    this.migrateCategoriaConfigKey(this.categoriaAutoEnabled, from, to);
    this.syncPrefijosSnapshot();
  }

  private migrateCategoriaConfigKey<T>(
    map: Record<string, T>,
    from: string,
    to: string
  ): void {
    const key = Object.keys(map).find(
      (item) => item.trim().toLowerCase() === from.trim().toLowerCase()
    );
    if (!key) return;
    map[to] = map[key];
    delete map[key];
  }

  addCategoria() {
    const value = this.categoriaDraft.trim();
    if (!value || this.savingCategorias || !this.canAddCategoria) return;

    const current = [...this.config.productos.categorias];
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) {
      this.categoriaDraft = '';
      this.categoriaPrefijoDraft = '';
      this.categoriaDraftUsesAuto = false;
      this.categoriaAddPrefijoError = '';
      return;
    }

    if (this.categoriaDraftUsesAuto) {
      const prefijoDraft = this.normalizePrefijoInput(this.categoriaPrefijoDraft);
      const conflict = this.validatePrefijoDraft(prefijoDraft);
      if (conflict) {
        this.categoriaAddPrefijoError = conflict;
        this.dialogService.alert({
          title: 'Prefijo duplicado',
          message: conflict,
        });
        return;
      }
      this.applyPrefijoToConfig(value, prefijoDraft);
      this.categoriaAutoEnabled[value] = true;
    }

    this.config.productos.categorias = [...current, value].sort((a, b) =>
      a.localeCompare(b, 'es')
    );
    this.syncFieldMode('productos.categorias');
    this.syncProductosAutomaticoFlag();
    this.expandedConfigSectionKey = 'productos.categorias';

    this.categoriaDraft = '';
    this.categoriaPrefijoDraft = '';
    this.categoriaDraftUsesAuto = false;
    this.categoriaAddPrefijoError = '';
    this.persistCategorias();
  }

  removeCategoria(categoria: string) {
    if (this.savingCategorias) return;

    this.confirmConfigRemoval(
      'productos.categorias',
      categoria,
      () => {
        this.config.productos.categorias = this.config.productos.categorias.filter(
          (item) => item !== categoria
        );
        delete this.config.productos.codigo.prefijosPorCategoria[categoria];
        delete this.categoriaAutoEnabled[categoria];
        delete this.prefijoConflictByCategoria[categoria];
        this.syncProductosAutomaticoFlag();
        this.syncFieldMode('productos.categorias');
      },
      (confirm) => this.persistCategorias(undefined, confirm)
    );
  }

  private persistCategorias(
    _unused?: undefined,
    confirmConfigRemovals = false,
    renameCategoria?: { from: string; to: string },
    regenerateCodigosCategoria?: string
  ) {
    this.savingCategorias = true;
    const effectiveRename = renameCategoria ?? this.pendingCategoriaRename ?? undefined;

    this.catalogConfigService
      .updateAppConfig(this.config, {
        confirmConfigRemovals,
        renameCategoria: effectiveRename,
        regenerateCodigosCategoria,
      })
      .subscribe({
        next: (config) => {
          this.config = config;
          this.ensureProductosCodigo();
          this.syncPrefijosSnapshot();
          this.savingCategorias = false;
          this.pendingCategoriaRename = null;
        },
        error: (err: HttpErrorResponse) => {
          this.savingCategorias = false;
          this.handleConfigSaveError(err, () =>
            this.persistCategorias(undefined, true, effectiveRename, regenerateCodigosCategoria)
          );
        },
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
    this.expandedConfigSectionKey = key;
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
    this.resetConfigSectionAccordion();
    this.activeModuleId = moduleId;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: moduleId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  backToModuleList() {
    if (!this.activeModuleId) return;
    this.cancelPedidosPersist();
    this.clearSaveFeedback();
    this.resetConfigSectionAccordion();
    this.activeModuleId = null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  getModuleIcon(moduleId: ConfigModule['id']): string {
    const icons: Record<ConfigModule['id'], string> = {
      productos: 'package',
      clientes: 'users',
      proveedores: 'building-2',
      caja: 'wallet',
      finanzas: 'receipt',
      stock: 'boxes',
      pedidos: 'clipboard-list',
      colaboradores: 'id-card',
      usuarios: 'user-cog',
    };
    return icons[moduleId] ?? 'settings';
  }

  saveConfig() {
    if (this.activeModuleId === 'pedidos') {
      this.saveActiveModule();
      return;
    }
    this.applyPendingPrefijoDraftsToConfig();
    this.persistConfig(true);
  }

  private applyPendingPrefijoDraftsToConfig() {
    if (Object.keys(this.prefijoEditDrafts).length === 0) return;
    for (const [categoria, draft] of Object.entries(this.prefijoEditDrafts)) {
      const previous = this.getSavedPrefijo(categoria);
      const next = String(draft).replace(/\D/g, '').slice(0, 4);
      if (next !== previous) {
        this.applyPrefijoToConfig(categoria, next);
      }
    }
    this.prefijoEditDrafts = {};
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
    // Sin guardado automático; usar Guardar.
  }

  onFotosReferenciaSettingsChange() {
    if (!this.config.pedidos.fotosReferenciaHabilitadas) {
      this.config.pedidos.fotosEliminacionAutomatica = false;
    }
  }

  onFotosRetencionSettingsChange() {
    this.config.pedidos.fotosRetencionDias = normalizeOrderPhotoRetentionDays(
      this.config.pedidos.fotosRetencionDias
    );
  }

  persistPedidosSettings() {
    // Sin guardado automático; usar Guardar.
  }

  schedulePedidosPersist() {
    // Sin guardado automático; usar Guardar.
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
          this.showSaveSuccess('Configuración guardada correctamente.');
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

    const renameTalle =
      this.pendingFieldRename?.key === 'productos.talles'
        ? { from: this.pendingFieldRename.from, to: this.pendingFieldRename.to }
        : undefined;
    const renameColor =
      this.pendingFieldRename?.key === 'productos.colores'
        ? { from: this.pendingFieldRename.from, to: this.pendingFieldRename.to }
        : undefined;

    this.catalogConfigService
      .updateAppConfig(this.config, {
        confirmConfigRemovals,
        renameCategoria: this.pendingCategoriaRename ?? undefined,
        renameTalle,
        renameColor,
      })
      .subscribe({
      next: (config) => {
        this.config = config;
        this.pendingCategoriaRename = null;
        this.pendingFieldRename = null;
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
