import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Supplier, SupplierService } from '../../core/services/supplier.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  ICON_ACTION_LINK_CLASS,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  SupplierFormPanelComponent,
  SupplierFormSaveEvent,
} from './supplier-form-panel.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    TransactionModalComponent,
    SupplierFormPanelComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    CompactListRowComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListLoadMoreComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Proveedores"
        description="Administra tus proveedores para compras e insumos."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="suppliersPage = 1"
        searchFieldName="suppliersSearchQueryMobile"
        activityModule="suppliers">
        <a
          headerActions
          routerLink="/suppliers/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo proveedor"
          title="Nuevo proveedor">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo proveedor</span>
        </a>
      </app-module-page-header>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="suppliersPage = 1"
            name="suppliersSearchQuery"
            placeholder="Buscar por nombre, contacto, dirección o etiqueta...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let supplier of paginatedFilteredSuppliers"
            (activate)="openSupplier(supplier)">
            <div compactTitle class="compact-list-title truncate">{{ supplier.nombre }}</div>
            <div compactSubtitle class="compact-list-subtitle truncate">{{ getContactDisplay(supplier) }}</div>
            <span
              *ngIf="auth.canViewAccountBalance"
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0"
              [class.text-orange-600]="(supplier.saldoPendiente || 0) > 0"
              [class.text-gray-500]="!(supplier.saldoPendiente || 0)">
              {{ '$' + (supplier.saldoPendiente || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando proveedores...</p>
          <p *ngIf="!loading && suppliers.length > 0 && filteredSuppliers.length === 0" [class]="compactListEmptyClass">
            No se encontraron proveedores para "{{ searchQuery }}".
          </p>
          <p *ngIf="!loading && suppliers.length === 0" [class]="compactListEmptyClass">
            No se encontraron proveedores.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[640px] sm:table-fixed'">
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
              *ngFor="let supplier of paginatedFilteredSuppliers"
              (click)="openSupplier(supplier)"
              [class]="listTableRowClass">
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
                <app-list-row-actions
                  [showDelete]="auth.canDeleteRecords"
                  [editLabel]="auth.canEditRecords ? 'Editar' : 'Ver proveedor'"
                  (editClick)="openSupplier(supplier)"
                  (deleteClick)="confirmDeleteSupplier(supplier)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando proveedores...</td>
            </tr>
            <tr *ngIf="!loading && suppliers.length > 0 && filteredSuppliers.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron proveedores para "{{ searchQuery }}".
              </td>
            </tr>
            <tr *ngIf="!loading && suppliers.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron proveedores.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="suppliersPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredSuppliers.length"
          (pageChange)="suppliersPage = $event">
        </app-list-pagination>
        <app-list-load-more
          listFooter
          [hasMore]="suppliersHasMore"
          [loading]="loadingMoreSuppliers"
          label="Cargar más proveedores"
          (loadMoreClick)="loadMoreSuppliers()">
        </app-list-load-more>
      </app-compact-data-list>
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
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  private supplierService = inject(SupplierService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  suppliers: Supplier[] = [];
  loading = true;
  loadingMoreSuppliers = false;
  suppliersHasMore = false;
  suppliersCursor: string | null = null;
  searchQuery = '';
  suppliersPage = 1;
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

  get paginatedFilteredSuppliers(): Supplier[] {
    return paginateSlice(this.filteredSuppliers, this.suppliersPage, this.listPageSize);
  }

  ngOnInit() {
    this.loadSuppliers();

    this.route.queryParamMap.subscribe((params) => {
      const editId = params.get('edit');
      const isNew = params.get('new') === '1';

      if (editId) {
        if (prefersInlineFormPage()) {
          this.router.navigate(['/suppliers', editId, 'edit'], { replaceUrl: true });
        } else {
          this.openSupplierModal(editId);
        }
        this.clearSupplierQueryParams();
        return;
      }

      if (isNew) {
        const nombre = params.get('nombre')?.trim();
        if (prefersInlineFormPage()) {
          this.router.navigate(['/suppliers/new'], {
            ...(nombre ? { queryParams: { nombre } } : {}),
            replaceUrl: true,
          });
        } else {
          this.openNewSupplier(nombre ?? '');
        }
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
    if (prefersInlineFormPage()) {
      this.router.navigate(['/suppliers/new'], {
        ...(prefillNombre.trim() ? { queryParams: { nombre: prefillNombre.trim() } } : {}),
      });
      return;
    }

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
    this.suppliersPage = 1;
    this.supplierService.getSuppliersPage(this.listPageSize).subscribe({
      next: (page) => {
        this.suppliers = page.items;
        this.suppliersHasMore = page.hasMore;
        this.suppliersCursor = page.nextCursor;
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

  loadMoreSuppliers() {
    if (!this.suppliersHasMore || this.loadingMoreSuppliers) return;
    this.loadingMoreSuppliers = true;
    this.supplierService
      .getSuppliersPage(this.listPageSize, this.suppliersCursor ?? undefined)
      .subscribe({
        next: (page) => {
          this.suppliers = [...this.suppliers, ...page.items];
          this.suppliersHasMore = page.hasMore;
          this.suppliersCursor = page.nextCursor;
          this.loadingMoreSuppliers = false;
        },
        error: () => {
          this.loadingMoreSuppliers = false;
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
    if (prefersInlineFormPage()) {
      this.router.navigate(['/suppliers', supplier.id, 'edit']);
      return;
    }
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
