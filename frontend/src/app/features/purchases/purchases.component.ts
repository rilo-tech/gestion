import { Component, DestroyRef, Injector, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  PurchaseService,
  Purchase,
  formatPurchaseLabel,
} from '../../core/services/purchase.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  IconActionComponent,
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
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import { LucideAngularModule } from 'lucide-angular';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';

@Component({
  selector: 'app-purchases',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    IconActionComponent,
    ActivityLogTriggerComponent,
    CompactListRowComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListLoadMoreComponent,
    ListSearchFieldComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Compras"
        description="Registrá entradas de mercadería e insumos al inventario."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="purchasesPage = 1"
        searchFieldName="purchasesSearchQueryMobile"
        activityModule="purchases"
        [showRefresh]="true"
        [refreshing]="loading"
        (refreshClick)="reloadList()">
        <p headerExtra class="text-xs text-gray-400 mt-1 desc-lg-only">
          Los movimientos de stock se ven en
          <a routerLink="/stock" class="text-teal-600 hover:underline">Stock → Movimientos</a>.
        </p>
        <app-icon-action
          headerActions
          label="Nueva compra"
          (clicked)="openPurchaseModal()">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
      </app-module-page-header>

      <div *ngIf="auth.canViewEconomics" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8 w-full">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Compras registradas</p>
          <p class="text-2xl font-bold text-gray-900">{{ purchases.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total comprado</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalComprado }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Este mes</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + totalMes }}</p>
        </div>
        <div
          *ngIf="ahorroOfertasMes > 0"
          class="bg-amber-50 p-6 rounded-xl border border-amber-100 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-xs font-semibold text-amber-600 uppercase mb-2">Ahorro por ofertas (mes)</p>
          <p class="text-2xl font-bold text-amber-700">{{ '$' + ahorroOfertasMes }}</p>
        </div>
      </div>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="purchasesPage = 1"
            name="purchasesSearchQuery"
            placeholder="Buscar por compra, proveedor, comprobante o producto...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let purchase of paginatedFilteredPurchases"
            (activate)="openPurchaseDetail(purchase)">
            <div compactTitle class="compact-list-title flex items-baseline gap-1.5 min-w-0">
              <span
                *ngIf="purchase.estado === 'borrador'"
                class="shrink-0 text-amber-600 font-semibold">
                Borrador
              </span>
              <span *ngIf="purchase.estado !== 'borrador'" class="shrink-0 tabular-nums">#{{ formatPurchaseLabel(purchase) }}</span>
              <span class="truncate min-w-0 font-normal text-gray-600">{{ purchase.proveedor?.trim() || '—' }}</span>
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              {{ formatDate(purchase.fecha) }}
              <span *ngIf="purchase.numeroComprobante?.trim()"> · Fact. {{ purchase.numeroComprobante }}</span>
            </div>
            <span compactTrailing class="text-[11px] font-bold tabular-nums shrink-0 text-gray-900">
              {{ '$' + (purchase.total || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando compras...</p>
          <p *ngIf="!loading && purchases.length === 0" [class]="compactListEmptyClass">
            Todavía no hay compras. Usá <span class="font-semibold">Nueva compra</span> para sumar stock.
          </p>
          <p *ngIf="!loading && purchases.length > 0 && filteredPurchases.length === 0" [class]="compactListEmptyClass">
            No hay compras que coincidan con la búsqueda.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[640px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Compra</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Proveedor</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Líneas</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let purchase of paginatedFilteredPurchases"
              (click)="openPurchaseDetail(purchase)"
              [class]="listTableRowClass">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(purchase.fecha) }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-teal-700">
                <span *ngIf="purchase.estado === 'borrador'" class="text-amber-700">Borrador</span>
                <span *ngIf="purchase.estado !== 'borrador'">#{{ formatPurchaseLabel(purchase) }}</span>
                <div class="text-xs font-normal text-gray-400 sm:hidden">{{ formatDate(purchase.fecha) }}</div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-700">
                <div class="truncate">{{ purchase.proveedor?.trim() || '—' }}</div>
                <div *ngIf="purchase.numeroComprobante?.trim()" class="text-xs text-gray-500 truncate">
                  Fact. {{ purchase.numeroComprobante }}
                </div>
                <div class="text-xs text-gray-400 sm:hidden">{{ purchase.items?.length || 0 }} línea(s)</div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                {{ purchase.items?.length || 0 }} línea(s)
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (purchase.total || 0) }}
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [showDuplicate]="canDuplicatePurchase(purchase)"
                  duplicateLabel="Duplicar compra"
                  (duplicateClick)="duplicatePurchase(purchase, $event)"
                  [editIcon]="canOpenPurchaseForEdit(purchase) ? 'pencil' : 'clipboard-list'"
                  [editLabel]="getPurchaseEditLabel(purchase)"
                  (editClick)="openPurchaseDetail(purchase)"
                  [showDelete]="canDeletePurchase(purchase)"
                  deleteLabel="Eliminar compra"
                  [deleteLoading]="deletingPurchaseId === purchase.id"
                  (deleteClick)="confirmDeletePurchase(purchase)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando compras...</td>
            </tr>
            <tr *ngIf="!loading && purchases.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay compras. Usá <span class="font-semibold">Nueva compra</span> para sumar stock.
              </td>
            </tr>
            <tr *ngIf="!loading && purchases.length > 0 && filteredPurchases.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No hay compras que coincidan con la búsqueda.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="purchasesPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredPurchases.length"
          (pageChange)="purchasesPage = $event">
        </app-list-pagination>
        <app-list-load-more
          listFooter
          [hasMore]="purchasesHasMore"
          [loading]="loadingMorePurchases"
          label="Cargar más compras"
          (loadMoreClick)="loadMorePurchases()">
        </app-list-load-more>
      </app-compact-data-list>
    </div>
  `,
})
export class PurchasesComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  formatPurchaseLabel = formatPurchaseLabel;

  private purchaseService = inject(PurchaseService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  purchases: Purchase[] = [];
  loading = true;
  loadingMorePurchases = false;
  purchasesHasMore = false;
  purchasesCursor: string | null = null;
  readonly serverPageSize = 80;

  searchQuery = '';
  purchasesPage = 1;
  deletingPurchaseId: string | null = null;

  canEditPurchase(purchase: Purchase): boolean {
    return (
      this.auth.canEditRecords &&
      !!purchase.id &&
      purchase.estado !== 'borrador'
    );
  }

  canOpenPurchaseForEdit(purchase: Purchase): boolean {
    return this.auth.canEditRecords && !!purchase.id;
  }

  canDuplicatePurchase(purchase: Purchase): boolean {
    return this.canOpenPurchaseForEdit(purchase);
  }

  canDeletePurchase(purchase: Purchase): boolean {
    return this.auth.canDeleteRecords && !!purchase.id;
  }

  getPurchaseEditLabel(purchase: Purchase): string {
    if (purchase.estado === 'borrador') return 'Editar borrador';
    if (this.canEditPurchase(purchase)) return 'Editar compra';
    return 'Ver compra';
  }

  get filteredPurchases(): Purchase[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.purchases;

    return this.purchases.filter((purchase) => {
      const label = formatPurchaseLabel(purchase).toLowerCase();
      const proveedor = (purchase.proveedor || '').toLowerCase();
      const comprobante = (purchase.numeroComprobante || '').toLowerCase();
      const notas = (purchase.notas || '').toLowerCase();
      const productos = (purchase.items ?? [])
        .map(
          (line) =>
            (line.productoNombre || line.categoriaLabel || line.descripcion || '').toLowerCase()
        )
        .join(' ');

      return (
        label.includes(query) ||
        proveedor.includes(query) ||
        comprobante.includes(query) ||
        notas.includes(query) ||
        productos.includes(query)
      );
    });
  }

  get paginatedFilteredPurchases(): Purchase[] {
    return paginateSlice(this.filteredPurchases, this.purchasesPage, this.listPageSize);
  }

  ngOnInit() {
    if (!this.auth.canViewStockCosts) {
      this.router.navigate(['/dashboard']);
      return;
    }
    bindListPageRefreshOnReturn({
      listPath: '/purchases',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.loadPurchases();

    this.route.queryParamMap.subscribe((params) => {
      const detailId = params.get('detail')?.trim();
      if (!detailId) return;
      this.router.navigate(['/purchases', detailId], { replaceUrl: true });
    });
  }

  get totalComprado(): number {
    return this.purchases.reduce((acc, purchase) => acc + (Number(purchase.total) || 0), 0);
  }

  get totalMes(): number {
    const now = new Date();
    return this.purchases
      .filter((purchase) => {
        const date = new Date(purchase.fecha);
        return (
          !Number.isNaN(date.getTime()) &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce((acc, purchase) => acc + (Number(purchase.total) || 0), 0);
  }

  get ahorroOfertasMes(): number {
    const now = new Date();
    const total = this.purchases
      .filter((purchase) => {
        const date = new Date(purchase.fecha);
        return (
          !Number.isNaN(date.getTime()) &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce((acc, purchase) => acc + this.purchaseAhorroOferta(purchase), 0);
    return Math.round(total * 100) / 100;
  }

  private purchaseAhorroOferta(purchase: Purchase): number {
    if (typeof purchase.ahorroOfertaTotal === 'number') {
      return Number(purchase.ahorroOfertaTotal) || 0;
    }
    return (purchase.items ?? []).reduce(
      (acc, line) => acc + (Number(line.ahorroOferta) || 0),
      0
    );
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  openPurchaseModal() {
    this.router.navigate(['/purchases/new']);
  }

  openPurchaseDraftEdit(purchase: Purchase) {
    if (!purchase.id) return;
    this.router.navigate(['/purchases/new'], { queryParams: { draftId: purchase.id } });
  }

  openPurchaseEdit(purchase: Purchase) {
    if (!purchase.id || !this.canEditPurchase(purchase)) return;

    const navigate = (fullPurchase: Purchase) => {
      this.router.navigate(['/purchases', fullPurchase.id, 'edit'], {
        state: { purchasePreview: fullPurchase },
      });
    };

    this.purchaseService.getPurchase(purchase.id).subscribe({
      next: navigate,
      error: () => {
        this.router.navigate(['/purchases', purchase.id, 'edit'], {
          state: { purchasePreview: purchase },
        });
      },
    });
  }

  openPurchaseView(purchase: Purchase) {
    if (!purchase.id) return;
    this.router.navigate(['/purchases', purchase.id], {
      state: { purchasePreview: purchase },
    });
  }

  openPurchaseDetail(purchase: Purchase) {
    if (!purchase.id) return;
    if (purchase.estado === 'borrador') {
      this.openPurchaseDraftEdit(purchase);
      return;
    }
    if (this.canEditPurchase(purchase)) {
      this.openPurchaseEdit(purchase);
      return;
    }
    this.openPurchaseView(purchase);
  }

  duplicatePurchase(purchase: Purchase, event?: Event) {
    event?.stopPropagation();
    if (!purchase.id || !this.canDuplicatePurchase(purchase)) return;
    this.router.navigate(['/purchases/new'], { queryParams: { duplicate: purchase.id } });
  }

  confirmDeletePurchase(purchase: Purchase) {
    if (!purchase.id || !this.canDeletePurchase(purchase)) return;

    const label =
      purchase.estado === 'borrador'
        ? 'borrador'
        : `#${formatPurchaseLabel(purchase)}`;

    this.dialogService
      .confirm({
        title: 'Eliminar compra',
        message:
          purchase.estado === 'borrador'
            ? '¿Eliminar este borrador de compra?'
            : `¿Eliminar la compra ${label}? Se revertirá el stock ingresado y los movimientos de caja vinculados.`,
        confirmLabel: 'Eliminar',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !purchase.id) return;

        this.deletingPurchaseId = purchase.id;
        this.purchaseService.deletePurchase(purchase.id).subscribe({
          next: () => {
            this.deletingPurchaseId = null;
            this.purchases = this.purchases.filter((row) => row.id !== purchase.id);
          },
          error: (err) => {
            this.deletingPurchaseId = null;
            this.dialogService.alert({
              title: 'No se pudo eliminar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar la compra.',
            });
          },
        });
      });
  }

  reloadList() {
    this.purchasesPage = 1;
    this.purchasesCursor = null;
    this.loadPurchases();
  }

  private loadPurchases() {
    this.loading = true;
    this.purchasesPage = 1;
    this.purchaseService.getPurchasesPage(this.serverPageSize).subscribe({
      next: (page) => {
        this.purchases = page.items;
        this.purchasesHasMore = page.hasMore;
        this.purchasesCursor = page.nextCursor;
        this.loading = false;
        this.tryOpenDetailFromQuery();
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las compras.',
        });
      },
    });
  }

  loadMorePurchases() {
    if (!this.purchasesHasMore || this.loadingMorePurchases) return;
    this.loadingMorePurchases = true;
    this.purchaseService
      .getPurchasesPage(this.serverPageSize, this.purchasesCursor ?? undefined)
      .subscribe({
        next: (page) => {
          this.purchases = [...this.purchases, ...page.items];
          this.purchasesHasMore = page.hasMore;
          this.purchasesCursor = page.nextCursor;
          this.loadingMorePurchases = false;
        },
        error: () => {
          this.loadingMorePurchases = false;
        },
      });
  }
}
