import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { DialogService } from '../../core/services/dialog.service';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  SupplierFormPanelComponent,
  SupplierFormSaveEvent,
} from './supplier-form-panel.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ConfigSettingsLinkComponent,
    TransactionModalComponent,
    SupplierFormPanelComponent,
    ActivityLogTriggerComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Proveedores</h1>
          <p class="text-sm sm:text-base text-gray-500">Administra tus proveedores para compras e insumos.</p>
          <app-config-settings-link
            settingsTab="proveedores"
            message="¿Falta una etiqueta?"
            linkLabel="Configurala acá">
          </app-config-settings-link>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="suppliers"></app-activity-log-trigger>
          <button
            type="button"
            (click)="openNewSupplier()"
            [class]="iconActionLinkClass"
            aria-label="Nuevo proveedor"
            title="Nuevo proveedor">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
            <span class="hidden sm:inline">Nuevo proveedor</span>
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            name="suppliersSearchQuery"
            placeholder="Buscar por nombre, contacto, dirección o etiqueta..."
            class="w-full max-w-xl px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
        </div>
        <div [class]="tableScrollClass">
        <table class="w-full sm:min-w-[640px] text-left border-collapse sm:table-fixed">
          <colgroup class="hidden sm:table-column-group">
            <col class="w-[9rem]" />
            <col class="w-[7.5rem]" />
            <col class="w-[14rem]" />
            <col class="w-[8rem]" />
            <col class="w-[5.5rem]" />
            <col class="w-[9rem]" />
          </colgroup>
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contacto</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dirección</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Etiquetas</th>
              <th *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">A pagar</th>
              <th class="hidden sm:table-cell px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let supplier of filteredSuppliers"
              (click)="openSupplier(supplier)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="font-medium text-gray-900 truncate">{{ supplier.nombre }}</div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-600 truncate">
                {{ getContactDisplay(supplier) }}
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                <span class="line-clamp-2 break-words">{{ supplier.direccion?.trim() || '—' }}</span>
              </td>
              <td class="hidden sm:table-cell px-6 py-4">
                <div class="flex gap-1 flex-wrap">
                  <span
                    *ngFor="let tag of supplier.etiquetas"
                    class="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                    {{ tag }}
                  </span>
                </div>
              </td>
              <td *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-right whitespace-nowrap">
                <div
                  class="text-sm font-bold tabular-nums"
                  [class.text-orange-600]="(supplier.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(supplier.saldoPendiente || 0)">
                  {{ '$' + (supplier.saldoPendiente || 0) }}
                </div>
                <div *ngIf="supplier.debe" class="text-xs font-semibold text-orange-500">Pendiente de pago</div>
              </td>
              <td class="hidden sm:table-cell px-4 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    (click)="openSupplier(supplier)"
                    [title]="auth.canEditRecords ? 'Editar' : 'Ver proveedor'"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="auth.canDeleteRecords"
                    type="button"
                    (click)="confirmDeleteSupplier(supplier)"
                    title="Eliminar"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="loading" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">Cargando proveedores...</td>
            </tr>
            <tr *ngIf="loading" class="hidden sm:table-row">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando proveedores...</td>
            </tr>
            <tr *ngIf="!loading && suppliers.length > 0 && filteredSuppliers.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                No se encontraron proveedores para "{{ searchQuery }}".
              </td>
            </tr>
            <tr *ngIf="!loading && suppliers.length > 0 && filteredSuppliers.length === 0" class="hidden sm:table-row">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron proveedores para "{{ searchQuery }}".
              </td>
            </tr>
            <tr *ngIf="!loading && suppliers.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                No se encontraron proveedores.
              </td>
            </tr>
            <tr *ngIf="!loading && suppliers.length === 0" class="hidden sm:table-row">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron proveedores.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>

    <app-transaction-modal
      [open]="supplierModalOpen"
      [title]="supplierModalTitle"
      [subtitle]="supplierModalSubtitle"
      maxWidthClass="max-w-lg"
      (closed)="closeSupplierModal()">
      <app-supplier-form-panel
        [supplierId]="editingSupplierId"
        [prefillNombre]="supplierPrefillNombre"
        (saved)="onSupplierSaved($event)"
        (cancelled)="closeSupplierModal()"
        (deleted)="onSupplierDeleted()">
      </app-supplier-form-panel>
    </app-transaction-modal>
  `,
})
export class SuppliersComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);

  private supplierService = inject(SupplierService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  suppliers: Supplier[] = [];
  loading = true;
  searchQuery = '';
  supplierModalOpen = false;
  editingSupplierId: string | null = null;
  supplierPrefillNombre = '';

  get supplierModalTitle(): string {
    return this.editingSupplierId ? 'Editar proveedor' : 'Nuevo proveedor';
  }

  get supplierModalSubtitle(): string {
    return this.editingSupplierId
      ? 'Datos de contacto y etiquetas del proveedor.'
      : 'Cargá un proveedor a tu base de datos.';
  }

  get filteredSuppliers(): Supplier[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.suppliers;

    return this.suppliers.filter((supplier) => {
      const nombre = (supplier.nombre ?? '').toLowerCase();
      const contacto = this.getContactDisplay(supplier).toLowerCase();
      const direccion = (supplier.direccion ?? '').toLowerCase();
      const email = (supplier.email ?? '').toLowerCase();
      const etiquetas = (supplier.etiquetas ?? []).join(' ').toLowerCase();

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
    this.loadSuppliers();

    this.route.queryParamMap.subscribe((params) => {
      const editId = params.get('edit');
      const isNew = params.get('new') === '1';

      if (editId) {
        this.openSupplierModal(editId);
        this.clearSupplierQueryParams();
        return;
      }

      if (isNew) {
        this.openNewSupplier(params.get('nombre') ?? '');
        this.clearSupplierQueryParams();
      }
    });
  }

  private clearSupplierQueryParams() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { edit: null, new: null, nombre: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  openNewSupplier(prefillNombre = '') {
    this.editingSupplierId = null;
    this.supplierPrefillNombre = prefillNombre.trim();
    this.supplierModalOpen = true;
  }

  openSupplierModal(supplierId: string) {
    this.editingSupplierId = supplierId;
    this.supplierPrefillNombre = '';
    this.supplierModalOpen = true;
  }

  closeSupplierModal() {
    this.supplierModalOpen = false;
    this.editingSupplierId = null;
    this.supplierPrefillNombre = '';
  }

  onSupplierSaved(event: SupplierFormSaveEvent) {
    this.editingSupplierId = event.id;
    this.loadSuppliers();
  }

  onSupplierDeleted() {
    this.closeSupplierModal();
    this.loadSuppliers();
  }

  loadSuppliers() {
    this.loading = true;
    this.supplierService.getSuppliers().subscribe({
      next: (suppliers) => {
        this.suppliers = suppliers;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los proveedores.',
        });
      },
    });
  }

  getContactDisplay(supplier: Supplier): string {
    if (supplier.telefono?.trim()) {
      return supplier.telefono.trim();
    }

    const igWeb = supplier.redes?.igWeb?.trim() || supplier.redes?.instagram?.trim();
    if (igWeb) {
      return igWeb.startsWith('http') ? igWeb : igWeb.startsWith('@') ? igWeb : `@${igWeb}`;
    }

    return 'Sin contacto';
  }

  openSupplier(supplier: Supplier) {
    if (!supplier.id) return;
    this.openSupplierModal(supplier.id);
  }

  confirmDeleteSupplier(supplier: Supplier) {
    if (!supplier.id || !this.auth.canDeleteRecords) return;

    this.dialogService
      .confirm({
        title: 'Eliminar proveedor',
        message: `¿Eliminar a ${supplier.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.supplierService.deleteSupplier(supplier.id!).subscribe({
          next: () => this.loadSuppliers(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el proveedor.',
            }),
        });
      });
  }
}
