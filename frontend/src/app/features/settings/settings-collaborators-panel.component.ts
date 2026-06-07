import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DialogService } from '../../core/services/dialog.service';
import {
  AppConfig,
  CatalogConfigService,
  ConfigRemovalKind,
  ConfigUsageHit,
  DEFAULT_APP_CONFIG,
  slugifyCollaboratorExtraTipoId,
} from '../../core/services/catalog-config.service';
import { ConfigSettingCardComponent } from '../../shared/components/config-setting-card/config-setting-card.component';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
} from '../../shared/components/config-editable-list/config-editable-list.component';
import { FormSaveFooterComponent } from '../../shared/components/form-save-footer/form-save-footer.component';

@Component({
  selector: 'app-settings-collaborators-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ConfigSettingCardComponent,
    ConfigEditableListComponent,
    FormSaveFooterComponent,
  ],
  template: `
    <section [class]="sectionClass">
      <div [class]="sectionsListClass">
        <app-config-setting-card
          title="Tipos de extra"
          description="Opciones del selector al registrar un extra (reparto, premio, aguinaldo, etc.)."
          [listCount]="config.colaboradores.tiposExtra.length"
          [sectionCollapse]="true"
          [listExpanded]="listExpanded"
          (listExpandedChange)="listExpanded = $event"
          [cardClass]="cardClass">
          <app-config-editable-list
            configList
            [items]="extraTipoListItems"
            labelMode="input"
            addPlaceholder="Ej. Viático"
            [disabled]="saving || !!removalBusyId"
            [busyRemoveId]="removalBusyId"
            inputName="colaboradorExtraTipoDraft"
            listMaxHeightClass=""
            (add)="addExtraTipoFromList($event)"
            (remove)="removeExtraTipoById($event)"
            (labelChange)="onExtraTipoLabelChange($event)"
            (labelBlur)="onExtraTipoLabelBlur($event)">
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
export class SettingsCollaboratorsPanelComponent implements OnInit, OnDestroy {
  private catalog = inject(CatalogConfigService);
  private dialog = inject(DialogService);
  private configSub?: Subscription;

  config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  saving = false;
  saveSuccessMessage = '';
  removalBusyId: string | null = null;
  listExpanded = true;
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

  readonly sectionClass = 'space-y-4 sm:space-y-6';
  readonly sectionsListClass = 'flex flex-col gap-2 w-full min-w-0';
  readonly cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 sm:p-4 flex flex-col min-w-0';

  get extraTipoListItems(): ConfigEditableListItem[] {
    return this.config.colaboradores.tiposExtra.map((tipo) => ({
      id: tipo.id,
      label: tipo.nombre,
      removable: true,
    }));
  }

  ngOnInit(): void {
    this.catalog.getAppConfig().subscribe();
    this.configSub = this.catalog.appConfig$.subscribe((config) => {
      this.config = structuredClone(config);
      if (!this.config.colaboradores?.tiposExtra?.length) {
        this.config.colaboradores = structuredClone(DEFAULT_APP_CONFIG.colaboradores);
      }
    });
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
  }

  addExtraTipoFromList(label: string) {
    const trimmed = label.trim();
    if (!trimmed || this.saving) return;
    const id = slugifyCollaboratorExtraTipoId(trimmed);
    if (this.config.colaboradores.tiposExtra.some((item) => item.id === id)) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe un tipo de extra con ese nombre.' });
      return;
    }
    this.config.colaboradores.tiposExtra = [
      ...this.config.colaboradores.tiposExtra,
      { id, nombre: trimmed },
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    this.listExpanded = true;
    this.persist();
  }

  removeExtraTipoById(id: string) {
    const tipo = this.config.colaboradores.tiposExtra.find((item) => item.id === id);
    if (!tipo || this.saving || this.removalBusyId) return;
    if (this.config.colaboradores.tiposExtra.length <= 1) {
      this.dialog.alert({
        title: 'No se puede quitar',
        message: 'Debe quedar al menos un tipo de extra.',
      });
      return;
    }
    this.confirmRemoval('colaboradores.tiposExtra', tipo.nombre, id, () => {
      this.config.colaboradores.tiposExtra = this.config.colaboradores.tiposExtra.filter(
        (item) => item.id !== id
      );
    });
  }

  onExtraTipoLabelChange(event: { id: string; label: string }) {
    const row = this.config.colaboradores.tiposExtra.find((item) => item.id === event.id);
    if (row) row.nombre = event.label;
  }

  onExtraTipoLabelBlur(event: { id: string; label: string }) {
    const row = this.config.colaboradores.tiposExtra.find((item) => item.id === event.id);
    if (!row) return;
    const trimmed = event.label.trim();
    if (!trimmed) {
      this.catalog.getAppConfig().subscribe((cfg) => {
        const saved = cfg.colaboradores.tiposExtra.find((item) => item.id === event.id);
        if (saved) row.nombre = saved.nombre;
      });
      return;
    }
    if (
      this.config.colaboradores.tiposExtra.some(
        (item) => item.id !== event.id && item.nombre.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      this.dialog.alert({ title: 'Duplicado', message: 'Ya existe un tipo de extra con ese nombre.' });
      this.catalog.getAppConfig().subscribe((cfg) => {
        const saved = cfg.colaboradores.tiposExtra.find((item) => item.id === event.id);
        if (saved) row.nombre = saved.nombre;
      });
      return;
    }
    row.nombre = trimmed;
    this.persist();
  }

  saveConfiguration() {
    this.persist(true);
  }

  private confirmRemoval(
    kind: ConfigRemovalKind,
    displayName: string,
    checkValue: string,
    applyRemoval: () => void
  ) {
    this.removalBusyId = checkValue;
    this.catalog.checkConfigUsage(kind, checkValue).subscribe({
      next: (response) => {
        this.removalBusyId = null;
        if (response.inUse) {
          this.dialog
            .confirm({
              title: 'Tipo en uso',
              message: this.formatUsageMessage(displayName, response.usage),
              confirmLabel: 'Quitar igual',
              variant: 'danger',
            })
            .subscribe((confirmed) => {
              if (!confirmed) return;
              applyRemoval();
              this.persist(true, true);
            });
          return;
        }
        applyRemoval();
        this.persist();
      },
      error: () => {
        this.removalBusyId = null;
        this.dialog.alert({
          title: 'Error',
          message: 'No se pudo verificar si el tipo está en uso.',
        });
      },
    });
  }

  private formatUsageMessage(displayName: string, usage: ConfigUsageHit[]): string {
    const lines = usage.map((hit) => `· ${hit.label}: ${hit.count}`);
    return `«${displayName}» aparece en registros existentes.\n\n${lines.join('\n')}\n\n¿Querés quitarlo igual? Los registros viejos conservan el código interno.`;
  }

  private persist(showSuccess = false, confirmConfigRemovals = false) {
    if (this.saving) return;
    this.saving = true;
    this.saveSuccessMessage = '';
    this.catalog
      .updateAppConfig(this.config, { confirmConfigRemovals })
      .subscribe({
        next: () => {
          this.saving = false;
          if (showSuccess) {
            this.saveSuccessMessage = 'Configuración guardada';
            if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
            this.saveSuccessTimeout = setTimeout(() => {
              this.saveSuccessMessage = '';
            }, 3500);
          }
        },
        error: (err) => {
          this.saving = false;
          const body = err?.error;
          if (body?.requiresConfirmation) {
            this.dialog
              .confirm({
                title: 'Opciones en uso',
                message: this.formatUsageMessage('la opción', body.usage ?? []),
                confirmLabel: 'Quitar igual',
                variant: 'danger',
              })
              .subscribe((confirmed) => {
                if (confirmed) this.persist(showSuccess, true);
              });
            return;
          }
          this.dialog.alert({
            title: 'Error',
            message: typeof body?.error === 'string' ? body.error : 'No se pudo guardar.',
          });
        },
      });
  }
}
