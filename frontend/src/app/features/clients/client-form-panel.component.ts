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
import { RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
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
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface ClientFormSaveEvent {
  id: string;
  client: Client;
}

@Component({
  selector: 'app-client-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    ConfigSettingsLinkComponent,
    RouterLink,
  ],
  template: `
    <div class="space-y-4">
      <app-config-settings-link
        settingsTab="clientes"
        message="¿Falta una etiqueta?"
        linkLabel="Configurala acá"
        [compact]="true">
      </app-config-settings-link>

      <a
        *ngIf="isEditing && clientId && showHistorialLink"
        [routerLink]="['/clients', clientId, 'historial']"
        class="flex items-center justify-between gap-4 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 hover:bg-teal-100/80 transition-colors">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-teal-900">Historial y cuenta corriente</p>
          <p class="text-xs text-teal-800 mt-0.5">Ver pedidos, ventas y registrar cobros.</p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span *ngIf="clientSaldo > 0" class="text-sm font-bold tabular-nums text-orange-700">
            {{ '$' + clientSaldo }}
          </span>
          <i-lucide name="history" class="w-5 h-5 text-teal-700"></i-lucide>
        </div>
      </a>

      <div *ngIf="loadingClient" class="py-8 text-center text-sm text-gray-400">
        Cargando cliente...
      </div>

      <form
        *ngIf="!loadingClient"
        (submit)="saveClient(); $event.preventDefault()"
        class="space-y-4">
        <fieldset [disabled]="formReadOnly" class="space-y-4 border-0 p-0 m-0 min-w-0">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
          <input
            [(ngModel)]="clientForm.nombre"
            name="clientNombre"
            required
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">WhatsApp / Teléfono</label>
          <input
            [(ngModel)]="clientForm.telefono"
            name="clientTelefono"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">IG / Web</label>
          <input
            [(ngModel)]="clientForm.redes!.igWeb"
            name="clientIgWeb"
            placeholder="@usuario o https://..."
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
          <input
            [(ngModel)]="clientForm.direccion"
            name="clientDireccion"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            [(ngModel)]="clientForm.email"
            name="clientEmail"
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
              placeholder="Ej. VIP, Mayorista"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <p class="mt-1 text-xs text-gray-400">Separá varias etiquetas con coma.</p>
          </ng-template>
        </div>
        </fieldset>

        <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <button
            *ngIf="isEditing && auth.canDeleteRecords"
            type="button"
            (click)="confirmDeleteClient()"
            class="text-sm font-medium text-red-600 hover:text-red-700">
            Eliminar cliente
          </button>
          <div class="flex justify-end gap-3 sm:ml-auto">
            <button
              type="button"
              (click)="cancelled.emit()"
              class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {{ formReadOnly ? 'Cerrar' : 'Cancelar' }}
            </button>
            <button
              *ngIf="!formReadOnly"
              type="submit"
              [disabled]="savingClient"
              class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingClient ? 'Guardando...' : (isEditing ? 'Guardar' : 'Crear cliente') }}
            </button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class ClientFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() clientId: string | null = null;
  @Input() prefillNombre = '';
  @Input() showHistorialLink = true;
  @Output() saved = new EventEmitter<ClientFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  private clientService = inject(ClientService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  readonly auth = inject(AuthService);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  clientSaldo = 0;
  savingClient = false;
  loadingClient = false;
  clientForm: Partial<Client> = this.emptyClientForm();
  etiquetaPicker = '';
  etiquetasText = '';

  get isEditing(): boolean {
    return !!this.clientId;
  }

  get formReadOnly(): boolean {
    return this.isEditing && !this.auth.canEditRecords;
  }

  get useEtiquetaList(): boolean {
    return this.catalogConfigService.usesConfigurableList(this.appConfig, 'clientes.etiquetas');
  }

  get etiquetaSelectOptions(): SearchableSelectOption[] {
    const selected = new Set(this.selectedEtiquetas.map((tag) => tag.toLowerCase()));
    return this.catalogConfigService
      .getFieldOptions(this.appConfig, 'clientes.etiquetas')
      .filter((tag) => !selected.has(tag.toLowerCase()))
      .map((tag) => ({
        value: tag,
        label: tag,
      }));
  }

  get selectedEtiquetas(): string[] {
    return this.clientForm.etiquetas ?? [];
  }

  ngOnInit() {
    this.configSub = this.catalogConfigService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalogConfigService.getAppConfig().subscribe();
    this.resetForm();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['clientId'] || changes['prefillNombre']) {
      this.resetForm();
    }
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  private resetForm() {
    this.clientSaldo = 0;

    if (this.clientId) {
      this.loadClient(this.clientId);
      return;
    }

    this.loadingClient = false;
    this.clientForm = this.emptyClientForm();
    if (this.prefillNombre.trim()) {
      this.clientForm.nombre = this.prefillNombre.trim();
    }
    this.etiquetasText = '';
    this.etiquetaPicker = '';
  }

  private loadClient(id: string) {
    this.loadingClient = true;
    this.clientService.getClient(id).subscribe({
      next: (client) => {
        this.clientForm = {
          nombre: client.nombre ?? '',
          telefono: client.telefono ?? '',
          email: client.email ?? '',
          direccion: client.direccion ?? '',
          redes: {
            igWeb: client.redes?.igWeb ?? client.redes?.instagram ?? '',
          },
          etiquetas: [...(client.etiquetas ?? [])],
        };
        this.clientSaldo = client.saldoPendiente ?? 0;
        this.etiquetasText = (client.etiquetas ?? []).join(', ');
        this.etiquetaPicker = '';
        this.loadingClient = false;
      },
      error: () => {
        this.loadingClient = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el cliente.',
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
    this.catalogConfigService.ensureFieldOptions('clientes.etiquetas', [tag]).subscribe();
  }

  addEtiqueta(tag: string) {
    if (!tag) return;

    const current = this.clientForm.etiquetas ?? [];
    const exists = current.some((item) => item.toLowerCase() === tag.toLowerCase());
    if (exists) return;

    this.clientForm.etiquetas = [...current, tag];
  }

  removeEtiqueta(tag: string) {
    this.clientForm.etiquetas = (this.clientForm.etiquetas ?? []).filter((item) => item !== tag);
  }

  resolveEtiquetas(): string[] {
    if (this.useEtiquetaList) {
      return [...(this.clientForm.etiquetas ?? [])];
    }

    return this.etiquetasText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  saveClient() {
    if (!this.clientForm.nombre?.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del cliente.',
      });
      return;
    }

    const etiquetas = this.resolveEtiquetas();

    const payload: Client = {
      nombre: this.clientForm.nombre!.trim(),
      telefono: this.clientForm.telefono?.trim() ?? '',
      email: this.clientForm.email?.trim() ?? '',
      direccion: this.clientForm.direccion?.trim() ?? '',
      redes: { igWeb: this.clientForm.redes?.igWeb?.trim() ?? '' },
      etiquetas,
    };

    this.savingClient = true;

    const request = this.clientId
      ? this.clientService.updateClient(this.clientId, payload)
      : this.clientService.createClient(payload);

    request
      .pipe(
        switchMap((response) =>
          this.catalogConfigService.ensureFieldOptions('clientes.etiquetas', etiquetas).pipe(
            catchError(() => of(null)),
            switchMap(() => of(response))
          )
        )
      )
      .subscribe({
        next: (response) => {
          this.savingClient = false;
          const id = this.clientId ?? response.id;
          if (!id) return;

          this.saved.emit({
            id,
            client: { ...payload, id },
          });
        },
        error: () => {
          this.savingClient = false;
          this.dialogService.alert({
            title: 'Error',
            message: this.clientId
              ? 'No se pudo actualizar el cliente.'
              : 'No se pudo guardar el cliente.',
          });
        },
      });
  }

  confirmDeleteClient() {
    if (!this.clientId) return;
    const name = this.clientForm.nombre?.trim() || 'este cliente';

    this.dialogService
      .confirm({
        title: 'Eliminar cliente',
        message: `¿Eliminar a ${name}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.clientId) return;

        this.clientService.deleteClient(this.clientId).subscribe({
          next: () => this.deleted.emit(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el cliente.',
            }),
        });
      });
  }

  private emptyClientForm(): Partial<Client> {
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
