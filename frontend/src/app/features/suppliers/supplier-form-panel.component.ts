import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
} from '../../core/services/catalog-config.service';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../shared/components/searchable-select/searchable-select.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';
import { Subscription } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface SupplierFormSaveEvent {
  id: string;
  supplier: Supplier;
}

@Component({
  selector: 'app-supplier-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SearchableSelectComponent,
    ConfigSettingsLinkComponent,
    SelectOnFocusDirective,
  ],
  template: `
    <div class="space-y-4">
      <app-config-settings-link
        settingsTab="proveedores"
        message="¿Falta una etiqueta?"
        linkLabel="Configurala acá"
        [compact]="true">
      </app-config-settings-link>

      <div *ngIf="loadingSupplier" class="py-8 text-center text-sm text-gray-400">
        Cargando proveedor...
      </div>

      <form
        *ngIf="!loadingSupplier"
        (submit)="saveSupplier(); $event.preventDefault()"
        class="space-y-4">
        <fieldset [disabled]="formReadOnly" class="space-y-4 border-0 p-0 m-0 min-w-0">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
          <input
            [(ngModel)]="supplierForm.nombre"
            name="supplierNombre"
            required
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">WhatsApp / Teléfono</label>
          <input
            [(ngModel)]="supplierForm.telefono"
            name="supplierTelefono"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">IG / Web</label>
          <input
            [(ngModel)]="supplierForm.redes!.igWeb"
            name="supplierIgWeb"
            placeholder="@usuario o https://..."
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
          <input
            [(ngModel)]="supplierForm.direccion"
            name="supplierDireccion"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            [(ngModel)]="supplierForm.email"
            name="supplierEmail"
            type="email"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Etiquetas</label>

          <div *ngIf="useEtiquetaList; else freeEtiquetas">
            <div
              class="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-primary">
              <span
                *ngFor="let tag of selectedEtiquetas"
                class="inline-flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                {{ tag }}
                <button
                  type="button"
                  (click)="removeEtiqueta(tag)"
                  class="inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-600 hover:bg-teal-100 hover:text-teal-900"
                  [attr.aria-label]="'Quitar ' + tag">
                  ×
                </button>
              </span>
              <app-searchable-select
                [(ngModel)]="etiquetaPicker"
                (ngModelChange)="onEtiquetaSelected($event)"
                name="etiquetaPicker"
                [labeledOptions]="etiquetaSelectOptions"
                [creatable]="true"
                [embedded]="true"
                createLabelPrefix="Agregar etiqueta"
                (createRequested)="onCreateEtiqueta($event)"
                placeholder="Buscar etiqueta..."
                emptyOptionsMessage="No hay etiquetas configuradas"
                listHint="">
              </app-searchable-select>
            </div>
            <p class="mt-1 text-xs text-gray-400">
              Podés agregar varias. Elegí una existente o escribí una nueva.
            </p>
          </div>

          <ng-template #freeEtiquetas>
            <input
              [(ngModel)]="etiquetasText"
              name="etiquetasText"
              placeholder="Ej. Mayorista, Local"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <p class="mt-1 text-xs text-gray-400">Separá varias etiquetas con coma.</p>
          </ng-template>
        </div>
        </fieldset>

        <div class="form-actions flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <button
            *ngIf="isEditing && auth.canDeleteRecords"
            type="button"
            (click)="confirmDeleteSupplier()"
            class="text-sm font-medium text-red-600 hover:text-red-700 min-h-[44px] sm:min-h-0">
            Eliminar proveedor
          </button>
          <div class="flex justify-end gap-3 sm:ml-auto">
            <button
              type="button"
              (click)="cancelled.emit()"
              class="form-btn-secondary rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {{ formReadOnly ? 'Cerrar' : 'Cancelar' }}
            </button>
            <button
              *ngIf="!formReadOnly"
              type="submit"
              [disabled]="savingSupplier"
              class="form-btn-primary rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingSupplier ? 'Guardando...' : (isEditing ? 'Guardar' : 'Crear proveedor') }}
            </button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class SupplierFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() supplierId: string | null = null;
  @Input() prefillNombre = '';
  @Output() saved = new EventEmitter<SupplierFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  private supplierService = inject(SupplierService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  readonly auth = inject(AuthService);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  savingSupplier = false;
  loadingSupplier = false;
  supplierForm: Partial<Supplier> = this.emptySupplierForm();
  etiquetaPicker = '';
  etiquetasText = '';

  get isEditing(): boolean {
    return !!this.supplierId;
  }

  get formReadOnly(): boolean {
    return this.isEditing && !this.auth.canEditRecords;
  }

  get useEtiquetaList(): boolean {
    return this.catalogConfigService.usesConfigurableList(this.appConfig, 'proveedores.etiquetas');
  }

  get etiquetaSelectOptions(): SearchableSelectOption[] {
    const selected = new Set(this.selectedEtiquetas.map((tag) => tag.toLowerCase()));
    return this.catalogConfigService
      .getFieldOptions(this.appConfig, 'proveedores.etiquetas')
      .filter((tag) => !selected.has(tag.toLowerCase()))
      .map((tag) => ({
        value: tag,
        label: tag,
      }));
  }

  get selectedEtiquetas(): string[] {
    return this.supplierForm.etiquetas ?? [];
  }

  ngOnInit() {
    this.configSub = this.catalogConfigService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalogConfigService.getAppConfig().subscribe();
    this.resetForm();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['supplierId'] || changes['prefillNombre']) {
      this.resetForm();
    }
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  private resetForm() {
    if (this.supplierId) {
      this.loadSupplier(this.supplierId);
      return;
    }

    this.loadingSupplier = false;
    this.supplierForm = this.emptySupplierForm();
    if (this.prefillNombre.trim()) {
      this.supplierForm.nombre = this.prefillNombre.trim();
    }
    this.etiquetasText = '';
    this.etiquetaPicker = '';
  }

  private loadSupplier(id: string) {
    this.loadingSupplier = true;
    this.supplierService.getSupplier(id).subscribe({
      next: (supplier) => {
        this.supplierForm = {
          nombre: supplier.nombre ?? '',
          telefono: supplier.telefono ?? '',
          email: supplier.email ?? '',
          direccion: supplier.direccion ?? '',
          redes: { igWeb: supplier.redes?.igWeb ?? '' },
          etiquetas: [...(supplier.etiquetas ?? [])],
        };
        this.etiquetasText = (supplier.etiquetas ?? []).join(', ');
        this.etiquetaPicker = '';
        this.loadingSupplier = false;
      },
      error: () => {
        this.loadingSupplier = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el proveedor.',
        });
        this.cancelled.emit();
      },
    });
  }

  onEtiquetaSelected(value: string) {
    const tag = value.trim();
    if (!tag) return;
    this.addEtiqueta(tag);
    window.setTimeout(() => {
      this.etiquetaPicker = '';
    });
  }

  onCreateEtiqueta(name: string) {
    const tag = name.trim();
    if (!tag) return;
    this.addEtiqueta(tag);
    this.etiquetaPicker = '';
    this.catalogConfigService.ensureFieldOptions('proveedores.etiquetas', [tag]).subscribe();
  }

  addEtiqueta(tag: string) {
    if (!tag) return;
    const current = this.supplierForm.etiquetas ?? [];
    if (current.some((item) => item.toLowerCase() === tag.toLowerCase())) return;
    this.supplierForm.etiquetas = [...current, tag];
  }

  removeEtiqueta(tag: string) {
    this.supplierForm.etiquetas = (this.supplierForm.etiquetas ?? []).filter((item) => item !== tag);
  }

  resolveEtiquetas(): string[] {
    if (this.useEtiquetaList) {
      return [...(this.supplierForm.etiquetas ?? [])];
    }
    return this.etiquetasText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  saveSupplier() {
    if (!this.supplierForm.nombre?.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del proveedor.',
      });
      return;
    }

    const etiquetas = this.resolveEtiquetas();
    const payload: Supplier = {
      nombre: this.supplierForm.nombre!.trim(),
      telefono: this.supplierForm.telefono?.trim() ?? '',
      email: this.supplierForm.email?.trim() ?? '',
      direccion: this.supplierForm.direccion?.trim() ?? '',
      redes: { igWeb: this.supplierForm.redes?.igWeb?.trim() ?? '' },
      etiquetas,
    };

    this.savingSupplier = true;
    const request = this.supplierId
      ? this.supplierService.updateSupplier(this.supplierId, payload)
      : this.supplierService.createSupplier(payload);

    request
      .pipe(
        switchMap((response) =>
          this.catalogConfigService.ensureFieldOptions('proveedores.etiquetas', etiquetas).pipe(
            catchError(() => of(null)),
            switchMap(() => of(response))
          )
        )
      )
      .subscribe({
        next: (response) => {
          this.savingSupplier = false;
          const id = this.supplierId ?? response.id;
          if (!id) return;
          this.saved.emit({ id, supplier: { ...payload, id } });
        },
        error: () => {
          this.savingSupplier = false;
          this.dialogService.alert({
            title: 'Error',
            message: this.supplierId
              ? 'No se pudo actualizar el proveedor.'
              : 'No se pudo guardar el proveedor.',
          });
        },
      });
  }

  confirmDeleteSupplier() {
    if (!this.supplierId) return;
    const name = this.supplierForm.nombre?.trim() || 'este proveedor';

    this.dialogService
      .confirm({
        title: 'Eliminar proveedor',
        message: `¿Eliminar a ${name}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.supplierId) return;

        this.supplierService.deleteSupplier(this.supplierId).subscribe({
          next: () => this.deleted.emit(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el proveedor.',
            }),
        });
      });
  }

  private emptySupplierForm(): Partial<Supplier> {
    return {
      nombre: '',
      telefono: '',
      email: '',
      direccion: '',
      redes: { igWeb: '' },
      etiquetas: [],
    };
  }
}
