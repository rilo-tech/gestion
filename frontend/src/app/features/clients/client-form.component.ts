import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
} from '../../core/services/catalog-config.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';

@Component({
  selector: 'app-client-form',
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
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <div class="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">
            {{ isEditing ? 'Editar cliente' : 'Nuevo cliente' }}
          </h1>
          <p class="text-sm text-gray-500">
            {{ isEditing ? 'Datos de contacto y etiquetas del cliente.' : 'Cargá un cliente a tu base de datos.' }}
          </p>
          <app-config-settings-link
            settingsTab="clientes"
            message="¿Falta una etiqueta?"
            linkLabel="Configurala acá">
          </app-config-settings-link>
        </div>
        <button
          routerLink="/clients"
          class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
          <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
          Volver a clientes
        </button>
      </div>

      <div class="max-w-4xl space-y-6">
        <a
          *ngIf="isEditing && clientId"
          [routerLink]="['/clients', clientId, 'historial']"
          class="flex items-center justify-between gap-4 rounded-xl border border-teal-100 bg-teal-50 px-4 py-4 hover:bg-teal-100/80 transition-colors">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-teal-900">Historial y cuenta corriente</p>
            <p class="text-xs text-teal-800 mt-0.5">
              Ver pedidos, ventas, saldo pendiente y registrar cobros.
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span
              *ngIf="clientSaldo > 0"
              class="text-sm font-bold tabular-nums text-orange-700">
              {{ '$' + clientSaldo }}
            </span>
            <i-lucide name="history" class="w-5 h-5 text-teal-700"></i-lucide>
          </div>
        </a>

        <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <form (submit)="saveClient(); $event.preventDefault()" class="space-y-4">
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
              <label class="block text-sm font-medium text-gray-700 mb-1">Instagram</label>
              <input
                [(ngModel)]="clientForm.redes!.instagram"
                name="clientInstagram"
                placeholder="@usuario"
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

              <div *ngIf="clientForm.etiquetas?.length" class="flex flex-wrap gap-2 mb-3">
                <span
                  *ngFor="let tag of clientForm.etiquetas; let i = index"
                  class="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 text-teal-700 text-xs rounded-full">
                  {{ tag }}
                  <button type="button" (click)="removeEtiqueta(i)" class="text-teal-900">×</button>
                </span>
              </div>

              <div *ngIf="useEtiquetaList; else freeEtiquetas" class="flex gap-2">
                <app-searchable-select
                  class="flex-1"
                  [(ngModel)]="newEtiqueta"
                  name="newEtiqueta"
                  [options]="availableEtiquetaOptions"
                  placeholder="Buscar etiqueta..."
                  plainPlaceholder="Ej. VIP">
                </app-searchable-select>
                <button
                  type="button"
                  (click)="addEtiqueta()"
                  class="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Agregar
                </button>
              </div>

              <ng-template #freeEtiquetas>
                <input
                  [(ngModel)]="etiquetasText"
                  name="etiquetasText"
                  placeholder="Ej. VIP, Mayorista"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
              </ng-template>
            </div>

            <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <button
                *ngIf="isEditing"
                type="button"
                (click)="confirmDeleteClient()"
                class="text-sm font-medium text-red-600 hover:text-red-700">
                Eliminar cliente
              </button>
              <div class="flex justify-end gap-3 sm:ml-auto">
                <button
                  type="button"
                  routerLink="/clients"
                  class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  type="submit"
                  [disabled]="savingClient"
                  class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                  {{ savingClient ? 'Guardando...' : (isEditing ? 'Guardar' : 'Crear cliente') }}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  `,
})
export class ClientFormComponent implements OnInit, OnDestroy {
  readonly pageShellClass = PAGE_SHELL_CLASS;

  private clientService = inject(ClientService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  clientId: string | null = null;
  clientSaldo = 0;
  savingClient = false;
  clientForm: Partial<Client> = this.emptyClientForm();
  newEtiqueta = '';
  etiquetasText = '';

  get isEditing(): boolean {
    return !!this.clientId;
  }

  get useEtiquetaList(): boolean {
    return this.catalogConfigService.usesConfigurableList(this.appConfig, 'clientes.etiquetas');
  }

  get availableEtiquetaOptions(): string[] {
    return this.catalogConfigService
      .getFieldOptions(this.appConfig, 'clientes.etiquetas')
      .filter((tag) => !(this.clientForm.etiquetas ?? []).includes(tag));
  }

  ngOnInit() {
    this.configSub = this.catalogConfigService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.catalogConfigService.getAppConfig().subscribe();

    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      this.clientId = id;
      this.clientSaldo = 0;

      if (id) {
        this.loadClient(id);
      } else {
        this.clientForm = this.emptyClientForm();
        this.etiquetasText = '';
        this.newEtiqueta = '';
      }
    });
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  loadClient(id: string) {
    this.clientService.getClient(id).subscribe({
      next: (client) => {
        this.clientForm = {
          nombre: client.nombre ?? '',
          telefono: client.telefono ?? '',
          email: client.email ?? '',
          direccion: client.direccion ?? '',
          redes: { instagram: client.redes?.instagram ?? '' },
          etiquetas: [...(client.etiquetas ?? [])],
        };
        this.clientSaldo = client.saldoPendiente ?? 0;
        this.etiquetasText = (client.etiquetas ?? []).join(', ');
        this.newEtiqueta = '';
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el cliente.',
        });
        this.router.navigate(['/clients']);
      },
    });
  }

  addEtiqueta() {
    const tag = this.newEtiqueta.trim();
    if (!tag) return;

    const current = this.clientForm.etiquetas ?? [];
    if (current.includes(tag)) {
      this.newEtiqueta = '';
      return;
    }

    this.clientForm.etiquetas = [...current, tag];
    this.newEtiqueta = '';
  }

  removeEtiqueta(index: number) {
    this.clientForm.etiquetas = (this.clientForm.etiquetas ?? []).filter((_, i) => i !== index);
  }

  resolveEtiquetas(): string[] {
    if (this.useEtiquetaList) {
      return this.clientForm.etiquetas ?? [];
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

    const payload = {
      ...this.clientForm,
      nombre: this.clientForm.nombre.trim(),
      etiquetas: this.resolveEtiquetas(),
    } as Client;

    this.savingClient = true;
    const request = this.clientId
      ? this.clientService.updateClient(this.clientId, payload)
      : this.clientService.createClient(payload);

    request.subscribe({
      next: () => {
        this.savingClient = false;
        this.router.navigate(['/clients']);
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
          next: () => this.router.navigate(['/clients']),
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
      redes: { instagram: '' },
      etiquetas: [],
    };
  }
}
