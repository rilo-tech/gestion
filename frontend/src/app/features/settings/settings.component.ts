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
  getCajaConceptoTipoLabel,
  slugifyOrigenGrupo,
  DEFAULT_STOCK_TIPOS,
  normalizeCajaAmbitos,
  slugifyCajaAmbitoId,
  DEFAULT_ORDER_ESTADOS,
  getOrderStockTriggerOptions,
  getOrderStatusLabelFromConfig,
} from '../../core/services/catalog-config.service';
import { normalizeStockTipos } from '../../core/constants/stock-movimientos';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsUsersPanelComponent } from './settings-users-panel.component';

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

const SAVE_BUTTON_COOLDOWN_MS = 1800;
const SAVE_SUCCESS_DISPLAY_MS = 3500;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, SettingsUsersPanelComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 w-full max-w-7xl mx-auto">
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

      <section *ngIf="activeModuleId === 'pedidos'" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Pedidos</h2>
          <p [class]="configDescClass">
            Estados del flujo, stock reservado o descuento directo, impresión y costos de personalización.
          </p>
        </div>

        <article [class]="configCardClass">
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Estados del pedido</h3>
            <p [class]="configDescClass">
              Personalizá cómo se muestran los estados en pedidos e impresiones. Los identificadores internos
              no se modifican para no romper el flujo del sistema.
            </p>
          </header>

          <div class="space-y-2">
            <div
              *ngFor="let estado of config.pedidos.estados; let i = index"
              class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-gray-50">
              <span class="text-[11px] font-mono text-gray-400 shrink-0 sm:w-36">{{ estado.value }}</span>
              <input
                [(ngModel)]="config.pedidos.estados[i].label"
                [name]="'pedidoEstadoLabel' + estado.value"
                [disabled]="savingPedidos"
                (blur)="persistPedidosSettings()"
                class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <span
                *ngIf="estado.sistema"
                class="text-[11px] font-semibold uppercase tracking-wide text-teal-700 shrink-0">
                Sistema
              </span>
            </div>
          </div>
        </article>

        <article [class]="configToggleCardClass">
          <h3 class="text-base font-bold text-gray-900 mb-1">Stock en pedidos</h3>
          <p [class]="configDescClass + ' mb-4'">
            Elegí si reservás stock con el checklist antes de descontar depósito, o si preferís descontar
            todo de una vez al cambiar de estado.
          </p>

          <div class="space-y-3">
            <label class="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
              <input
                type="radio"
                name="pedidosModoStock"
                value="reservado"
                [(ngModel)]="config.pedidos.modoStock"
                [disabled]="savingPedidos"
                (change)="persistPedidosSettings()"
                class="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary">
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-gray-900">Stock reservado (checklist)</span>
                <span [class]="configDescClass">
                  «Revisar stock» reserva en depósito y marca faltantes para comprar. El depósito se descuenta
                  al pasar al estado que elijas abajo (por defecto: en producción).
                </span>
              </span>
            </label>

            <label class="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
              <input
                type="radio"
                name="pedidosModoStock"
                value="directo"
                [(ngModel)]="config.pedidos.modoStock"
                [disabled]="savingPedidos"
                (change)="persistPedidosSettings()"
                class="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary">
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-gray-900">Descuento directo (sin reservas)</span>
                <span [class]="configDescClass">
                  No hay checklist ni stock reservado. Al llegar al estado configurado se descuenta todo el
                  pedido del depósito de una vez.
                </span>
              </span>
            </label>
          </div>

          <div class="mt-4 pt-4 border-t border-gray-100">
            <label class="block text-sm font-semibold text-gray-900 mb-1">
              Estado que descuenta stock del depósito
            </label>
            <p [class]="configDescClass + ' mb-2'">
              {{
                config.pedidos.modoStock === 'reservado'
                  ? 'Después de revisar stock, el depósito baja al pasar a este estado.'
                  : 'El depósito baja automáticamente al pasar a este estado, sin revisión previa.'
              }}
            </p>
            <select
              [(ngModel)]="config.pedidos.estadoDescuentaStock"
              name="pedidosEstadoDescuentaStock"
              [disabled]="savingPedidos"
              (change)="persistPedidosSettings()"
              class="w-full max-w-md px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <option *ngFor="let option of orderStockTriggerOptions" [ngValue]="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <p class="text-xs rounded-lg px-3 py-2 mt-4" [ngClass]="configStatusBadgeClass(true)">
            {{
              config.pedidos.modoStock === 'reservado'
                ? 'Modo reservado · descuento en «' +
                  getOrderStatusLabelFromConfig(config.pedidos.estadoDescuentaStock, config.pedidos) +
                  '»'
                : 'Modo directo · descuento en «' +
                  getOrderStatusLabelFromConfig(config.pedidos.estadoDescuentaStock, config.pedidos) +
                  '»'
            }}
          </p>
        </article>

        <article [class]="configToggleCardClass">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              [(ngModel)]="config.pedidos.impresionDosVias"
              name="pedidosImpresionDosVias"
              [disabled]="savingPedidos"
              (change)="persistPedidosSettings()"
              class="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-gray-900">
                Imprimir dos vías en la misma hoja A4
              </span>
              <span [class]="configDescClass">
                Al imprimir un pedido, genera la misma ficha dos veces en una sola hoja (ideal para
                entregar una copia al cliente y quedarte con otra). Si está desactivado, imprime una
                sola vía por hoja.
              </span>
            </span>
          </label>

          <p
            class="text-xs rounded-lg px-3 py-2 mt-4"
            [ngClass]="configStatusBadgeClass(config.pedidos.impresionDosVias)">
            {{
              config.pedidos.impresionDosVias
                ? 'Impresión en dos vías activa.'
                : 'Impresión en una sola vía por hoja.'
            }}
          </p>
        </article>

        <article [class]="configToggleCardClass">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              [(ngModel)]="config.pedidos.costosPersonalizacionDetallados"
              name="pedidosCostosDetallados"
              [disabled]="savingPedidos"
              (change)="persistPedidosSettings()"
              class="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-gray-900">
                Agregar costos extra detallados
              </span>
              <span [class]="configDescClass">
                Muestra el enlace «+ Agregar costo» bajo cada producto para cargar varios conceptos
                (bordado, diseño, etc.).
              </span>
            </span>
          </label>

          <p
            class="text-xs rounded-lg px-3 py-2 mt-4"
            [ngClass]="configStatusBadgeClass(config.pedidos.costosPersonalizacionDetallados)">
            {{
              config.pedidos.costosPersonalizacionDetallados
                ? 'Modo detallado activo en pedidos.'
                : 'Modo simple activo: la columna Pers. queda editable por producto.'
            }}
          </p>
        </article>
      </section>

      <section *ngIf="activeModuleId === 'caja'" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Caja</h2>
          <p [class]="configDescClass">
            Conceptos, orígenes y opciones de la grilla de caja.
          </p>
        </div>

        <article [class]="configCardClass">
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Etiquetas de caja</h3>
            <p [class]="configDescClass">
              Cada etiqueta aparece como pestaña en Caja y en Cuentas a pagar para separar movimientos y vencimientos. Con una sola (o ninguna) queda unificado.
            </p>
          </header>

          <p class="mb-3" [ngClass]="configStatusBadgeClass(config.caja.ambitos.length >= 2)">
            {{ config.caja.ambitos.length }} etiqueta{{ config.caja.ambitos.length === 1 ? '' : 's' }}
            ·
            {{
              config.caja.ambitos.length >= 2
                ? 'visible en Caja como pestañas'
                : 'caja unificada sin pestañas'
            }}
          </p>

          <div class="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              [(ngModel)]="cajaAmbitoDraft"
              name="cajaAmbitoDraft"
              placeholder="Ej. Negocio, Personal, Caja chica..."
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
                <p [class]="configCodeClass">Código: {{ ambito.id }}</p>
              </div>
              <button
                type="button"
                (click)="removeCajaAmbito(ambito)"
                [disabled]="savingCajaAmbito"
                [class]="configRemoveButtonClass">
                Quitar
              </button>
            </li>
            <li *ngIf="config.caja.ambitos.length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg desc-lg-only">
              Agregá etiquetas para separar Caja y Cuentas a pagar en pestañas (ej. Empresa, Casa).
            </li>
          </ul>
        </article>

        <div [class]="configGridPairClass">
        <article [class]="configCardClass">
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Orígenes</h3>
            <p [class]="configDescClass">
              Etiquetas del combobox de filtro. Por defecto: Ventas, Pedidos y Compra.
            </p>
          </header>

          <p class="mb-3" [ngClass]="configStatusBadgeClass(config.caja.origenes.length > 0)">
            {{ config.caja.origenes.length }} origen{{ config.caja.origenes.length === 1 ? '' : 'es' }} configurado{{ config.caja.origenes.length === 1 ? '' : 's' }} · visible en Caja
          </p>

          <div class="flex flex-col sm:flex-row gap-2 mb-4">
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
                <p [class]="configCodeClass">Código: {{ origen.grupo }}</p>
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
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Conceptos</h3>
            <p [class]="configDescClass">
              Ej. Venta mostrador (ingreso), Compra insumos (egreso), Diferencia (ambos).
            </p>
          </header>

          <p class="mb-3" [ngClass]="configStatusBadgeClass(config.caja.conceptos.length > 0)">
            {{ getCajaConceptosHint() }}
          </p>

          <div class="flex flex-col gap-2 mb-4">
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
                <span class="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-white text-teal-700 border border-teal-100">
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

      <section *ngIf="activeModuleId === 'stock'" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Stock</h2>
          <p [class]="configDescClass">
            Etiquetas de tipos y orígenes en la grilla de movimientos de inventario.
          </p>
        </div>

        <div [class]="configGridPairClass">
          <article [class]="configCardClass">
            <header class="mb-3">
              <h3 class="text-base font-bold text-gray-900">Tipos</h3>
              <p [class]="configDescClass">
                Entrada y salida son fijos; podés cambiar solo el nombre visible.
              </p>
            </header>

            <p class="mb-3" [ngClass]="configStatusBadgeClass(true)">
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
                  <p class="mt-1 text-[11px] text-teal-700/80">Código: {{ tipo.grupo }}</p>
                </div>
              </li>
            </ul>
          </article>

          <article [class]="configCardClass">
            <header class="mb-3">
              <h3 class="text-base font-bold text-gray-900">Orígenes</h3>
              <p [class]="configDescClass">
                Etiquetas del combobox de filtro. Por defecto: Compras, Pedidos/ventas, Carga inicial y Ajuste.
              </p>
            </header>

            <p class="mb-3" [ngClass]="configStatusBadgeClass(config.stock.origenes.length > 0)">
              {{ config.stock.origenes.length }} origen{{ config.stock.origenes.length === 1 ? '' : 'es' }} configurado{{ config.stock.origenes.length === 1 ? '' : 's' }} · visible en Stock
            </p>

            <div class="flex flex-col sm:flex-row gap-2 mb-4">
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
                  <p [class]="configCodeClass">Código: {{ origen.grupo }}</p>
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

      <section *ngIf="activeModule && activeModuleId !== 'pedidos' && activeModuleId !== 'caja' && activeModuleId !== 'stock' && activeModuleId !== 'usuarios'" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">{{ activeModule!.title }}</h2>
          <p [class]="configDescClass">{{ activeModule!.description }}</p>
        </div>

        <div [class]="configGridMultiClass">
          <article
            *ngFor="let section of activeModule!.sections"
            [class]="configCardClass">
            <header class="mb-3">
              <h3 class="text-base font-bold text-gray-900">{{ section.title }}</h3>
              <p [class]="configDescClass">{{ section.description }}</p>
            </header>

            <p class="mb-3" [ngClass]="configStatusBadgeClass(getList(section.key).length > 0)">
              {{ getSectionHint(section.key) }}
            </p>

            <div class="flex flex-col sm:flex-row gap-2 mb-4">
              <input
                [ngModel]="getDraft(section.key)"
                (ngModelChange)="setDraft(section.key, $event)"
                [name]="section.key + '-new'"
                [placeholder]="section.placeholder"
                [disabled]="isSavingField(section.key)"
                (keyup.enter)="addValue(section)"
                [class]="configInputClass + ' flex-1'">
              <button
                type="button"
                (click)="addValue(section)"
                [disabled]="isSavingField(section.key)"
                [class]="configAddButtonClass">
                Agregar
              </button>
            </div>

            <ul [class]="configOptionListClass">
              <li
                *ngFor="let value of getList(section.key)"
                [class]="configOptionListItemClass">
                <span [class]="configOptionTextClass">
                  {{ value }}
                </span>
                <button
                  type="button"
                  (click)="removeValue(section.key, value)"
                  [disabled]="isSavingField(section.key)"
                  [class]="configRemoveButtonClass">
                  Quitar
                </button>
              </li>
              <li *ngIf="getList(section.key).length === 0" class="text-xs text-gray-400 px-1 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                Todavía no hay opciones cargadas.
              </li>
            </ul>
          </article>
        </div>
      </section>

      <div class="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <button
          type="button"
          (click)="saveConfig()"
          [disabled]="saving"
          class="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-opacity-90 disabled:opacity-60">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
        <p
          *ngIf="saveSuccessMessage"
          class="text-sm font-medium text-teal-700"
          role="status"
          aria-live="polite">
          {{ saveSuccessMessage }}
        </p>
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
  cajaConceptoDraft = '';
  cajaOrigenDraft = '';
  cajaAmbitoDraft = '';
  stockOrigenDraft = '';
  cajaConceptoTipoDraft: CajaConceptoTipo = 'ingreso';
  getCajaConceptoTipoLabel = getCajaConceptoTipoLabel;

  readonly configDescClass = 'block text-sm text-gray-500 mt-1 desc-lg-only';
  readonly configCodeClass = 'mt-1 text-[11px] text-teal-700/80 desc-lg-only';
  readonly configCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col';
  readonly configToggleCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 max-w-3xl';
  readonly configGridPairClass =
    'grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch';
  readonly configGridMultiClass =
    'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 items-start';
  readonly configInputClass =
    'w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50';
  readonly configAddButtonClass =
    'w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-opacity-90 disabled:opacity-60 whitespace-nowrap';
  readonly configListItemClass =
    'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-teal-50 border border-teal-100';
  readonly configOptionListClass = 'space-y-1 max-h-52 overflow-y-auto';
  readonly configOptionListItemClass =
    'flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-teal-50/80 border border-teal-100/80';
  readonly configOptionTextClass = 'text-xs font-medium text-teal-800 break-words min-w-0 leading-tight';
  readonly configRemoveButtonClass =
    'shrink-0 text-teal-700 text-xs font-semibold hover:text-teal-900 disabled:opacity-50';

  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  private saveCooldownTimeout?: ReturnType<typeof setTimeout>;

  modules: ConfigModule[] = [
    {
      id: 'productos',
      title: 'Productos',
      description: 'Opciones para categoría, talle y color al cargar stock.',
      sections: [
        {
          key: 'productos.categorias',
          title: 'Categoría',
          description: 'Ej. Indumentaria. Al agregar, Nuevo producto usa buscador.',
          placeholder: 'Ej. Indumentaria',
        },
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

  get orderStockTriggerOptions() {
    return getOrderStockTriggerOptions(this.config.pedidos);
  }

  readonly getOrderStatusLabelFromConfig = getOrderStatusLabelFromConfig;

  get visibleModules(): ConfigModule[] {
    return this.modules.filter((module) => {
      if (module.supervisorOnly) return this.auth.canManageUsers;
      return this.auth.canManageSettings;
    });
  }

  get activeModule(): ConfigModule | undefined {
    return this.modules.find((module) => module.id === this.activeModuleId);
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
      ? 'text-xs rounded-lg px-3 py-1.5 bg-teal-50 text-teal-800'
      : 'text-xs rounded-lg px-3 py-1.5 bg-gray-50 text-gray-600';
    return `${tone} desc-lg-only`;
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

  removeCajaAmbito(ambito: { id: string; label: string }) {
    if (this.savingCajaAmbito) return;

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
        this.syncAllFieldModes();
        this.syncCajaConceptosMode();
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
    return [...((this.config[module] as Record<string, string[]>)[field] ?? [])];
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
  }

  selectModule(moduleId: ConfigModule['id']) {
    if (this.activeModuleId === moduleId) return;
    this.clearSaveFeedback();
    this.activeModuleId = moduleId;
  }

  saveConfig() {
    this.persistConfig(true);
  }

  persistPedidosSettings() {
    this.persistConfig(false, undefined, true);
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
