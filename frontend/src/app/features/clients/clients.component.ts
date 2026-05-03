import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientService, Client } from '../../core/services/client.service';
import { LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule],
  template: `
    <div class="p-8">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Clientes</h1>
          <p class="text-gray-500">Administra tu base de datos de clientes.</p>
        </div>
        <button 
          (click)="showAddModal = true"
          class="bg-primary text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-opacity-90">
          <i-lucide name="users" class="w-4 h-4"></i-lucide>
          Nuevo Cliente
        </button>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contacto</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Etiquetas</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let client of clients" class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900">{{client.nombre}}</div>
                <div class="text-xs text-gray-400">{{client.id}}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">
                <div>{{client.telefono || 'Sin teléfono'}}</div>
                <div class="text-xs text-gray-400">{{client.email}}</div>
              </td>
              <td class="px-6 py-4">
                <div class="flex gap-1 flex-wrap">
                  <span *ngFor="let tag of client.etiquetas" 
                        class="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                    {{tag}}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm font-medium">
                <button class="text-teal-600 hover:text-teal-900">Ver historial</button>
              </td>
            </tr>
            <tr *ngIf="clients.length === 0">
              <td colspan="4" class="px-6 py-12 text-center text-gray-400">
                No se encontraron clientes.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Add Modal (Simple) -->
      <div *ngIf="showAddModal" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-xl">
          <h2 class="text-xl font-bold mb-6">Nuevo Cliente</h2>
          <form (submit)="saveClient(); $event.preventDefault()" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre Completo</label>
              <input [(ngModel)]="newClient.nombre" name="nombre" required
                     class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">WhatsApp / Teléfono</label>
              <input [(ngModel)]="newClient.telefono" name="telefono"
                     class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input [(ngModel)]="newClient.email" name="email" type="email"
                     class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none">
            </div>
            <div class="flex gap-4 pt-4">
              <button type="button" (click)="showAddModal = false"
                      class="flex-1 px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button type="submit"
                      class="flex-1 px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-opacity-90">
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: []
})
export class ClientsComponent implements OnInit {
  private clientService = inject(ClientService);
  
  clients: Client[] = [];
  showAddModal = false;
  newClient: Partial<Client> = { nombre: '', telefono: '', email: '' };

  ngOnInit() {
    this.loadClients();
  }

  loadClients() {
    this.clientService.getClients().subscribe(clients => {
      this.clients = clients;
    });
  }

  saveClient() {
    if (!this.newClient.nombre) return;
    this.clientService.createClient(this.newClient as Client).subscribe(() => {
      this.loadClients();
      this.showAddModal = false;
      this.newClient = { nombre: '', telefono: '', email: '' };
    });
  }
}
