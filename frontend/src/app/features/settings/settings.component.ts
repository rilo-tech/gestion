import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  AppConfig,
  ConfigFieldKey,
  DEFAULT_APP_CONFIG,
  FieldInputMode,
  CatalogConfigService,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';

interface ConfigSection {
  key: ConfigFieldKey;
  title: string;
  description: string;
  placeholder: string;
}

interface ConfigModule {
  id: 'productos' | 'clientes' | 'caja';
  title: string;
  description: string;
  sections: ConfigSection[];
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
          *ngFor="let module of modules"
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

      <section *ngIf="activeModule as module" class="space-y-4 sm:space-y-6">
        <div>
          <h2 class="text-xl font-bold text-gray-900">{{ module.title }}</h2>
          <p class="text-sm text-gray-500 mt-1">{{ module.description }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4 sm:gap-6">
          <article
            *ngFor="let section of module.sections"
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
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);

  config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  activeModuleId: ConfigModule['id'] = 'productos';
  saving = false;
  optionDrafts: Record<string, string> = {};
  savingFields = new Set<string>();

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
      id: 'caja',
      title: 'Caja',
      description: 'Conceptos para movimientos manuales de ingreso y egreso.',
      sections: [
        {
          key: 'caja.conceptosIngreso',
          title: 'Conceptos de ingreso',
          description: 'Ej. Venta mostrador, Ajuste. Al agregar, Caja usa buscador.',
          placeholder: 'Ej. Venta mostrador',
        },
        {
          key: 'caja.conceptosEgreso',
          title: 'Conceptos de egreso',
          description: 'Ej. Compra insumos, Retiro. Al agregar, Caja usa buscador.',
          placeholder: 'Ej. Compra insumos',
        },
      ],
    },
  ];

  get activeModule(): ConfigModule | undefined {
    return this.modules.find((module) => module.id === this.activeModuleId);
  }

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'caja' || tab === 'clientes' || tab === 'productos') {
        this.activeModuleId = tab;
      }
    });

    this.catalogConfigService.getAppConfig().subscribe({
      next: (config) => {
        this.config = config;
        this.syncAllFieldModes();
      },
      error: () =>
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la configuración.',
        }),
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

  private persistField(key: ConfigFieldKey) {
    this.persistConfig(false, key);
  }

  private persistConfig(showSavingState = false, fieldKey?: ConfigFieldKey) {
    if (showSavingState) {
      this.saving = true;
    }
    if (fieldKey) {
      this.savingFields.add(fieldKey);
    }
    this.syncAllFieldModes();

    this.catalogConfigService.updateAppConfig(this.config).subscribe({
      next: (config) => {
        this.config = config;
        this.syncAllFieldModes();
        this.saving = false;
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
      },
      error: () => {
        this.saving = false;
        if (fieldKey) {
          this.savingFields.delete(fieldKey);
        }
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo guardar. Verificá que el servidor y el emulador estén corriendo.',
        });
      },
    });
  }
}
