import { Component, ViewChild, inject, OnInit } from '@angular/core';
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
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  TransactionDetailPageComponent,
  TransactionSummaryPanelComponent,
  TransactionSummaryRowComponent,
  TransactionFormSaveEvent,
  TRANSACTION_FORM_CARD_CLASS,
} from '../../shared/components/transaction-form';
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
import { PurchaseFormPanelComponent } from './purchase-form-panel.component';
import { IconToolbarButtonComponent } from '../../shared/components/icon-toolbar';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';

@Component({
  selector: 'app-purchases',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    TransactionModalComponent,
    IconActionComponent,
    ActivityLogTriggerComponent,
    CompactListRowComponent,
    IconToolbarButtonComponent,
    PurchaseFormPanelComponent,
    TransactionDetailPageComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
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
        activityModule="purchases">
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
            <div compactTitle class="compact-list-title truncate">
              <span *ngIf="purchase.estado === 'borrador'" class="text-amber-600 font-semibold mr-1">Borrador</span>
              <span *ngIf="purchase.estado !== 'borrador'">#{{ formatPurchaseLabel(purchase) }}</span>
              <span *ngIf="purchase.estado === 'borrador' && purchase.proveedor?.trim()">· {{ purchase.proveedor }}</span>
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              {{ purchase.proveedor?.trim() || '—' }} · {{ purchase.items?.length || 0 }} línea(s)
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
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
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
                <div class="text-xs text-gray-400 sm:hidden">{{ purchase.items?.length || 0 }} línea(s)</div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                {{ purchase.items?.length || 0 }} línea(s)
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (purchase.total || 0) }}
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  editIcon="clipboard-list"
                  editLabel="Ver compra"
                  [showDelete]="false"
                  (editClick)="openPurchaseDetail(purchase)">
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

    <app-transaction-modal
      [open]="purchaseModalOpen"
      [title]="purchaseModalTitle"
      subtitle="Productos suman stock al registrar. Gastos y servicios solo afectan caja y cuentas."
      maxWidthClass="max-w-3xl"
      (closed)="closePurchaseModal()">
      <app-icon-toolbar-button
        *ngIf="!purchaseModalCompleted"
        headerActions
        class="sm:hidden"
        icon="save"
        label="Registrar compra"
        variant="primary"
        [disabled]="purchaseModalSaving"
        [loading]="purchaseModalSaving"
        (clicked)="purchaseFormPanel?.submitPurchase()">
      </app-icon-toolbar-button>
      <app-purchase-form-panel
        #purchaseFormPanel
        *ngIf="purchaseModalOpen"
        [initialPurchase]="editingDraftPurchase"
        [editingDraftId]="editingDraftPurchase?.id ?? null"
        (saved)="onPurchaseCreated($event)"
        (savingChange)="onPurchaseSavingChange($event)"
        (cancelled)="closePurchaseModal()">
      </app-purchase-form-panel>
    </app-transaction-modal>

    <app-transaction-detail-page
      *ngIf="detailModalOpen"
      [title]="detailModalTitle"
      [subtitle]="detailModalSubtitle"
      backLabel="Volver a compras"
      backAriaLabel="Volver a compras"
      [loading]="detailLoading"
      [hasContent]="!!detailPurchase"
      loadingMessage="Cargando compra..."
      refreshingMessage="Actualizando detalle..."
      (closeClick)="closePurchaseDetail()">
      <section main [class]="formCardClass" *ngIf="detailPurchase as purchase">
        <app-purchase-form-panel
          #detailForm
          [readOnly]="true"
          [initialPurchase]="purchase"
          [pageLayout]="true"
          [hideInlineSummary]="true">
        </app-purchase-form-panel>
      </section>

      <app-transaction-summary-panel aside *ngIf="detailForm">
        <div class="space-y-2 sm:space-y-3 mb-4">
          <app-transaction-summary-row label="Líneas" [value]="'' + detailForm.draftLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Productos (stock)" [value]="'' + detailForm.stockLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row label="Gastos / servicios" [value]="'' + detailForm.expenseLineCount"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Total compra"
            [value]="'$' + detailForm.draftTotal"
            [bold]="true"
            [divider]="true"
            size="md"></app-transaction-summary-row>
        </div>

        <div class="p-3 bg-gray-800/60 rounded-lg border border-gray-700 text-xs sm:text-sm space-y-1">
          <div class="flex justify-between gap-2">
            <span class="text-gray-400">Medio de pago</span>
            <span class="font-medium text-right">{{ detailForm.selectedMedioPagoLabel }}</span>
          </div>
          <p class="text-gray-500 leading-snug m-0">{{ detailForm.pagoResumenHint }}</p>
        </div>
      </app-transaction-summary-panel>
    </app-transaction-detail-page>
  `,
})
export class PurchasesComponent implements OnInit {
  @ViewChild('purchaseFormPanel') purchaseFormPanel?: PurchaseFormPanelComponent;
  @ViewChild('detailForm') detailForm?: PurchaseFormPanelComponent;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;
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

  purchases: Purchase[] = [];
  loading = true;
  loadingMorePurchases = false;
  purchasesHasMore = false;
  purchasesCursor: string | null = null;
  readonly serverPageSize = 80;

  searchQuery = '';
  purchasesPage = 1;

  purchaseModalOpen = false;
  purchaseModalTitle = 'Nueva compra';
  purchaseModalSaving = false;
  purchaseModalCompleted = false;
  editingDraftPurchase: Purchase | null = null;
  detailModalOpen = false;
  detailPurchase: Purchase | null = null;
  detailLoading = false;

  get detailModalTitle(): string {
    if (!this.detailPurchase) return 'Detalle de compra';
    return `Compra #${formatPurchaseLabel(this.detailPurchase)}`;
  }

  get detailModalSubtitle(): string {
    if (!this.detailPurchase) return 'Productos, gastos y pago de la compra.';
    return this.detailPurchase.proveedor?.trim() || 'Detalle completo de la compra.';
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
    this.loadPurchases();

    this.route.queryParamMap.subscribe((params) => {
      const detailId = params.get('detail');
      if (!detailId) return;
      this.openPurchaseDetailById(detailId);
    });
  }

  private tryOpenDetailFromQuery() {
    const detailId = this.route.snapshot.queryParamMap.get('detail');
    if (!detailId) return;
    this.openPurchaseDetailById(detailId);
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

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  openPurchaseModal() {
    if (prefersInlineFormPage()) {
      this.router.navigate(['/purchases/new']);
      return;
    }
    this.purchaseModalTitle = 'Nueva compra';
    this.purchaseModalSaving = false;
    this.purchaseModalCompleted = false;
    this.editingDraftPurchase = null;
    this.purchaseModalOpen = true;
  }

  openPurchaseDraftEdit(purchase: Purchase) {
    if (prefersInlineFormPage()) {
      this.router.navigate(['/purchases/new'], { queryParams: { draftId: purchase.id } });
      return;
    }
    this.editingDraftPurchase = purchase;
    this.purchaseModalTitle = 'Borrador de compra';
    this.purchaseModalSaving = false;
    this.purchaseModalCompleted = false;
    this.purchaseModalOpen = true;
  }

  onPurchaseSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.purchaseModalSaving = saving;
    });
  }

  onPurchaseCreated(event?: TransactionFormSaveEvent) {
    if (event?.draft) {
      this.purchaseModalSaving = false;
      this.purchaseModalTitle = 'Borrador de compra';
      if (event.id) {
        this.editingDraftPurchase = {
          ...(this.editingDraftPurchase ?? {}),
          id: event.id,
          estado: 'borrador',
          items: this.editingDraftPurchase?.items ?? [],
          total: this.editingDraftPurchase?.total ?? 0,
          fecha: this.editingDraftPurchase?.fecha ?? new Date().toISOString(),
        };
      }
      this.loadPurchases();
      return;
    }
    const label = event?.label || (event?.id ? formatPurchaseLabel({ id: event.id }) : '');
    this.purchaseModalTitle = label ? `Compra #${label}` : 'Compra registrada';
    this.purchaseModalSaving = false;
    this.purchaseModalCompleted = true;
    this.editingDraftPurchase = null;
    this.loadPurchases();
  }

  closePurchaseModal() {
    this.purchaseModalOpen = false;
    this.purchaseModalTitle = 'Nueva compra';
    this.purchaseModalSaving = false;
    this.purchaseModalCompleted = false;
    this.editingDraftPurchase = null;
  }

  openPurchaseDetail(purchase: Purchase) {
    if (purchase.estado === 'borrador') {
      this.openPurchaseDraftEdit(purchase);
      return;
    }
    if (!purchase.id) return;

    this.detailModalOpen = true;
    this.detailLoading = true;
    this.detailPurchase = purchase;

    this.purchaseService.getPurchase(purchase.id).subscribe({
      next: (fullPurchase) => {
        this.detailPurchase = fullPurchase;
        this.detailLoading = false;
      },
      error: () => {
        this.detailLoading = false;
        this.detailModalOpen = false;
        this.dialogService.alert({
          title: 'Servidor no disponible',
          message:
            'No se pudo cargar la compra. Ejecutá npm run dev en la raíz del proyecto y recargá la página.',
        });
      },
    });
  }

  openPurchaseDetailById(purchaseId: string) {
    const purchase = this.purchases.find((entry) => entry.id === purchaseId);
    if (purchase) {
      this.openPurchaseDetail(purchase);
      this.clearDetailQueryParam();
      return;
    }

    this.purchaseService.getPurchase(purchaseId).subscribe({
      next: (fullPurchase) => {
        this.openPurchaseDetail(fullPurchase);
        this.clearDetailQueryParam();
      },
      error: () => {
        this.clearDetailQueryParam();
      },
    });
  }

  closePurchaseDetail() {
    this.detailModalOpen = false;
    this.detailPurchase = null;
    this.detailLoading = false;
    this.clearDetailQueryParam();
  }

  private clearDetailQueryParam() {
    if (!this.route.snapshot.queryParamMap.get('detail')) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { detail: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private loadPurchases() {
    this.loading = true;
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
