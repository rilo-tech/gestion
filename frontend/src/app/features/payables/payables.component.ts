import { Component, DestroyRef, Injector, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  PayableDisplayEstado,
  PayableInstallment,
  PayableObligation,
  PayablesService,
  CardStatementSummary,
} from '../../core/services/payables.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  AppConfig,
  CatalogConfigService,
  CajaAmbitoConfig,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getCashAmbitoLabel,
  getCategoriasGasto,
  getDefaultCashAmbitoId,
  getMediosPagoActivos,
  getMedioPagoConfig,
  getTarjetasActivas,
  resolveCashAmbito,
  usesCashAmbitoSeparation,
} from '../../core/services/catalog-config.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import {
  IconActionComponent,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
} from '../../shared/components/icon-action/icon-action.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  EXPANDED_NESTED_WRAP_CLASS,
  EXPANDED_NESTED_WRAP_LEVEL2_CLASS,
  MODULE_TABLE_HEAD_CELL_NESTED_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, finalize } from 'rxjs';
import {
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import {
  ModuleDataTableComponent,
  ModuleTableBodyComponent,
  ModuleTableCellComponent,
  ModuleTableCellTextComponent,
  ModuleTableEmptyRowComponent,
  ModuleTableHeadCellComponent,
  ModuleTableHeadComponent,
  ModuleTableRowComponent,
  ModuleTableRowTone,
} from '../../shared/components/module-data-table';
import { formatMonthYearLabel } from '../../core/utils/date-format';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';
import { formatDisplayDate } from '../../core/utils/transaction-date';

type PayablesViewTab = 'month' | 'account' | 'obligation';

interface PayableInstallmentGroupSummary {
  count: number;
  purchaseCount: number;
  pendingCount: number;
  totalPending: number;
  nextDueDate: string;
  summaryEstado: PayableDisplayEstado;
}

interface PayableAccountCardHeader extends PayableInstallmentGroupSummary {
  tarjetaId: string;
  tarjetaLabel: string;
  /** Suma de todas las cuotas pendientes/vencidas de la cuenta (todos los meses). */
  totalBalancePending: number;
}

interface PayableAccountPurchaseHeader extends PayableInstallmentGroupSummary {
  obligacionId: string;
  compraId?: string;
  compraLabel?: string;
  title: string;
  subtitle: string;
}

interface PayableAccountPurchaseEntry {
  key: string;
  header: PayableAccountPurchaseHeader;
  rows: PayableInstallment[];
}

interface PayableAccountMonthStatement {
  key: string;
  mes: string;
  pendingCount: number;
  totalPending: number;
  rows: PayableInstallment[];
  purchases: PayableAccountPurchaseEntry[];
}

interface PayableAccountCardEntry {
  key: string;
  header: PayableAccountCardHeader;
  /** Cuotas del mes corriente (una por compra en el resumen del mes). */
  currentMonth: PayableAccountMonthStatement | null;
  monthStatements: PayableAccountMonthStatement[];
}

interface PayableObligationGroupHeader extends PayableInstallmentGroupSummary {
  obligacionId: string;
  beneficiario: string;
  cuotaTotal: number;
  paidCount: number;
  isPrestamo: boolean;
}

interface PayableObligationGroupEntry {
  key: string;
  header: PayableObligationGroupHeader;
  rows: PayableInstallment[];
}

@Component({
  selector: 'app-payables',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TransactionModalComponent,
    IconActionComponent,
    ModalFormFooterComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    CompactListRowComponent,
    ListSearchFieldComponent,
    ModuleDataTableComponent,
    ModuleTableHeadComponent,
    ModuleTableHeadCellComponent,
    ModuleTableBodyComponent,
    ModuleTableRowComponent,
    ModuleTableCellComponent,
    ModuleTableCellTextComponent,
    ModuleTableEmptyRowComponent,
    TransactionSaveBannerComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Cuentas a pagar"
        [showMobileSearch]="true"
        [searchQuery]="searchQuery"
        (searchQueryChange)="onSearchQueryChange($event)"
        searchFieldName="searchQueryMobile"
        activityModule="payables"
        [showRefresh]="true"
        [refreshing]="loadingInstallments"
        (refreshClick)="reloadList()">
        <p
          headerExtra
          class="hidden lg:block text-[11px] xl:text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight max-w-2xl">
          <span class="font-semibold text-gray-600 dark:text-gray-300">Aviso:</span>
          <span>
            Las compras (también las de tarjeta) entran por <span class="font-medium">Compras</span> y siempre van al ámbito <span class="font-medium">Rilo</span>.
            Si es una compra personal, registrala acá con <span class="font-medium">Nuevo gasto</span> y elegí el ámbito <span class="font-medium">Personal</span>.
            En <span class="font-medium">Por mes</span> ves vencimientos del mes (gastos fijos, servicios y cuotas);
            en <span class="font-medium">Por cuenta</span>, tarjetas y resúmenes; en
            <span class="font-medium">Préstamos</span>, solo los creados con «Nuevo préstamo».
          </span>
        </p>
        <div headerActions class="hidden sm:contents">
          <app-icon-action label="Nuevo préstamo" (clicked)="openLoanModal()">
            <i-lucide name="credit-card" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Nuevo gasto" (clicked)="openCreateModal()">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
        <div headerActions class="relative shrink-0 sm:hidden">
          <button
            type="button"
            (click)="togglePayablesCreateMenu($event)"
            [attr.aria-expanded]="payablesCreateMenuOpen"
            aria-haspopup="menu"
            aria-label="Nuevo préstamo o gasto"
            [class]="payablesCreateMenuButtonClass">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </button>
          <div
            *ngIf="payablesCreateMenuOpen"
            class="fixed inset-0 z-10"
            aria-hidden="true"
            (click)="closePayablesCreateMenu()"></div>
          <div
            *ngIf="payablesCreateMenuOpen"
            role="menu"
            class="absolute right-0 top-full z-20 mt-1 min-w-[10.5rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              (click)="openLoanFromMenu()"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
              <i-lucide name="credit-card" class="w-4 h-4 shrink-0 text-teal-600"></i-lucide>
              Préstamo
            </button>
            <button
              type="button"
              role="menuitem"
              (click)="openExpenseFromMenu()"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
              <i-lucide name="receipt" class="w-4 h-4 shrink-0 text-teal-600"></i-lucide>
              Gasto
            </button>
          </div>
        </div>
      </app-module-page-header>

      <div *ngIf="usesAmbitoSeparation" class="hidden sm:block mb-6 sm:mb-8">
        <div [class]="payablesTabRowClass + ' border-b border-gray-200 dark:border-gray-700'">
          <button
            *ngFor="let ambito of cajaAmbitos"
            type="button"
            (click)="setActiveAmbito(ambito.id)"
            [class]="payablesTabButtonClass"
            [class.border-teal-600]="activeAmbitoTab === ambito.id"
            [class.text-teal-700]="activeAmbitoTab === ambito.id"
            [class.dark:text-teal-400]="activeAmbitoTab === ambito.id"
            [class.bg-teal-50]="activeAmbitoTab === ambito.id"
            [class.dark:bg-teal-950]="activeAmbitoTab === ambito.id"
            [class.border-transparent]="activeAmbitoTab !== ambito.id"
            [class.text-gray-500]="activeAmbitoTab !== ambito.id"
            [class.dark:text-gray-400]="activeAmbitoTab !== ambito.id">
            {{ ambito.label }}
          </button>
        </div>
      </div>

      <div class="module-summary-kpis grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ kpiScopePrefix }}Pendientes
          </p>
          <p class="text-xl sm:text-2xl font-bold text-amber-600 tabular-nums">{{ countPendientes }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-red-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ kpiScopePrefix }}Vencidas
          </p>
          <p class="text-xl sm:text-2xl font-bold text-red-600 tabular-nums">{{ countVencidas }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ kpiScopePrefix }}Pagadas
          </p>
          <p class="text-xl sm:text-2xl font-bold text-teal-600 tabular-nums">{{ countPagadas }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm col-span-2 lg:col-span-1">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ kpiScopePrefix }}Total pendiente
          </p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatMoney(totalPendiente) }}</p>
        </div>
      </div>

      <app-compact-data-list [showSearch]="true" class="block mb-4 sm:mb-6">
        <div listSearch class="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
          <div class="border-b border-gray-200 dark:border-gray-700">
            <div
              *ngIf="usesAmbitoSeparation"
              [class]="payablesTabRowClass + ' px-2 pt-1.5 sm:hidden'">
              <button
                *ngFor="let ambito of cajaAmbitos"
                type="button"
                (click)="setActiveAmbito(ambito.id)"
                [class]="payablesTabButtonClass"
                [class.border-teal-600]="activeAmbitoTab === ambito.id"
                [class.text-teal-700]="activeAmbitoTab === ambito.id"
                [class.dark:text-teal-400]="activeAmbitoTab === ambito.id"
                [class.bg-teal-50]="activeAmbitoTab === ambito.id"
                [class.dark:bg-teal-950]="activeAmbitoTab === ambito.id"
                [class.border-transparent]="activeAmbitoTab !== ambito.id"
                [class.text-gray-500]="activeAmbitoTab !== ambito.id"
                [class.dark:text-gray-400]="activeAmbitoTab !== ambito.id">
                {{ ambito.label }}
              </button>
            </div>
            <div [class]="payablesTabRowClass + ' px-2 pt-1 pb-0 sm:px-6 sm:pt-3 sm:pb-0'">
              <button
                type="button"
                (click)="setViewTab('month')"
                [class]="payablesTabButtonClass"
                [class.border-teal-600]="viewTab === 'month'"
                [class.text-teal-700]="viewTab === 'month'"
                [class.dark:text-teal-400]="viewTab === 'month'"
                [class.bg-teal-50]="viewTab === 'month'"
                [class.dark:bg-teal-950]="viewTab === 'month'"
                [class.border-transparent]="viewTab !== 'month'"
                [class.text-gray-500]="viewTab !== 'month'"
                [class.dark:text-gray-400]="viewTab !== 'month'">
                Por mes
              </button>
              <button
                type="button"
                (click)="setViewTab('account')"
                [class]="payablesTabButtonClass"
                [class.border-teal-600]="viewTab === 'account'"
                [class.text-teal-700]="viewTab === 'account'"
                [class.dark:text-teal-400]="viewTab === 'account'"
                [class.bg-teal-50]="viewTab === 'account'"
                [class.dark:bg-teal-950]="viewTab === 'account'"
                [class.border-transparent]="viewTab !== 'account'"
                [class.text-gray-500]="viewTab !== 'account'"
                [class.dark:text-gray-400]="viewTab !== 'account'">
                Por cuenta
              </button>
              <button
                type="button"
                (click)="setViewTab('obligation')"
                [class]="payablesTabButtonClass"
                [class.border-teal-600]="viewTab === 'obligation'"
                [class.text-teal-700]="viewTab === 'obligation'"
                [class.dark:text-teal-400]="viewTab === 'obligation'"
                [class.bg-teal-50]="viewTab === 'obligation'"
                [class.dark:bg-teal-950]="viewTab === 'obligation'"
                [class.border-transparent]="viewTab !== 'obligation'"
                [class.text-gray-500]="viewTab !== 'obligation'"
                [class.dark:text-gray-400]="viewTab !== 'obligation'">
                Préstamos
              </button>
            </div>
          </div>
          <div class="sm:hidden px-2 py-2 border-b border-gray-100 dark:border-gray-800 space-y-2">
            <ng-container *ngIf="viewTab === 'month'">
              <div>
                <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Estado
                </label>
                <select
                  [(ngModel)]="mesEstadoFilter"
                  (ngModelChange)="onMesEstadoFilterChange()"
                  name="mesEstadoFilterMobile"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
                  <option *ngFor="let opt of mesEstadoFilterOptions" [ngValue]="opt.value">{{ opt.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Mes
                </label>
                <input
                  type="month"
                  [(ngModel)]="mesFilter"
                  name="mesFilterMobile"
                  (ngModelChange)="onMesFilterChange()"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  title="Mes de vencimiento" />
              </div>
            </ng-container>
            <ng-container *ngIf="viewTab !== 'month'">
            <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
              {{ viewTab === 'account' ? 'Cuenta' : 'Prestamista' }}
            </label>
            <select
              *ngIf="viewTab === 'account'"
              [(ngModel)]="cuentaFilter"
              (ngModelChange)="onCuentaFilterChange()"
              name="cuentaFilterMobile"
              class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
              <option [ngValue]="''">Todas las cuentas</option>
              <option *ngFor="let t of tarjetaFilterOptions" [ngValue]="t.id">{{ t.label }}</option>
            </select>
            <select
              *ngIf="viewTab === 'obligation'"
              [(ngModel)]="obligacionFilter"
              (ngModelChange)="onObligacionFilterChange()"
              name="obligacionFilterMobile"
              class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
              <option [ngValue]="''">Todos los préstamos</option>
              <option *ngFor="let o of obligacionFilterOptions" [ngValue]="o.id">{{ o.label }}</option>
            </select>
            </ng-container>
          </div>
          <div [class]="desktopListSearchWrapClass + ' border-0 hidden sm:block'">
            <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div class="sm:flex-1 sm:min-w-[12rem]">
                <app-list-search-field
                  mode="filter"
                  [query]="searchQuery"
                  (queryChange)="onSearchQueryChange($event)"
                  name="searchQuery"
                  [placeholder]="viewTab === 'month' ? 'Buscar cuota, cuenta, compra...' : (viewTab === 'account' ? 'Buscar cuenta o compra...' : 'Buscar préstamo o cuota...')"
                  extraClass="w-full">
                </app-list-search-field>
              </div>
              <div class="flex shrink-0 flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 sm:pl-4 sm:border-l border-gray-200 dark:border-gray-700">
                <select
                  *ngIf="viewTab === 'month'"
                  [(ngModel)]="mesEstadoFilter"
                  (ngModelChange)="onMesEstadoFilterChange()"
                  name="mesEstadoFilter"
                  class="w-full sm:w-auto min-w-[9.5rem] px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500"
                  title="Estado de la cuota">
                  <option *ngFor="let opt of mesEstadoFilterOptions" [ngValue]="opt.value">{{ opt.label }}</option>
                </select>
                <input
                  *ngIf="viewTab === 'month'"
                  type="month"
                  [(ngModel)]="mesFilter"
                  name="mesFilter"
                  (ngModelChange)="onMesFilterChange()"
                  class="w-full sm:w-auto min-w-[10.5rem] px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  title="Mes de vencimiento" />
                <select
                  *ngIf="viewTab === 'account'"
                  [(ngModel)]="cuentaFilter"
                  (ngModelChange)="onCuentaFilterChange()"
                  name="cuentaFilter"
                  class="w-full sm:w-auto min-w-[12rem] px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
                  <option [ngValue]="''">Todas las cuentas</option>
                  <option *ngFor="let t of tarjetaFilterOptions" [ngValue]="t.id">{{ t.label }}</option>
                </select>
                <select
                  *ngIf="viewTab === 'obligation'"
                  [(ngModel)]="obligacionFilter"
                  (ngModelChange)="onObligacionFilterChange()"
                  name="obligacionFilter"
                  class="w-full sm:w-auto min-w-[12rem] px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
                  <option [ngValue]="''">Todos los préstamos</option>
                  <option *ngFor="let o of obligacionFilterOptions" [ngValue]="o.id">{{ o.label }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <ng-container *ngIf="viewTab === 'month'">
            <app-compact-list-row
              *ngFor="let row of monthViewInstallments"
              (activate)="openInstallmentEdit(row)"
              [disabled]="!canOpenInstallmentEdit(row) || savingCuotaId === row.id">
              <div compactTitle class="compact-list-title font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 min-w-0">
                <span class="truncate min-w-0">{{ installmentCuentaLabel(row) }}</span>
                <span
                  class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                  [ngClass]="estadoBadgeClass(row.displayEstado)">
                  {{ estadoLabel(row.displayEstado) }}
                </span>
              </div>
              <div compactSubtitle class="compact-list-subtitle truncate">
                {{ formatDate(row.fechaVencimiento) }} · {{ cuotaLabel(row) }} · {{ installmentDetalleDisplayLabel(row) }}
              </div>
              <span compactTrailing class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100 whitespace-nowrap">{{ formatMoney(row.monto) }}</span>
              <span
                *ngIf="row.displayEstado !== 'pagada'"
                compactTrailing
                role="button"
                tabindex="0"
                (click)="togglePaid(row); $event.stopPropagation()"
                (keydown.enter)="togglePaid(row); $event.stopPropagation()"
                [class.opacity-50]="savingCuotaId === row.id"
                class="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap">
                Pago
              </span>
              <span
                *ngIf="row.displayEstado === 'pagada'"
                compactTrailing
                role="button"
                tabindex="0"
                (click)="togglePaid(row); $event.stopPropagation()"
                (keydown.enter)="togglePaid(row); $event.stopPropagation()"
                [class.opacity-50]="savingCuotaId === row.id"
                class="text-[10px] font-semibold text-gray-500 hover:underline whitespace-nowrap">
                Deshacer
              </span>
            </app-compact-list-row>
            <p *ngIf="loadingInstallments" [class]="compactListEmptyClass">Cargando vencimientos...</p>
            <p *ngIf="!loadingInstallments && !mesFilter" [class]="compactListEmptyClass">
              Elegí un mes para ver las cuotas.
            </p>
            <p *ngIf="!loadingInstallments && mesFilter && monthViewInstallments.length === 0" [class]="compactListEmptyClass">
              {{ emptyMonthViewMessage }}
            </p>
          </ng-container>

          <ng-container *ngIf="viewTab === 'account'">
            <ng-container *ngFor="let card of accountViewCards">
              <app-compact-list-row (activate)="toggleAccountCardExpand(card.key)">
                <div compactTitle class="compact-list-title truncate font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                  <i-lucide
                    [name]="isAccountCardExpanded(card.key) ? 'chevron-down' : 'chevron-right'"
                    class="w-3.5 h-3.5 shrink-0 text-gray-400"></i-lucide>
                  {{ card.header.tarjetaLabel }}
                </div>
                <div compactSubtitle class="compact-list-subtitle truncate">
                  {{ accountCardSubtitle(card) }}
                </div>
                <div compactTrailing class="flex flex-col items-end gap-1 shrink-0">
                  <ng-container *ngIf="cardNextResumenStatement(card) as nextStmt; else accountCardTotalPendingMobile">
                    <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {{ formatMoney(nextStmt.totalPending) }}
                    </span>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 capitalize">{{ formatMes(nextStmt.mes) }}</span>
                  </ng-container>
                  <ng-template #accountCardTotalPendingMobile>
                    <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {{ formatMoney(card.header.totalPending) }}
                    </span>
                  </ng-template>
                  <button
                    *ngIf="card.header.pendingCount > 0"
                    type="button"
                    (click)="openPayCardStatementForCard(card); $event.stopPropagation()"
                    class="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap text-right">
                    Pagar
                  </button>
                  <span
                    *ngIf="card.header.pendingCount === 0"
                    class="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                    [ngClass]="estadoBadgeClass(card.header.summaryEstado)">
                    Al día
                  </span>
                </div>
              </app-compact-list-row>

              <div
                *ngIf="isAccountCardExpanded(card.key)"
                class="border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/30">
                <div [class]="expandedNestedWrapClass">
                  <p
                    *ngIf="card.currentMonth as stmt"
                    class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 m-0 border-b border-gray-100 dark:border-gray-800">
                    Resumen {{ formatMes(stmt.mes) }} · {{ formatMoney(stmt.totalPending) }} pend.
                  </p>
                  <app-compact-list-row
                    *ngFor="let row of card.currentMonth?.rows ?? []"
                    (activate)="onAccountCurrentMonthRowActivate(row)"
                    [disabled]="savingCuotaId === row.id">
                    <div compactTitle class="compact-list-title text-gray-800 dark:text-gray-200 flex items-center gap-1.5 min-w-0">
                      <span class="truncate min-w-0">{{ accountCurrentMonthRowTitle(row) }}</span>
                      <span
                        class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                        [ngClass]="estadoBadgeClass(row.displayEstado)">
                        {{ estadoLabel(row.displayEstado) }}
                      </span>
                    </div>
                    <div compactSubtitle class="compact-list-subtitle truncate">
                      {{ installmentCuotaCompraLabel(row) }} · vence {{ formatDate(row.fechaVencimiento) }}
                    </div>
                    <span compactTrailing class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {{ formatMoney(row.monto) }}
                    </span>
                    <span
                      *ngIf="row.displayEstado !== 'pagada'"
                      compactTrailing
                      role="button"
                      tabindex="0"
                      (click)="togglePaid(row); $event.stopPropagation()"
                      (keydown.enter)="togglePaid(row); $event.stopPropagation()"
                      [class.opacity-50]="savingCuotaId === row.id"
                      class="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap">
                      Pago
                    </span>
                    <span
                      *ngIf="row.displayEstado === 'pagada'"
                      compactTrailing
                      role="button"
                      tabindex="0"
                      (click)="togglePaid(row); $event.stopPropagation()"
                      (keydown.enter)="togglePaid(row); $event.stopPropagation()"
                      [class.opacity-50]="savingCuotaId === row.id"
                      class="text-[10px] font-semibold text-gray-500 hover:underline whitespace-nowrap">
                      Deshacer
                    </span>
                  </app-compact-list-row>
                  <p
                    *ngIf="isAccountCardExpanded(card.key) && !card.currentMonth"
                    class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 m-0">
                    No hay cuotas en {{ formatMes(accountViewMesKey()) }} para esta cuenta.
                  </p>
                </div>
              </div>
            </ng-container>
            <p *ngIf="loadingInstallments" [class]="compactListEmptyClass">Cargando vencimientos...</p>
            <p *ngIf="!loadingInstallments && accountViewCards.length === 0" [class]="compactListEmptyClass">
              {{ emptyAccountViewMessage }}
            </p>
          </ng-container>

          <ng-container *ngIf="viewTab === 'obligation'">
            <ng-container *ngFor="let group of obligationViewGroups">
              <app-compact-list-row
                (activate)="toggleObligationExpand(group.key)">
                <div compactTitle class="compact-list-title font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 min-w-0">
                  <i-lucide
                    [name]="isObligationExpanded(group.key) ? 'chevron-down' : 'chevron-right'"
                    class="w-3.5 h-3.5 shrink-0 text-gray-400"></i-lucide>
                  <span class="truncate min-w-0">{{ group.header.beneficiario }}</span>
                  <span
                    *ngIf="group.header.isPrestamo"
                    class="inline-flex shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
                    Préstamo
                  </span>
                  <span
                    class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                    [ngClass]="estadoBadgeClass(group.header.summaryEstado)">
                    {{ estadoLabel(group.header.summaryEstado) }}
                  </span>
                </div>
                <div compactSubtitle class="compact-list-subtitle truncate">
                  {{ obligationGroupSubtitle(group) }}
                </div>
                <div compactTrailing class="shrink-0">
                  <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{{ formatMoney(group.header.totalPending) }}</span>
                </div>
              </app-compact-list-row>

              <div
                *ngIf="isObligationExpanded(group.key)"
                class="border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/30">
                <div [class]="expandedNestedWrapClass">
                  <app-compact-list-row
                    *ngFor="let row of group.rows"
                    (activate)="onMobileInstallmentActivate(row)"
                    [disabled]="savingCuotaId === row.id">
                    <div compactTitle class="compact-list-title text-gray-800 dark:text-gray-200 flex items-center gap-1.5 min-w-0">
                      <span class="truncate min-w-0">{{ cuotaLabel(row) }} · {{ formatDate(row.fechaVencimiento) }}</span>
                      <span
                        class="inline-flex shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                        [ngClass]="estadoBadgeClass(row.displayEstado)">
                        {{ estadoLabel(row.displayEstado) }}
                      </span>
                    </div>
                    <div compactSubtitle class="compact-list-subtitle truncate">
                      {{ installmentDetalleDisplayLabel(row) }}
                    </div>
                    <span compactTrailing class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100 whitespace-nowrap">{{ formatMoney(row.monto) }}</span>
                    <span
                      *ngIf="row.displayEstado !== 'pagada'"
                      compactTrailing
                      role="button"
                      tabindex="0"
                      (click)="togglePaid(row); $event.stopPropagation()"
                      (keydown.enter)="togglePaid(row); $event.stopPropagation()"
                      [class.opacity-50]="savingCuotaId === row.id"
                      class="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap">
                      Pago
                    </span>
                  </app-compact-list-row>
                  <p
                    *ngIf="group.rows.length === 0"
                    class="py-2 text-xs text-gray-500 dark:text-gray-400">
                    Sin cuotas pendientes.
                  </p>
                </div>
              </div>
            </ng-container>

            <p *ngIf="loadingInstallments" [class]="compactListEmptyClass">Cargando vencimientos...</p>
            <p *ngIf="!loadingInstallments && obligationViewGroups.length === 0" [class]="compactListEmptyClass">
              {{ emptyObligationViewMessage }}
            </p>
          </ng-container>
        </div>

        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
          <app-module-data-table
            *ngIf="viewTab === 'month'"
            minWidthClass="min-w-[52rem]">
            <colgroup>
              <col style="width: 3.25rem" />
              <col style="width: 10rem" />
              <col style="width: 14rem" />
              <col style="width: 4.75rem" />
              <col style="width: 5.5rem" />
              <col style="width: 6rem" />
              <col style="width: 5.5rem" />
            </colgroup>
            <thead app-module-table-head>
              <th app-module-table-head-cell align="right" [nowrap]="true">Cuota</th>
              <th app-module-table-head-cell>Cuenta</th>
              <th app-module-table-head-cell>Detalle</th>
              <th app-module-table-head-cell [nowrap]="true">Vencimiento</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Monto</th>
              <th app-module-table-head-cell>Estado</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Acción</th>
            </thead>
            <tbody app-module-table-body>
              <tr app-module-table-row
                *ngFor="let row of monthViewInstallments"
                [tone]="installmentRowTone(row)"
                [clickable]="canOpenInstallmentEdit(row)"
                (click)="openInstallmentEdit(row)">
                <td app-module-table-cell align="right" [nowrap]="true" extraClass="tabular-nums text-gray-700 max-w-0">
                  {{ cuotaLabel(row) }}
                </td>
                <td app-module-table-cell extraClass="max-w-0 overflow-hidden">
                  <span class="block truncate font-medium text-gray-900 dark:text-gray-100" [title]="installmentCuentaLabel(row)">
                    {{ installmentCuentaLabel(row) }}
                  </span>
                </td>
                <td app-module-table-cell extraClass="max-w-0 overflow-hidden">
                  <span class="block truncate text-gray-600 dark:text-gray-400" [title]="installmentDetalleDisplayLabel(row)">
                    {{ installmentDetalleDisplayLabel(row) }}
                  </span>
                </td>
                <td app-module-table-cell [nowrap]="true" extraClass="tabular-nums">
                  <span
                    [class.text-red-700]="row.displayEstado === 'vencida'"
                    [class.font-semibold]="row.displayEstado === 'vencida'">
                    {{ formatDate(row.fechaVencimiento) }}
                  </span>
                </td>
                <td app-module-table-cell align="right" [nowrap]="true" extraClass="font-semibold tabular-nums">
                  {{ formatMoney(row.monto) }}
                </td>
                <td app-module-table-cell>
                  <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold" [ngClass]="estadoBadgeClass(row.displayEstado)">
                    {{ estadoLabel(row.displayEstado) }}
                  </span>
                </td>
                <td app-module-table-cell align="right">
                  <button
                    *ngIf="row.displayEstado !== 'pagada'"
                    type="button"
                    (click)="togglePaid(row); $event.stopPropagation()"
                    [disabled]="savingCuotaId === row.id"
                    class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50">
                    Pago
                  </button>
                  <button
                    *ngIf="row.displayEstado === 'pagada'"
                    type="button"
                    (click)="togglePaid(row); $event.stopPropagation()"
                    [disabled]="savingCuotaId === row.id"
                    class="text-xs font-semibold text-gray-500 hover:underline whitespace-nowrap disabled:opacity-50">
                    Deshacer pago
                  </button>
                </td>
              </tr>
              <tr app-module-table-empty-row *ngIf="loadingInstallments" [colspan]="7">Cargando vencimientos...</tr>
              <tr app-module-table-empty-row *ngIf="!loadingInstallments && !mesFilter" [colspan]="7">
                Elegí un mes para ver las cuotas de todas las cuentas.
              </tr>
              <tr app-module-table-empty-row *ngIf="!loadingInstallments && mesFilter && monthViewInstallments.length === 0" [colspan]="7">
                {{ emptyMonthViewMessage }}
              </tr>
            </tbody>
          </app-module-data-table>

          <app-module-data-table
            *ngIf="viewTab === 'account'"
            minWidthClass="min-w-[920px]">
            <colgroup>
              <col class="w-[2.5rem]" />
              <col class="w-[10rem]" />
              <col class="w-[13rem]" />
              <col class="w-[6.5rem]" />
              <col class="w-[7rem]" />
              <col class="w-[6.5rem]" />
              <col class="w-[5.5rem]" />
            </colgroup>
            <thead app-module-table-head>
              <th app-module-table-head-cell></th>
              <th app-module-table-head-cell>Cuenta</th>
              <th app-module-table-head-cell>Resumen</th>
              <th app-module-table-head-cell [nowrap]="true">Próx. venc.</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Próx. resumen</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Total pendiente</th>
              <th app-module-table-head-cell align="right">Acción</th>
            </thead>
            <tbody app-module-table-body>
              <ng-container *ngFor="let card of accountViewCards">
                <tr
                  app-module-table-row
                  tone="group"
                  [clickable]="true"
                  (click)="toggleAccountCardExpand(card.key)">
                  <td app-module-table-cell align="center" extraClass="w-10">
                    <i-lucide
                      [name]="isAccountCardExpanded(card.key) ? 'chevron-down' : 'chevron-right'"
                      class="w-4 h-4 text-gray-500 mx-auto"></i-lucide>
                  </td>
                  <td app-module-table-cell>
                    <span class="font-medium text-gray-900 dark:text-gray-100 truncate block">{{ card.header.tarjetaLabel }}</span>
                  </td>
                  <td app-module-table-cell extraClass="text-gray-600 text-sm min-w-0">
                    <span class="block truncate" [title]="accountCardSubtitle(card)">
                      {{ accountCardSubtitle(card) }}
                    </span>
                  </td>
                  <td app-module-table-cell [nowrap]="true" extraClass="tabular-nums text-gray-700 whitespace-nowrap">
                    <span
                      *ngIf="card.header.nextDueDate"
                      [class.text-red-700]="card.header.summaryEstado === 'vencida'"
                      [class.font-semibold]="card.header.summaryEstado === 'vencida'">
                      {{ formatDate(card.header.nextDueDate) }}
                    </span>
                    <span *ngIf="!card.header.nextDueDate" class="text-gray-400">—</span>
                  </td>
                  <td app-module-table-cell align="right" [nowrap]="true" extraClass="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    <ng-container *ngIf="cardNextResumenStatement(card) as nextStmt; else accountCardTotalPendingDesktop">
                      <span class="block">{{ formatMoney(nextStmt.totalPending) }}</span>
                      <span class="block text-[10px] font-normal text-gray-500 dark:text-gray-400 capitalize">{{ formatMes(nextStmt.mes) }}</span>
                    </ng-container>
                    <ng-template #accountCardTotalPendingDesktop>
                      {{ formatMoney(card.header.totalPending) }}
                    </ng-template>
                  </td>
                  <td app-module-table-cell align="right" [nowrap]="true" extraClass="font-semibold tabular-nums text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {{ formatMoney(card.header.totalBalancePending) }}
                  </td>
                  <td app-module-table-cell align="right">
                    <button
                      *ngIf="card.header.pendingCount > 0"
                      type="button"
                      (click)="openPayCardStatementForCard(card); $event.stopPropagation()"
                      class="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap">
                      Pagar
                    </button>
                    <span
                      *ngIf="card.header.pendingCount === 0"
                      class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold"
                      [ngClass]="estadoBadgeClass(card.header.summaryEstado)">
                      Al día
                    </span>
                  </td>
                </tr>

                <tr *ngIf="isAccountCardExpanded(card.key)">
                  <td colspan="7" class="p-0 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40">
                    <div [class]="expandedNestedWrapClass">
                      <p
                        *ngIf="card.currentMonth as stmt"
                        class="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 m-0 border-b border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-900/50">
                        Resumen {{ formatMes(stmt.mes) }} · {{ stmt.rows.length }} compra(s) · {{ formatMoney(stmt.totalPending) }} pend.
                      </p>
                      <table
                        *ngIf="card.currentMonth as stmt"
                        [class]="nativeCompactTableClass + ' module-table-nested module-data-table-layout w-full max-w-5xl'">
                        <thead>
                          <tr class="bg-gray-100/80 dark:bg-gray-800/60">
                            <th [class]="moduleTableHeadNestedClass">Compra</th>
                            <th [class]="moduleTableHeadNestedClass + ' text-right'">Cuota</th>
                            <th [class]="moduleTableHeadNestedClass">Venc.</th>
                            <th [class]="moduleTableHeadNestedClass + ' text-right'">Monto</th>
                            <th [class]="moduleTableHeadNestedClass">Estado</th>
                            <th [class]="moduleTableHeadNestedClass + ' text-right'">Acción</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
                          <tr
                            app-module-table-row
                            *ngFor="let row of stmt.rows"
                            [tone]="installmentRowTone(row)"
                            [hover]="canOpenInstallmentEdit(row)"
                            [clickable]="canOpenInstallmentEdit(row)"
                            (click)="openInstallmentEdit(row)">
                            <td app-module-table-cell nested extraClass="font-medium text-gray-900 dark:text-gray-100">
                              {{ accountCurrentMonthRowTitle(row) }}
                            </td>
                            <td app-module-table-cell nested align="right" [nowrap]="true" extraClass="tabular-nums text-gray-700">
                              {{ cuotaLabel(row) }}
                            </td>
                            <td app-module-table-cell nested [nowrap]="true" extraClass="tabular-nums">
                              <span
                                [class.text-red-700]="row.displayEstado === 'vencida'"
                                [class.font-semibold]="row.displayEstado === 'vencida'">
                                {{ formatDate(row.fechaVencimiento) }}
                              </span>
                            </td>
                            <td app-module-table-cell nested align="right" [nowrap]="true" extraClass="font-semibold tabular-nums">
                              {{ formatMoney(row.monto) }}
                            </td>
                            <td app-module-table-cell nested>
                              <span class="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold" [ngClass]="estadoBadgeClass(row.displayEstado)">
                                {{ estadoLabel(row.displayEstado) }}
                              </span>
                            </td>
                            <td app-module-table-cell nested align="right">
                              <button
                                *ngIf="row.displayEstado !== 'pagada'"
                                type="button"
                                (click)="togglePaid(row); $event.stopPropagation()"
                                [disabled]="savingCuotaId === row.id"
                                class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50">
                                Pago
                              </button>
                              <button
                                *ngIf="row.displayEstado === 'pagada'"
                                type="button"
                                (click)="togglePaid(row); $event.stopPropagation()"
                                [disabled]="savingCuotaId === row.id"
                                class="text-xs font-semibold text-gray-500 hover:underline whitespace-nowrap disabled:opacity-50">
                                Deshacer pago
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p
                        *ngIf="!card.currentMonth"
                        class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 m-0">
                        No hay cuotas en {{ formatMes(accountViewMesKey()) }} para esta cuenta.
                      </p>
                    </div>
                  </td>
                </tr>
              </ng-container>

              <tr app-module-table-empty-row *ngIf="loadingInstallments" [colspan]="7">
                Cargando vencimientos...
              </tr>
              <tr app-module-table-empty-row *ngIf="!loadingInstallments && accountViewCards.length === 0" [colspan]="7">
                {{ emptyAccountViewMessage }}
              </tr>
            </tbody>
          </app-module-data-table>

          <app-module-data-table
            *ngIf="viewTab === 'obligation'"
            minWidthClass="min-w-[760px]">
            <colgroup>
              <col class="w-[2.5rem]" />
              <col class="w-[11rem]" />
              <col class="w-[10rem]" />
              <col class="w-[7rem]" />
              <col class="w-[6.5rem]" />
              <col class="w-[7.5rem]" />
            </colgroup>
            <thead app-module-table-head>
              <th app-module-table-head-cell></th>
              <th app-module-table-head-cell>Prestamista</th>
              <th app-module-table-head-cell [nowrap]="true">Resumen</th>
              <th app-module-table-head-cell [nowrap]="true">Próx. venc.</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Pendiente</th>
              <th app-module-table-head-cell align="right">Acción</th>
            </thead>
            <tbody app-module-table-body>
              <ng-container *ngFor="let group of obligationViewGroups">
                <tr
                  app-module-table-row
                  tone="group"
                  [clickable]="true"
                  (click)="toggleObligationExpand(group.key)">
                  <td app-module-table-cell align="center" extraClass="w-10">
                    <i-lucide
                      [name]="isObligationExpanded(group.key) ? 'chevron-down' : 'chevron-right'"
                      class="w-4 h-4 text-gray-500 mx-auto"></i-lucide>
                  </td>
                  <td app-module-table-cell>
                    <span class="font-medium text-gray-900 dark:text-gray-100 truncate block">{{ group.header.beneficiario }}</span>
                    <span
                      *ngIf="group.header.isPrestamo"
                      class="inline-flex mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-violet-100 text-violet-800">
                      Préstamo
                    </span>
                  </td>
                  <td app-module-table-cell [nowrap]="true" extraClass="text-gray-600 text-sm whitespace-nowrap">
                    {{ obligationGroupSubtitle(group) }}
                  </td>
                  <td app-module-table-cell [nowrap]="true" extraClass="tabular-nums">
                    {{ group.header.nextDueDate ? formatDate(group.header.nextDueDate) : '—' }}
                  </td>
                  <td app-module-table-cell align="right" [nowrap]="true" extraClass="font-semibold tabular-nums">
                    {{ formatMoney(group.header.totalPending) }}
                  </td>
                  <td app-module-table-cell align="right">
                    <span
                      class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold"
                      [ngClass]="estadoBadgeClass(group.header.summaryEstado)">
                      {{ estadoLabel(group.header.summaryEstado) }}
                    </span>
                  </td>
                </tr>
                <tr *ngIf="isObligationExpanded(group.key)" app-module-table-row tone="nested">
                  <td app-module-table-cell nested [attr.colspan]="6" extraClass="!p-0 bg-gray-50/80 dark:bg-gray-900/30">
                    <div [class]="expandedNestedWrapClass">
                      <table [class]="nativeCompactTableClass + ' module-table-nested module-data-table-layout w-full max-w-4xl'">
                      <colgroup>
                        <col style="width: 3.25rem" />
                        <col style="width: 4.75rem" />
                        <col />
                        <col style="width: 5.5rem" />
                        <col style="width: 6rem" />
                        <col style="width: 5.5rem" />
                      </colgroup>
                      <thead>
                        <tr class="bg-gray-100/80 dark:bg-gray-800/60">
                          <th [class]="moduleTableHeadNestedClass + ' text-right'">Cuota</th>
                          <th [class]="moduleTableHeadNestedClass">Venc.</th>
                          <th [class]="moduleTableHeadNestedClass">Detalle</th>
                          <th [class]="moduleTableHeadNestedClass + ' text-right'">Monto</th>
                          <th [class]="moduleTableHeadNestedClass">Estado</th>
                          <th [class]="moduleTableHeadNestedClass + ' text-right'">Acción</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
                        <tr
                          app-module-table-row
                          *ngFor="let row of group.rows"
                          [tone]="installmentRowTone(row)"
                          [hover]="canOpenInstallmentEdit(row)"
                          [clickable]="canOpenInstallmentEdit(row)"
                          (click)="openInstallmentEdit(row)">
                          <td app-module-table-cell nested align="right" [nowrap]="true" extraClass="tabular-nums text-gray-700">
                            {{ cuotaLabel(row) }}
                          </td>
                          <td app-module-table-cell nested [nowrap]="true" extraClass="tabular-nums">
                            <span
                              [class.text-red-700]="row.displayEstado === 'vencida'"
                              [class.font-semibold]="row.displayEstado === 'vencida'">
                              {{ formatDate(row.fechaVencimiento) }}
                            </span>
                          </td>
                          <td app-module-table-cell nested extraClass="text-gray-600 text-sm max-w-0 truncate">
                            {{ installmentDetalleDisplayLabel(row) }}
                          </td>
                          <td app-module-table-cell nested align="right" [nowrap]="true" extraClass="font-semibold tabular-nums">
                            {{ formatMoney(row.monto) }}
                          </td>
                          <td app-module-table-cell nested>
                            <span class="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold" [ngClass]="estadoBadgeClass(row.displayEstado)">
                              {{ estadoLabel(row.displayEstado) }}
                            </span>
                          </td>
                          <td app-module-table-cell nested align="right">
                            <button
                              *ngIf="row.displayEstado !== 'pagada'"
                              type="button"
                              (click)="togglePaid(row); $event.stopPropagation()"
                              [disabled]="savingCuotaId === row.id"
                              class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50">
                              Pago
                            </button>
                          </td>
                        </tr>
                        <tr *ngIf="group.rows.length === 0">
                          <td [attr.colspan]="6" class="px-4 py-3 text-xs text-gray-500">Sin cuotas pendientes.</td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </td>
                </tr>
              </ng-container>
              <tr app-module-table-empty-row *ngIf="loadingInstallments" [colspan]="6">Cargando vencimientos...</tr>
              <tr app-module-table-empty-row *ngIf="!loadingInstallments && obligationViewGroups.length === 0" [colspan]="6">
                {{ emptyObligationViewMessage }}
              </tr>
            </tbody>
          </app-module-data-table>
        </div>
      </app-compact-data-list>

      <div *ngIf="mensualObligations.length > 0" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-900">Gastos fijos mensuales</h2>
          <p class="text-xs text-gray-500 mt-1">Sueldos, servicios y otros pagos que se repiten cada mes.</p>
        </div>
        <div [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:min-w-[560px]'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Beneficiario</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Monto</th>
                <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Primer venc.</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Estado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let item of mensualObligations"
                class="hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer"
                (click)="openMensualObligationEdit(item)">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{{ item.beneficiario }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-gray-100">{{ formatMoney(item.monto) }}</td>
                <td class="hidden sm:table-cell px-6 py-3 text-sm text-gray-600 dark:text-gray-300">{{ formatDate(item.fechaPrimerVencimiento) }}</td>
                <td class="px-4 sm:px-6 py-3">
                  <span
                    class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold"
                    [class.bg-teal-100]="item.activo"
                    [class.text-teal-800]="item.activo"
                    [class.bg-gray-100]="!item.activo"
                    [class.text-gray-600]="!item.activo">
                    {{ item.activo ? 'Activa' : 'Inactiva' }}
                  </span>
                </td>
                <td class="px-4 sm:px-6 py-3 text-right" (click)="$event.stopPropagation()">
                  <div class="inline-flex flex-wrap gap-x-2 gap-y-1 justify-end">
                    <button
                      *ngIf="item.activo"
                      type="button"
                      (click)="payMensualObligation(item, $event)"
                      [disabled]="payingMensualObligationId === item.id"
                      class="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50 whitespace-nowrap">
                      Pagar
                    </button>
                    <button
                      type="button"
                      (click)="toggleObligationActive(item)"
                      [disabled]="savingObligationId === item.id"
                      class="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50 whitespace-nowrap">
                      {{ item.activo ? 'Desactivar' : 'Reactivar' }}
                    </button>
                    <button
                      type="button"
                      (click)="duplicateMensualObligation(item, $event)"
                      class="text-xs font-semibold text-gray-600 dark:text-gray-300 hover:underline whitespace-nowrap">
                      Duplicar
                    </button>
                    <button
                      type="button"
                      (click)="confirmDeleteObligation(item)"
                      class="text-xs font-semibold text-red-600 hover:underline whitespace-nowrap">
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <app-transaction-modal
      [open]="payCardModalOpen"
      title="Pagar resumen"
      [subtitle]="payCardModalSubtitle"
      [hideSubtitleOnMobile]="false"
      (closed)="closePayCardModal()">
      <div *ngIf="payCardTarget as target" class="space-y-4">
        <app-transaction-save-banner [message]="payCardSave.successMessage"></app-transaction-save-banner>
        <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-1">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Cuenta / tarjeta
          </p>
          <p class="text-base font-bold text-gray-900 dark:text-gray-100">{{ target.tarjetaLabel }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-300 capitalize">
            Resumen de {{ formatMes(target.mes) }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400 leading-snug">
            El mes se arma por la <span class="font-medium">fecha de vencimiento</span> de cada cuota incluida abajo.
            Solo entran cuotas <span class="font-medium">pendientes</span>; las ya pagadas no se suman.
          </p>
        </div>

        <div>
          <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Cuotas del resumen ({{ payCardPendingRows.length }})
          </p>
          <ul
            class="rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 max-h-52 overflow-y-auto bg-white dark:bg-gray-900">
            <li
              *ngFor="let row of payCardPendingRows"
              class="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div class="min-w-0">
                <p class="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {{ installmentCuotaCompraLabel(row) }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Vence {{ formatDate(row.fechaVencimiento) }}
                </p>
              </div>
              <span class="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {{ formatMoney(row.monto) }}
              </span>
            </li>
          </ul>
        </div>

        <div class="rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-900 px-4 py-3 space-y-2">
          <div class="flex justify-between items-center gap-3">
            <span class="text-sm text-teal-900 dark:text-teal-200">Total pendiente del resumen</span>
            <span class="text-lg font-bold tabular-nums text-teal-900 dark:text-teal-100">{{ formatMoney(payCardPendingTotal) }}</span>
          </div>
          <p *ngIf="payCardSaldoResumen > 0 && payCardMonto !== null && payCardMonto < payCardPendingTotal" class="text-xs text-teal-800 dark:text-teal-300 m-0">
            Saldo que quedará pendiente: {{ formatMoney(payCardSaldoResumen) }}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto a pagar (egreso de caja)</label>
          <input
            type="number"
            [(ngModel)]="payCardMonto"
            name="payCardMonto"
            min="0.01"
            [max]="payCardPendingTotal"
            step="0.01"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm tabular-nums bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
            Podés pagar menos del total: se imputa a cuotas en orden de vencimiento (completas primero) y el resto queda pendiente en la última cuota afectada.
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago (egreso de caja)</label>
          <select
            [(ngModel)]="payCardMedioId"
            name="payCardMedioId"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900">
            <option *ngFor="let medio of mediosPagoCaja" [ngValue]="medio.id">{{ medio.label }}</option>
          </select>
        </div>
        <app-modal-form-footer
          [saving]="payingCardStatement"
          [primaryDisabled]="!canSubmitPayCardStatement"
          [successMessage]="payCardSave.successMessage"
          primaryLabel="Confirmar pago del resumen"
          (cancelClick)="closePayCardModal()"
          (primaryClick)="submitPayCardStatement()">
        </app-modal-form-footer>
      </div>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="payCardMonthPickerOpen"
      title="Elegir mes a pagar"
      [subtitle]="payCardMonthPickerCard?.header.tarjetaLabel ?? ''"
      (closed)="closePayCardMonthPicker()">
      <div *ngIf="payCardMonthPickerCard as card" class="space-y-2">
        <p class="text-sm text-gray-600 dark:text-gray-300 m-0">
          Elegí el mes del resumen. Solo se incluyen cuotas pendientes que vencen en ese mes (las ya pagadas no entran).
        </p>
        <button
          *ngFor="let stmt of card.monthStatements"
          type="button"
          (click)="selectPayCardMonthStatement(card, stmt)"
          class="w-full flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 text-left hover:border-teal-300 dark:hover:border-teal-700 transition-colors">
          <div class="min-w-0">
            <p class="font-semibold text-gray-900 dark:text-gray-100 capitalize">{{ formatMes(stmt.mes) }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {{ stmt.pendingCount }} cuota(s)
              <span *ngIf="cardStatementPurchaseLabels(stmt) as labels"> · {{ labels }}</span>
            </p>
          </div>
          <span class="shrink-0 text-base font-bold tabular-nums text-teal-800 dark:text-teal-200">
            {{ formatMoney(stmt.totalPending) }}
          </span>
        </button>
      </div>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="payCuotaModalOpen"
      title="{{ payCuotaModalTitle }}"
      [subtitle]="payCuotaModalSubtitle"
      [hideSubtitleOnMobile]="false"
      (closed)="closePayCuotaModal()">
      <div *ngIf="payCuotaTarget as target" class="space-y-4">
        <app-transaction-save-banner [message]="payCuotaSave.successMessage"></app-transaction-save-banner>
        <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-1">
          <p class="text-base font-bold text-gray-900 dark:text-gray-100">{{ installmentCuentaLabel(target) }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-300">{{ installmentCuotaCompraLabel(target) }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Vence {{ formatDate(target.fechaVencimiento) }} · {{ formatMes(installmentMesKey(target)) }}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Detalle</label>
          <input
            [(ngModel)]="payCuotaDetalle"
            name="payCuotaDetalle"
            placeholder="Detalle del pago"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ payCuotaMontoEditable ? 'Monto a pagar (egreso de caja)' : 'Monto de esta cuota (egreso de caja)' }}
          </label>
          <input
            type="number"
            [(ngModel)]="payCuotaMonto"
            name="payCuotaMonto"
            min="0"
            step="0.01"
            placeholder="0"
            [readonly]="!payCuotaMontoEditable"
            [class.bg-gray-50]="!payCuotaMontoEditable"
            [class.dark:bg-gray-800]="!payCuotaMontoEditable"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm tabular-nums bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary">
          <p *ngIf="payCuotaMontoEditable && (payCuotaTarget?.cuotaTotal ?? 1) > 1" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Podés ajustar el monto por cuota si el importe programado no es correcto.
            Monto programado: {{ formatMoney(payCuotaTarget?.monto ?? 0) }}.
          </p>
          <p *ngIf="payCuotaMontoEditable && (payCuotaTarget?.cuotaTotal ?? 1) <= 1" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Gasto recurrente: podés ajustar el importe si este mes vino distinto al habitual.
            Monto programado: {{ formatMoney(payCuotaTarget?.monto ?? 0) }}.
          </p>
          <p *ngIf="!payCuotaMontoEditable" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ payCuotaMontoFixedHint }}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago (egreso de caja)</label>
          <select
            [(ngModel)]="payCuotaMedioId"
            name="payCuotaMedioId"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white">
            <option *ngFor="let medio of mediosPagoCaja" [ngValue]="medio.id">{{ medio.label }}</option>
          </select>
        </div>
        <app-modal-form-footer
          [saving]="payingCuota"
          [primaryDisabled]="!canSubmitPayCuota"
          [successMessage]="payCuotaSave.successMessage"
          primaryLabel="{{ payCuotaConfirmLabel }}"
          (cancelClick)="closePayCuotaModal()"
          (primaryClick)="submitPayCuota()">
        </app-modal-form-footer>
      </div>
    </app-transaction-modal>
  `,
})
export class PayablesComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private payables = inject(PayablesService);
  private dialog = inject(DialogService);
  private configService = inject(CatalogConfigService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private configSub?: Subscription;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly moduleTableHeadNestedClass = MODULE_TABLE_HEAD_CELL_NESTED_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly expandedNestedWrapClass = EXPANDED_NESTED_WRAP_CLASS;
  readonly expandedNestedWrapLevel2Class = EXPANDED_NESTED_WRAP_LEVEL2_CLASS;
  readonly payablesTabButtonClass =
    'px-2.5 py-1 text-[11px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap rounded-t-md sm:px-4 sm:py-2 sm:text-sm';
  readonly payablesTabRowClass =
    'flex flex-wrap gap-0.5 sm:gap-1';

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  activeAmbitoTab = '';

  installments: PayableInstallment[] = [];
  obligations: PayableObligation[] = [];
  cardStatements: CardStatementSummary[] = [];
  payCardModalOpen = false;
  payCardTarget: CardStatementSummary | null = null;
  payCardPendingRows: PayableInstallment[] = [];
  payCardMonthPickerOpen = false;
  payCardMonthPickerCard: PayableAccountCardEntry | null = null;
  payCardMedioId = 'transferencia';
  payCardMonto: number | null = null;
  payCuotaModalOpen = false;
  payCuotaTarget: PayableInstallment | null = null;
  payCuotaMedioId = 'transferencia';
  payCuotaMonto: number | null = null;
  payCuotaDetalle = '';
  loadingInstallments = true;
  private allInstallmentsCache: PayableInstallment[] | null = null;

  readonly payCardSave = new TransactionSaveFeedback();
  readonly payCuotaSave = new TransactionSaveFeedback();

  get payingCardStatement(): boolean {
    return this.payCardSave.saving;
  }

  get payingCuota(): boolean {
    return this.payCuotaSave.saving;
  }

  savingCuotaId: string | null = null;
  savingObligationId: string | null = null;
  payingMensualObligationId: string | null = null;

  searchQuery = '';
  mesFilter = '';
  mesEstadoFilter: PayableDisplayEstado = 'pendiente';
  cuentaFilter = '';
  obligacionFilter = '';
  viewTab: PayablesViewTab = 'month';
  expandedAccountCardKeys: Record<string, boolean> = {};
  expandedAccountMonthKeys: Record<string, boolean> = {};
  expandedAccountPurchaseKeys: Record<string, boolean> = {};
  expandedObligationKeys: Record<string, boolean> = {};

  tarjetaFilterOptions: { id: string; label: string }[] = [];
  obligacionFilterOptions: { id: string; label: string }[] = [];
  monthViewInstallments: PayableInstallment[] = [];
  accountViewCards: PayableAccountCardEntry[] = [];
  obligationViewGroups: PayableObligationGroupEntry[] = [];
  mensualObligations: PayableObligation[] = [];
  kpiScopePrefix = '';
  countPendientes = 0;
  countVencidas = 0;
  countPagadas = 0;
  totalPendiente = 0;

  private payablesViewCacheKey = '';
  payablesCreateMenuOpen = false;

  readonly payablesCreateMenuButtonClass =
    `inline-flex items-center justify-center rounded-lg bg-teal-600 text-white hover:bg-teal-700 w-[42px] p-0 transition-colors ${LIST_TOOLBAR_CONTROL_HEIGHT}`;

  readonly mesEstadoFilterOptions: Array<{ value: PayableDisplayEstado; label: string }> = [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'vencida', label: 'Vencida' },
    { value: 'pagada', label: 'Pagada' },
  ];

  ngOnInit(): void {
    bindListPageRefreshOnReturn({
      listPath: '/payables',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'obligation' || tab === 'account' || tab === 'month') {
      this.viewTab = tab;
    }

    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.syncActiveAmbitoTab();
      this.syncPayablesView();
    });
    this.configService.getAppConfig().subscribe();
    if (!this.mesFilter) {
      this.mesFilter = new Date().toISOString().slice(0, 7);
    }
    this.loadData();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.payCardSave.destroy();
    this.payCuotaSave.destroy();
  }

  private finishModalSave(
    feedback: TransactionSaveFeedback,
    message: string,
    close: () => void,
    afterClose?: () => void
  ): void {
    feedback.showSuccess(message);
    window.setTimeout(() => {
      feedback.clearSuccess();
      close();
      afterClose?.();
    }, 1400);
  }

  get cajaAmbitos(): CajaAmbitoConfig[] {
    return getCajaAmbitos(this.appConfig);
  }

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get activeAmbitoLabel(): string {
    return getCashAmbitoLabel(this.activeAmbitoTab, this.appConfig);
  }

  get scopedCardStatements(): CardStatementSummary[] {
    if (!this.usesAmbitoSeparation) return this.cardStatements;
    return this.cardStatements.filter((row) => row.ambito === this.activeAmbitoTab);
  }

  get mediosPagoCaja() {
    return getMediosPagoActivos(this.appConfig).filter((m) => m.comportamiento === 'caja_inmediata');
  }

  get categoriasGasto() {
    return getCategoriasGasto(this.appConfig);
  }

  private getScopedInstallments(): PayableInstallment[] {
    if (!this.usesAmbitoSeparation) return this.installments;
    return this.installments.filter(
      (row) => resolveCashAmbito(row, this.appConfig) === this.activeAmbitoTab
    );
  }

  onSearchQueryChange(value: string): void {
    const next = value ?? '';
    if (this.searchQuery === next) return;
    this.searchQuery = next;
    this.syncPayablesView();
  }

  onCuentaFilterChange(): void {
    this.expandedAccountCardKeys = {};
    this.expandedAccountMonthKeys = {};
    this.expandedAccountPurchaseKeys = {};
    this.syncPayablesView();
  }

  onObligacionFilterChange(): void {
    this.expandedObligationKeys = {};
    this.syncPayablesView();
  }

  canOpenInstallmentEdit(row: PayableInstallment): boolean {
    return !!(row.obligacionId || row.compraId);
  }

  openInstallmentEdit(row: PayableInstallment): void {
    if (row.compraId) {
      if (!this.auth.canViewStockCosts) {
        this.dialog.alert({
          message: 'No tenés permiso para editar compras.',
        });
        return;
      }
      this.router.navigate(['/purchases', row.compraId, 'edit'], {
        queryParams: {
          returnTo: 'payables',
          tab: this.viewTab,
        },
      });
      return;
    }

    if (row.obligacionId) {
      this.router.navigate(['/payables/obligations', row.obligacionId, 'edit']);
      return;
    }

    this.dialog.alert({
      message: 'Este vencimiento no tiene formulario de edición.',
    });
  }

  onMobileInstallmentActivate(row: PayableInstallment): void {
    if (row.displayEstado !== 'pagada') {
      this.togglePaid(row);
      return;
    }
    this.openInstallmentEdit(row);
  }

  setActiveAmbito(id: string): void {
    if (this.activeAmbitoTab === id) return;
    this.activeAmbitoTab = id;
    this.syncPayablesView();
  }

  private buildTarjetaFilterOptions(): { id: string; label: string }[] {
    const fromConfig = getTarjetasActivas(this.appConfig).map((t) => ({
      id: t.id,
      label: t.label,
    }));
    const seen = new Set(fromConfig.map((t) => t.id));
    for (const row of this.getScopedInstallments()) {
      if (row.tarjetaId && row.tarjetaLabel && !seen.has(row.tarjetaId)) {
        fromConfig.push({ id: row.tarjetaId, label: row.tarjetaLabel });
        seen.add(row.tarjetaId);
      }
    }
    return fromConfig.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  private syncPayablesView(): void {
    const key = [
      this.viewTab,
      this.mesFilter,
      this.mesEstadoFilter,
      this.cuentaFilter,
      this.obligacionFilter,
      this.searchQuery,
      this.activeAmbitoTab,
      this.installments.length,
      this.installments.map((row) => `${row.id}:${row.displayEstado}:${row.monto}`).join('\u0001'),
      this.obligations.length,
      getTarjetasActivas(this.appConfig).length,
    ].join('|');
    if (key === this.payablesViewCacheKey) return;
    this.payablesViewCacheKey = key;

    this.tarjetaFilterOptions = this.buildTarjetaFilterOptions();
    this.monthViewInstallments = this.sortInstallments(
      this.rowsMatchingFilters({ applyMes: true })
    );
    this.accountViewCards = this.buildAccountCardEntries(
      this.sortInstallments(this.rowsMatchingFilters({ applyCuenta: true }))
    );
    this.obligationViewGroups = this.buildObligationGroupEntries(
      this.sortInstallments(this.rowsMatchingFilters({ applyObligacion: true }))
    );
    this.obligacionFilterOptions = this.buildObligacionFilterOptions();
    this.syncAccountViewAutoExpand();
    this.mensualObligations = this.buildMensualObligations();

    const kpiScope = this.buildKpiScopeInstallments();
    this.kpiScopePrefix = this.buildKpiScopePrefix();
    this.countPendientes = kpiScope.filter((row) => row.displayEstado === 'pendiente').length;
    this.countVencidas = kpiScope.filter((row) => row.displayEstado === 'vencida').length;
    this.countPagadas = kpiScope.filter((row) => row.displayEstado === 'pagada').length;
    this.totalPendiente = kpiScope
      .filter((row) => row.displayEstado === 'pendiente' || row.displayEstado === 'vencida')
      .reduce((sum, row) => sum + row.monto, 0);
  }

  private rowsMatchingFilters(opts: {
    applyMes?: boolean;
    applyCuenta?: boolean;
    applyObligacion?: boolean;
  }): PayableInstallment[] {
    const query = this.searchQuery.trim().toLowerCase();
    const mes = this.mesFilter.trim();
    return this.getScopedInstallments().filter((row) => {
      if (opts.applyMes) {
        if (!mes) return false;
        if (this.installmentMesKey(row) !== mes) return false;
        if (row.displayEstado !== this.mesEstadoFilter) return false;
      }
      if (opts.applyCuenta && this.cuentaFilter) {
        if (row.tarjetaId !== this.cuentaFilter) return false;
      }
      if (opts.applyObligacion) {
        if (!this.isObligationScheduleRow(row)) return false;
        if (this.obligacionFilter && row.obligacionId !== this.obligacionFilter) return false;
      }
      if (query && !this.installmentMatchesSearch(row, query)) return false;
      return true;
    });
  }

  private sortInstallments(rows: PayableInstallment[]): PayableInstallment[] {
    return [...rows].sort((a, b) => this.compareInstallmentsByDueDate(a, b));
  }

  /** Vencidas y pendientes primero; dentro de cada grupo, la fecha más próxima arriba. */
  private compareInstallmentsByDueDate(a: PayableInstallment, b: PayableInstallment): number {
    const statusCmp =
      this.installmentEstadoSortOrder(a.displayEstado) -
      this.installmentEstadoSortOrder(b.displayEstado);
    if (statusCmp !== 0) return statusCmp;

    const dateA = a.fechaVencimiento?.slice(0, 10) || '';
    const dateB = b.fechaVencimiento?.slice(0, 10) || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const cuentaCmp = (a.tarjetaLabel || '').localeCompare(b.tarjetaLabel || '', 'es');
    if (cuentaCmp !== 0) return cuentaCmp;
    if (a.compraId && b.compraId && a.compraId === b.compraId) {
      return (a.numeroCuota || 0) - (b.numeroCuota || 0);
    }
    return (a.beneficiario || '').localeCompare(b.beneficiario || '', 'es');
  }

  private installmentEstadoSortOrder(estado: PayableDisplayEstado): number {
    switch (estado) {
      case 'vencida':
        return 0;
      case 'pendiente':
        return 1;
      case 'pagada':
        return 2;
      default:
        return 3;
    }
  }

  private buildAccountCardEntries(rows: PayableInstallment[]): PayableAccountCardEntry[] {
    const byCard = new Map<string, PayableInstallment[]>();

    for (const row of rows) {
      if (!row.tarjetaId) continue;
      const ambito = (row.ambito ?? 'negocio').trim().toLowerCase();
      const key = `${row.tarjetaId}|${ambito}`;
      const list = byCard.get(key) ?? [];
      list.push(row);
      byCard.set(key, list);
    }

    const currentMes = this.accountViewMesKey();

    return Array.from(byCard.entries())
      .map(([key, cardRows]) => {
        const sortedCardRows = this.sortInstallments(cardRows);
        const first = sortedCardRows[0];
        const currentMonth = this.buildMonthStatementForMes(key, sortedCardRows, currentMes);
        const headerSummary = currentMonth
          ? this.buildInstallmentGroupSummary(currentMonth.rows)
          : {
              count: 0,
              purchaseCount: 0,
              pendingCount: 0,
              totalPending: 0,
              nextDueDate: '',
              summaryEstado: 'pagada' as PayableDisplayEstado,
            };
        const allUnpaid = sortedCardRows.filter((row) => row.displayEstado !== 'pagada');
        const totalBalancePending = allUnpaid.reduce((sum, row) => sum + row.monto, 0);
        return {
          key,
          header: {
            ...headerSummary,
            tarjetaId: first?.tarjetaId ?? '',
            tarjetaLabel: first?.tarjetaLabel ?? first?.beneficiario ?? 'Cuenta',
            totalBalancePending,
          },
          currentMonth,
          monthStatements: this.buildCardMonthStatements(key, sortedCardRows),
        };
      })
      .sort((a, b) => {
        const statusCmp =
          this.installmentEstadoSortOrder(a.header.summaryEstado) -
          this.installmentEstadoSortOrder(b.header.summaryEstado);
        if (statusCmp !== 0) return statusCmp;

        const dateCmp = (a.header.nextDueDate || '').localeCompare(b.header.nextDueDate || '');
        if (dateCmp !== 0) return dateCmp;

        return a.header.tarjetaLabel.localeCompare(b.header.tarjetaLabel, 'es');
      });
  }

  private isObligationScheduleRow(row: PayableInstallment): boolean {
    if (row.compraId || row.tarjetaId) return false;
    // Solo préstamos explícitos (botón «Nuevo préstamo»). Los gastos en cuotas van en «Por mes».
    return row.origenTipo === 'prestamo';
  }

  private buildObligacionFilterOptions(): { id: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const row of this.getScopedInstallments()) {
      if (!this.isObligationScheduleRow(row) || !row.obligacionId) continue;
      if (!seen.has(row.obligacionId)) {
        seen.set(row.obligacionId, row.beneficiario?.trim() || 'Sin nombre');
      }
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  private buildObligationGroupEntries(rows: PayableInstallment[]): PayableObligationGroupEntry[] {
    const byObligation = new Map<string, PayableInstallment[]>();

    for (const row of rows) {
      if (!this.isObligationScheduleRow(row)) continue;
      const key = row.obligacionId || row.beneficiario;
      const list = byObligation.get(key) ?? [];
      list.push(row);
      byObligation.set(key, list);
    }

    return Array.from(byObligation.entries())
      .map(([key, groupRows]) => {
        const sorted = this.sortInstallments(groupRows);
        const unpaid = sorted.filter((row) => row.displayEstado !== 'pagada');
        const summary = this.buildInstallmentGroupSummary(sorted);
        const first = sorted[0];
        const cuotaTotal = first.cuotaTotal ?? sorted.length;
        const paidCount = sorted.filter((row) => row.displayEstado === 'pagada').length;

        return {
          key,
          header: {
            ...summary,
            obligacionId: first.obligacionId,
            beneficiario: first.beneficiario?.trim() || 'Sin nombre',
            cuotaTotal,
            paidCount,
            isPrestamo: sorted.some((row) => row.origenTipo === 'prestamo'),
          },
          rows: unpaid,
        };
      })
      .sort((a, b) => {
        const statusCmp =
          this.installmentEstadoSortOrder(a.header.summaryEstado) -
          this.installmentEstadoSortOrder(b.header.summaryEstado);
        if (statusCmp !== 0) return statusCmp;

        const dateCmp = (a.header.nextDueDate || '').localeCompare(b.header.nextDueDate || '');
        if (dateCmp !== 0) return dateCmp;

        return a.header.beneficiario.localeCompare(b.header.beneficiario, 'es');
      });
  }

  toggleObligationExpand(key: string): void {
    this.expandedObligationKeys = {
      ...this.expandedObligationKeys,
      [key]: !this.expandedObligationKeys[key],
    };
  }

  isObligationExpanded(key: string): boolean {
    return !!this.expandedObligationKeys[key];
  }

  obligationGroupSubtitle(group: PayableObligationGroupEntry): string {
    const h = group.header;
    return `${h.paidCount}/${h.cuotaTotal} pagadas · ${h.pendingCount} pendiente(s)`;
  }

  private purchaseGroupKey(row: PayableInstallment): string {
    return row.compraId || row.obligacionId;
  }

  private buildInstallmentGroupSummary(rows: PayableInstallment[]): PayableInstallmentGroupSummary {
    const sorted = this.sortInstallments(rows);
    const pending = sorted.filter((row) => row.displayEstado !== 'pagada');
    const purchaseIds = new Set(rows.map((row) => this.purchaseGroupKey(row)));
    const nextDueDate =
      pending[0]?.fechaVencimiento?.slice(0, 10) ||
      sorted[0]?.fechaVencimiento?.slice(0, 10) ||
      '';

    return {
      count: rows.length,
      purchaseCount: purchaseIds.size,
      pendingCount: pending.length,
      totalPending: pending.reduce((sum, row) => sum + row.monto, 0),
      nextDueDate,
      summaryEstado: this.summarizeEstado(rows),
    };
  }

  private buildAccountPurchaseEntries(
    scopeKey: string,
    rows: PayableInstallment[]
  ): PayableAccountPurchaseEntry[] {
    const byPurchase = new Map<string, PayableInstallment[]>();

    for (const row of rows) {
      const purchaseKey = this.purchaseGroupKey(row);
      const list = byPurchase.get(purchaseKey) ?? [];
      list.push(row);
      byPurchase.set(purchaseKey, list);
    }

    return Array.from(byPurchase.entries())
      .map(([purchaseKey, groupRows]) => {
        const sorted = this.sortInstallments(groupRows);
        const first = sorted[0];
        const summary = this.buildInstallmentGroupSummary(sorted);
        return {
          key: `${scopeKey}|${purchaseKey}`,
          header: {
            ...summary,
            obligacionId: first.obligacionId,
            compraId: first.compraId,
            compraLabel: first.compraLabel,
            title: this.purchaseEntryTitle(first),
            subtitle: this.purchaseEntrySubtitle(first, sorted),
          },
          rows: sorted,
        };
      })
      .sort((a, b) => this.compareInstallmentsByDueDate(a.rows[0], b.rows[0]));
  }

  accountViewMesKey(): string {
    const mes = this.mesFilter.trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mes)) return mes;
    return new Date().toISOString().slice(0, 7);
  }

  accountCurrentMonthRowTitle(row: PayableInstallment): string {
    if (row.compraLabel) return `Compra #${row.compraLabel}`;
    return row.beneficiario?.trim() || row.descripcion?.trim() || 'Sin detalle';
  }

  onAccountCurrentMonthRowActivate(row: PayableInstallment): void {
    if (row.displayEstado !== 'pagada') {
      this.togglePaid(row);
      return;
    }
    if (row.compraId && this.auth.canViewStockCosts) {
      this.openInstallmentEdit(row);
    }
  }

  private buildMonthStatementForMes(
    cardKey: string,
    rows: PayableInstallment[],
    mes: string
  ): PayableAccountMonthStatement | null {
    const mesRows = rows.filter((row) => this.installmentMesKey(row) === mes);
    if (mesRows.length === 0) return null;

    const sorted = this.sortInstallments(mesRows);
    const pending = sorted.filter((row) => row.displayEstado !== 'pagada');
    return {
      key: `${cardKey}|${mes}`,
      mes,
      pendingCount: pending.length,
      totalPending: pending.reduce((sum, row) => sum + row.monto, 0),
      rows: sorted,
      purchases: this.buildAccountPurchaseEntries(`${cardKey}|${mes}`, sorted),
    };
  }

  private buildCardMonthStatements(
    cardKey: string,
    rows: PayableInstallment[]
  ): PayableAccountMonthStatement[] {
    const byMes = new Map<string, PayableInstallment[]>();

    for (const row of rows) {
      const mes = this.installmentMesKey(row);
      const list = byMes.get(mes) ?? [];
      list.push(row);
      byMes.set(mes, list);
    }

    return Array.from(byMes.entries())
      .map(([mes, mesRows]) => {
        const sorted = this.sortInstallments(mesRows);
        const pending = sorted.filter((row) => row.displayEstado !== 'pagada');
        return {
          key: `${cardKey}|${mes}`,
          mes,
          pendingCount: pending.length,
          totalPending: pending.reduce((sum, row) => sum + row.monto, 0),
          rows: sorted,
          purchases: this.buildAccountPurchaseEntries(`${cardKey}|${mes}`, sorted),
        };
      })
      .filter((stmt) => stmt.pendingCount > 0)
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }

  private purchaseEntryTitle(row: PayableInstallment): string {
    if (row.compraLabel) return `Compra #${row.compraLabel}`;
    return row.beneficiario?.trim() || 'Sin detalle';
  }

  private purchaseEntrySubtitle(first: PayableInstallment, rows: PayableInstallment[]): string {
    const parts: string[] = [`${rows.length} cuota(s)`];
    if (first.descripcion?.trim()) parts.push(first.descripcion.trim());
    return parts.join(' · ');
  }

  private syncAccountViewAutoExpand(): void {
    if (this.viewTab !== 'account' || !this.cuentaFilter) return;

    const cards = this.accountViewCards;
    if (cards.length !== 1) return;

    const card = cards[0];
    this.expandedAccountCardKeys = { ...this.expandedAccountCardKeys, [card.key]: true };
  }

  cardNextResumenStatement(card: PayableAccountCardEntry): PayableAccountMonthStatement | null {
    return card.currentMonth;
  }

  accountCardSubtitle(card: PayableAccountCardEntry): string {
    const h = card.header;
    const mes = this.formatMes(this.accountViewMesKey());
    return `${h.purchaseCount} compra(s) en ${mes} · ${h.pendingCount} cuota(s) pend.`;
  }

  cardPayResumenHint(card: PayableAccountCardEntry): string | null {
    const stmts = card.monthStatements.filter((stmt) => stmt.pendingCount > 0);
    if (stmts.length === 0) return null;
    if (stmts.length === 1) {
      return `${this.formatMes(stmts[0].mes)} · ${this.formatMoney(stmts[0].totalPending)}`;
    }
    return `${stmts.length} meses con saldo`;
  }

  cardStatementPurchaseLabels(stmt: PayableAccountMonthStatement): string {
    const labels = [
      ...new Set(
        stmt.rows
          .filter((row) => row.displayEstado !== 'pagada' && row.compraLabel?.trim())
          .map((row) => `#${row.compraLabel!.trim()}`)
      ),
    ].sort();
    return labels.join(', ');
  }

  closePayCardMonthPicker(): void {
    this.payCardMonthPickerOpen = false;
    this.payCardMonthPickerCard = null;
  }

  selectPayCardMonthStatement(card: PayableAccountCardEntry, stmt: PayableAccountMonthStatement): void {
    this.closePayCardMonthPicker();
    this.openPayCardStatementForMonth(card, stmt);
  }

  get emptyMonthViewMessage(): string {
    const mes = this.mesFilter.trim();
    const mesLabel = mes ? this.formatMes(mes) : 'este mes';
    if (this.mesEstadoFilter === 'pagada') {
      return `No hay cuotas pagadas en ${mesLabel}.`;
    }
    if (this.mesEstadoFilter === 'vencida') {
      return `No hay cuotas vencidas en ${mesLabel}.`;
    }
    return `No hay cuotas pendientes en ${mesLabel}.`;
  }

  get emptyAccountViewMessage(): string {
    if (this.cuentaFilter) {
      return 'No hay cuotas para esta cuenta.';
    }
    return 'No hay cuotas de tarjeta para mostrar.';
  }

  get emptyObligationViewMessage(): string {
    if (this.obligacionFilter) {
      return 'No hay cuotas pendientes para este préstamo.';
    }
    if (this.searchQuery.trim()) {
      return 'No hay préstamos que coincidan con la búsqueda.';
    }
    return 'No hay préstamos cargados. Usá «Nuevo préstamo» para registrar cuotas.';
  }

  setViewTab(tab: PayablesViewTab): void {
    if (this.viewTab === tab) return;
    this.viewTab = tab;
    if (tab === 'account') {
      this.expandedAccountCardKeys = {};
      this.expandedAccountPurchaseKeys = {};
    }
    if (tab === 'obligation') {
      this.expandedObligationKeys = {};
    }
    if (tab === 'month' && !this.mesFilter) {
      this.mesFilter = new Date().toISOString().slice(0, 7);
    }
    if (tab === 'month') {
      this.loadInstallmentsForCurrentView();
      this.loadCardStatements();
      return;
    }
    if (this.allInstallmentsCache) {
      this.installments = this.allInstallmentsCache;
      this.syncPayablesView();
      return;
    }
    this.loadInstallmentsForCurrentView();
  }

  monthRowTitle(row: PayableInstallment): string {
    return `${this.cuotaLabel(row)} · ${this.installmentCuentaLabel(row)}`;
  }

  monthRowSubtitle(row: PayableInstallment): string {
    return `${this.installmentDetalleDisplayLabel(row)} · ${this.formatDate(row.fechaVencimiento)}`;
  }

  installmentCuentaLabel(row: PayableInstallment): string {
    if (row.tarjetaLabel?.trim()) return row.tarjetaLabel.trim();
    if (row.compraId) return 'Sin cuenta';
    return row.beneficiario;
  }

  installmentDetalleLabel(row: PayableInstallment): string {
    if (row.descripcion?.trim()) return row.descripcion.trim();
    if (row.compraLabel) return `Compra #${row.compraLabel}`;
    const ben = row.beneficiario?.trim() ?? '';
    if (row.tarjetaLabel && ben.startsWith(row.tarjetaLabel)) {
      const rest = ben.slice(row.tarjetaLabel.length).replace(/^\s*·\s*/, '').trim();
      return rest || '—';
    }
    return ben || '—';
  }

  /** Detalle sin «Cuota N/M» cuando la tabla ya tiene columna Cuota. */
  installmentDetalleDisplayLabel(row: PayableInstallment): string {
    let text = this.installmentDetalleLabel(row);
    if (!text || text === '—') return text;

    text = text
      .replace(/(^|\s·\s*)Cuota\s+\d+\/\d+(\s·\s*|$)/gi, '$1')
      .replace(/^\s*·\s*/, '')
      .replace(/\s*·\s*$/, '')
      .replace(/\s*·\s*·\s*/g, ' · ')
      .trim();

    return text || '—';
  }

  private buildMensualObligations(): PayableObligation[] {
    let list = this.obligations.filter((item) => item.tipo === 'mensual' && !item.compraId);
    if (this.usesAmbitoSeparation) {
      list = list.filter(
        (item) => resolveCashAmbito(item, this.appConfig) === this.activeAmbitoTab
      );
    }
    return list;
  }

  private buildKpiScopeInstallments(): PayableInstallment[] {
    const scoped = this.getScopedInstallments();
    if (this.viewTab === 'month') {
      const mes = this.mesFilter.trim();
      if (!mes) return [];
      return scoped.filter((row) => this.installmentMesKey(row) === mes);
    }
    if (this.viewTab === 'obligation') {
      let rows = scoped.filter((row) => this.isObligationScheduleRow(row));
      if (this.obligacionFilter) {
        rows = rows.filter((row) => row.obligacionId === this.obligacionFilter);
      }
      return rows;
    }
    if (this.cuentaFilter) {
      return scoped.filter((row) => row.tarjetaId === this.cuentaFilter);
    }
    return scoped;
  }

  private buildKpiScopePrefix(): string {
    const parts: string[] = [];
    if (this.usesAmbitoSeparation) {
      parts.push(this.activeAmbitoLabel);
    }
    if (this.viewTab === 'month') {
      const mes = this.mesFilter.trim();
      if (mes) parts.push(this.formatMes(mes));
    } else if (this.viewTab === 'obligation') {
      if (this.obligacionFilter) {
        const label = this.obligacionFilterOptions.find((o) => o.id === this.obligacionFilter)?.label;
        if (label) parts.push(label);
      } else {
        parts.push('Préstamos');
      }
    } else if (this.cuentaFilter) {
      const label = this.tarjetaFilterOptions.find((t) => t.id === this.cuentaFilter)?.label;
      if (label) parts.push(label);
    } else {
      parts.push('Todas las cuentas');
    }
    return parts.length ? `${parts.join(' · ')} · ` : '';
  }

  openPayCardStatement(row: CardStatementSummary, pendingRows?: PayableInstallment[]): void {
    this.payCardTarget = row;
    this.payCardPendingRows =
      pendingRows ??
      this.resolvePayCardPendingRows(row).sort((a, b) => {
        const dateCmp = (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || '');
        if (dateCmp !== 0) return dateCmp;
        return (a.numeroCuota || 0) - (b.numeroCuota || 0);
      });
    this.payCardMedioId = this.mediosPagoCaja[0]?.id ?? 'transferencia';
    this.payCardMonto = this.payCardPendingTotal;
    this.payCardModalOpen = true;
  }

  get payCardPendingTotal(): number {
    return Math.round(this.payCardPendingRows.reduce((sum, row) => sum + row.monto, 0) * 100) / 100;
  }

  get payCardSaldoResumen(): number {
    const monto = Number(this.payCardMonto);
    if (!Number.isFinite(monto) || monto <= 0) return this.payCardPendingTotal;
    return Math.max(0, Math.round((this.payCardPendingTotal - monto) * 100) / 100);
  }

  get canSubmitPayCardStatement(): boolean {
    const monto = Number(this.payCardMonto);
    return (
      Number.isFinite(monto) &&
      monto > 0 &&
      monto <= this.payCardPendingTotal + 0.009
    );
  }

  get payCuotaMontoEditable(): boolean {
    const row = this.payCuotaTarget;
    if (!row) return false;
    if (row.tarjetaId || row.compraId) return false;
    if (row.tipo === 'mensual') return true;
    // Gastos en cuotas manuales: permitir ajustar el importe al pagar.
    return row.tipo === 'unico';
  }

  get payCuotaModalTitle(): string {
    return 'Registrar pago';
  }

  get payCuotaConfirmLabel(): string {
    return 'Confirmar pago de la cuota';
  }

  get payCuotaMontoFixedHint(): string {
    const row = this.payCuotaTarget;
    if (!row) return '';
    const monto = this.installmentDisplayMonto(row);
    if (row.tarjetaId || row.compraId) {
      return `Cuota de tarjeta o compra: se paga por el monto completo (${this.formatMoney(monto)}).`;
    }
    const total = row.cuotaTotal ?? 1;
    if (total > 1) {
      return `Cuota ${row.numeroCuota ?? 1}/${total}: el egreso en caja será de ${this.formatMoney(monto)}.`;
    }
    return `El egreso en caja será de ${this.formatMoney(monto)}.`;
  }

  get payCardModalSubtitle(): string {
    if (!this.payCardTarget) return '';
    return `${this.payCardTarget.tarjetaLabel} · ${this.formatMes(this.payCardTarget.mes)}`;
  }

  get payCuotaModalSubtitle(): string {
    if (!this.payCuotaTarget) return '';
    const cuota = this.payCuotaTarget.numeroCuota ?? 1;
    const total = this.payCuotaTarget.cuotaTotal ?? 1;
    const cuotaLabel = total > 1 ? ` · cuota ${cuota}/${total}` : '';
    return `${this.installmentCuentaLabel(this.payCuotaTarget)}${cuotaLabel} · vence ${this.formatDate(this.payCuotaTarget.fechaVencimiento)}`;
  }

  private resolvePayCardPendingRows(target: CardStatementSummary): PayableInstallment[] {
    const cuotaIds = new Set(target.cuotaIds);
    return this.getScopedInstallments().filter(
      (row) => cuotaIds.has(row.id) && row.displayEstado !== 'pagada'
    );
  }

  closePayCardModal(): void {
    this.payCardModalOpen = false;
    this.payCardTarget = null;
    this.payCardPendingRows = [];
    this.payCardMonto = null;
    this.payCardSave.clearSuccess();
    this.payCardSave.endSave();
  }

  submitPayCardStatement(): void {
    if (!this.payCardTarget || !this.canSubmitPayCardStatement || !this.payCardSave.tryBeginSave()) return;

    const montoPago = Math.round(Number(this.payCardMonto) * 100) / 100;

    this.payables
      .payCardStatement({
        tarjetaId: this.payCardTarget.tarjetaId,
        mes: this.payCardTarget.mes,
        medioPagoId: this.payCardMedioId,
        ambito: this.usesAmbitoSeparation ? this.payCardTarget.ambito : undefined,
        cuotaIds: this.payCardPendingRows.map((row) => row.id),
        montoPago,
      })
      .pipe(finalize(() => this.payCardSave.endSave()))
      .subscribe({
        next: (result) => {
          const parcial =
            result.saldoPendiente > 0
              ? ` · saldo pendiente $${result.saldoPendiente}`
              : '';
          this.finishModalSave(
            this.payCardSave,
            `Pago registrado · $${result.total}${parcial}`,
            () => this.closePayCardModal(),
            () => this.loadData()
          );
        },
        error: (err) => {
          this.dialog.alert({
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago del resumen.',
          });
        },
      });
  }

  formatMes(mes: string): string {
    return formatMonthYearLabel(mes);
  }

  onMesFilterChange(): void {
    if (this.viewTab === 'month') {
      this.loadInstallmentsForCurrentView();
    } else {
      this.syncPayablesView();
    }
    this.loadCardStatements();
  }

  onMesEstadoFilterChange(): void {
    this.payablesViewCacheKey = '';
    this.syncPayablesView();
  }

  isAccountCardExpanded(key: string): boolean {
    return !!this.expandedAccountCardKeys[key];
  }

  isAccountMonthExpanded(key: string): boolean {
    return !!this.expandedAccountMonthKeys[key];
  }

  isAccountPurchaseExpanded(key: string): boolean {
    return !!this.expandedAccountPurchaseKeys[key];
  }

  toggleAccountCardExpand(key: string): void {
    const next = !this.expandedAccountCardKeys[key];
    this.expandedAccountCardKeys = {
      ...this.expandedAccountCardKeys,
      [key]: next,
    };
    if (!next) {
      this.collapseNestedForAccount(key);
    }
  }

  toggleAccountMonthExpand(key: string): void {
    this.expandedAccountMonthKeys = {
      ...this.expandedAccountMonthKeys,
      [key]: !this.expandedAccountMonthKeys[key],
    };
  }

  toggleAccountPurchaseExpand(key: string): void {
    this.expandedAccountPurchaseKeys = {
      ...this.expandedAccountPurchaseKeys,
      [key]: !this.expandedAccountPurchaseKeys[key],
    };
  }

  private collapseNestedForAccount(cardKey: string): void {
    const prefix = `${cardKey}|`;
    const nextPurchases = { ...this.expandedAccountPurchaseKeys };
    let purchasesChanged = false;
    for (const purchaseKey of Object.keys(nextPurchases)) {
      if (purchaseKey.startsWith(prefix)) {
        delete nextPurchases[purchaseKey];
        purchasesChanged = true;
      }
    }
    if (purchasesChanged) {
      this.expandedAccountPurchaseKeys = nextPurchases;
    }

    const nextMonths = { ...this.expandedAccountMonthKeys };
    let monthsChanged = false;
    for (const monthKey of Object.keys(nextMonths)) {
      if (monthKey.startsWith(prefix)) {
        delete nextMonths[monthKey];
        monthsChanged = true;
      }
    }
    if (monthsChanged) {
      this.expandedAccountMonthKeys = nextMonths;
    }
  }

  openPayCardStatementForCard(card: PayableAccountCardEntry): void {
    const stmt = card.currentMonth;
    if (!stmt || stmt.pendingCount === 0) return;
    this.openPayCardStatementForMonth(card, stmt);
  }

  openPayCardStatementForMonth(
    card: PayableAccountCardEntry,
    stmt: PayableAccountMonthStatement
  ): void {
    const pendingRows = stmt.rows.filter((row) => row.displayEstado !== 'pagada');
    this.openPayCardStatement(this.buildCardStatementFromMonth(card, stmt), pendingRows);
  }

  installmentCuotaCompraLabel(row: PayableInstallment): string {
    const cuota = this.cuotaLabel(row);
    if (row.origenTipo === 'compra' && row.compraLabel) {
      return `Compra #${row.compraLabel} · Cuota ${cuota}`;
    }
    if ((row.cuotaTotal ?? 0) > 1 || (row.numeroCuota ?? 1) > 1) {
      return `Cuota ${cuota}`;
    }
    return cuota;
  }

  /** Monto programado de la cuota (tras corrección en servidor). */
  installmentDisplayMonto(row: PayableInstallment): number {
    return Number(row.monto) || 0;
  }

  installmentRowTone(row: PayableInstallment): ModuleTableRowTone {
    if (row.displayEstado === 'vencida') return 'danger';
    if (row.displayEstado === 'pagada') return 'success';
    return 'default';
  }

  installmentDetailSecondary(row: PayableInstallment): string | undefined {
    const parts = [row.descripcion, row.compraLabel ? `Compra #${row.compraLabel}` : null].filter(
      Boolean
    ) as string[];
    return parts[0];
  }

  private buildCardStatementFromMonth(
    card: PayableAccountCardEntry,
    stmt: PayableAccountMonthStatement
  ): CardStatementSummary {
    const pending = stmt.rows.filter((row) => row.displayEstado !== 'pagada');
    const first = stmt.rows[0];
    const tarjeta = getTarjetasActivas(this.appConfig).find(
      (item) => item.id === card.header.tarjetaId
    );
    const medioPagoId = tarjeta?.medioPagoId ?? 'tarjeta_credito';
    const medio = getMedioPagoConfig(this.appConfig, medioPagoId);
    return {
      tarjetaId: card.header.tarjetaId,
      tarjetaLabel: card.header.tarjetaLabel,
      mes: stmt.mes,
      medioPagoId,
      medioPagoLabel: medio?.label ?? medioPagoId,
      ambito: (first?.ambito ?? 'negocio').trim().toLowerCase(),
      cuotaIds: pending.map((row) => row.id),
      total: stmt.totalPending,
      cuotasCount: pending.length,
    };
  }

  private summarizeEstado(rows: PayableInstallment[]): PayableDisplayEstado {
    if (rows.some((row) => row.displayEstado === 'vencida')) return 'vencida';
    if (rows.some((row) => row.displayEstado === 'pendiente')) return 'pendiente';
    return 'pagada';
  }

  openCreateModal(): void {
    this.closePayablesCreateMenu();
    const ambito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab || getDefaultCashAmbitoId(this.appConfig)
      : '';
    this.router.navigate(['/payables/new'], {
      queryParams: ambito ? { ambito } : {},
    });
  }

  openLoanModal(): void {
    this.closePayablesCreateMenu();
    const ambito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab || getDefaultCashAmbitoId(this.appConfig)
      : '';
    this.router.navigate(['/payables/loans/new'], {
      queryParams: ambito ? { ambito } : {},
    });
  }

  togglePayablesCreateMenu(event: Event): void {
    event.stopPropagation();
    this.payablesCreateMenuOpen = !this.payablesCreateMenuOpen;
  }

  closePayablesCreateMenu(): void {
    this.payablesCreateMenuOpen = false;
  }

  openLoanFromMenu(): void {
    this.closePayablesCreateMenu();
    this.openLoanModal();
  }

  openExpenseFromMenu(): void {
    this.closePayablesCreateMenu();
    this.openCreateModal();
  }

  togglePaid(row: PayableInstallment): void {
    if (row.displayEstado === 'pagada') {
      this.savingCuotaId = row.id;
      this.payables.setInstallmentPaid(row.id, false).subscribe({
        next: (updated) => {
          this.installments = this.installments.map((item) =>
            item.id === updated.id ? updated : item
          );
          this.payablesViewCacheKey = '';
          this.syncPayablesView();
          this.savingCuotaId = null;
        },
        error: () => {
          this.savingCuotaId = null;
          this.dialog.alert({ message: 'No se pudo actualizar el pago.' });
        },
      });
      return;
    }

    this.payCuotaTarget = row;
    this.payCuotaMedioId = this.mediosPagoCaja[0]?.id ?? 'transferencia';
    this.payCuotaMonto = row.monto;
    this.payCuotaDetalle = this.installmentDetalleLabel(row);
    this.payCuotaModalOpen = true;
  }

  closePayCuotaModal(): void {
    this.payCuotaModalOpen = false;
    this.payCuotaTarget = null;
    this.payCuotaMonto = null;
    this.payCuotaDetalle = '';
    this.payCuotaSave.clearSuccess();
    this.payCuotaSave.endSave();
  }

  get canSubmitPayCuota(): boolean {
    if (this.payCuotaMonto === null || !Number.isFinite(Number(this.payCuotaMonto))) return false;
    const monto = Number(this.payCuotaMonto);
    if (monto <= 0) return false;
    if (!this.payCuotaMontoEditable && this.payCuotaTarget) {
      return Math.abs(monto - this.payCuotaTarget.monto) < 0.01;
    }
    return true;
  }

  submitPayCuota(): void {
    if (!this.payCuotaTarget || !this.canSubmitPayCuota) return;
    if (!this.payCuotaSave.tryBeginSave()) return;

    const montoPago = Math.round(Number(this.payCuotaMonto) * 100) / 100;
    const concepto = this.payCuotaDetalle.trim();

    this.payables
      .setInstallmentPaid(this.payCuotaTarget.id, true, this.payCuotaMedioId, {
        montoPago,
        concepto,
      })
      .pipe(finalize(() => this.payCuotaSave.endSave()))
      .subscribe({
        next: (updated) => {
          this.installments = this.installments.map((item) =>
            item.id === updated.id ? updated : item
          );
          this.payablesViewCacheKey = '';
          this.syncPayablesView();
          this.finishModalSave(
            this.payCuotaSave,
            `Cuota pagada · $${updated.monto}`,
            () => this.closePayCuotaModal(),
            () => {
              this.loadData();
            }
          );
        },
        error: (err) => {
          this.dialog.alert({
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago.',
          });
        },
      });
  }

  openMensualObligationEdit(item: PayableObligation): void {
    this.router.navigate(['/payables/obligations', item.id, 'edit'], {
      queryParams: { mes: this.resolveMensualPayMes() },
    });
  }

  payMensualObligation(item: PayableObligation, event?: Event): void {
    event?.stopPropagation();
    if (!item.activo) {
      this.dialog.alert({ message: 'Activá el gasto fijo antes de registrar un pago.' });
      return;
    }

    const mes = this.resolveMensualPayMes();
    this.payingMensualObligationId = item.id;
    this.payables.getMensualInstallmentForMonth(item.id, mes).subscribe({
      next: (row) => {
        this.payingMensualObligationId = null;
        if (row.displayEstado === 'pagada') {
          this.dialog.alert({
            title: 'Cuota ya pagada',
            message: `La cuota de ${formatMonthYearLabel(mes)} ya está pagada.`,
          });
          return;
        }
        this.payCuotaTarget = row;
        this.payCuotaMedioId = this.mediosPagoCaja[0]?.id ?? 'transferencia';
        this.payCuotaMonto = row.monto;
        this.payCuotaDetalle = this.installmentDetalleLabel(row);
        this.payCuotaModalOpen = true;
      },
      error: (err) => {
        this.payingMensualObligationId = null;
        this.dialog.alert({
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : `No hay vencimiento en ${formatMonthYearLabel(mes)}.`,
        });
      },
    });
  }

  duplicateMensualObligation(item: PayableObligation, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/payables/new'], { queryParams: { duplicate: item.id } });
  }

  private resolveMensualPayMes(): string {
    const mes = this.mesFilter.trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mes)) return mes;
    return new Date().toISOString().slice(0, 7);
  }

  toggleObligationActive(item: PayableObligation): void {
    this.savingObligationId = item.id;
    this.payables.setObligationActive(item.id, !item.activo).subscribe({
      next: (updated) => {
        this.obligations = this.obligations.map((row) =>
          row.id === updated.id ? updated : row
        );
        this.savingObligationId = null;
        this.allInstallmentsCache = null;
        this.loadInstallmentsForCurrentView(true);
      },
      error: () => {
        this.savingObligationId = null;
        this.dialog.alert({ message: 'No se pudo actualizar la obligación.' });
      },
    });
  }

  confirmDeleteObligation(item: PayableObligation): void {
    this.dialog
      .confirm({
        title: 'Eliminar obligación',
        message: `¿Eliminar "${item.beneficiario}" y todos sus vencimientos? Esta acción no se puede deshacer.`,
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.payables.deleteObligation(item.id).subscribe({
          next: () => this.loadData(),
          error: () => this.dialog.alert({ message: 'No se pudo eliminar la obligación.' }),
        });
      });
  }

  formatMoney(value: number | null | undefined): string {
    return '$' + Number(value ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  formatDate(value: string): string {
    return formatDisplayDate(value);
  }

  installmentMesKey(row: PayableInstallment): string {
    return row.fechaVencimiento?.slice(0, 7) || '';
  }

  cuotaLabel(row: PayableInstallment): string {
    const total = row.cuotaTotal;
    if (total && total > 0) {
      return `${row.numeroCuota}/${total}`;
    }
    return String(row.numeroCuota);
  }

  installmentMobileTitle(row: PayableInstallment): string {
    const mes = this.formatMes(this.installmentMesKey(row));
    return `${mes} · ${this.cuotaLabel(row)}`;
  }

  installmentMobileSubtitle(row: PayableInstallment): string {
    return `${this.formatDate(row.fechaVencimiento)} · ${row.beneficiario}`;
  }

  private installmentMatchesSearch(row: PayableInstallment, query: string): boolean {
    const haystack = [
      row.beneficiario,
      row.descripcion,
      row.compraLabel,
      row.tarjetaLabel,
      this.formatMes(this.installmentMesKey(row)),
      this.formatDate(row.fechaVencimiento),
      this.cuotaLabel(row),
      String(row.numeroCuota),
      String(row.monto),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  tipoLabel(tipo: PayableTipo): string {
    return tipo === 'mensual' ? 'Mensual' : 'Cuotas fijas';
  }

  estadoLabel(estado: PayableDisplayEstado): string {
    if (estado === 'pagada') return 'Pagada';
    if (estado === 'vencida') return 'Vencida';
    return 'Pendiente';
  }

  estadoBadgeClass(estado: PayableDisplayEstado): string {
    if (estado === 'pagada') return 'bg-teal-100 text-teal-800';
    if (estado === 'vencida') return 'bg-red-100 text-red-800';
    return 'bg-amber-100 text-amber-800';
  }

  private syncActiveAmbitoTab(): void {
    const ambitos = this.cajaAmbitos;
    if (ambitos.length === 0) {
      this.activeAmbitoTab = getDefaultCashAmbitoId(this.appConfig);
      return;
    }
    if (!ambitos.some((ambito) => ambito.id === this.activeAmbitoTab)) {
      this.activeAmbitoTab = ambitos[0].id;
    }
  }

  reloadList(): void {
    this.payablesViewCacheKey = '';
    this.allInstallmentsCache = null;
    this.loadData();
  }

  private loadData(): void {
    this.loadCardStatements();
    this.payables.getObligations().subscribe({
      next: (obligations) => {
        this.obligations = obligations;
        this.syncPayablesView();
      },
      error: () => {
        this.obligations = [];
      },
    });
    this.loadInstallmentsForCurrentView(true);
  }

  private installmentsScopeForView(): 'month' | 'all' {
    return this.viewTab === 'month' ? 'month' : 'all';
  }

  private loadInstallmentsForCurrentView(force = false): void {
    const scope = this.installmentsScopeForView();
    const mes = scope === 'month' ? this.mesFilter.trim() : undefined;

    if (scope === 'all' && this.allInstallmentsCache && !force) {
      this.installments = this.allInstallmentsCache;
      this.loadingInstallments = false;
      this.syncPayablesView();
      return;
    }

    this.loadingInstallments = true;
    this.payables.getInstallments({ mes, scope, reconcile: force }).subscribe({
      next: (installments) => {
        this.installments = installments;
        if (scope === 'all') {
          this.allInstallmentsCache = installments;
        }
        this.loadingInstallments = false;
        this.syncPayablesView();
      },
      error: () => {
        this.installments = [];
        this.loadingInstallments = false;
        this.payablesViewCacheKey = '';
        this.syncPayablesView();
        this.dialog.alert({ message: 'No se pudieron cargar los vencimientos.' });
      },
    });
  }

  loadCardStatements(): void {
    this.payables.getCardStatements(this.mesFilter.trim() || undefined).subscribe({
      next: (summaries) => {
        this.cardStatements = summaries;
      },
      error: () => {
        this.cardStatements = [];
      },
    });
  }

}
