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
  ORDER_STATUS_CARD_LIMIT,
  canRemoveOrderEstado,
  slugifyOrderEstadoValue,
} from '../../core/constants/order-config';
import { normalizeStockTipos } from '../../core/constants/stock-movimientos';
import { normalizeCategoriasStock } from '../../core/utils/stock-product';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsUsersPanelComponent } from './settings-users-panel.component';
import { SettingsFinancePanelComponent } from './settings-finance-panel.component';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';
import { ConfigStringListComponent } from '../../shared/components/config-string-list/config-string-list.component';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
} from '../../shared/components/config-editable-list/config-editable-list.component';
import {
  CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS,
  CONFIG_EDITABLE_LIST_ITEM_CLASS,
  CONFIG_EDITABLE_LIST_REMOVE_BUTTON_CLASS,
} from '../../shared/components/config-editable-list/config-editable-list.constants';
import {
  CONFIG_SETTINGS_GRID_CLASS,
} from '../../shared/components/config-editable-list/config-layout.constants';
import { ConfigSettingCardComponent } from '../../shared/components/config-setting-card/config-setting-card.component';
import { ConfigModuleHeaderComponent } from '../../shared/components/config-module-header/config-module-header.component';
import { LucideAngularModule } from 'lucide-angular';

interface ConfigSection {
  key: ConfigFieldKey;
  title: string;
  description: string;
  placeholder: string;
}

interface ConfigModule {
  id: 'productos' | 'clientes' | 'proveedores' | 'caja' | 'finanzas' | 'stock' | 'pedidos' | 'usuarios';
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
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SettingsUsersPanelComponent,
    SettingsFinancePanelComponent,
    FormSaveFooterComponent,
    ConfigStringListComponent,
    ConfigEditableListComponent,
    ConfigSettingCardComponent,
    ConfigModuleHeaderComponent,
  ],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 w-full min-w-0">
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
        <app-config-module-header
          title="Pedidos"
          description="Estados del flujo (en ese orden), stock, impresión y costos de personalización."
          [saving]="savingPedidos"
          saveTitle="Guardar pedidos"
          (saveClick)="saveActiveModule()">
        </app-config-module-header>

        <div [class]="configGridPairClass">
            <app-config-setting-card
              title="Estados del pedido"
              description="Orden del flujo. Los primeros cinco nombres se muestran como tarjetas en Pedidos. Borrador y Cancelado no se pueden quitar."
              [listCount]="config.pedidos.estados.length"
              [listExpanded]="isConfigListExpanded('pedidos.estados', config.pedidos.estados.length)"
              (listExpandedChange)="onConfigListExpandedChange('pedidos.estados', $event)"
              [cardClass]="configCardClass">
              <app-config-editable-list
                configList
                [items]="pedidoEstadoListItems"
                labelMode="input"
                [showIndex]="true"
                addPlaceholder="Nuevo estado"
                listMaxHeightClass="max-h-64"
                [disabled]="savingPedidos"
                inputName="pedidoEstadoDraft"
                [footer]="'Las tarjetas del listado usan los estados 1 a ' + orderStatusCardPreviewCount + ' en este orden.'"
                (add)="addPedidoEstadoFromList($event)"
                (remove)="removePedidoEstadoById($event)"
                (labelChange)="onPedidoEstadoLabelChange($event)"
                (labelBlur)="onPedidoEstadoLabelBlurById($event)">
              </app-config-editable-list>
            </app-config-setting-card>

            <app-config-setting-card
              title="Stock · modo"
              description="Desde qué estado baja el depósito."
              [listCount]="null"
              [listExpanded]="isConfigListExpanded('pedidos.stockModo', 1)"
              (listExpandedChange)="onConfigListExpandedChange('pedidos.stockModo', $event)"
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
              [listExpanded]="isConfigListExpanded('pedidos.stockAlCambiar', 1)"
              (listExpandedChange)="onConfigListExpandedChange('pedidos.stockAlCambiar', $event)"
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
              [listExpanded]="isConfigListExpanded('pedidos.impresion', 1)"
              (listExpandedChange)="onConfigListExpandedChange('pedidos.impresion', $event)"
              [cardClass]="configCardClass">
              <div configList class="space-y-2">
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
              title="Costos extra"
              description="Conceptos precargados al personalizar productos."
              [listCount]="config.pedidos.costosExtraPredeterminados?.length ?? 0"
              [listExpanded]="isConfigListExpanded('pedidos.costos', config.pedidos.costosExtraPredeterminados?.length ?? 0)"
              (listExpandedChange)="onConfigListExpandedChange('pedidos.costos', $event)"
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
                <p class="text-xs text-gray-500 leading-snug">
                  Activá «Costos detallados» para casillas por producto y conceptos precargados.
                </p>
              </ng-template>
              </div>
            </app-config-setting-card>
        </div>

        <app-config-setting-card
          *ngIf="config.pedidos.modoStock === 'reservado'"
          [cardClass]="configCardClass"
          title="Reglas de stock por estado"
          description="Al pasar a cada estado: cuánto se descuenta del depósito (solo reservado o todo el pedido) y si exige tener el stock completo antes del cambio."
          [listCount]="pedidoStockRuleRows.length"
          [listExpanded]="pedidosStockRulesExpanded"
          (listExpandedChange)="pedidosStockRulesExpanded = $event"
          [collapsibleList]="true">
          <div configList class="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
            <div
              *ngFor="let row of pedidoStockRuleRows; trackBy: trackPedidoStockRuleRow"
              class="px-4 py-3 flex flex-col gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ row.label }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ row.mobileSummary }}</p>
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
      </section>

      <section *ngIf="activeModuleId === 'caja'" [class]="configSectionClass">
        <app-config-module-header
          title="Caja"
          description="Conceptos, orígenes y opciones de la grilla de caja."
          [saving]="isActiveModuleSaving()"
          (saveClick)="saveActiveModule()">
        </app-config-module-header>

        <div [class]="configGridCajaClass">
        <app-config-setting-card
          title="Etiquetas de caja"
          description="Caja principal del negocio (pedidos, ventas y cobros automáticos). Podés renombrarla y agregar pestañas para movimientos manuales."
          [listCount]="config.caja.ambitos.length"
          [listExpanded]="isConfigListExpanded('caja.ambitos', config.caja.ambitos.length)"
          (listExpandedChange)="onConfigListExpandedChange('caja.ambitos', $event)"
          [cardClass]="configCardClass">
          <app-config-editable-list
            configList
            [items]="cajaAmbitoListItems"
            labelMode="input"
            addPlaceholder="Ej. Personal, Caja chica..."
            [disabled]="savingCajaAmbito"
            inputName="cajaAmbitoDraft"
            (add)="addCajaAmbitoFromList($event)"
            (remove)="removeCajaAmbitoById($event)"
            (labelChange)="onCajaAmbitoLabelChange($event)"
            (labelBlur)="onCajaAmbitoLabelBlur()">
          </app-config-editable-list>
        </app-config-setting-card>

        <app-config-setting-card
          title="Orígenes"
          description="Etiquetas del combobox de filtro. Por defecto: Ventas, Pedidos y Compra."
          [listCount]="config.caja.origenes.length"
          [listExpanded]="isConfigListExpanded('caja.origenes', config.caja.origenes.length)"
          (listExpandedChange)="onConfigListExpandedChange('caja.origenes', $event)"
          [cardClass]="configCardClass">
          <app-config-editable-list
            configList
            [items]="cajaOrigenListItems"
            labelMode="input"
            addPlaceholder="Ej. Gastos fijos"
            [disabled]="isSavingCajaOrigenes"
            inputName="cajaOrigenDraft"
            (add)="addCajaOrigenFromList($event)"
            (remove)="removeCajaOrigenById($event)"
            (labelChange)="onCajaOrigenLabelChange($event)"
            (labelBlur)="onCajaOrigenLabelBlur()">
          </app-config-editable-list>
        </app-config-setting-card>

        <app-config-setting-card
          title="Conceptos"
          description="Ej. Venta mostrador (ingreso), Compra insumos (egreso), Diferencia (ambos)."
          [listCount]="config.caja.conceptos.length"
          [listExpanded]="isConfigListExpanded('caja.conceptos', config.caja.conceptos.length)"
          (listExpandedChange)="onConfigListExpandedChange('caja.conceptos', $event)"
          [cardClass]="configCardClass">
          <app-config-editable-list
            configList
            [items]="cajaConceptoListItems"
            labelMode="text"
            labelEmphasis="true"
            [useCustomAdd]="true"
            [disabled]="isSavingCajaConceptos"
            (remove)="removeCajaConceptoById($event)">
            <div configListAdd class="flex flex-col gap-1.5">
              <input
                [(ngModel)]="cajaConceptoDraft"
                name="cajaConceptoDraft"
                placeholder="Ej. Diferencia"
                [disabled]="isSavingCajaConceptos"
                (keyup.enter)="addCajaConcepto()"
                [class]="configInputClass">
              <div class="flex flex-col gap-2">
                <select
                  [(ngModel)]="cajaConceptoTipoDraft"
                  name="cajaConceptoTipoDraft"
                  [disabled]="isSavingCajaConceptos"
                  class="w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 bg-white">
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                  <option value="ambos">Ambos</option>
                </select>
                <button
                  type="button"
                  (click)="addCajaConcepto()"
                  [disabled]="isSavingCajaConceptos || !cajaConceptoDraft.trim()"
                  [class]="configAddButtonClass + ' w-full sm:w-auto'">
                  Agregar
                </button>
              </div>
            </div>
          </app-config-editable-list>
        </app-config-setting-card>
        </div>
      </section>

      <section *ngIf="activeModuleId === 'stock'" [class]="configSectionClass">
        <app-config-module-header
          title="Stock"
          description="Etiquetas de tipos y orígenes en la grilla de movimientos de inventario."
          [saving]="isActiveModuleSaving()"
          (saveClick)="saveActiveModule()">
        </app-config-module-header>

        <div [class]="configGridPairClass">
          <app-config-setting-card
            title="Tipos"
            description="Entrada y salida son fijos; podés cambiar solo el nombre visible."
            [listCount]="config.stock.tipos.length"
            [listExpanded]="isConfigListExpanded('stock.tipos', config.stock.tipos.length)"
            (listExpandedChange)="onConfigListExpandedChange('stock.tipos', $event)"
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
            [listExpanded]="isConfigListExpanded('stock.origenes', config.stock.origenes.length)"
            (listExpandedChange)="onConfigListExpandedChange('stock.origenes', $event)"
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

      <section *ngIf="activeModuleId === 'productos'" [class]="configSectionClass">
        <app-config-module-header
          title="Productos"
          description="Categorías con reglas de stock opcionales (se heredan a productos nuevos). Talles y colores en listas desplegables."
          [saving]="isActiveModuleSaving()"
          (saveClick)="saveActiveModule()">
        </app-config-module-header>

        <div [class]="configGridProductosClass">
        <app-config-setting-card
          title="Categoría"
          description="Podés definir stock por categoría. Si no configurás reglas, cada producto se define solo."
          [cardClass]="configCardClass"
          [listCount]="config.productos.categorias.length"
          [listExpanded]="isConfigListExpanded('productos.categorias', config.productos.categorias.length)"
          (listExpandedChange)="onConfigListExpandedChange('productos.categorias', $event)">
          <div configAdd class="flex flex-col sm:flex-row gap-1.5">
            <input
              [(ngModel)]="categoriaDraft"
              name="productoCategoriaNew"
              placeholder="Ej. Personalización"
              [disabled]="savingCategoriasStock"
              (keyup.enter)="addCategoria()"
              [class]="configInputClass + ' flex-1'">
            <button type="button" (click)="addCategoria()" [disabled]="savingCategoriasStock || !categoriaDraft.trim()" [class]="configAddButtonClass">
              Agregar
            </button>
          </div>

          <ul configList [class]="configOptionListClass + ' max-h-48'">
            <li
              *ngFor="let categoria of config.productos.categorias"
              [class]="configListItemClass + ' flex-col items-stretch !min-h-0'">
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
        </app-config-setting-card>

          <app-config-setting-card
            *ngFor="let section of productosCatalogSections"
            [title]="section.title"
            [description]="section.description"
            [listCount]="getList(section.key).length"
            [listExpanded]="isConfigListExpanded(section.key, getList(section.key).length)"
            (listExpandedChange)="onConfigListExpandedChange(section.key, $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="getStringListItems(section.key)"
              [addPlaceholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (add)="addValueFromList(section.key, $event)"
              (remove)="removeValue(section.key, $event)">
            </app-config-editable-list>
          </app-config-setting-card>
        </div>
      </section>

      <section *ngIf="activeModule && activeModuleId !== 'pedidos' && activeModuleId !== 'caja' && activeModuleId !== 'stock' && activeModuleId !== 'usuarios' && activeModuleId !== 'productos' && activeModuleId !== 'finanzas'" [class]="configSectionClass">
        <app-config-module-header
          [title]="activeModule!.title"
          [description]="activeModule!.description"
          [saving]="isActiveModuleSaving()"
          (saveClick)="saveActiveModule()">
        </app-config-module-header>

        <div [class]="configGridMultiClass">
          <app-config-setting-card
            *ngFor="let section of activeModule!.sections"
            [title]="section.title"
            [description]="section.description"
            [listCount]="getList(section.key).length"
            [listExpanded]="isConfigListExpanded(section.key, getList(section.key).length)"
            (listExpandedChange)="onConfigListExpandedChange(section.key, $event)"
            [cardClass]="configCardClass">
            <app-config-editable-list
              configList
              [items]="getStringListItems(section.key)"
              [addPlaceholder]="section.placeholder"
              [disabled]="isSavingField(section.key)"
              [inputName]="section.key + '-new'"
              (add)="addValueFromList(section.key, $event)"
              (remove)="removeValue(section.key, $event)">
            </app-config-editable-list>
          </app-config-setting-card>
        </div>
      </section>

      <div *ngIf="activeModuleId !== 'usuarios' && activeModuleId !== 'finanzas'" class="mt-6 sm:mt-8">
        <app-form-save-footer
          [saving]="saving"
          [successMessage]="saveSuccessMessage"
          [centerOnLarge]="true"
          (saveClick)="saveConfig()">
        </app-form-save-footer>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit, OnDestroy {
  @ViewChild(SettingsFinancePanelComponent)
  financePanel?: SettingsFinancePanelComponent;

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
  pedidoEstadoDraft = '';
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

  /** Columna centrada en pantallas grandes (no ocupa todo el ancho). */
  readonly settingsShellClass = 'w-full max-w-4xl mx-auto min-w-0';
  readonly configSectionClass = 'space-y-3';
  readonly configDescClass = 'block text-xs text-gray-500 mt-0.5 desc-lg-only leading-snug';
  readonly configCodeClass = 'mt-1 text-[11px] text-primary/80 desc-lg-only';
  readonly configCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col min-w-0';
  readonly configToggleCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-3 w-full';
  readonly configGridClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly configGridPairClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly configGridTripleClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly configGridProductosClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly configGridMultiClass = CONFIG_SETTINGS_GRID_CLASS;
  readonly configGridCajaClass = CONFIG_SETTINGS_GRID_CLASS;

  private configListExpanded: Record<string, boolean> = {};
  pedidosStockRulesExpanded = false;
  readonly configInputClass = CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS;
  readonly configAddButtonClass =
    'w-full sm:w-auto shrink-0 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500 whitespace-nowrap';
  readonly configOptionListClass = 'space-y-1 max-h-52 overflow-y-auto';
  readonly configOptionListItemClass =
    'flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-gray-200';
  readonly configOptionTextClass = 'text-xs font-medium text-gray-900 break-words min-w-0 leading-tight';
  readonly configListItemClass = CONFIG_EDITABLE_LIST_ITEM_CLASS;
  readonly configRemoveButtonClass = CONFIG_EDITABLE_LIST_REMOVE_BUTTON_CLASS;

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
      id: 'finanzas',
      title: 'Finanzas',
      description: 'Medios de pago, tarjetas y categorías de gasto.',
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
      removable: this.canRemovePedidoEstado(estado),
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

  get cajaOrigenListItems(): ConfigEditableListItem[] {
    return this.config.caja.origenes.map((origen) => ({
      id: origen.grupo,
      label: origen.nombre,
      removable: true,
    }));
  }

  get cajaConceptoListItems(): ConfigEditableListItem[] {
    return this.config.caja.conceptos.map((concepto) => ({
      id: concepto.nombre,
      label: concepto.nombre,
      badge: getCajaConceptoTipoLabel(concepto.tipo),
      removable: true,
    }));
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
    return this.getList(key).map((label) => ({ id: label, label, removable: true }));
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

  addCajaOrigenFromList(nombre: string) {
    this.cajaOrigenDraft = nombre;
    this.addCajaOrigen();
  }

  removeCajaOrigenById(grupo: string) {
    const origen = this.config.caja.origenes.find((item) => item.grupo === grupo);
    if (origen) this.removeCajaOrigen(origen);
  }

  onCajaOrigenLabelChange(event: { id: string; label: string }) {
    const row = this.config.caja.origenes.find((item) => item.grupo === event.id);
    if (row) row.nombre = event.label;
  }

  onCajaOrigenLabelBlur() {
    this.persistCajaOrigenes();
  }

  removeCajaConceptoById(nombre: string) {
    const concepto = this.config.caja.conceptos.find((item) => item.nombre === nombre);
    if (concepto) this.removeCajaConcepto(concepto);
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
    const label = this.pedidoEstadoDraft.trim();
    if (!label || this.savingPedidos) return;

    let value = slugifyOrderEstadoValue(label);
    const existing = new Set(this.config.pedidos.estados.map((item) => item.value));
    if (existing.has(value)) {
      let suffix = 2;
      while (existing.has(`${value}_${suffix}`)) suffix++;
      value = `${value}_${suffix}`;
    }

    const canceladoIndex = this.config.pedidos.estados.findIndex((item) => item.value === 'cancelado');
    const row: OrderEstadoConfig = { value, label, sistema: false };
    if (canceladoIndex >= 0) {
      this.config.pedidos.estados.splice(canceladoIndex, 0, row);
    } else {
      this.config.pedidos.estados.push(row);
    }

    this.pedidoEstadoDraft = '';
    this.refreshPedidosViewState();
    this.schedulePedidosPersist();
  }

  removePedidoEstado(estado: OrderEstadoConfig) {
    if (!this.canRemovePedidoEstado(estado) || this.savingPedidos) return;

    this.dialogService
      .confirm({
        title: 'Quitar estado',
        message: `¿Quitar «${estado.label}» del flujo de pedidos? Los pedidos que ya lo usan conservan el valor interno.`,
        confirmLabel: 'Quitar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;
        const index = this.config.pedidos.estados.findIndex((item) => item.value === estado.value);
        if (index < 0) return;
        this.config.pedidos.estados.splice(index, 1);
        this.refreshPedidosViewState();
        this.schedulePedidosPersist();
      });
  }

  onPedidoEstadoLabelBlur(index: number) {
    const row = this.config.pedidos.estados[index];
    if (!row) return;
    row.label = row.label.trim();
    if (!row.label) {
      const defaults = DEFAULT_ORDER_ESTADOS.find((item) => item.value === row.value);
      row.label = defaults?.label ?? row.value;
    }
    this.schedulePedidosPersist();
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
        this.schedulePedidosPersist();
      });
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
        tab === 'usuarios' ||
        tab === 'finanzas'
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

  isConfigListExpanded(key: string, count: number): boolean {
    if (Object.prototype.hasOwnProperty.call(this.configListExpanded, key)) {
      return this.configListExpanded[key];
    }
    return count === 0;
  }

  onConfigListExpandedChange(key: string, expanded: boolean) {
    this.configListExpanded[key] = expanded;
  }

  saveActiveModule() {
    if (this.activeModuleId === 'pedidos') {
      this.flushPedidosPersist();
      return;
    }
    if (this.activeModuleId === 'finanzas') {
      this.financePanel?.saveConfiguration();
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
    return this.saving;
  }

  saveCategoriasSection() {
    this.ensureCategoriasStockMap();
    this.saveConfig();
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
    this.configListExpanded['productos.categorias'] = true;

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
    this.configListExpanded[key] = true;
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
