import { Component, DestroyRef, Injector, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { DialogService } from '../../core/services/dialog.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
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
} from '../../shared/components/list-pagination/list-pagination.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { confirmClientDeletion } from '../../core/utils/client-delete-flow';
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
import {
  PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE,
  PROGRESSIVE_LIST_FIRST_PAGE_SIZE,
  ProgressiveListSession,
} from '../../core/utils/progressive-list-load';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    ActivityLogTriggerComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    CompactListRowComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass" (click)="clearSaldoKpiFilter()">
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

      <div
        *ngIf="auth.canViewAccountBalance"
        class="sm:hidden mb-3 px-2"
        (click)="$event.stopPropagation()">
        <div class="grid grid-cols-2 gap-1">
          <button
            type="button"
            (click)="toggleSaldoKpiFilter($event)"
            [class]="saldoKpiMobileChipClass('orange')">
            <span class="block text-[9px] font-semibold uppercase leading-tight text-gray-500 dark:text-gray-400">
              Por cobrar
            </span>
            <span class="block text-[11px] font-bold tabular-nums text-orange-600 dark:text-orange-400 leading-tight mt-0.5 truncate">
              {{ formatMoney(totalSaldoPorCobrar) }}
            </span>
          </button>
          <button
            type="button"
            (click)="toggleSaldoKpiFilter($event)"
            [class]="saldoKpiMobileChipClass('neutral')">
            <span class="block text-[9px] font-semibold uppercase leading-tight text-gray-500 dark:text-gray-400">
              Con saldo
            </span>
            <span class="block text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-tight mt-0.5">
              {{ debtorCount }}
            </span>
          </button>
        </div>
      </div>

      <div
        *ngIf="auth.canViewAccountBalance"
        class="module-summary-kpis hidden sm:grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8"
        (click)="$event.stopPropagation()">
        <button
          type="button"
          (click)="toggleSaldoKpiFilter($event)"
          [class]="saldoKpiCardClass('border-orange-100 dark:border-orange-900/50')">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Total por cobrar</p>
          <p class="text-xl sm:text-2xl font-bold text-orange-600 tabular-nums">{{ formatMoney(totalSaldoPorCobrar) }}</p>
        </button>
        <button
          type="button"
          (click)="toggleSaldoKpiFilter($event)"
          [class]="saldoKpiCardClass('border-gray-100 dark:border-gray-700')">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Clientes con saldo</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{{ debtorCount }}</p>
        </button>
      </div>

      <div
        *ngIf="saldoKpiFilterActive && auth.canViewAccountBalance"
        class="mb-3 sm:mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg sm:rounded-xl border border-teal-100 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-950/40 px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm text-teal-800 dark:text-teal-200">
        <span class="min-w-0 truncate">
          <span class="sm:hidden">Filtrado: </span>
          <span class="hidden sm:inline">Mostrando solo clientes con saldo pendiente. Hacé click fuera de los recuadros para ver todos.</span>
          <span class="sm:hidden font-semibold">Con saldo</span>
        </span>
        <button
          type="button"
          (click)="clearSaldoKpiFilter(); $event.stopPropagation()"
          class="shrink-0 font-semibold text-teal-700 dark:text-teal-300 hover:underline">
          Ver todos
        </button>
      </div>

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
              {{ formatMoney(client.saldoPendiente || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando clientes...</p>
          <p *ngIf="!loading && clients.length > 0 && filteredClients.length === 0" [class]="compactListEmptyClass">
            <ng-container *ngIf="saldoKpiFilterActive && !searchQuery.trim()">
              No hay clientes con saldo pendiente.
            </ng-container>
            <ng-container *ngIf="!saldoKpiFilterActive || searchQuery.trim()">
              No se encontraron clientes para "{{ searchQuery }}".
            </ng-container>
          </p>
          <p *ngIf="!loading && clients.length === 0" [class]="compactListEmptyClass">
            No se encontraron clientes.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
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
                  {{ formatMoney(client.saldoPendiente || 0) }}
                </div>
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
                <ng-container *ngIf="saldoKpiFilterActive && !searchQuery.trim()">
                  No hay clientes con saldo pendiente.
                </ng-container>
                <ng-container *ngIf="!saldoKpiFilterActive || searchQuery.trim()">
                  No se encontraron clientes para "{{ searchQuery }}".
                </ng-container>
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
          (pageChange)="clientsPage = $event">
        </app-list-pagination>
      </app-compact-data-list>
    </div>
  `,
})
export class ClientsComponent implements OnInit {
  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

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
  private readonly listLoadSession = new ProgressiveListSession();
  searchQuery = '';
  clientsPage = 1;
  saldoKpiFilterActive = false;

  get totalSaldoPorCobrar(): number {
    return this.clients.reduce(
      (sum, client) => sum + Math.max(0, client.saldoPendiente || 0),
      0
    );
  }

  get debtorCount(): number {
    return this.clients.filter((client) => (client.saldoPendiente || 0) > 0).length;
  }

  get filteredClients(): Client[] {
    let list = this.clients;

    if (this.saldoKpiFilterActive) {
      list = list.filter((client) => (client.saldoPendiente || 0) > 0);
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((client) => {
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
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.loadClients();

    this.route.queryParamMap.subscribe((params) => {
      const editId = params.get('edit');
      const isNew = params.get('new') === '1';

      if (editId) {
        this.router.navigate(['/clients', editId, 'edit'], { replaceUrl: true });
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

  reloadList() {
    this.clientsPage = 1;
    this.loadClients();
  }

  loadClients() {
    const loadToken = this.listLoadSession.next();
    this.loading = true;
    this.clientsPage = 1;
    this.clientService.getClientsPage(PROGRESSIVE_LIST_FIRST_PAGE_SIZE).subscribe({
      next: (page) => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.clients = [...page.items].sort((a, b) =>
          (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base' })
        );
        this.clientsHasMore = page.hasMore;
        this.clientsCursor = page.nextCursor;
        this.loading = false;
        if (page.hasMore && page.nextCursor) {
          this.loadRemainingClientsInBackground(loadToken);
        }
      },
      error: () => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los clientes.',
        });
      },
    });
  }

  private loadRemainingClientsInBackground(loadToken: number) {
    if (!this.listLoadSession.isActive(loadToken)) return;
    if (!this.clientsHasMore || !this.clientsCursor || this.loadingMoreClients) return;

    this.loadingMoreClients = true;
    this.clientService
      .getClientsPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.clientsCursor)
      .subscribe({
        next: (page) => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.clients = [...this.clients, ...page.items].sort((a, b) =>
            (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base' })
          );
          this.clientsHasMore = page.hasMore;
          this.clientsCursor = page.nextCursor;
          this.loadingMoreClients = false;
          if (page.hasMore && page.nextCursor) {
            this.loadRemainingClientsInBackground(loadToken);
          }
        },
        error: () => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.loadingMoreClients = false;
        },
      });
  }

  toggleSaldoKpiFilter(event: Event): void {
    event.stopPropagation();
    this.saldoKpiFilterActive = !this.saldoKpiFilterActive;
    this.clientsPage = 1;
  }

  clearSaldoKpiFilter(): void {
    if (!this.saldoKpiFilterActive) return;
    this.saldoKpiFilterActive = false;
    this.clientsPage = 1;
  }

  saldoKpiCardClass(borderClass: string): string {
    const base =
      'w-full text-left bg-white dark:bg-gray-900 p-4 sm:p-5 rounded-xl border shadow-sm transition-colors cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50';
    const ring = this.saldoKpiFilterActive
      ? ' ring-2 ring-teal-500 ring-offset-2 dark:ring-offset-gray-950'
      : '';
    return `${base} ${borderClass}${ring}`;
  }

  saldoKpiMobileChipClass(variant: 'orange' | 'neutral'): string {
    const base =
      'w-full min-w-0 text-left rounded-lg px-2 py-1.5 border transition-colors active:scale-[0.98]';
    if (this.saldoKpiFilterActive) {
      return `${base} border-teal-500 bg-teal-50 ring-1 ring-teal-500/40 dark:bg-teal-950/50 dark:border-teal-600`;
    }
    if (variant === 'orange') {
      return `${base} border-orange-200 dark:border-orange-900/50 bg-white dark:bg-gray-900`;
    }
    return `${base} border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900`;
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
    this.router.navigate(['/clients', client.id, 'edit']);
  }

  confirmDeleteClient(client: Client) {
    if (!client.id || !this.auth.canDeleteRecords) return;

    confirmClientDeletion(
      client.id,
      client.nombre,
      this.clientService,
      this.dialogService,
      () => this.loadClients()
    );
  }
}
