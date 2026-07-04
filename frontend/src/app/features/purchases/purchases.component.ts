import { Component, DestroyRef, Injector, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
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
import {
  PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE,
  PROGRESSIVE_LIST_FIRST_PAGE_SIZE,
  ProgressiveListSession,
} from '../../core/utils/progressive-list-load';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getComprobantesActivos,
  resolvePurchasePagoDisplayLabel,
  type ComprobanteTipoId,
  type ComprobanteTipoOption,
} from '../../core/services/catalog-config.service';
import { LIST_TOOLBAR_CONTROL_HEIGHT } from '../../shared/components/list-search-field/list-search-field.component';

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
        <ng-container headerActions>
          <app-icon-action
            *ngIf="!showComprobanteCreateMenu"
            label="Nueva compra"
            (clicked)="openPurchaseModal()">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <div *ngIf="showComprobanteCreateMenu" class="relative shrink-0">
            <button
              type="button"
              (click)="togglePurchasesCreateMenu($event)"
              [attr.aria-expanded]="purchasesCreateMenuOpen"
              aria-haspopup="menu"
              aria-label="Nueva compra, nota de crédito o débito"
              [class]="purchasesCreateMenuButtonClass">
              <i-lucide name="plus" class="w-4 h-4"></i-lucide>
            </button>
            <div
              *ngIf="purchasesCreateMenuOpen"
              class="fixed inset-0 z-10"
              aria-hidden="true"
              (click)="closePurchasesCreateMenu()"></div>
            <div
              *ngIf="purchasesCreateMenuOpen"
              role="menu"
              class="absolute right-0 top-full z-20 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-lg">
              <button
                *ngFor="let option of comprobanteCreateOptions"
                type="button"
                role="menuitem"
                (click)="openNewPurchaseFromMenu(option.id)"
                class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                <i-lucide [name]="comprobanteCreateIcon(option.id)" class="w-4 h-4 shrink-0 text-teal-600"></i-lucide>
                {{ option.label }}
              </button>
            </div>
          </div>
        </ng-container>
      </app-module-page-header>

      <div *ngIf="auth.canViewEconomics" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8 w-full items-start">
        <div class="bg-white dark:bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm min-w-0">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Compras confirmadas</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{{ confirmedPurchaseCount }}</p>
          <p *ngIf="draftCount > 0" class="text-xs font-semibold text-amber-600 mt-1">
            + {{ draftCount }} borrador{{ draftCount === 1 ? '' : 'es' }}
          </p>
        </div>
        <div class="bg-white dark:bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm min-w-0">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Total comprado</p>
          <p class="text-xl sm:text-2xl font-bold text-teal-600 tabular-nums leading-tight">{{ formatMoney(totalComprado) }}</p>
        </div>
        <div class="bg-white dark:bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Este mes</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{{ formatMoney(totalMes) }}</p>
        </div>
        <div
          *ngIf="ahorroOfertasMes > 0"
          class="bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5 rounded-xl border border-amber-100 dark:border-amber-900/50 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-[11px] font-semibold text-amber-600 uppercase mb-1">Ahorro por ofertas (mes)</p>
          <p class="text-xl sm:text-2xl font-bold text-amber-700 tabular-nums leading-tight">{{ formatMoney(ahorroOfertasMes) }}</p>
        </div>
      </div>

      <div
        *ngIf="draftCount > 0"
        class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Tenés <span class="font-semibold">{{ draftCount }} borrador{{ draftCount === 1 ? '' : 'es' }}</span>
        sin confirmar. Aparecen primero en la lista marcados como <span class="font-semibold">Borrador</span>
        (no mueven stock ni caja hasta que confirmes).
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
              {{ formatMoney(purchase.total || 0) }}
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
        <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Compra</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Proveedor</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Medio de pago</th>
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
                <div class="text-xs text-gray-400 sm:hidden">{{ getPurchasePagoDisplay(purchase) }}</div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                <div>{{ getPurchaseMedioPagoLabel(purchase) }}</div>
                <div *ngIf="purchaseShowsCuotas(purchase)" class="text-xs text-gray-500">
                  {{ getPurchaseCuotasLabel(purchase) }}
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ formatMoney(purchase.total || 0) }}
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
  private catalogConfig = inject(CatalogConfigService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  purchases: Purchase[] = [];
  loading = true;
  loadingMorePurchases = false;
  purchasesHasMore = false;
  purchasesCursor: string | null = null;
  private readonly listLoadSession = new ProgressiveListSession();

  searchQuery = '';
  purchasesPage = 1;
  deletingPurchaseId: string | null = null;
  purchasesCreateMenuOpen = false;

  readonly purchasesCreateMenuButtonClass =
    `inline-flex items-center justify-center rounded-lg bg-teal-600 text-white hover:bg-teal-700 w-[42px] p-0 transition-colors ${LIST_TOOLBAR_CONTROL_HEIGHT}`;

  get showComprobanteCreateMenu(): boolean {
    return this.comprobanteCreateOptions.length > 1;
  }

  get comprobanteCreateOptions(): ComprobanteTipoOption[] {
    return getComprobantesActivos(this.catalogConfig.appConfig, 'compras');
  }

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
    const list = !query
      ? [...this.purchases]
      : this.purchases.filter((purchase) => {
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
        productos.includes(query) ||
        (purchase.estado === 'borrador' && 'borrador'.includes(query))
      );
    });

    return list.sort((a, b) => {
      const aDraft = a.estado === 'borrador' ? 0 : 1;
      const bDraft = b.estado === 'borrador' ? 0 : 1;
      if (aDraft !== bDraft) return aDraft - bDraft;
      const dateA = Date.parse(String(a.fecha ?? '')) || 0;
      const dateB = Date.parse(String(b.fecha ?? '')) || 0;
      return dateB - dateA;
    });
  }

  get draftCount(): number {
    return this.purchases.filter((purchase) => purchase.estado === 'borrador').length;
  }

  get confirmedPurchaseCount(): number {
    return this.purchases.length - this.draftCount;
  }

  get paginatedFilteredPurchases(): Purchase[] {
    return paginateSlice(this.filteredPurchases, this.purchasesPage, this.listPageSize);
  }

  ngOnInit() {
    if (!this.auth.canViewStockCosts) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.catalogConfig.appConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => {
        this.appConfig = config;
      });
    this.catalogConfig.getAppConfig().subscribe();
    bindListPageRefreshOnReturn({
      listPath: '/purchases',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.purchaseService.listChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reloadList());
    this.loadPurchases();

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.tryOpenDetailFromQuery();
      });
  }

  private tryOpenDetailFromQuery(): void {
    const detailId = this.route.snapshot.queryParamMap.get('detail')?.trim();
    if (!detailId) return;
    this.router.navigate(['/purchases', detailId], { replaceUrl: true });
  }

  get totalComprado(): number {
    return this.purchases
      .filter((purchase) => purchase.estado !== 'borrador')
      .reduce((acc, purchase) => acc + (Number(purchase.total) || 0), 0);
  }

  get totalMes(): number {
    const now = new Date();
    return this.purchases
      .filter((purchase) => {
        if (purchase.estado === 'borrador') return false;
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

  getPurchaseMedioPagoId(purchase: Purchase): string {
    return String(purchase.pago?.medioPagoId ?? 'efectivo').trim().toLowerCase() || 'efectivo';
  }

  getPurchaseMedioPagoLabel(purchase: Purchase): string {
    if (purchase.pago?.displayLabel?.trim()) {
      return purchase.pago.displayLabel.trim();
    }
    return resolvePurchasePagoDisplayLabel(purchase.pago, {
      mediosPago: this.appConfig.finanzas?.mediosPago,
      tarjetas: this.appConfig.finanzas?.tarjetas,
    });
  }

  purchaseShowsCuotas(purchase: Purchase): boolean {
    const medioId = this.getPurchaseMedioPagoId(purchase);
    return medioId !== 'efectivo' && medioId !== 'transferencia';
  }

  getPurchaseCuotasLabel(purchase: Purchase): string {
    const cuotas = Math.max(1, Number(purchase.pago?.cuotas) || 1);
    return cuotas === 1 ? '1 cuota' : `${cuotas} cuotas`;
  }

  getPurchasePagoDisplay(purchase: Purchase): string {
    const label = this.getPurchaseMedioPagoLabel(purchase);
    if (!this.purchaseShowsCuotas(purchase)) return label;
    return `${label} · ${this.getPurchaseCuotasLabel(purchase)}`;
  }

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  openPurchaseModal() {
    this.router.navigate(['/purchases/new']);
  }

  togglePurchasesCreateMenu(event: Event): void {
    event.stopPropagation();
    this.purchasesCreateMenuOpen = !this.purchasesCreateMenuOpen;
  }

  closePurchasesCreateMenu(): void {
    this.purchasesCreateMenuOpen = false;
  }

  comprobanteCreateIcon(tipo: ComprobanteTipoId): string {
    if (tipo === 'nota_credito') return 'file-minus';
    if (tipo === 'nota_debito') return 'file-plus';
    return 'receipt';
  }

  openNewPurchaseFromMenu(tipo: ComprobanteTipoId): void {
    this.closePurchasesCreateMenu();
    const queryParams = tipo === 'factura' ? {} : { tipoComprobante: tipo };
    this.router.navigate(['/purchases/new'], { queryParams });
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
    const loadToken = this.listLoadSession.next();
    this.loading = true;
    this.purchasesPage = 1;
    this.purchaseService.getPurchasesPage(PROGRESSIVE_LIST_FIRST_PAGE_SIZE).subscribe({
      next: (page) => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.purchases = page.items;
        this.purchasesHasMore = page.hasMore;
        this.purchasesCursor = page.nextCursor;
        this.loading = false;
        this.tryOpenDetailFromQuery();
        if (page.hasMore && page.nextCursor) {
          this.loadRemainingPurchasesInBackground(loadToken);
        }
      },
      error: () => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las compras.',
        });
      },
    });
  }

  private loadRemainingPurchasesInBackground(loadToken: number) {
    if (!this.listLoadSession.isActive(loadToken)) return;
    if (!this.purchasesHasMore || !this.purchasesCursor || this.loadingMorePurchases) return;

    this.loadingMorePurchases = true;
    this.purchaseService
      .getPurchasesPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.purchasesCursor)
      .subscribe({
        next: (page) => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.purchases = [...this.purchases, ...page.items];
          this.purchasesHasMore = page.hasMore;
          this.purchasesCursor = page.nextCursor;
          this.loadingMorePurchases = false;
          if (page.hasMore && page.nextCursor) {
            this.loadRemainingPurchasesInBackground(loadToken);
          }
        },
        error: () => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.loadingMorePurchases = false;
        },
      });
  }

  loadMorePurchases() {
    if (!this.purchasesHasMore || this.loadingMorePurchases) return;
    this.loadingMorePurchases = true;
    this.purchaseService
      .getPurchasesPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.purchasesCursor ?? undefined)
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
