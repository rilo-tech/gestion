import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ConfigSettingsLinkComponent, RouterLink],
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
        <a
          routerLink="/clients/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo cliente"
          title="Nuevo cliente">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo cliente</span>
        </a>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div [class]="tableScrollClass">
        <table [class]="tableMinWidthClass">
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
              (click)="openClient(client)"
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
    </div>
  `,
})
export class ClientsComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;

  private clientService = inject(ClientService);
  private dialogService = inject(DialogService);
  private router = inject(Router);

  clients: Client[] = [];
  loading = true;

  ngOnInit() {
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

    const instagram = client.redes?.instagram?.trim();
    if (instagram) {
      return instagram.startsWith('@') ? instagram : `@${instagram}`;
    }

    return 'Sin contacto';
  }

  openClient(client: Client) {
    if (!client.id) return;
    this.router.navigate(['/clients', client.id, 'edit']);
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
}
