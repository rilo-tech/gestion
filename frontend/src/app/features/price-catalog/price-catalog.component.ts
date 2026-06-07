import { Component, DestroyRef, Injector, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import {
  PriceCatalogEntry,
  PriceCatalogListRow,
  PriceCatalogService,
  buildPriceCatalogListRows,
} from '../../core/services/price-catalog.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  DESKTOP_TABLE_TD_CLASS,
  DESKTOP_TABLE_TD_CLASS_RIGHT,
  MODULE_TABLE_HEAD_CELL_CLASS,
  EXPANDED_NESTED_WRAP_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';

const PRICE_QTY_BADGE_CLASS =
  'inline-flex items-center rounded-md bg-teal-50 border border-teal-100 px-3 py-1 text-xs sm:text-sm leading-snug text-teal-900 whitespace-nowrap';

const EXPANDED_DETAIL_GRID_CLASS =
  'grid grid-cols-[minmax(5.5rem,9rem)_minmax(4.5rem,auto)_4.5rem] sm:grid-cols-[minmax(7rem,11rem)_minmax(5rem,auto)_5.5rem] gap-x-4 sm:gap-x-8 gap-y-2 py-1 items-center w-full max-w-xl';

const EXPANDED_DETAIL_NAME_CLASS =
  'text-xs sm:text-sm font-medium text-gray-800 min-w-0 truncate';

const EXPANDED_DETAIL_PRICE_CLASS =
  'text-xs sm:text-sm font-bold tabular-nums text-teal-800 whitespace-nowrap text-right justify-self-end';

@Component({
  selector: 'app-price-catalog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    IconActionComponent,
    ListPaginationComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListSearchFieldComponent,
    CompactListRowComponent,
    ListRowActionsComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Precios de venta"
        description="Catálogo por detalle (con/sin estampado) y cantidad. Solo precios de venta, sin costos."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="onSearchChange()"
        searchFieldName="priceCatalogSearchMobile"
        activityModule="price_catalog"
        [showRefresh]="true"
        [refreshing]="loading"
        (refreshClick)="reloadList()">
        <app-icon-action
          headerActions
          *ngIf="auth.canManagePriceCatalog"
          label="Nueva referencia"
          (clicked)="router.navigate(['/price-catalog/new'])">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
      </app-module-page-header>

      <div
        *ngIf="savedNotice"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-300 dark:border-teal-600 bg-teal-100 dark:bg-teal-950/60 px-4 py-3 text-sm font-semibold text-teal-900 dark:text-teal-100"
        role="status">
        <span>{{ savedNotice }}</span>
        <button
          type="button"
          (click)="dismissSavedNotice()"
          class="text-xs font-semibold text-teal-800 dark:text-teal-200 underline hover:no-underline">
          Cerrar
        </button>
      </div>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="onSearchChange()"
            name="priceCatalogSearch"
            placeholder="Buscar por producto, detalle o notas...">
          </app-list-search-field>
        </div>

        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando referencias...</p>
          <p *ngIf="!loading && entries.length === 0" [class]="compactListEmptyClass">
            Todavía no hay referencias en el catálogo.
          </p>
          <p *ngIf="!loading && entries.length > 0 && filteredRows.length === 0" [class]="compactListEmptyClass">
            No hay referencias que coincidan con la búsqueda.
          </p>

          <ng-container *ngFor="let row of paginatedFilteredRows">
            <app-compact-list-row (activate)="toggleRowExpand(row.key)">
              <div compactTitle class="compact-list-title truncate flex items-center gap-1.5 min-w-0">
                <i-lucide
                  [name]="isRowExpanded(row.key) ? 'chevron-down' : 'chevron-right'"
                  class="w-3.5 h-3.5 shrink-0 text-gray-400"></i-lucide>
                <span class="truncate">{{ row.entryNombre }}</span>
                <span
                  *ngIf="!row.entryActivo"
                  class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[9px] font-semibold uppercase">
                  Inactiva
                </span>
              </div>
              <div compactSubtitle *ngIf="row.entryNotas" class="compact-list-subtitle truncate">
                {{ row.entryNotas }}
              </div>
              <div compactTrailing class="flex items-center gap-2 shrink-0">
                <span class="text-[11px] font-bold tabular-nums text-teal-800 whitespace-nowrap">
                  {{ '$' + row.peakUnitPrice }}
                </span>
                <app-list-row-actions
                  *ngIf="auth.canManagePriceCatalog"
                  [showDelete]="false"
                  editLabel="Editar referencia"
                  (editClick)="openEntry(row.entryId)">
                </app-list-row-actions>
              </div>
            </app-compact-list-row>

            <div
              *ngIf="isRowExpanded(row.key)"
              class="border-b border-gray-100 bg-gray-50/60 px-3 py-2">
              <div [class]="expandedDetailWrapClass">
                <div [class]="expandedDetailGridClass">
                  <ng-container *ngFor="let detail of row.detalles">
                    <ng-container *ngFor="let range of detail.ranges; let rangeIndex = index">
                      <span [class]="expandedDetailNameClass">
                        {{ rangeIndex === 0 ? detail.detalle : '' }}
                      </span>
                      <span [class]="priceQtyBadgeClass + ' justify-self-start'">{{ range.label }}</span>
                      <span [class]="expandedDetailPriceClass">{{ '$' + range.precio }}</span>
                    </ng-container>
                  </ng-container>
                </div>
              </div>
            </div>
          </ng-container>
        </div>

        <div listDesktop [class]="tableScrollClass">
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando referencias...</p>

          <p *ngIf="!loading && entries.length === 0" [class]="compactListEmptyClass">
            Todavía no hay referencias en el catálogo.
          </p>

          <p *ngIf="!loading && entries.length > 0 && filteredRows.length === 0" [class]="compactListEmptyClass">
            No hay referencias que coincidan con la búsqueda.
          </p>

          <table
            *ngIf="!loading && filteredRows.length > 0"
            [class]="nativeCompactTableClass + ' sm:min-w-[520px] sm:table-fixed'">
            <colgroup class="hidden sm:table-column-group">
              <col class="w-[2.5rem]" />
              <col class="w-[min(38%,14rem)]" />
              <col class="w-[6.5rem]" />
              <col class="w-[5.5rem]" />
            </colgroup>
            <thead>
              <tr class="border-b border-gray-100 bg-gray-50/80">
                <th [class]="tableHeadClass + ' w-10 px-3 sm:px-4'"></th>
                <th [class]="tableHeadClass">Producto</th>
                <th [class]="tableHeadClass + ' text-right whitespace-nowrap'">Precio U.</th>
                <th [class]="tableHeadClass + ' text-right'">Acción</th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngFor="let row of paginatedFilteredRows">
                <tr
                  [class]="listTableRowClass"
                  (click)="toggleRowExpand(row.key)"
                  (keydown.enter)="toggleRowExpand(row.key)"
                  tabindex="0"
                  role="button"
                  [attr.aria-expanded]="isRowExpanded(row.key)">
                  <td [class]="tableCellClass + ' w-10 px-3 sm:px-4 text-gray-400'">
                    <i-lucide
                      [name]="isRowExpanded(row.key) ? 'chevron-down' : 'chevron-right'"
                      class="w-4 h-4"></i-lucide>
                  </td>
                  <td [class]="tableCellClass + ' font-semibold text-gray-900 max-w-[14rem]'">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="truncate">{{ row.entryNombre }}</span>
                      <span
                        *ngIf="!row.entryActivo"
                        class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-semibold uppercase">
                        Inactiva
                      </span>
                    </div>
                    <p *ngIf="row.entryNotas" class="mt-0.5 text-xs font-normal text-gray-500 truncate">
                      {{ row.entryNotas }}
                    </p>
                  </td>
                  <td [class]="tableCellRightClass + ' font-bold tabular-nums text-teal-800 whitespace-nowrap'">
                    {{ '$' + row.peakUnitPrice }}
                  </td>
                  <td [class]="tableCellClass + ' text-right'" (click)="$event.stopPropagation()">
                    <app-list-row-actions
                      *ngIf="auth.canManagePriceCatalog"
                      [showDelete]="false"
                      editLabel="Editar referencia"
                      (editClick)="openEntry(row.entryId)">
                    </app-list-row-actions>
                  </td>
                </tr>

                <tr *ngIf="isRowExpanded(row.key)" class="bg-gray-50/50 border-b border-gray-100">
                  <td colspan="4" class="px-3 sm:px-6 py-2">
                    <div [class]="expandedDetailWrapClass">
                      <div [class]="expandedDetailGridClass">
                        <ng-container *ngFor="let detail of row.detalles">
                          <ng-container *ngFor="let range of detail.ranges; let rangeIndex = index">
                            <span [class]="expandedDetailNameClass">
                              {{ rangeIndex === 0 ? detail.detalle : '' }}
                            </span>
                            <span [class]="priceQtyBadgeClass + ' justify-self-start'">{{ range.label }}</span>
                            <span [class]="expandedDetailPriceClass">{{ '$' + range.precio }}</span>
                          </ng-container>
                        </ng-container>
                      </div>
                    </div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>
        </div>

        <app-list-pagination
          *ngIf="!loading && filteredRows.length > 0"
          listFooter
          [page]="catalogPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredRows.length"
          (pageChange)="catalogPage = $event">
        </app-list-pagination>
      </app-compact-data-list>
    </div>
  `,
})
export class PriceCatalogComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly tableHeadClass = MODULE_TABLE_HEAD_CELL_CLASS;
  readonly tableCellClass = DESKTOP_TABLE_TD_CLASS;
  readonly tableCellRightClass = DESKTOP_TABLE_TD_CLASS_RIGHT;
  readonly priceQtyBadgeClass = PRICE_QTY_BADGE_CLASS;
  readonly expandedDetailWrapClass = EXPANDED_NESTED_WRAP_CLASS;
  readonly expandedDetailGridClass = EXPANDED_DETAIL_GRID_CLASS;
  readonly expandedDetailNameClass = EXPANDED_DETAIL_NAME_CLASS;
  readonly expandedDetailPriceClass = EXPANDED_DETAIL_PRICE_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);
  readonly router = inject(Router);

  private route = inject(ActivatedRoute);
  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  entries: PriceCatalogEntry[] = [];
  loading = true;
  searchQuery = '';
  catalogPage = 1;
  savedNotice = '';
  expandedRowKeys = new Set<string>();

  get filteredRows(): PriceCatalogListRow[] {
    const query = this.searchQuery.trim().toLowerCase();
    const rows = buildPriceCatalogListRows(this.entries);
    if (!query) return rows;

    return rows.filter((row) => {
      const haystack = [
        row.entryNombre,
        row.entryNotas,
        ...row.detalles.flatMap((detail) => [
          detail.detalle,
          ...detail.ranges.map((range) => `${range.label} ${range.precio}`),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }

  get paginatedFilteredRows(): PriceCatalogListRow[] {
    return paginateSlice(this.filteredRows, this.catalogPage, this.listPageSize);
  }

  ngOnInit() {
    bindListPageRefreshOnReturn({
      listPath: '/price-catalog',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('saved') === '1') {
        this.savedNotice = 'Referencia guardada correctamente.';
      }
    });
    this.loadEntries();
  }

  onSearchChange() {
    this.catalogPage = 1;
    this.expandedRowKeys.clear();
  }

  dismissSavedNotice() {
    this.savedNotice = '';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { saved: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  isRowExpanded(key: string): boolean {
    return this.expandedRowKeys.has(key);
  }

  toggleRowExpand(key: string) {
    if (this.expandedRowKeys.has(key)) {
      this.expandedRowKeys.delete(key);
    } else {
      this.expandedRowKeys.add(key);
    }
  }

  openEntry(entryId: string) {
    if (!entryId) return;
    this.router.navigate(['/price-catalog', entryId, 'edit']);
  }

  reloadList() {
    this.catalogPage = 1;
    this.expandedRowKeys.clear();
    this.loadEntries();
  }

  private loadEntries() {
    this.loading = true;
    this.catalogPage = 1;
    this.priceCatalogService.getEntries().subscribe({
      next: (entries) => {
        this.entries = entries;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el catálogo de precios.',
        });
      },
    });
  }
}
