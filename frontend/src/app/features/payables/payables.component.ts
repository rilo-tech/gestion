import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CreatePayableObligationPayload,
  PayableDisplayEstado,
  PayableInstallment,
  PayableObligation,
  PayableTipo,
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
import {
  IconActionComponent,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  MODULE_TABLE_HEAD_CELL_NESTED_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
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

type PayablesViewTab = 'month' | 'account';

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
}

interface PayableAccountCardEntry {
  key: string;
  header: PayableAccountCardHeader;
  purchases: PayableAccountPurchaseEntry[];
  monthStatements: PayableAccountMonthStatement[];
}

interface ObligationPreset {
  id: string;
  label: string;
  beneficiario: string;
  tipo: PayableTipo;
  categoriaId?: string;
}

const OBLIGATION_PRESETS: ObligationPreset[] = [
  { id: 'vps', label: 'VPS / hosting', beneficiario: 'VPS / Hosting', tipo: 'mensual', categoriaId: 'servicios_cloud' },
  { id: 'luz', label: 'Luz / agua', beneficiario: 'Servicios públicos', tipo: 'mensual', categoriaId: 'servicios_publicos' },
  { id: 'alquiler', label: 'Alquiler', beneficiario: 'Alquiler', tipo: 'mensual', categoriaId: 'alquiler' },
];

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
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Cuentas a pagar"
        [showMobileSearch]="true"
        [searchQuery]="searchQuery"
        (searchQueryChange)="onSearchQueryChange($event)"
        searchFieldName="searchQueryMobile"
        activityModule="payables">
        <p headerExtra class="hidden sm:block text-xs text-gray-500 dark:text-gray-400 mt-1 leading-snug max-w-3xl">
          <span class="font-semibold text-gray-600 dark:text-gray-300">Aviso:</span>
          <span>
            en <span class="font-medium">Por mes</span> pagás cuota por cuota; en <span class="font-medium">Por cuenta</span> expandí la tarjeta para ver compras y, al elegir una, sus cuotas, o usá
            <span class="font-medium">Pagar resumen</span> en cada tarjeta.
          </span>
        </p>
        <app-icon-action headerActions label="Nuevo gasto fijo" (clicked)="openCreateModal()">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
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
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ '$' + totalPendiente }}</p>
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
                [class.border-transparent]="viewTab !== 'account'"
                [class.text-gray-500]="viewTab !== 'account'"
                [class.dark:text-gray-400]="viewTab !== 'account'">
                Por cuenta
              </button>
            </div>
          </div>
          <div class="sm:hidden px-2 py-2 border-b border-gray-100 dark:border-gray-800">
            <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
              {{ viewTab === 'month' ? 'Mes' : 'Cuenta' }}
            </label>
            <input
              *ngIf="viewTab === 'month'"
              type="month"
              [(ngModel)]="mesFilter"
              name="mesFilterMobile"
              (ngModelChange)="onMesFilterChange()"
              class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500"
              title="Mes de vencimiento" />
            <select
              *ngIf="viewTab === 'account'"
              [(ngModel)]="cuentaFilter"
              (ngModelChange)="onCuentaFilterChange()"
              name="cuentaFilterMobile"
              class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500">
              <option [ngValue]="''">Todas las cuentas</option>
              <option *ngFor="let t of tarjetaFilterOptions" [ngValue]="t.id">{{ t.label }}</option>
            </select>
          </div>
          <div [class]="desktopListSearchWrapClass + ' border-0 hidden sm:block'">
            <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div class="sm:flex-1 sm:min-w-[12rem]">
                <app-list-search-field
                  mode="filter"
                  [query]="searchQuery"
                  (queryChange)="onSearchQueryChange($event)"
                  name="searchQuery"
                  [placeholder]="viewTab === 'month' ? 'Buscar cuota, cuenta, compra...' : 'Buscar cuenta o compra...'"
                  extraClass="w-full">
                </app-list-search-field>
              </div>
              <div class="flex shrink-0 sm:pl-4 sm:border-l border-gray-200 dark:border-gray-700">
                <input
                  *ngIf="viewTab === 'month'"
                  type="month"
                  [(ngModel)]="mesFilter"
                  name="mesFilter"
                  (ngModelChange)="onMesFilterChange()"
                  class="w-full sm:w-auto min-w-[10.5rem] px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-teal-500"
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
              </div>
            </div>
          </div>
        </div>

        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <ng-container *ngIf="viewTab === 'month'">
            <app-compact-list-row
              *ngFor="let row of monthViewInstallments"
              (activate)="onMobileMonthRowActivate(row)"
              [disabled]="savingCuotaId === row.id">
              <div compactTitle class="compact-list-title truncate font-medium text-gray-900 dark:text-gray-100">
                {{ installmentCuentaLabel(row) }}
              </div>
              <div compactSubtitle class="compact-list-subtitle truncate">
                {{ formatDate(row.fechaVencimiento) }} · {{ cuotaLabel(row) }} · {{ installmentDetalleLabel(row) }}
              </div>
              <div compactTrailing class="flex flex-col items-end gap-0.5 shrink-0">
                <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{{ '$' + row.monto }}</span>
                <span
                  class="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                  [ngClass]="estadoBadgeClass(row.displayEstado)">
                  {{ estadoLabel(row.displayEstado) }}
                </span>
              </div>
            </app-compact-list-row>
            <p *ngIf="loading" [class]="compactListEmptyClass">Cargando vencimientos...</p>
            <p *ngIf="!loading && !mesFilter" [class]="compactListEmptyClass">
              Elegí un mes para ver las cuotas.
            </p>
            <p *ngIf="!loading && mesFilter && monthViewInstallments.length === 0" [class]="compactListEmptyClass">
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
                  <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">
                    {{ '$' + card.header.totalPending }}
                  </span>
                  <button
                    *ngIf="card.header.pendingCount > 0"
                    type="button"
                    (click)="openPayCardStatementForCard(card); $event.stopPropagation()"
                    class="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap text-right">
                    Pagar resumen
                    <span *ngIf="cardPayResumenHint(card) as hint" class="block font-normal opacity-80 capitalize">{{ hint }}</span>
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
                <ng-container *ngFor="let purchase of card.purchases">
                  <div class="pl-3 ml-2 border-l-2 border-teal-200/70 dark:border-teal-800/60">
                    <app-compact-list-row (activate)="toggleAccountPurchaseExpand(purchase.key)">
                      <div compactTitle class="compact-list-title truncate font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                        <i-lucide
                          [name]="isAccountPurchaseExpanded(purchase.key) ? 'chevron-down' : 'chevron-right'"
                          class="w-3.5 h-3.5 shrink-0 text-gray-400"></i-lucide>
                        {{ purchase.header.title }}
                      </div>
                      <div compactSubtitle class="compact-list-subtitle truncate">
                        {{ purchase.header.subtitle }}
                        <span *ngIf="purchase.header.nextDueDate"> · vence {{ formatDate(purchase.header.nextDueDate) }}</span>
                        · {{ '$' + purchase.header.totalPending }} pend.
                      </div>
                      <div compactTrailing class="shrink-0 text-[10px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                        {{ purchase.header.pendingCount }}/{{ purchase.header.count }}
                      </div>
                    </app-compact-list-row>

                    <div *ngIf="isAccountPurchaseExpanded(purchase.key)" class="border-t border-gray-100/80 dark:border-gray-800/80">
                      <app-compact-list-row
                        *ngFor="let row of purchase.rows"
                        (activate)="onMobileMonthRowActivate(row)"
                        [disabled]="savingCuotaId === row.id">
                        <div compactTitle class="compact-list-title truncate text-gray-800 dark:text-gray-200 pl-4">
                          {{ cuotaLabel(row) }} · {{ formatDate(row.fechaVencimiento) }}
                        </div>
                        <div compactSubtitle class="compact-list-subtitle truncate capitalize pl-4">
                          {{ formatMes(installmentMesKey(row)) }}
                        </div>
                        <div compactTrailing class="flex flex-col items-end gap-0.5 shrink-0">
                          <span class="text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{{ '$' + row.monto }}</span>
                          <span
                            class="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                            [ngClass]="estadoBadgeClass(row.displayEstado)">
                            {{ estadoLabel(row.displayEstado) }}
                          </span>
                        </div>
                      </app-compact-list-row>
                    </div>
                  </div>
                </ng-container>
              </div>
            </ng-container>
            <p *ngIf="loading" [class]="compactListEmptyClass">Cargando vencimientos...</p>
            <p *ngIf="!loading && accountViewCards.length === 0" [class]="compactListEmptyClass">
              {{ emptyAccountViewMessage }}
            </p>
          </ng-container>
        </div>

        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
          <app-module-data-table
            *ngIf="viewTab === 'month'"
            minWidthClass="min-w-[52rem]">
            <colgroup>
              <col style="width: 3.25rem" />
              <col style="width: 11rem" />
              <col style="width: 9rem" />
              <col style="width: 6.5rem" />
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
                [tone]="installmentRowTone(row)">
                <td app-module-table-cell align="right" [nowrap]="true" extraClass="tabular-nums text-gray-700 max-w-0">
                  {{ cuotaLabel(row) }}
                </td>
                <td app-module-table-cell extraClass="max-w-0 overflow-hidden">
                  <span class="block truncate font-medium text-gray-900 dark:text-gray-100" [title]="installmentCuentaLabel(row)">
                    {{ installmentCuentaLabel(row) }}
                  </span>
                </td>
                <td app-module-table-cell extraClass="max-w-0 overflow-hidden">
                  <span class="block truncate text-gray-600 dark:text-gray-400" [title]="installmentDetalleLabel(row)">
                    {{ installmentDetalleLabel(row) }}
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
                  {{ '$' + row.monto }}
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
                    (click)="togglePaid(row)"
                    [disabled]="savingCuotaId === row.id"
                    class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50">
                    Pagar cuota
                  </button>
                  <button
                    *ngIf="row.displayEstado === 'pagada'"
                    type="button"
                    (click)="togglePaid(row)"
                    [disabled]="savingCuotaId === row.id"
                    class="text-xs font-semibold text-gray-500 hover:underline whitespace-nowrap disabled:opacity-50">
                    Deshacer
                  </button>
                </td>
              </tr>
              <tr app-module-table-empty-row *ngIf="loading" [colspan]="7">Cargando vencimientos...</tr>
              <tr app-module-table-empty-row *ngIf="!loading && !mesFilter" [colspan]="7">
                Elegí un mes para ver las cuotas de todas las cuentas.
              </tr>
              <tr app-module-table-empty-row *ngIf="!loading && mesFilter && monthViewInstallments.length === 0" [colspan]="7">
                {{ emptyMonthViewMessage }}
              </tr>
            </tbody>
          </app-module-data-table>

          <app-module-data-table
            *ngIf="viewTab === 'account'"
            minWidthClass="min-w-[760px]">
            <colgroup>
              <col class="w-[2.5rem]" />
              <col class="w-[14rem]" />
              <col class="w-[12rem]" />
              <col class="w-[7rem]" />
              <col class="w-[6.5rem]" />
              <col class="w-[7.5rem]" />
            </colgroup>
            <thead app-module-table-head>
              <th app-module-table-head-cell></th>
              <th app-module-table-head-cell>Cuenta</th>
              <th app-module-table-head-cell>Resumen</th>
              <th app-module-table-head-cell [nowrap]="true">Próx. venc.</th>
              <th app-module-table-head-cell align="right" [nowrap]="true">Pendiente</th>
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
                  <td app-module-table-cell extraClass="text-gray-600 text-sm">
                    {{ accountCardSubtitle(card) }}
                  </td>
                  <td app-module-table-cell [nowrap]="true" extraClass="tabular-nums text-gray-700">
                    <span
                      *ngIf="card.header.nextDueDate"
                      [class.text-red-700]="card.header.summaryEstado === 'vencida'"
                      [class.font-semibold]="card.header.summaryEstado === 'vencida'">
                      {{ formatDate(card.header.nextDueDate) }}
                    </span>
                    <span *ngIf="!card.header.nextDueDate" class="text-gray-400">—</span>
                  </td>
                  <td app-module-table-cell align="right" [nowrap]="true" extraClass="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {{ '$' + card.header.totalPending }}
                  </td>
                  <td app-module-table-cell align="right">
                    <button
                      *ngIf="card.header.pendingCount > 0"
                      type="button"
                      (click)="openPayCardStatementForCard(card); $event.stopPropagation()"
                      class="inline-flex flex-col items-end text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap">
                      <span>Pagar resumen</span>
                      <span *ngIf="cardPayResumenHint(card) as hint" class="text-[10px] font-normal opacity-80 capitalize">{{ hint }}</span>
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
                  <td colspan="6" class="p-0 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40">
                    <div class="divide-y divide-gray-100 dark:divide-gray-800">
                      <div *ngFor="let purchase of card.purchases" class="border-l-4 border-teal-300/60 dark:border-teal-700/50">
                        <button
                          type="button"
                          (click)="toggleAccountPurchaseExpand(purchase.key)"
                          class="w-full px-4 py-2.5 bg-gray-100/50 dark:bg-gray-800/30 text-left hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors">
                          <div class="flex items-start gap-2">
                            <i-lucide
                              [name]="isAccountPurchaseExpanded(purchase.key) ? 'chevron-down' : 'chevron-right'"
                              class="w-4 h-4 shrink-0 text-gray-500 mt-0.5"></i-lucide>
                            <div class="min-w-0 flex-1">
                              <p class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ purchase.header.title }}</p>
                              <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {{ purchase.header.subtitle }}
                                <span *ngIf="purchase.header.nextDueDate"> · vence {{ formatDate(purchase.header.nextDueDate) }}</span>
                                · {{ '$' + purchase.header.totalPending }} pend.
                              </p>
                            </div>
                            <span class="shrink-0 text-[11px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                              {{ purchase.header.pendingCount }}/{{ purchase.header.count }} cuotas
                            </span>
                          </div>
                        </button>
                        <table
                          *ngIf="isAccountPurchaseExpanded(purchase.key)"
                          [class]="nativeCompactTableClass + ' module-table-nested module-data-table-layout w-full'">
                          <thead>
                            <tr class="bg-gray-100/80 dark:bg-gray-800/60">
                              <th [class]="moduleTableHeadNestedClass + ' text-right'">Cuota</th>
                              <th [class]="moduleTableHeadNestedClass">Venc.</th>
                              <th [class]="moduleTableHeadNestedClass">Mes</th>
                              <th [class]="moduleTableHeadNestedClass + ' text-right'">Monto</th>
                              <th [class]="moduleTableHeadNestedClass">Estado</th>
                              <th [class]="moduleTableHeadNestedClass + ' text-right'">Acción</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
                            <tr
                              app-module-table-row
                              *ngFor="let row of purchase.rows"
                              [tone]="installmentRowTone(row)"
                              [hover]="false">
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
                              <td app-module-table-cell nested [nowrap]="true" extraClass="text-gray-600 capitalize">
                                {{ formatMes(installmentMesKey(row)) }}
                              </td>
                              <td app-module-table-cell nested align="right" [nowrap]="true" extraClass="font-semibold tabular-nums">
                                {{ '$' + row.monto }}
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
                                  (click)="togglePaid(row)"
                                  [disabled]="savingCuotaId === row.id"
                                  class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50">
                                  Pagar cuota
                                </button>
                                <button
                                  *ngIf="row.displayEstado === 'pagada'"
                                  type="button"
                                  (click)="togglePaid(row)"
                                  [disabled]="savingCuotaId === row.id"
                                  class="text-xs font-semibold text-gray-500 hover:underline whitespace-nowrap disabled:opacity-50">
                                  Deshacer
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              </ng-container>

              <tr app-module-table-empty-row *ngIf="loading" [colspan]="6">
                Cargando vencimientos...
              </tr>
              <tr app-module-table-empty-row *ngIf="!loading && accountViewCards.length === 0" [colspan]="6">
                {{ emptyAccountViewMessage }}
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
              <tr *ngFor="let item of mensualObligations" class="hover:bg-gray-50">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">{{ item.beneficiario }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ '$' + item.monto }}</td>
                <td class="hidden sm:table-cell px-6 py-3 text-sm text-gray-600">{{ formatDate(item.fechaPrimerVencimiento) }}</td>
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
                <td class="px-4 sm:px-6 py-3 text-right">
                  <div class="inline-flex gap-2">
                    <button
                      type="button"
                      (click)="toggleObligationActive(item)"
                      [disabled]="savingObligationId === item.id"
                      class="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50">
                      {{ item.activo ? 'Desactivar' : 'Reactivar' }}
                    </button>
                    <button
                      type="button"
                      (click)="confirmDeleteObligation(item)"
                      class="text-xs font-semibold text-red-600 hover:underline">
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
      [open]="createModalOpen"
      title="Nuevo gasto fijo o servicio"
      subtitle="Para sueldos, VPS, luz, agua, alquiler y otros pagos que no pasan por Compras."
      (closed)="closeCreateModal()">
      <form class="space-y-4" (ngSubmit)="submitCreate()">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Atajo rápido</label>
          <div class="flex flex-wrap gap-2">
            <button
              *ngFor="let preset of obligationPresets"
              type="button"
              (click)="applyPreset(preset)"
              class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors"
              [class.border-teal-500]="form.presetId === preset.id"
              [class.bg-teal-50]="form.presetId === preset.id"
              [class.text-teal-700]="form.presetId === preset.id"
              [class.border-gray-200]="form.presetId !== preset.id"
              [class.text-gray-700]="form.presetId !== preset.id">
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div *ngIf="usesAmbitoSeparation">
          <label class="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
          <div class="flex flex-wrap gap-2">
            <button
              *ngFor="let ambito of cajaAmbitos"
              type="button"
              (click)="formAmbito = ambito.id"
              class="px-3 py-2 rounded-lg border text-sm font-semibold transition-colors"
              [class.border-teal-500]="formAmbito === ambito.id"
              [class.bg-teal-50]="formAmbito === ambito.id"
              [class.text-teal-700]="formAmbito === ambito.id"
              [class.border-gray-200]="formAmbito !== ambito.id"
              [class.text-gray-700]="formAmbito !== ambito.id">
              {{ ambito.label }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Concepto / beneficiario</label>
          <input
            [(ngModel)]="form.beneficiario"
            name="beneficiario"
            required
            placeholder="Ej: Sueldo María, VPS DigitalOcean, EDESUR..."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Categoría (opcional)</label>
          <select
            [(ngModel)]="form.categoriaId"
            name="categoriaId"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">Sin categoría</option>
            <option *ngFor="let cat of categoriasGasto" [ngValue]="cat.id">{{ cat.label }}</option>
          </select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Monto</label>
            <input
              [(ngModel)]="form.monto"
              name="monto"
              type="number"
              min="0"
              step="0.01"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Primer vencimiento</label>
            <input
              [(ngModel)]="form.fechaPrimerVencimiento"
              name="fechaPrimerVencimiento"
              type="date"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Tipo de pago</label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
              [class.border-teal-500]="form.tipo === 'unico'"
              [class.bg-teal-50]="form.tipo === 'unico'"
              [class.border-gray-200]="form.tipo !== 'unico'">
              <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="unico" class="mt-1">
              <span>
                <span class="block text-sm font-semibold text-gray-900">Pago único / en cuotas</span>
                <span class="block text-xs text-gray-500 mt-0.5">Una vez o N cuotas mensuales (ej. 12 pagos).</span>
              </span>
            </label>
            <label
              class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
              [class.border-teal-500]="form.tipo === 'mensual'"
              [class.bg-teal-50]="form.tipo === 'mensual'"
              [class.border-gray-200]="form.tipo !== 'mensual'">
              <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="mensual" class="mt-1">
              <span>
                <span class="block text-sm font-semibold text-gray-900">Mensual recurrente</span>
                <span class="block text-xs text-gray-500 mt-0.5">Se repite cada mes hasta que lo desactives.</span>
              </span>
            </label>
          </div>
        </div>

        <div *ngIf="form.tipo === 'unico'">
          <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad de pagos</label>
          <input
            [(ngModel)]="form.cantidadCuotas"
            name="cantidadCuotas"
            type="number"
            min="1"
            max="120"
            required
            class="w-full sm:max-w-xs px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          <p class="text-xs text-gray-500 mt-1">1 = un solo pago. 12 = doce cuotas mensuales desde la fecha indicada.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            [(ngModel)]="form.notas"
            name="notas"
            placeholder="Referencia, CBU, etc."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>

        <app-modal-form-footer
          [saving]="creating"
          primaryLabel="Crear"
          (cancelClick)="closeCreateModal()"
          (primaryClick)="submitCreate()">
        </app-modal-form-footer>
      </form>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="payCardModalOpen"
      title="Pagar resumen"
      [subtitle]="payCardModalSubtitle"
      [hideSubtitleOnMobile]="false"
      (closed)="closePayCardModal()">
      <div *ngIf="payCardTarget as target" class="space-y-4">
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
                {{ '$' + row.monto }}
              </span>
            </li>
          </ul>
        </div>

        <div class="rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-900 px-4 py-3 flex justify-between items-center">
          <span class="text-sm text-teal-900 dark:text-teal-200">Total · un egreso de caja</span>
          <span class="text-lg font-bold tabular-nums text-teal-900 dark:text-teal-100">{{ '$' + target.total }}</span>
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
          primaryLabel="Confirmar pago del resumen"
          (cancelClick)="closePayCardModal()"
          (primaryClick)="submitPayCardStatement()">
        </app-modal-form-footer>
      </div>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="payCuotaModalOpen"
      title="Pagar cuota"
      [subtitle]="payCuotaModalSubtitle"
      [hideSubtitleOnMobile]="false"
      (closed)="closePayCuotaModal()">
      <div *ngIf="payCuotaTarget as target" class="space-y-4">
        <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-1">
          <p class="text-base font-bold text-gray-900 dark:text-gray-100">{{ installmentCuentaLabel(target) }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-300">{{ installmentCuotaCompraLabel(target) }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Vence {{ formatDate(target.fechaVencimiento) }} · {{ formatMes(installmentMesKey(target)) }}
          </p>
        </div>
        <div class="rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-900 px-4 py-3 flex justify-between items-center">
          <span class="text-sm text-teal-900 dark:text-teal-200">Monto · un egreso de caja</span>
          <span class="text-lg font-bold tabular-nums text-teal-900 dark:text-teal-100">{{ '$' + target.monto }}</span>
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
          primaryLabel="Confirmar pago de la cuota"
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
  private configSub?: Subscription;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly moduleTableHeadNestedClass = MODULE_TABLE_HEAD_CELL_NESTED_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly payablesTabButtonClass =
    'px-2.5 py-1 text-[11px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap sm:px-4 sm:py-2 sm:text-sm';
  readonly payablesTabRowClass =
    'flex gap-0.5 sm:gap-1 overflow-x-auto';

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  activeAmbitoTab = '';
  formAmbito = '';

  installments: PayableInstallment[] = [];
  obligations: PayableObligation[] = [];
  cardStatements: CardStatementSummary[] = [];
  payCardModalOpen = false;
  payCardTarget: CardStatementSummary | null = null;
  payCardPendingRows: PayableInstallment[] = [];
  payCardMedioId = 'transferencia';
  payingCardStatement = false;
  payCuotaModalOpen = false;
  payCuotaTarget: PayableInstallment | null = null;
  payCuotaMedioId = 'transferencia';
  payingCuota = false;
  loading = true;
  createModalOpen = false;
  creating = false;
  savingCuotaId: string | null = null;
  savingObligationId: string | null = null;

  searchQuery = '';
  mesFilter = '';
  cuentaFilter = '';
  viewTab: PayablesViewTab = 'month';
  expandedAccountCardKeys: Record<string, boolean> = {};
  expandedAccountPurchaseKeys: Record<string, boolean> = {};

  tarjetaFilterOptions: { id: string; label: string }[] = [];
  monthViewInstallments: PayableInstallment[] = [];
  accountViewCards: PayableAccountCardEntry[] = [];
  mensualObligations: PayableObligation[] = [];
  kpiScopePrefix = '';
  countPendientes = 0;
  countVencidas = 0;
  countPagadas = 0;
  totalPendiente = 0;

  private payablesViewCacheKey = '';

  readonly obligationPresets = OBLIGATION_PRESETS;

  form = this.emptyForm();

  ngOnInit(): void {
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
    this.expandedAccountPurchaseKeys = {};
    this.syncPayablesView();
  }

  onMobileMonthRowActivate(row: PayableInstallment): void {
    this.togglePaid(row);
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
      this.cuentaFilter,
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
  }): PayableInstallment[] {
    const query = this.searchQuery.trim().toLowerCase();
    const mes = this.mesFilter.trim();
    return this.getScopedInstallments().filter((row) => {
      if (opts.applyMes) {
        if (!mes) return false;
        if (this.installmentMesKey(row) !== mes) return false;
      }
      if (opts.applyCuenta && this.cuentaFilter) {
        if (row.tarjetaId !== this.cuentaFilter) return false;
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

    return Array.from(byCard.entries())
      .map(([key, cardRows]) => {
        const sortedCardRows = this.sortInstallments(cardRows);
        const byPurchase = new Map<string, PayableInstallment[]>();

        for (const row of sortedCardRows) {
          const purchaseKey = this.purchaseGroupKey(row);
          const list = byPurchase.get(purchaseKey) ?? [];
          list.push(row);
          byPurchase.set(purchaseKey, list);
        }

        const purchases: PayableAccountPurchaseEntry[] = Array.from(byPurchase.entries())
          .map(([purchaseKey, groupRows]) => {
            const sorted = this.sortInstallments(groupRows);
            const first = sorted[0];
            const summary = this.buildInstallmentGroupSummary(sorted);
            return {
              key: `${key}|${purchaseKey}`,
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

        const first = sortedCardRows[0];
        return {
          key,
          header: {
            ...this.buildInstallmentGroupSummary(sortedCardRows),
            tarjetaId: first?.tarjetaId ?? '',
            tarjetaLabel: first?.tarjetaLabel ?? first?.beneficiario ?? 'Cuenta',
          },
          purchases,
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

  accountCardSubtitle(card: PayableAccountCardEntry): string {
    const h = card.header;
    const parts = [`${h.purchaseCount} compra(s)`, `${h.pendingCount} cuota(s) pend.`];
    if (h.nextDueDate) parts.push(`próx. ${this.formatDate(h.nextDueDate)}`);
    return parts.join(' · ');
  }

  cardPayResumenHint(card: PayableAccountCardEntry): string | null {
    const stmt = card.monthStatements[0];
    if (!stmt) return null;
    return `Resumen ${this.formatMes(stmt.mes)}`;
  }

  get emptyMonthViewMessage(): string {
    return 'No hay vencimientos en este mes.';
  }

  get emptyAccountViewMessage(): string {
    if (this.cuentaFilter) {
      return 'No hay cuotas para esta cuenta.';
    }
    return 'No hay cuotas para mostrar.';
  }

  setViewTab(tab: PayablesViewTab): void {
    if (this.viewTab === tab) return;
    this.viewTab = tab;
    if (tab === 'account') {
      this.expandedAccountCardKeys = {};
      this.expandedAccountPurchaseKeys = {};
    }
    if (tab === 'month' && !this.mesFilter) {
      this.mesFilter = new Date().toISOString().slice(0, 7);
      this.onMesFilterChange();
    } else {
      this.syncPayablesView();
    }
  }

  monthRowTitle(row: PayableInstallment): string {
    return `${this.cuotaLabel(row)} · ${this.installmentCuentaLabel(row)}`;
  }

  monthRowSubtitle(row: PayableInstallment): string {
    return `${this.installmentDetalleLabel(row)} · ${this.formatDate(row.fechaVencimiento)}`;
  }

  installmentCuentaLabel(row: PayableInstallment): string {
    if (row.tarjetaLabel?.trim()) return row.tarjetaLabel.trim();
    if (row.compraId) return 'Sin cuenta';
    return row.beneficiario;
  }

  installmentDetalleLabel(row: PayableInstallment): string {
    if (row.compraLabel) return `Compra #${row.compraLabel}`;
    const ben = row.beneficiario?.trim() ?? '';
    if (row.tarjetaLabel && ben.startsWith(row.tarjetaLabel)) {
      const rest = ben.slice(row.tarjetaLabel.length).replace(/^\s*·\s*/, '').trim();
      return rest || '—';
    }
    return ben || '—';
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
    this.payCardModalOpen = true;
  }

  get payCardModalSubtitle(): string {
    if (!this.payCardTarget) return '';
    return `${this.payCardTarget.tarjetaLabel} · ${this.formatMes(this.payCardTarget.mes)}`;
  }

  get payCuotaModalSubtitle(): string {
    if (!this.payCuotaTarget) return '';
    return `${this.installmentCuentaLabel(this.payCuotaTarget)} · vence ${this.formatDate(this.payCuotaTarget.fechaVencimiento)}`;
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
  }

  submitPayCardStatement(): void {
    if (!this.payCardTarget || this.payingCardStatement) return;

    this.payingCardStatement = true;
    this.payables
      .payCardStatement({
        tarjetaId: this.payCardTarget.tarjetaId,
        mes: this.payCardTarget.mes,
        medioPagoId: this.payCardMedioId,
        ambito: this.usesAmbitoSeparation ? this.payCardTarget.ambito : undefined,
      })
      .subscribe({
        next: (result) => {
          this.payingCardStatement = false;
          this.closePayCardModal();
          this.dialog.alert({
            title: 'Resumen pagado',
            message: `Se marcaron ${result.cuotasPagadas} cuotas como pagadas por $${result.total}.`,
          });
          this.loadData();
        },
        error: (err) => {
          this.payingCardStatement = false;
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
    this.syncPayablesView();
    this.loadCardStatements();
  }

  isAccountCardExpanded(key: string): boolean {
    return !!this.expandedAccountCardKeys[key];
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
      this.collapsePurchasesForAccount(key);
    }
  }

  toggleAccountPurchaseExpand(key: string): void {
    this.expandedAccountPurchaseKeys = {
      ...this.expandedAccountPurchaseKeys,
      [key]: !this.expandedAccountPurchaseKeys[key],
    };
  }

  private collapsePurchasesForAccount(cardKey: string): void {
    const prefix = `${cardKey}|`;
    const next = { ...this.expandedAccountPurchaseKeys };
    let changed = false;
    for (const purchaseKey of Object.keys(next)) {
      if (purchaseKey.startsWith(prefix)) {
        delete next[purchaseKey];
        changed = true;
      }
    }
    if (changed) {
      this.expandedAccountPurchaseKeys = next;
    }
  }

  openPayCardStatementForCard(card: PayableAccountCardEntry): void {
    const stmt = card.monthStatements[0];
    if (!stmt) return;
    this.openPayCardStatementForMonth(card, stmt);
  }

  openPayCardStatementForMonth(
    card: PayableAccountCardEntry,
    stmt: PayableAccountMonthStatement
  ): void {
    const pendingRows = stmt.rows.filter((row) => row.displayEstado !== 'pagada');
    const ambito = (stmt.rows[0]?.ambito ?? 'negocio').trim().toLowerCase();
    const match = this.scopedCardStatements.find(
      (row) =>
        row.tarjetaId === card.header.tarjetaId &&
        row.mes === stmt.mes &&
        row.ambito === ambito
    );
    this.openPayCardStatement(
      match ?? this.buildCardStatementFromMonth(card, stmt),
      pendingRows
    );
  }

  installmentCuotaCompraLabel(row: PayableInstallment): string {
    const compra = row.compraLabel ? `Compra #${row.compraLabel}` : 'Compra';
    return `${compra} · Cuota ${this.cuotaLabel(row)}`;
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
    this.form = this.emptyForm();
    this.formAmbito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);
    this.createModalOpen = true;
  }

  applyPreset(preset: ObligationPreset): void {
    this.form.presetId = preset.id;
    this.form.beneficiario = preset.beneficiario;
    this.form.tipo = preset.tipo;
    this.form.cantidadCuotas = 1;
    this.form.categoriaId = preset.categoriaId ?? '';
    const cat = this.categoriasGasto.find((c) => c.id === preset.categoriaId);
    if (cat && this.usesAmbitoSeparation) {
      this.formAmbito = cat.ambitoDefault;
    }
  }

  closeCreateModal(): void {
    this.createModalOpen = false;
  }

  submitCreate(): void {
    const payload = this.buildPayload();
    if (!payload) {
      this.dialog.alert({ message: 'Completá beneficiario, monto y fecha de vencimiento.' });
      return;
    }

    this.creating = true;
    this.payables.createObligation(payload).subscribe({
      next: () => {
        this.creating = false;
        this.closeCreateModal();
        this.loadData();
      },
      error: () => {
        this.creating = false;
        this.dialog.alert({ message: 'No se pudo crear la obligación.' });
      },
    });
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
    this.payCuotaModalOpen = true;
  }

  closePayCuotaModal(): void {
    this.payCuotaModalOpen = false;
    this.payCuotaTarget = null;
  }

  submitPayCuota(): void {
    if (!this.payCuotaTarget || this.payingCuota) return;

    this.payingCuota = true;
    this.payables
      .setInstallmentPaid(this.payCuotaTarget.id, true, this.payCuotaMedioId)
      .subscribe({
        next: (updated) => {
          this.payingCuota = false;
          this.installments = this.installments.map((item) =>
            item.id === updated.id ? updated : item
          );
          this.payablesViewCacheKey = '';
          this.syncPayablesView();
          this.closePayCuotaModal();
        },
        error: (err) => {
          this.payingCuota = false;
          this.dialog.alert({
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago.',
          });
        },
      });
  }

  toggleObligationActive(item: PayableObligation): void {
    this.savingObligationId = item.id;
    this.payables.setObligationActive(item.id, !item.activo).subscribe({
      next: (updated) => {
        this.obligations = this.obligations.map((row) =>
          row.id === updated.id ? updated : row
        );
        this.savingObligationId = null;
        this.loadInstallments();
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

  formatDate(value: string): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    if (!year || !month || !day) return value;
    return `${day}/${month}/${year}`;
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

  private loadData(): void {
    this.loading = true;
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
    this.loadInstallments();
  }

  private loadInstallments(): void {
    this.payables.getInstallments().subscribe({
      next: (installments) => {
        this.installments = installments;
        this.loading = false;
        this.syncPayablesView();
      },
      error: () => {
        this.installments = [];
        this.loading = false;
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

  private emptyForm() {
    return {
      presetId: '',
      beneficiario: '',
      monto: null as number | null,
      tipo: 'mensual' as PayableTipo,
      cantidadCuotas: 1,
      fechaPrimerVencimiento: new Date().toISOString().slice(0, 10),
      notas: '',
      categoriaId: '',
    };
  }

  private buildPayload(): CreatePayableObligationPayload | null {
    const beneficiario = this.form.beneficiario.trim();
    const monto = Number(this.form.monto);
    const fechaPrimerVencimiento = this.form.fechaPrimerVencimiento?.trim();
    if (!beneficiario || !fechaPrimerVencimiento || !Number.isFinite(monto) || monto <= 0) {
      return null;
    }

    const payload: CreatePayableObligationPayload = {
      beneficiario,
      monto,
      tipo: this.form.tipo,
      cantidadCuotas:
        this.form.tipo === 'unico'
          ? Math.min(Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1)), 120)
          : 1,
      fechaPrimerVencimiento,
      ambito: this.usesAmbitoSeparation ? this.formAmbito : undefined,
      notas: this.form.notas.trim() || undefined,
      categoriaId: this.form.categoriaId.trim() || undefined,
    };

    return payload;
  }
}
