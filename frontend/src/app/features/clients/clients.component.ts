import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Client,
  ClientAccount,
  ClientService,
} from '../../core/services/client.service';
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

@Component({
  selector: 'app-clients',
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
    <div class="p-8">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Clientes</h1>
          <p class="text-gray-500">Administra tu base de datos de clientes.</p>
          <app-config-settings-link
            settingsTab="clientes"
            message="¿Falta una etiqueta?"
            linkLabel="Configurala acá">
          </app-config-settings-link>
        </div>
        <button
          type="button"
          (click)="openClientModal()"
          class="bg-primary text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-opacity-90">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          Nuevo cliente
        </button>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contacto</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dirección</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Etiquetas</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Saldo</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let client of clients"
              (click)="openEditClient(client)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900">{{ client.nombre }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{ getContactDisplay(client) }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                {{ client.direccion?.trim() || '—' }}
              </td>
              <td class="px-6 py-4">
                <div class="flex gap-1 flex-wrap">
                  <span
                    *ngFor="let tag of client.etiquetas"
                    class="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                    {{ tag }}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <div
                  class="text-sm font-bold tabular-nums"
                  [class.text-orange-600]="(client.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(client.saldoPendiente || 0)">
                  {{ '$' + (client.saldoPendiente || 0) }}
                </div>
                <div *ngIf="client.debe" class="text-xs font-semibold text-orange-500">Debe</div>
              </td>
              <td class="px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    (click)="openEditClient(client)"
                    title="Editar"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    type="button"
                    (click)="confirmDeleteClient(client)"
                    title="Eliminar"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando clientes...</td>
            </tr>
            <tr *ngIf="!loading && clients.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron clientes.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      *ngIf="clientModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar"
        (click)="closeClientModal()">
      </button>
      <div class="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl p-6">
        <h2 class="text-lg font-bold text-gray-900 mb-1">
          {{ editingClientId ? 'Editar cliente' : 'Nuevo cliente' }}
        </h2>
        <p class="text-sm text-gray-500 mb-4">
          {{ editingClientId ? 'Datos del cliente y cuenta corriente.' : 'Cargá un cliente a tu base de datos.' }}
        </p>

        <div *ngIf="editingClientId" class="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            (click)="clientModalTab = 'datos'"
            class="px-4 py-2 rounded-lg border text-sm font-medium transition-colors"
            [class.bg-teal-600]="clientModalTab === 'datos'"
            [class.text-white]="clientModalTab === 'datos'"
            [class.border-teal-600]="clientModalTab === 'datos'"
            [class.bg-white]="clientModalTab !== 'datos'"
            [class.text-gray-700]="clientModalTab !== 'datos'"
            [class.border-gray-200]="clientModalTab !== 'datos'">
            Datos
          </button>
          <button
            type="button"
            (click)="openAccountTab()"
            class="px-4 py-2 rounded-lg border text-sm font-medium transition-colors"
            [class.bg-teal-600]="clientModalTab === 'cuenta'"
            [class.text-white]="clientModalTab === 'cuenta'"
            [class.border-teal-600]="clientModalTab === 'cuenta'"
            [class.bg-white]="clientModalTab !== 'cuenta'"
            [class.text-gray-700]="clientModalTab !== 'cuenta'"
            [class.border-gray-200]="clientModalTab !== 'cuenta'">
            Cuenta corriente
          </button>
        </div>

        <ng-container *ngIf="!editingClientId || clientModalTab === 'datos'">
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
              <app-config-settings-link
                settingsTab="clientes"
                message="¿Falta una etiqueta?"
                linkLabel="Configurala acá"
                [compact]="true">
              </app-config-settings-link>
            </ng-template>
          </div>

          <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <button
              *ngIf="editingClientId"
              type="button"
              (click)="confirmDeleteEditingClient()"
              class="text-sm font-medium text-red-600 hover:text-red-700">
              Eliminar cliente
            </button>
            <div class="flex justify-end gap-3 sm:ml-auto">
              <button
                type="button"
                (click)="closeClientModal()"
                class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="savingClient"
                class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                {{ savingClient ? 'Guardando...' : (editingClientId ? 'Guardar' : 'Crear cliente') }}
              </button>
            </div>
          </div>
        </form>
        </ng-container>

        <section *ngIf="editingClientId && clientModalTab === 'cuenta'" class="space-y-6">
          <div *ngIf="loadingAccount" class="py-12 text-center text-gray-400">Cargando cuenta...</div>

          <ng-container *ngIf="!loadingAccount && clientAccount">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Saldo total</p>
                <p
                  class="text-2xl font-bold tabular-nums"
                  [class.text-orange-600]="clientAccount.debe"
                  [class.text-gray-900]="!clientAccount.debe">
                  {{ '$' + clientAccount.saldoTotal }}
                </p>
                <p class="text-xs mt-1" [class.text-orange-600]="clientAccount.debe" [class.text-gray-500]="!clientAccount.debe">
                  {{ clientAccount.debe ? 'El cliente debe dinero' : 'Sin deuda pendiente' }}
                </p>
              </div>
              <div class="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p class="text-xs font-semibold text-gray-400 uppercase mb-1">En pedidos</p>
                <p class="text-xl font-bold tabular-nums text-gray-900">{{ '$' + clientAccount.saldoPedidos }}</p>
              </div>
              <div class="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p class="text-xs font-semibold text-gray-400 uppercase mb-1">Ventas mostrador</p>
                <p class="text-xl font-bold tabular-nums text-gray-900">{{ '$' + clientAccount.saldoVentasMostrador }}</p>
              </div>
            </div>

            <div *ngIf="clientAccount.proximosCobros.length" class="rounded-xl border border-orange-100 bg-orange-50 p-4">
              <h3 class="text-sm font-bold text-orange-900 mb-3">Próximos cobros</h3>
              <div class="space-y-2">
                <div
                  *ngFor="let cobro of clientAccount.proximosCobros"
                  class="flex items-center justify-between gap-3 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium text-orange-900 truncate">{{ cobro.referenciaLabel || 'Compromiso' }}</p>
                    <p class="text-xs text-orange-800">
                      Cuota {{ cobro.cuotaNumero }} · vence {{ formatAccountDate(cobro.fechaVencimiento) }}
                    </p>
                  </div>
                  <span class="font-bold tabular-nums text-orange-900">{{ '$' + cobro.monto }}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-sm font-bold text-gray-900 mb-3">Pedidos</h3>
              <div class="rounded-xl border border-gray-100 overflow-hidden">
                <table class="w-full text-left">
                  <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                    <tr>
                      <th class="px-4 py-3">Pedido</th>
                      <th class="px-4 py-3">Estado</th>
                      <th class="px-4 py-3 text-right">Total</th>
                      <th class="px-4 py-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50 text-sm">
                    <tr *ngFor="let pedido of clientAccount.pedidos">
                      <td class="px-4 py-3">
                        <a [routerLink]="['/orders', pedido.id, 'edit']" class="font-semibold text-teal-700 hover:underline">
                          #{{ pedido.numeroPedidoLabel }}
                        </a>
                        <p class="text-xs text-gray-500 truncate">{{ pedido.descripcion || '—' }}</p>
                      </td>
                      <td class="px-4 py-3 text-gray-600">{{ pedido.estado || '—' }}</td>
                      <td class="px-4 py-3 text-right tabular-nums">{{ '$' + pedido.total }}</td>
                      <td class="px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="pedido.saldo > 0">
                        {{ '$' + pedido.saldo }}
                      </td>
                    </tr>
                    <tr *ngIf="clientAccount.pedidos.length === 0">
                      <td colspan="4" class="px-4 py-8 text-center text-gray-400">Sin pedidos.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 class="text-sm font-bold text-gray-900 mb-3">Ventas</h3>
              <div class="rounded-xl border border-gray-100 overflow-hidden">
                <table class="w-full text-left">
                  <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                    <tr>
                      <th class="px-4 py-3">Venta</th>
                      <th class="px-4 py-3">Origen</th>
                      <th class="px-4 py-3 text-right">Total</th>
                      <th class="px-4 py-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50 text-sm">
                    <tr *ngFor="let venta of clientAccount.ventas">
                      <td class="px-4 py-3 font-semibold text-teal-700">#{{ venta.ventaLabel }}</td>
                      <td class="px-4 py-3 text-gray-600">
                        <span *ngIf="venta.origen === 'pedido'">Pedido #{{ venta.numeroPedidoLabel || '—' }}</span>
                        <span *ngIf="venta.origen !== 'pedido'">Mostrador</span>
                      </td>
                      <td class="px-4 py-3 text-right tabular-nums">{{ '$' + venta.total }}</td>
                      <td class="px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="venta.saldoPendiente > 0">
                        {{ '$' + venta.saldoPendiente }}
                      </td>
                    </tr>
                    <tr *ngIf="clientAccount.ventas.length === 0">
                      <td colspan="4" class="px-4 py-8 text-center text-gray-400">Sin ventas.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </ng-container>
        </section>
      </div>
    </div>
  `,
})
export class ClientsComponent implements OnInit, OnDestroy {
  private clientService = inject(ClientService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  clients: Client[] = [];
  loading = true;

  clientModalOpen = false;
  clientModalTab: 'datos' | 'cuenta' = 'datos';
  editingClientId: string | null = null;
  savingClient = false;
  loadingAccount = false;
  clientAccount: ClientAccount | null = null;
  clientForm: Partial<Client> = this.emptyClientForm();
  newEtiqueta = '';
  etiquetasText = '';

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
    this.loadClients();
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  loadClients() {
    this.loading = true;
    this.clientService.getClients().subscribe({
      next: (clients) => {
        this.clients = clients;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los clientes.',
        });
      },
    });
  }

  getContactDisplay(client: Client): string {
    if (client.telefono?.trim()) {
      return client.telefono.trim();
    }

    const instagram = client.redes?.instagram?.trim();
    if (instagram) {
      return instagram.startsWith('@') ? instagram : `@${instagram}`;
    }

    return 'Sin contacto';
  }

  openClientModal() {
    this.editingClientId = null;
    this.clientModalTab = 'datos';
    this.clientAccount = null;
    this.clientForm = this.emptyClientForm();
    this.newEtiqueta = '';
    this.etiquetasText = '';
    this.clientModalOpen = true;
  }

  openEditClient(client: Client) {
    if (!client.id) return;

    this.editingClientId = client.id;
    this.clientModalTab = 'datos';
    this.clientAccount = null;
    this.clientForm = {
      nombre: client.nombre ?? '',
      telefono: client.telefono ?? '',
      email: client.email ?? '',
      direccion: client.direccion ?? '',
      redes: { instagram: client.redes?.instagram ?? '' },
      etiquetas: [...(client.etiquetas ?? [])],
    };
    this.etiquetasText = (client.etiquetas ?? []).join(', ');
    this.newEtiqueta = '';
    this.clientModalOpen = true;
  }

  openAccountTab() {
    this.clientModalTab = 'cuenta';
    this.loadClientAccount();
  }

  loadClientAccount() {
    if (!this.editingClientId) return;

    this.loadingAccount = true;
    this.clientService.getClientAccount(this.editingClientId).subscribe({
      next: (account) => {
        this.clientAccount = account;
        this.loadingAccount = false;
      },
      error: () => {
        this.loadingAccount = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la cuenta del cliente.',
        });
      },
    });
  }

  formatAccountDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR');
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.editingClientId = null;
    this.clientAccount = null;
    this.clientModalTab = 'datos';
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
    const request = this.editingClientId
      ? this.clientService.updateClient(this.editingClientId, payload)
      : this.clientService.createClient(payload);

    request.subscribe({
      next: () => {
        this.savingClient = false;
        this.closeClientModal();
        this.loadClients();
      },
      error: () => {
        this.savingClient = false;
        this.dialogService.alert({
          title: 'Error',
          message: this.editingClientId
            ? 'No se pudo actualizar el cliente.'
            : 'No se pudo guardar el cliente.',
        });
      },
    });
  }

  confirmDeleteClient(client: Client) {
    if (!client.id) return;

    this.dialogService
      .confirm({
        title: 'Eliminar cliente',
        message: `¿Eliminar a ${client.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.clientService.deleteClient(client.id!).subscribe({
          next: () => this.loadClients(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el cliente.',
            }),
        });
      });
  }

  confirmDeleteEditingClient() {
    if (!this.editingClientId) return;
    const name = this.clientForm.nombre?.trim() || 'este cliente';

    this.dialogService
      .confirm({
        title: 'Eliminar cliente',
        message: `¿Eliminar a ${name}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.editingClientId) return;

        this.clientService.deleteClient(this.editingClientId).subscribe({
          next: () => {
            this.closeClientModal();
            this.loadClients();
          },
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
