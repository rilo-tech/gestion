import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from './client-form-panel.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ConfigSettingsLinkComponent,
    RouterLink,
    TransactionModalComponent,
    ClientFormPanelComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Clientes</h1>
          <p class="text-sm sm:text-base text-gray-500">Administra tu base de datos de clientes.</p>
          <app-config-settings-link
            settingsTab="clientes"
            message="¿Falta una etiqueta?"
            linkLabel="Configurala acá">
          </app-config-settings-link>
        </div>
        <button
          type="button"
          (click)="openNewClient()"
          [class]="iconActionLinkClass"
          aria-label="Nuevo cliente"
          title="Nuevo cliente">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo cliente</span>
        </button>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            name="clientsSearchQuery"
            placeholder="Buscar por nombre, contacto, dirección o etiqueta..."
            class="w-full max-w-xl px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
        </div>
        <div [class]="tableScrollClass">
        <table class="w-full min-w-[640px] text-left border-collapse table-fixed">
          <colgroup>
            <col class="w-[9rem]" />
            <col class="w-[7.5rem]" />
            <col class="w-[14rem]" />
            <col class="w-[8rem]" />
            <col class="w-[5.5rem]" />
            <col class="w-[9rem]" />
          </colgroup>
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contacto</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dirección</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Etiquetas</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Saldo</th>
              <th class="px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let client of filteredClients"
              (click)="openClient(client)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900 truncate">{{ client.nombre }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 truncate">
                {{ getContactDisplay(client) }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                <span class="line-clamp-2 break-words">{{ client.direccion?.trim() || '—' }}</span>
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
              <td class="px-6 py-4 text-right whitespace-nowrap">
                <div
                  class="text-sm font-bold tabular-nums"
                  [class.text-orange-600]="(client.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(client.saldoPendiente || 0)">
                  {{ '$' + (client.saldoPendiente || 0) }}
                </div>
                <div *ngIf="client.debe" class="text-xs font-semibold text-orange-500">Debe</div>
              </td>
              <td class="px-4 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                <div class="flex items-center justify-end gap-1">
                  <a
                    *ngIf="client.id"
                    [routerLink]="['/clients', client.id, 'historial']"
                    title="Historial"
                    class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                    <i-lucide name="history" class="w-4 h-4"></i-lucide>
                  </a>
                  <button
                    type="button"
                    (click)="openClient(client)"
                    [title]="auth.canEditRecords ? 'Editar' : 'Ver cliente'"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="auth.canDeleteRecords"
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
            <tr *ngIf="!loading && clients.length > 0 && filteredClients.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron clientes para "{{ searchQuery }}".
              </td>
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
    </div>

    <app-transaction-modal
      [open]="clientModalOpen"
      [title]="clientModalTitle"
      [subtitle]="clientModalSubtitle"
      maxWidthClass="max-w-lg"
      (closed)="closeClientModal()">
      <app-client-form-panel
        [clientId]="editingClientId"
        [prefillNombre]="clientPrefillNombre"
        (saved)="onClientSaved($event)"
        (cancelled)="closeClientModal()"
        (deleted)="onClientDeleted()">
      </app-client-form-panel>
    </app-transaction-modal>
  `,
})
export class ClientsComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);

  private clientService = inject(ClientService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  clients: Client[] = [];
  loading = true;
  searchQuery = '';
  clientModalOpen = false;
  editingClientId: string | null = null;
  clientPrefillNombre = '';

  get clientModalTitle(): string {
    return this.editingClientId ? 'Editar cliente' : 'Nuevo cliente';
  }

  get clientModalSubtitle(): string {
    return this.editingClientId
      ? 'Datos de contacto y etiquetas del cliente.'
      : 'Cargá un cliente a tu base de datos.';
  }

  get filteredClients(): Client[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.clients;

    return this.clients.filter((client) => {
      const nombre = (client.nombre ?? '').toLowerCase();
      const contacto = this.getContactDisplay(client).toLowerCase();
      const direccion = (client.direccion ?? '').toLowerCase();
      const email = (client.email ?? '').toLowerCase();
      const etiquetas = (client.etiquetas ?? []).join(' ').toLowerCase();

      return (
        nombre.includes(query) ||
        contacto.includes(query) ||
        direccion.includes(query) ||
        email.includes(query) ||
        etiquetas.includes(query)
      );
    });
  }

  ngOnInit() {
    this.loadClients();

    this.route.queryParamMap.subscribe((params) => {
      const editId = params.get('edit');
      const isNew = params.get('new') === '1';

      if (editId) {
        this.openClientModal(editId);
        this.clearClientQueryParams();
        return;
      }

      if (isNew) {
        this.openNewClient(params.get('nombre') ?? '');
        this.clearClientQueryParams();
      }
    });
  }

  private clearClientQueryParams() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { edit: null, new: null, nombre: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  openNewClient(prefillNombre = '') {
    this.editingClientId = null;
    this.clientPrefillNombre = prefillNombre.trim();
    this.clientModalOpen = true;
  }

  openClientModal(clientId: string) {
    this.editingClientId = clientId;
    this.clientPrefillNombre = '';
    this.clientModalOpen = true;
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.editingClientId = null;
    this.clientPrefillNombre = '';
  }

  onClientSaved(_event: ClientFormSaveEvent) {
    this.closeClientModal();
    this.loadClients();
  }

  onClientDeleted() {
    this.closeClientModal();
    this.loadClients();
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

    const igWeb = client.redes?.igWeb?.trim() || client.redes?.instagram?.trim();
    if (igWeb) {
      return igWeb.startsWith('http') ? igWeb : igWeb.startsWith('@') ? igWeb : `@${igWeb}`;
    }

    return 'Sin contacto';
  }

  openClient(client: Client) {
    if (!client.id) return;
    this.openClientModal(client.id);
  }

  confirmDeleteClient(client: Client) {
    if (!client.id || !this.auth.canDeleteRecords) return;

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
}
