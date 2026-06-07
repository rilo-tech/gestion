import { Component, DestroyRef, Injector, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  ICON_ACTION_LINK_CLASS,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
  totalListPages,
} from '../../shared/components/list-pagination/list-pagination.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from './client-form-panel.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { handleClientDeleteError } from '../../core/utils/client-delete-flow';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    TransactionModalComponent,
    ClientFormPanelComponent,
    ActivityLogTriggerComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    CompactListRowComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Clientes"
        description="Administra tu base de datos de clientes."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="clientsPage = 1"
        searchFieldName="clientsSearchQueryMobile"
        activityModule="clients"
        [showRefresh]="true"
        [refreshing]="loading"
        (refreshClick)="reloadList()">
        <a
          headerActions
          routerLink="/clients/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo cliente"
          title="Nuevo cliente">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo cliente</span>
        </a>
      </app-module-page-header>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="clientsPage = 1"
            name="clientsSearchQuery"
            placeholder="Buscar por nombre, contacto, dirección o etiqueta...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let client of paginatedFilteredClients"
            (activate)="openClient(client)">
            <div compactTitle class="compact-list-title truncate">
              {{ client.nombre }}<span *ngIf="client.activo === false" class="text-gray-400"> · inactivo</span>
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">{{ getContactDisplay(client) }}</div>
            <span
              *ngIf="auth.canViewAccountBalance"
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0"
              [class.text-orange-600]="(client.saldoPendiente || 0) > 0"
              [class.text-gray-500]="!(client.saldoPendiente || 0)">
              {{ '$' + (client.saldoPendiente || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando clientes...</p>
          <p *ngIf="!loading && clients.length > 0 && filteredClients.length === 0" [class]="compactListEmptyClass">
            No se encontraron clientes para "{{ searchQuery }}".
          </p>
          <p *ngIf="!loading && clients.length === 0" [class]="compactListEmptyClass">
            No se encontraron clientes.
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
              <th *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Saldo</th>
              <th class="hidden sm:table-cell px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let client of paginatedFilteredClients"
              (click)="openClient(client)"
              [class]="listTableRowClass">
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="font-medium text-gray-900 truncate">
                  {{ client.nombre }}<span *ngIf="client.activo === false" class="text-gray-400"> · inactivo</span>
                </div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-600 truncate">
                {{ getContactDisplay(client) }}
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                <span class="line-clamp-2 break-words">{{ client.direccion?.trim() || '—' }}</span>
              </td>
              <td class="hidden sm:table-cell px-6 py-4">
                <div class="flex gap-1 flex-wrap">
                  <span
                    *ngFor="let tag of client.etiquetas"
                    class="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                    {{ tag }}
                  </span>
                </div>
              </td>
              <td *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-right whitespace-nowrap">
                <div
                  class="text-sm font-bold tabular-nums"
                  [class.text-orange-600]="(client.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(client.saldoPendiente || 0)">
                  {{ '$' + (client.saldoPendiente || 0) }}
                </div>
                <div *ngIf="client.debe" class="text-xs font-semibold text-orange-500">Debe</div>
              </td>
              <td class="hidden sm:table-cell px-4 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [showDelete]="auth.canDeleteRecords"
                  [editLabel]="auth.canEditRecords ? 'Editar' : 'Ver cliente'"
                  (editClick)="openClient(client)"
                  (deleteClick)="confirmDeleteClient(client)">
                  <a
                    rowActionStart
                    *ngIf="client.id"
                    [routerLink]="['/clients', client.id, 'historial']"
                    title="Historial"
                    class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                    <i-lucide name="history" class="w-4 h-4"></i-lucide>
                  </a>
                </app-list-row-actions>
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
        <app-list-pagination
          listFooter
          [page]="clientsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredClients.length"
          [canFetchMore]="clientsHasMore && !searchQuery.trim()"
          [loadingMore]="loadingMoreClients"
          (pageChange)="clientsPage = $event"
          (fetchMore)="loadMoreClients()">
        </app-list-pagination>
      </app-compact-data-list>
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
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  private clientService = inject(ClientService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  clients: Client[] = [];
  loading = true;
  loadingMoreClients = false;
  clientsHasMore = false;
  clientsCursor: string | null = null;
  searchQuery = '';
  clientsPage = 1;
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

  get paginatedFilteredClients(): Client[] {
    return paginateSlice(this.filteredClients, this.clientsPage, this.listPageSize);
  }

  ngOnInit() {
    bindListPageRefreshOnReturn({
      listPath: '/clients',
      reload: () => this.reloadList(),
      reset: () => this.closeClientModal(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
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
        const nombre = params.get('nombre')?.trim();
        this.router.navigate(['/clients/new'], {
          ...(nombre ? { queryParams: { nombre } } : {}),
          replaceUrl: true,
        });
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

  onClientSaved(event: ClientFormSaveEvent) {
    this.editingClientId = event.id;
    this.loadClients();
  }

  onClientDeleted() {
    this.closeClientModal();
    this.loadClients();
  }

  reloadList() {
    this.clientsPage = 1;
    this.clientsCursor = null;
    this.loadClients();
  }

  loadClients() {
    this.loading = true;
    this.clientsPage = 1;
    this.clientService.getClientsPage(this.listPageSize).subscribe({
      next: (clients) => {
        this.clients = clients.items;
        this.clientsHasMore = clients.hasMore;
        this.clientsCursor = clients.nextCursor;
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

  loadMoreClients() {
    if (!this.clientsHasMore || this.loadingMoreClients || this.searchQuery.trim()) return;
    const pageBefore = this.clientsPage;
    const totalPagesBefore = totalListPages(this.filteredClients.length, this.listPageSize);
    this.loadingMoreClients = true;
    this.clientService.getClientsPage(this.listPageSize, this.clientsCursor ?? undefined).subscribe({
      next: (page) => {
        this.clients = [...this.clients, ...page.items];
        this.clientsHasMore = page.hasMore;
        this.clientsCursor = page.nextCursor;
        this.loadingMoreClients = false;
        if (pageBefore >= totalPagesBefore) {
          this.clientsPage = Math.min(
            pageBefore + 1,
            totalListPages(this.filteredClients.length, this.listPageSize)
          );
        }
      },
      error: () => {
        this.loadingMoreClients = false;
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
          error: (err) =>
            handleClientDeleteError(
              err,
              client.id!,
              client.nombre,
              this.clientService,
              this.dialogService,
              () => this.loadClients()
            ),
        });
      });
  }
}
