import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  AppConfig,
  ConfigFieldKey,
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
        <p class="text-sm sm:text-base text-gray-500 mt-1">
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
          <p class="text-sm text-gray-500 mt-1">
            Elegí cómo cargar costos de personalización en cada ítem del pedido.
          </p>
        </div>

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
              <span class="block text-sm text-gray-500 mt-1">
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
          <p class="text-sm text-gray-500 mt-1">
            Conceptos, orígenes y opciones de la grilla de caja.
          </p>
        </div>

        <article [class]="configCardClass">
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Etiquetas de caja</h3>
            <p class="text-sm text-gray-500 mt-1">
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
                <p class="mt-1 text-[11px] text-teal-700/80">Código: {{ ambito.id }}</p>
              </div>
              <button
                type="button"
                (click)="removeCajaAmbito(ambito)"
                [disabled]="savingCajaAmbito"
                [class]="configRemoveButtonClass">
                Quitar
              </button>
            </li>
            <li *ngIf="config.caja.ambitos.length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg">
              Agregá etiquetas para separar Caja y Cuentas a pagar en pestañas (ej. Empresa, Casa).
            </li>
          </ul>
        </article>

        <div [class]="configGridPairClass">
        <article [class]="configCardClass">
          <header class="mb-3">
            <h3 class="text-base font-bold text-gray-900">Orígenes</h3>
            <p class="text-sm text-gray-500 mt-1">
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
                <p class="mt-1 text-[11px] text-teal-700/80">Código: {{ origen.grupo }}</p>
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
            <p class="text-sm text-gray-500 mt-1">
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
          <p class="text-sm text-gray-500 mt-1">
            Etiquetas de tipos y orígenes en la grilla de movimientos de inventario.
          </p>
        </div>

        <div [class]="configGridPairClass">
          <article [class]="configCardClass">
            <header class="mb-3">
              <h3 class="text-base font-bold text-gray-900">Tipos</h3>
              <p class="text-sm text-gray-500 mt-1">
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
              <p class="text-sm text-gray-500 mt-1">
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
                  <p class="mt-1 text-[11px] text-teal-700/80">Código: {{ origen.grupo }}</p>
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
          <p class="text-sm text-gray-500 mt-1">{{ activeModule!.description }}</p>
        </div>

        <div [class]="configGridMultiClass">
          <article
            *ngFor="let section of activeModule!.sections"
            [class]="configCardClass">
            <header class="mb-3">
              <h3 class="text-base font-bold text-gray-900">{{ section.title }}</h3>
              <p class="text-sm text-gray-500 mt-1">{{ section.description }}</p>
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

            <ul class="space-y-2 flex-1">
              <li
                *ngFor="let value of getList(section.key)"
                [class]="configListItemClass">
                <span class="text-sm font-medium text-teal-800 break-words min-w-0">
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
              <li *ngIf="getList(section.key).length === 0" class="text-sm text-gray-400 px-1 py-6 text-center border border-dashed border-gray-200 rounded-lg">
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

  readonly configCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col h-full';
  readonly configToggleCardClass =
    'bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 max-w-3xl';
  readonly configGridPairClass =
    'grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch';
  readonly configGridMultiClass =
    'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 items-stretch';
  readonly configInputClass =
    'w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50';
  readonly configAddButtonClass =
    'w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-opacity-90 disabled:opacity-60 whitespace-nowrap';
  readonly configListItemClass =
    'flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-teal-50 border border-teal-100';
  readonly configRemoveButtonClass =
    'shrink-0 text-teal-700 text-sm font-semibold hover:text-teal-900 disabled:opacity-50';

  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;
  private saveCooldownTimeout?: ReturnType<typeof setTimeout>;

  modules: ConfigModule[] = [
    {
      id: 'productos',
      title: 'Productos',
      description: 'Opciones para tipo, categoría, talle y color al cargar stock.',
      sections: [
        {
          key: 'productos.tipos',
          title: 'Tipo',
          description: 'Agregá los tipos que uses. Se guardan al instante en Nuevo producto.',
          placeholder: 'Ej. Producto',
        },
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
      description: 'Costos de personalización en productos del pedido.',
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
    return active
      ? 'text-xs rounded-lg px-3 py-1.5 bg-teal-50 text-teal-800'
      : 'text-xs rounded-lg px-3 py-1.5 bg-gray-50 text-gray-600';
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

    this.config.caja.conceptos = this.config.caja.conceptos.filter(
      (item) => item !== concepto
    );
    this.syncCajaConceptosMode();
    this.persistCajaConceptos();
  }

  private syncCajaConceptosMode() {
    this.config.caja.modo.conceptos =
      this.config.caja.conceptos.length > 0 ? 'lista' : 'texto';
  }

  private persistCajaConceptos() {
    this.savingCajaConceptos = true;
    this.syncCajaConceptosMode();

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.syncCajaConceptosMode();
        this.savingCajaConceptos = false;
      },
      error: () => {
        this.savingCajaConceptos = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo guardar. Verificá que el servidor y el emulador estén corriendo.',
        });
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

    this.config.caja.origenes = this.config.caja.origenes.filter((item) => item !== origen);
    this.persistCajaOrigenes();
  }

  persistCajaOrigenes() {
    this.savingCajaOrigenes = true;
    this.config.caja.origenes = this.config.caja.origenes
      .map((item) => ({
        grupo: item.grupo.trim().toLowerCase(),
        nombre: item.nombre.trim(),
      }))
      .filter((item) => item.grupo && item.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.savingCajaOrigenes = false;
      },
      error: () => {
        this.savingCajaOrigenes = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron guardar los orígenes de caja.',
        });
      },
    });
  }

  persistCajaAmbitos() {
    this.savingCajaAmbito = true;
    this.config.caja.ambitos = normalizeCajaAmbitos(this.config.caja);
    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.savingCajaAmbito = false;
      },
      error: () => {
        this.savingCajaAmbito = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron guardar las etiquetas de caja.',
        });
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
    this.config.caja.ambitos = this.config.caja.ambitos.filter((item) => item.id !== ambito.id);
    this.persistCajaAmbitos();
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

    this.config.stock.origenes = this.config.stock.origenes.filter((item) => item !== origen);
    this.persistStockOrigenes();
  }

  persistStockOrigenes() {
    this.savingStockOrigenes = true;
    this.config.stock.origenes = this.config.stock.origenes
      .map((item) => ({
        grupo: item.grupo.trim().toLowerCase(),
        nombre: item.nombre.trim(),
      }))
      .filter((item) => item.grupo && item.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.savingStockOrigenes = false;
      },
      error: () => {
        this.savingStockOrigenes = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron guardar los orígenes de stock.',
        });
      },
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

    this.setList(
      key,
      this.getList(key).filter((item) => item !== value)
    );
    this.syncFieldMode(key);
    this.persistField(key);
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

  private persistField(key: ConfigFieldKey) {
    this.persistConfig(false, key);
  }

  private persistConfig(
    showSavingState = false,
    fieldKey?: ConfigFieldKey,
    pedidosOnly = false
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

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
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
      error: () => {
        this.cancelSaveCooldown();
        this.saving = false;
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
        if (pedidosOnly) {
          this.savingPedidos = false;
        }
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo guardar. Verificá que el servidor y el emulador estén corriendo.',
        });
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
