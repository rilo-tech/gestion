import { Component, inject, OnInit } from '@angular/core';
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
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsUsersPanelComponent } from './settings-users-panel.component';
import { SettingsAppearancePanelComponent } from './settings-appearance-panel.component';

interface ConfigSection {
  key: ConfigFieldKey;
  title: string;
  description: string;
  placeholder: string;
}

interface ConfigModule {
  id: 'productos' | 'clientes' | 'proveedores' | 'caja' | 'pedidos' | 'usuarios' | 'apariencia';
  title: string;
  description: string;
  sections: ConfigSection[];
  supervisorOnly?: boolean;
  everyone?: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, SettingsUsersPanelComponent, SettingsAppearancePanelComponent],
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
          (click)="activeModuleId = module.id"
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

        <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 max-w-2xl">
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
            [class.bg-teal-50]="config.pedidos.costosPersonalizacionDetallados"
            [class.text-teal-800]="config.pedidos.costosPersonalizacionDetallados"
            [class.bg-gray-50]="!config.pedidos.costosPersonalizacionDetallados"
            [class.text-gray-600]="!config.pedidos.costosPersonalizacionDetallados">
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
            Conceptos para movimientos manuales. Elegí si aparecen al registrar ingreso, egreso o ambos.
          </p>
        </div>

        <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 max-w-2xl flex flex-col">
          <header class="mb-3">
            <h3 class="text-lg font-bold text-gray-900">Conceptos</h3>
            <p class="text-sm text-gray-500 mt-1">
              Ej. Venta mostrador (ingreso), Compra insumos (egreso), Diferencia (ambos).
            </p>
          </header>

          <p
            class="text-xs rounded-lg px-3 py-1.5 mb-3"
            [class.bg-teal-50]="config.caja.conceptos.length > 0"
            [class.text-teal-800]="config.caja.conceptos.length > 0"
            [class.bg-gray-50]="config.caja.conceptos.length === 0"
            [class.text-gray-600]="config.caja.conceptos.length === 0">
            {{ getCajaConceptosHint() }}
          </p>

          <div class="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              [(ngModel)]="cajaConceptoDraft"
              name="cajaConceptoDraft"
              placeholder="Ej. Diferencia"
              [disabled]="isSavingCajaConceptos"
              (keyup.enter)="addCajaConcepto()"
              class="w-full flex-1 px-3 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50">
            <select
              [(ngModel)]="cajaConceptoTipoDraft"
              name="cajaConceptoTipoDraft"
              [disabled]="isSavingCajaConceptos"
              class="w-full sm:w-auto px-3 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 bg-white">
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
              <option value="ambos">Ambos</option>
            </select>
            <button
              type="button"
              (click)="addCajaConcepto()"
              [disabled]="isSavingCajaConceptos"
              class="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-opacity-90 disabled:opacity-60">
              Agregar
            </button>
          </div>

          <ul class="space-y-2 flex-1">
            <li
              *ngFor="let concepto of config.caja.conceptos"
              class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-teal-50 border border-teal-100">
              <div class="min-w-0">
                <span class="text-sm font-medium text-teal-800 underline decoration-teal-400 underline-offset-4 break-words">
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
                class="shrink-0 text-teal-700 text-sm font-semibold hover:text-teal-900 disabled:opacity-50">
                Quitar
              </button>
            </li>
            <li *ngIf="config.caja.conceptos.length === 0" class="text-sm text-gray-400 px-1">
              Todavía no hay opciones cargadas.
            </li>
          </ul>
        </article>
      </section>

      <app-settings-users-panel *ngIf="activeModuleId === 'usuarios'"></app-settings-users-panel>

      <app-settings-appearance-panel *ngIf="activeModuleId === 'apariencia'"></app-settings-appearance-panel>

      <section *ngIf="activeModule && activeModuleId !== 'pedidos' && activeModuleId !== 'caja' && activeModuleId !== 'usuarios' && activeModuleId !== 'apariencia'" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">{{ activeModule!.title }}</h2>
          <p class="text-sm text-gray-500 mt-1">{{ activeModule!.description }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4 sm:gap-6">
          <article
            *ngFor="let section of activeModule!.sections"
            class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 flex flex-col">
            <header class="mb-3">
              <h3 class="text-lg font-bold text-gray-900">{{ section.title }}</h3>
              <p class="text-sm text-gray-500 mt-1">{{ section.description }}</p>
            </header>

            <p
              class="text-xs rounded-lg px-3 py-1.5 mb-3"
              [class.bg-teal-50]="getList(section.key).length > 0"
              [class.text-teal-800]="getList(section.key).length > 0"
              [class.bg-gray-50]="getList(section.key).length === 0"
              [class.text-gray-600]="getList(section.key).length === 0">
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
                class="w-full flex-1 px-3 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50">
              <button
                type="button"
                (click)="addValue(section)"
                [disabled]="isSavingField(section.key)"
                class="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-opacity-90 disabled:opacity-60">
                Agregar
              </button>
            </div>

            <ul class="space-y-2 flex-1">
              <li
                *ngFor="let value of getList(section.key)"
                class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-teal-50 border border-teal-100">
                <span class="text-sm font-medium text-teal-800 underline decoration-teal-400 underline-offset-4 break-words">
                  {{ value }}
                </span>
                <button
                  type="button"
                  (click)="removeValue(section.key, value)"
                  [disabled]="isSavingField(section.key)"
                  class="shrink-0 text-teal-700 text-sm font-semibold hover:text-teal-900 disabled:opacity-50">
                  Quitar
                </button>
              </li>
              <li *ngIf="getList(section.key).length === 0" class="text-sm text-gray-400 px-1">
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
export class SettingsComponent implements OnInit {
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
  cajaConceptoDraft = '';
  cajaConceptoTipoDraft: CajaConceptoTipo = 'ingreso';
  getCajaConceptoTipoLabel = getCajaConceptoTipoLabel;
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

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
      description: 'Conceptos para movimientos manuales.',
      sections: [],
    },
    {
      id: 'pedidos',
      title: 'Pedidos',
      description: 'Costos de personalización en productos del pedido.',
      sections: [],
    },
    {
      id: 'apariencia',
      title: 'Apariencia',
      description: 'Tema claro u oscuro.',
      sections: [],
      everyone: true,
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
      if (module.everyone) return true;
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

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');

      if (tab === 'apariencia') {
        this.activeModuleId = 'apariencia';
        return;
      }

      if (!this.auth.canManageSettings) {
        this.router.navigate(['/dashboard']);
        return;
      }

      if (
        tab === 'caja' ||
        tab === 'clientes' ||
        tab === 'proveedores' ||
        tab === 'productos' ||
        tab === 'pedidos' ||
        tab === 'usuarios'
      ) {
        this.activeModuleId = tab;
      }
    });

    this.catalogConfigService.getAppConfig().subscribe({
      next: (config) => {
        this.config = config;
        this.syncAllFieldModes();
        this.syncCajaConceptosMode();
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
        this.saving = false;
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
        if (pedidosOnly) {
          this.savingPedidos = false;
        }
        if (showSavingState) {
          this.showSaveSuccess('Configuración guardada correctamente.');
        }
      },
      error: () => {
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
}
