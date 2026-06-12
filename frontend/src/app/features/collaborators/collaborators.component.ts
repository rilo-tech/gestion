import { Component, DestroyRef, Injector, inject, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import {
  Collaborator,
  CollaboratorMovement,
  CollaboratorsPeriodSummary,
  CollaboratorsService,
  CollaboratorSummaryRow,
  MODALIDAD_LABELS,
  MOVEMENT_TIPO_LABELS,
  PERIODO_LABELS,
  todayDate,
  weekEndDate,
  weekStartDate,
} from '../../core/services/collaborators.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getMediosPagoActivos,
  getCollaboratorExtraTipos,
  getCollaboratorExtraTipoLabel,
  type CollaboratorExtraTipoConfig,
} from '../../core/services/catalog-config.service';
import {
  SearchableSelectComponent,
  type SearchableSelectOption,
} from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar/record-action-toolbar.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import {
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { LucideAngularModule } from 'lucide-angular';
import {
  COMPACT_LIST_EMPTY_CLASS,
  COMPACT_LIST_SUBTITLE_CLASS,
  COMPACT_LIST_TITLE_CLASS,
  EXPANDED_NESTED_WRAP_CLASS,
  MODULE_TABLE_HEAD_CELL_NESTED_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import { Subscription, finalize } from 'rxjs';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';
import { formatDisplayDate, formatDisplayDateRange } from '../../core/utils/transaction-date';

type ActiveTab = 'resumen' | 'movimientos' | 'equipo';
type MovementModalMode = 'horas' | 'extra' | 'pago';
type HoursEntryMode = 'cantidad' | 'franja';

interface PayLiquidationTarget {
  colaboradorId: string;
  nombre: string;
  monto: number;
  subtitle: string;
  liquidacionMovimientoId?: string;
  periodoDesde?: string;
  periodoHasta?: string;
}

function hoursFromTimeRange(horaDesde: string, horaHasta: string): number | null {
  const parseClock = (value: string): number | null => {
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59 || hours > 23) {
      return null;
    }
    return hours * 60 + minutes;
  };

  const start = parseClock(horaDesde);
  const end = parseClock(horaHasta);
  if (start === null || end === null) return null;
  let endMinutes = end;
  if (endMinutes <= start) endMinutes += 24 * 60;
  const diff = endMinutes - start;
  if (diff <= 0) return null;
  return Math.round((diff / 60) * 100) / 100;
}

@Component({
  selector: 'app-collaborators',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    TransactionModalComponent,
    IconActionComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    FormPanelFooterComponent,
    ModalFormFooterComponent,
    TransactionSaveBannerComponent,
    RecordActionToolbarComponent,
    ModulePageHeaderComponent,
    ListSearchFieldComponent,
    CompactDataListComponent,
    CompactListRowComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Colaboradores"
        description="Horarios, sueldos, extras (repartos, aguinaldo, premios) y pagos."
        [showMobileSearch]="activeTab === 'movimientos'"
        [(searchQuery)]="movementSearch"
        (searchQueryChange)="movementsPage = 1"
        searchFieldName="movementSearchMobile"
        activityModule="collaborators"
        [showRefresh]="true"
        (refreshClick)="loadData()">
        <app-icon-action headerActions *ngIf="auth.canEditRecords" label="Registrar horas" variant="secondary" (clicked)="openMovementModal('horas')">
          <i-lucide name="clock" class="w-4 h-4"></i-lucide>
        </app-icon-action>
        <app-icon-action headerActions *ngIf="auth.canEditRecords" label="Extra / aguinaldo" variant="secondary" (clicked)="openMovementModal('extra')">
          <i-lucide name="gift" class="w-4 h-4"></i-lucide>
        </app-icon-action>
        <app-icon-action headerActions *ngIf="auth.canEditRecords" label="Registrar pago" (clicked)="openMovementModal('pago')">
          <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
        </app-icon-action>
        <app-icon-action headerActions *ngIf="auth.canEditRecords" label="Nuevo colaborador" (clicked)="openCollaboratorModal()">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
      </app-module-page-header>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label class="block min-w-0">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Desde</span>
              <input type="date" [(ngModel)]="periodFrom" name="periodFrom" (change)="onPeriodChange()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block min-w-0">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Hasta</span>
              <input type="date" [(ngModel)]="periodTo" name="periodTo" (change)="onPeriodChange()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block min-w-0 col-span-2 sm:col-span-1">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Filtrar colaborador</span>
              <app-searchable-select
                [(ngModel)]="filterColaboradorId"
                name="filterColaborador"
                [labeledOptions]="collaboratorOptions"
                placeholder="Todos"
                emptyListMessage="Sin colaboradores"
                (ngModelChange)="loadData()">
              </app-searchable-select>
            </label>
          </div>
        </div>
      </div>

      <div *ngIf="summary" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Horas</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatQty(summary.totalHoras) }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Devengado</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatMoney(summary.totalDevengado) }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-amber-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Extras</p>
          <p class="text-xl sm:text-2xl font-bold text-amber-600 tabular-nums">{{ formatMoney(summary.totalExtras) }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-teal-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Pagado</p>
          <p class="text-xl sm:text-2xl font-bold text-teal-600 tabular-nums">{{ formatMoney(summary.totalPagado) }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-orange-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Pendiente período</p>
          <p class="text-xl sm:text-2xl font-bold text-orange-600 tabular-nums">{{ formatMoney(summary.totalPendientePeriodo) }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Saldo acumulado</p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatMoney(summary.totalSaldoAcumulado) }}</p>
        </div>
      </div>

      <div class="mb-6 flex gap-2 border-b border-gray-200 overflow-x-auto">
        <button *ngFor="let tab of tabs" type="button" (click)="activeTab = tab.id"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap"
          [class.border-teal-600]="activeTab === tab.id"
          [class.text-teal-700]="activeTab === tab.id"
          [class.border-transparent]="activeTab !== tab.id"
          [class.text-gray-500]="activeTab !== tab.id">
          {{ tab.label }}
        </button>
      </div>

      <div *ngIf="activeTab === 'resumen'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-900">Cuánto corresponde pagar en el período</h2>
        </div>

        <div [class]="nativeCompactListClass + ' sm:hidden'">
          <ng-container *ngFor="let row of paginatedSummaryRows">
            <div class="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                class="w-full text-left px-3 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                (click)="toggleSummaryExpand(row.colaboradorId)">
                <div class="flex items-start gap-2">
                  <i-lucide
                    [name]="isSummaryExpanded(row.colaboradorId) ? 'chevron-down' : 'chevron-right'"
                    class="w-4 h-4 text-gray-500 shrink-0 mt-0.5">
                  </i-lucide>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-gray-900 truncate">{{ row.nombre }}</div>
                    <div class="text-[11px] text-gray-500 mt-0.5">
                      {{ summaryMovementsCount(row.colaboradorId) }} registro(s)
                      <span *ngIf="!row.activo" class="text-gray-400"> · inactivo</span>
                    </div>
                    <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt class="text-gray-400">Pendiente</dt>
                      <dd
                        class="text-right font-semibold tabular-nums"
                        [class.text-orange-600]="row.pendientePeriodo > 0">
                        {{ formatMoney(row.pendientePeriodo) }}
                      </dd>
                      <dt class="text-gray-400">Devengado</dt>
                      <dd class="text-right tabular-nums text-gray-800">{{ formatMoney(row.devengado) }}</dd>
                      <dt class="text-gray-400">Horas</dt>
                      <dd class="text-right tabular-nums text-gray-700">{{ formatQty(row.horas) }}</dd>
                      <dt class="text-gray-400">Saldo total</dt>
                      <dd class="text-right tabular-nums text-gray-700">{{ formatMoney(row.saldoAcumulado) }}</dd>
                    </dl>
                  </div>
                </div>
              </button>
              <div *ngIf="auth.canEditRecords && canPayBalance(row)" class="px-3 pb-3 -mt-1">
                <button
                  type="button"
                  [disabled]="payingLiquidation"
                  class="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50"
                  (click)="openPayBalance(row, $event)">
                  Pagar
                </button>
              </div>
              <div *ngIf="isSummaryExpanded(row.colaboradorId)" class="px-3 pb-3 bg-gray-50/80 border-t border-gray-100">
                <div
                  *ngFor="let mov of movementsForCollaborator(row.colaboradorId)"
                  class="py-2.5 border-b border-gray-100 last:border-b-0 text-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-xs text-gray-500 tabular-nums">{{ formatDate(mov.fecha) }}</div>
                      <div class="font-medium text-gray-900 mt-0.5">{{ movementTipoLabel(mov) }}</div>
                      <div class="text-xs text-gray-600 mt-0.5 break-words">
                        <span *ngIf="mov.tipo === 'horas'">{{ movementHorasDetalle(mov) }}</span>
                        <span *ngIf="mov.tipo === 'extra'">{{ extraLabel(mov.extraTipo) }}<span *ngIf="mov.concepto"> · {{ mov.concepto }}</span></span>
                        <span *ngIf="mov.tipo === 'pago'">Pago<span *ngIf="mov.periodoDesde"> · {{ formatPeriodRange(mov.periodoDesde, mov.periodoHasta) }}</span></span>
                      </div>
                    </div>
                    <div class="shrink-0 text-right">
                      <div class="font-semibold tabular-nums" [class.text-teal-700]="mov.tipo === 'pago'">
                        {{ formatMoney(mov.monto) }}
                      </div>
                      <button
                        *ngIf="auth.canEditRecords && canPayAccrual(mov)"
                        type="button"
                        [disabled]="payingLiquidation"
                        class="mt-1 text-[11px] font-semibold text-teal-700 hover:underline disabled:opacity-50"
                        (click)="openPayAccrual(mov, $event)">
                        Registrar pago
                      </button>
                      <span
                        *ngIf="auth.canEditRecords && isAccrualLiquidated(mov)"
                        class="mt-1 block text-[11px] font-semibold text-teal-600">
                        Liquidado
                      </span>
                    </div>
                  </div>
                </div>
                <p
                  *ngIf="!movementsForCollaborator(row.colaboradorId).length"
                  class="py-3 text-center text-xs text-gray-400">
                  Sin registros en este período.
                </p>
              </div>
            </div>
          </ng-container>
          <p *ngIf="!summaryRows.length" [class]="compactListEmptyClass">Sin movimientos en el período.</p>
        </div>

        <div class="hidden sm:block" [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="w-10 px-3 py-3"></th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Colaborador</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Horas</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Por horas</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Extras</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Devengado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pagado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pendiente</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Saldo total</th>
                <th
                  *ngIf="auth.canEditRecords"
                  class="px-3 sm:px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-right whitespace-nowrap">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <ng-container *ngFor="let row of paginatedSummaryRows">
                <tr
                  [class]="listTableRowClass"
                  (click)="toggleSummaryExpand(row.colaboradorId)">
                  <td class="px-3 py-3 text-center">
                    <i-lucide
                      [name]="isSummaryExpanded(row.colaboradorId) ? 'chevron-down' : 'chevron-right'"
                      class="w-4 h-4 text-gray-500 inline-block">
                    </i-lucide>
                  </td>
                  <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900 min-w-0">
                    <span class="font-medium text-gray-900">{{ row.nombre }}</span>
                    <span *ngIf="!row.activo" class="ml-2 text-xs text-gray-400">(inactivo)</span>
                    <span class="ml-2 text-xs font-normal text-gray-400">
                      {{ summaryMovementsCount(row.colaboradorId) }} registro(s)
                    </span>
                  </td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatQty(row.horas) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatMoney(row.montoHoras) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatMoney(row.montoExtras) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums font-medium">{{ formatMoney(row.devengado) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-teal-700">{{ formatMoney(row.pagado) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums" [class.text-orange-600]="row.pendientePeriodo > 0" [class.font-semibold]="row.pendientePeriodo > 0">
                    {{ formatMoney(row.pendientePeriodo) }}
                  </td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatMoney(row.saldoAcumulado) }}</td>
                  <td *ngIf="auth.canEditRecords" class="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                    <button
                      *ngIf="canPayBalance(row)"
                      type="button"
                      [disabled]="payingLiquidation"
                      class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      (click)="openPayBalance(row, $event)">
                      Pagar
                    </button>
                    <span *ngIf="!canPayBalance(row)" class="text-xs text-gray-400">—</span>
                  </td>
                </tr>
                <tr *ngIf="isSummaryExpanded(row.colaboradorId)">
                  <td [attr.colspan]="auth.canEditRecords ? 10 : 9" class="p-0 bg-gray-50/80 border-b border-gray-100">
                    <div [class]="expandedNestedWrapClass">
                      <table [class]="nativeCompactTableClass + ' w-full'">
                        <thead>
                          <tr class="bg-gray-100/80">
                            <th [class]="moduleTableHeadNestedClass">Fecha</th>
                            <th [class]="moduleTableHeadNestedClass">Tipo</th>
                            <th [class]="moduleTableHeadNestedClass">Detalle</th>
                            <th [class]="moduleTableHeadNestedClass + ' text-right'">Monto</th>
                            <th *ngIf="auth.canEditRecords" [class]="moduleTableHeadNestedClass + ' text-right'">Acción</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                          <tr
                            *ngFor="let mov of movementsForCollaborator(row.colaboradorId)"
                            class="bg-white">
                            <td class="px-3 py-2 text-sm text-gray-600 whitespace-nowrap tabular-nums">{{ formatDate(mov.fecha) }}</td>
                            <td class="px-3 py-2 text-sm">
                              <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                [class.bg-blue-50]="mov.tipo === 'horas'"
                                [class.text-blue-700]="mov.tipo === 'horas'"
                                [class.bg-amber-50]="mov.tipo === 'extra'"
                                [class.text-amber-700]="mov.tipo === 'extra'"
                                [class.bg-teal-50]="mov.tipo === 'pago'"
                                [class.text-teal-700]="mov.tipo === 'pago'">
                                {{ movementTipoLabel(mov) }}
                              </span>
                            </td>
                            <td class="px-3 py-2 text-sm text-gray-600 min-w-0">
                              <span *ngIf="mov.tipo === 'horas'">{{ movementHorasDetalle(mov) }}</span>
                              <span *ngIf="mov.tipo === 'extra'">{{ extraLabel(mov.extraTipo) }}<span *ngIf="mov.concepto"> · {{ mov.concepto }}</span></span>
                              <span *ngIf="mov.tipo === 'pago'">Pago<span *ngIf="mov.periodoDesde"> · {{ formatPeriodRange(mov.periodoDesde, mov.periodoHasta) }}</span></span>
                              <p *ngIf="mov.notas" class="text-xs text-gray-400 mt-0.5 truncate">{{ mov.notas }}</p>
                            </td>
                            <td class="px-3 py-2 text-sm text-right tabular-nums font-semibold" [class.text-teal-700]="mov.tipo === 'pago'">
                              {{ formatMoney(mov.monto) }}
                            </td>
                            <td *ngIf="auth.canEditRecords" class="px-3 py-2 text-right">
                              <button
                                *ngIf="canPayAccrual(mov)"
                                type="button"
                                [disabled]="payingLiquidation"
                                class="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap disabled:opacity-50"
                                (click)="openPayAccrual(mov, $event)">
                                Registrar pago
                              </button>
                              <span
                                *ngIf="isAccrualLiquidated(mov)"
                                class="text-[11px] font-semibold text-teal-600 whitespace-nowrap">
                                Liquidado
                              </span>
                              <span *ngIf="mov.tipo === 'pago'" class="text-[11px] text-gray-400">—</span>
                            </td>
                          </tr>
                          <tr *ngIf="!movementsForCollaborator(row.colaboradorId).length">
                            <td [attr.colspan]="auth.canEditRecords ? 5 : 4" class="px-3 py-4 text-sm text-gray-400 text-center">
                              Sin registros en este período.
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </ng-container>
              <tr *ngIf="!summaryRows.length">
                <td [attr.colspan]="auth.canEditRecords ? 10 : 9" class="px-6 py-10 text-center text-sm text-gray-400">Sin movimientos en el período.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          [page]="summaryPage"
          [pageSize]="listPageSize"
          [totalItems]="summaryRows.length"
          (pageChange)="summaryPage = $event">
        </app-list-pagination>
        <div *ngIf="summary?.extrasPorTipo?.length" class="px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Extras por tipo</p>
          <div class="flex flex-wrap gap-2">
            <span *ngFor="let extra of summary!.extrasPorTipo" class="px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-medium">
              {{ extra.label }} · {{ formatMoney(extra.monto) }}
            </span>
          </div>
        </div>
      </div>

      <app-compact-data-list *ngIf="activeTab === 'movimientos'" class="block mb-6">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="movementSearch"
            (queryChange)="movementsPage = 1"
            name="movementSearch"
            placeholder="Buscar por colaborador, concepto o notas...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let mov of paginatedFilteredMovements"
            (activate)="onMovementRowClick(mov)">
            <div compactTitle [class]="compactListTitleClass + ' truncate'">
              {{ mov.colaboradorNombre || collaboratorName(mov.colaboradorId) }}
            </div>
            <div compactSubtitle [class]="compactListSubtitleClass">
              {{ formatDate(mov.fecha) }} · {{ movementTipoLabel(mov) }}
            </div>
            <span
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0"
              [class.text-teal-700]="mov.tipo === 'pago'">
              {{ formatMoney(mov.monto) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="!filteredMovements.length" [class]="compactListEmptyClass">Sin movimientos.</p>
        </div>
        <div listDesktop [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Fecha</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Colaborador</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Tipo</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Detalle</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Monto</th>
                <th *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let mov of paginatedFilteredMovements"
                (click)="onMovementRowClick(mov)"
                [class]="listTableRowClass">
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-600 whitespace-nowrap">{{ formatDate(mov.fecha) }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">{{ mov.colaboradorNombre || collaboratorName(mov.colaboradorId) }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm">
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold"
                    [class.bg-blue-50]="mov.tipo === 'horas'"
                    [class.text-blue-700]="mov.tipo === 'horas'"
                    [class.bg-amber-50]="mov.tipo === 'extra'"
                    [class.text-amber-700]="mov.tipo === 'extra'"
                    [class.bg-teal-50]="mov.tipo === 'pago'"
                    [class.text-teal-700]="mov.tipo === 'pago'">
                    {{ movementTipoLabel(mov) }}
                  </span>
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-600">
                  <span *ngIf="mov.tipo === 'horas'">{{ formatQty(mov.horas) }} h × {{ formatMoney(mov.valorHora) }}</span>
                  <span *ngIf="mov.tipo === 'extra'">{{ extraLabel(mov.extraTipo) }}<span *ngIf="mov.concepto"> · {{ mov.concepto }}</span></span>
                  <span *ngIf="mov.tipo === 'pago'">Pago<span *ngIf="mov.periodoDesde"> · {{ formatPeriodRange(mov.periodoDesde, mov.periodoHasta) }}</span></span>
                  <p *ngIf="mov.notas" class="text-xs text-gray-400 mt-0.5">{{ mov.notas }}</p>
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums font-semibold" [class.text-teal-700]="mov.tipo === 'pago'">
                  {{ formatMoney(mov.monto) }}
                </td>
                <td *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-right" (click)="$event.stopPropagation()">
                  <app-list-row-actions
                    [showDelete]="auth.canDeleteRecords"
                    [deleteLoading]="deletingMovementId === mov.id"
                    [deleteDisabled]="!!deletingMovementId && deletingMovementId !== mov.id"
                    [editDisabled]="!!deletingMovementId"
                    (editClick)="editMovement(mov)"
                    (deleteClick)="confirmDeleteMovement(mov)">
                  </app-list-row-actions>
                </td>
              </tr>
              <tr *ngIf="!filteredMovements.length">
                <td [attr.colspan]="auth.canEditRecords ? 6 : 5" class="px-6 py-10 text-center text-sm text-gray-400">Sin movimientos.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="movementsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredMovements.length"
          (pageChange)="movementsPage = $event">
        </app-list-pagination>
      </app-compact-data-list>

      <app-compact-data-list *ngIf="activeTab === 'equipo'" class="block">
        <div listMobile [class]="nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let c of paginatedCollaborators"
            (activate)="openCollaboratorModal(c)">
            <div compactTitle [class]="compactListTitleClass + ' truncate'">{{ c.nombre }}</div>
            <div compactSubtitle [class]="compactListSubtitleClass">
              {{ modalidadLabel(c.modalidad) }} · {{ periodoLabel(c.periodoReferencia) }}
            </div>
            <span
              compactTrailing
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
              [class.bg-teal-50]="c.activo"
              [class.text-teal-700]="c.activo"
              [class.bg-gray-100]="!c.activo"
              [class.text-gray-500]="!c.activo">
              {{ c.activo ? 'Activo' : 'Inactivo' }}
            </span>
          </app-compact-list-row>
          <p *ngIf="!collaborators.length" [class]="compactListEmptyClass">Todavía no cargaste colaboradores.</p>
        </div>
        <div listDesktop [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Nombre</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Modalidad</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Valor hora</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Referencia</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Estado</th>
                <th *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let c of paginatedCollaborators"
                [class]="listTableRowClass"
                (click)="openCollaboratorModal(c)">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">{{ c.nombre }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-600">{{ modalidadLabel(c.modalidad) }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ c.valorHora ? formatMoney(c.valorHora) : '—' }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-600">{{ periodoLabel(c.periodoReferencia) }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm">
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold" [class.bg-teal-50]="c.activo" [class.text-teal-700]="c.activo" [class.bg-gray-100]="!c.activo" [class.text-gray-500]="!c.activo">
                    {{ c.activo ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-right" (click)="$event.stopPropagation()">
                  <app-list-row-actions
                    [showDelete]="auth.canDeleteRecords"
                    [deleteLoading]="deletingCollaboratorId === c.id"
                    [deleteDisabled]="!!deletingCollaboratorId && deletingCollaboratorId !== c.id"
                    [editDisabled]="!!deletingCollaboratorId"
                    (editClick)="openCollaboratorModal(c)"
                    (deleteClick)="confirmDeleteCollaborator(c)">
                  </app-list-row-actions>
                </td>
              </tr>
              <tr *ngIf="!collaborators.length">
                <td [attr.colspan]="auth.canEditRecords ? 6 : 5" class="px-6 py-10 text-center text-sm text-gray-400">
                  Todavía no cargaste colaboradores.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="teamPage"
          [pageSize]="listPageSize"
          [totalItems]="collaborators.length"
          (pageChange)="teamPage = $event">
        </app-list-pagination>
      </app-compact-data-list>
    </div>

    <app-transaction-modal [open]="collaboratorModalOpen" [title]="editingCollaborator?.id ? 'Editar colaborador' : 'Nuevo colaborador'" maxWidthClass="max-w-lg" (closed)="closeCollaboratorModal()">
      <form class="space-y-4" (ngSubmit)="saveCollaborator()">
        <label class="block">
          <span class="text-sm font-medium text-gray-700 mb-1 block">Nombre *</span>
          <input [(ngModel)]="collaboratorDraft.nombre" name="collabNombre" required class="form-control">
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Teléfono</span>
            <input [(ngModel)]="collaboratorDraft.telefono" name="collabTel" class="form-control">
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Email</span>
            <input [(ngModel)]="collaboratorDraft.email" name="collabEmail" type="email" class="form-control">
          </label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Modalidad</span>
            <select [(ngModel)]="collaboratorDraft.modalidad" name="collabModalidad" class="form-control">
              <option value="por_hora">Por hora</option>
              <option value="fijo">Monto fijo por período</option>
              <option value="mixto">Hora + extras</option>
            </select>
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Período de referencia</span>
            <select [(ngModel)]="collaboratorDraft.periodoReferencia" name="collabPeriodo" class="form-control">
              <option value="semana">Semanal</option>
              <option value="quincena">Quincenal</option>
              <option value="mes">Mensual</option>
            </select>
          </label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Valor hora ($)</span>
            <input [(ngModel)]="collaboratorDraft.valorHora" name="collabValorHora" type="number" min="0" step="0.01" class="form-control">
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Monto fijo período ($)</span>
            <input [(ngModel)]="collaboratorDraft.montoFijoPeriodo" name="collabFijo" type="number" min="0" step="0.01" class="form-control">
          </label>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" [(ngModel)]="collaboratorDraft.activo" name="collabActivo" class="rounded border-gray-300 text-teal-600">
          Activo
        </label>
        <label class="block">
          <span class="text-sm font-medium text-gray-700 mb-1 block">Notas</span>
          <textarea [(ngModel)]="collaboratorDraft.notas" name="collabNotas" rows="2" class="form-control"></textarea>
        </label>
        <app-form-panel-footer
          [saveLabel]="editingCollaborator?.id ? 'Guardar' : 'Crear colaborador'"
          (cancelClick)="closeCollaboratorModal()"
          (saveClick)="saveCollaborator()">
        </app-form-panel-footer>
      </form>
    </app-transaction-modal>

    <app-transaction-modal [open]="movementModalOpen" [title]="movementModalTitle" maxWidthClass="max-w-lg" (closed)="closeMovementModal()">
      <form class="space-y-4" (ngSubmit)="saveMovement()">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <label class="block min-w-0 sm:col-span-2">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Colaborador *</span>
            <app-searchable-select
              [(ngModel)]="movementDraft.colaboradorId"
              (ngModelChange)="onMovementColaboradorChange()"
              name="movColaborador"
              [labeledOptions]="collaboratorOptions"
              placeholder="Elegí colaborador"
              emptyListMessage="Sin colaboradores">
            </app-searchable-select>
          </label>
          <label class="block min-w-0 sm:col-span-1">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Fecha *</span>
            <input type="date" [(ngModel)]="movementDraft.fecha" name="movFecha" required class="form-control">
          </label>
        </div>

        <ng-container *ngIf="movementDraft.tipo === 'horas'">
          <div>
            <span class="text-sm font-medium text-gray-700 mb-2 block">Carga de horas</span>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                (click)="setHoursEntryMode('cantidad')"
                class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors"
                [class.border-teal-500]="movementHoursMode === 'cantidad'"
                [class.bg-teal-50]="movementHoursMode === 'cantidad'"
                [class.text-teal-700]="movementHoursMode === 'cantidad'"
                [class.border-gray-200]="movementHoursMode !== 'cantidad'"
                [class.text-gray-700]="movementHoursMode !== 'cantidad'">
                Cantidad de horas
              </button>
              <button
                type="button"
                (click)="setHoursEntryMode('franja')"
                class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors"
                [class.border-teal-500]="movementHoursMode === 'franja'"
                [class.bg-teal-50]="movementHoursMode === 'franja'"
                [class.text-teal-700]="movementHoursMode === 'franja'"
                [class.border-gray-200]="movementHoursMode !== 'franja'"
                [class.text-gray-700]="movementHoursMode !== 'franja'">
                De hora a hora
              </button>
            </div>
          </div>

          <div *ngIf="movementHoursMode === 'cantidad'" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block min-w-0 sm:col-span-2">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Horas *</span>
              <input
                [(ngModel)]="movementDraft.horas"
                name="movHoras"
                type="number"
                min="0.25"
                step="0.25"
                required
                class="form-control">
            </label>
            <label class="block min-w-0 sm:col-span-1">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Valor hora ($)</span>
              <input
                [(ngModel)]="movementDraft.valorHora"
                name="movValorHora"
                type="number"
                min="0"
                step="0.01"
                class="form-control"
                placeholder="Según colaborador">
            </label>
          </div>

          <div *ngIf="movementHoursMode === 'franja'" class="space-y-2">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="block min-w-0">
                <span class="text-sm font-medium text-gray-700 mb-1 block">Desde *</span>
                <input
                  [(ngModel)]="movementHoraDesde"
                  name="movHoraDesde"
                  type="time"
                  required
                  class="form-control"
                  (ngModelChange)="syncHorasFromTimeRange()">
              </label>
              <label class="block min-w-0">
                <span class="text-sm font-medium text-gray-700 mb-1 block">Hasta *</span>
                <input
                  [(ngModel)]="movementHoraHasta"
                  name="movHoraHasta"
                  type="time"
                  required
                  class="form-control"
                  (ngModelChange)="syncHorasFromTimeRange()">
              </label>
              <label class="block min-w-0">
                <span class="text-sm font-medium text-gray-700 mb-1 block">Valor hora ($)</span>
                <input
                  [(ngModel)]="movementDraft.valorHora"
                  name="movValorHoraFranja"
                  type="number"
                  min="0"
                  step="0.01"
                  class="form-control"
                  placeholder="Según colaborador">
              </label>
            </div>
            <p *ngIf="resolvedMovementHoras > 0" class="text-xs text-gray-500">
              Horas calculadas: {{ formatQty(resolvedMovementHoras) }}
            </p>
            <p *ngIf="movementHoursMode === 'franja' && !resolvedMovementHoras" class="text-xs text-amber-600">
              Revisá que la hora «hasta» sea posterior a «desde».
            </p>
          </div>

          <p class="text-xs text-gray-500">Estimado: {{ formatMoney(estimatedHoursAmount) }}</p>
        </ng-container>

        <ng-container *ngIf="movementDraft.tipo === 'extra'">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Tipo de extra</span>
            <select [(ngModel)]="movementDraft.extraTipo" name="movExtraTipo" class="form-control">
              <option
                *ngIf="movementDraft.extraTipo && !hasConfiguredExtraTipo(movementDraft.extraTipo)"
                [ngValue]="movementDraft.extraTipo">
                {{ extraLabel(movementDraft.extraTipo) }}
              </option>
              <option *ngFor="let tipo of collaboratorExtraTipos" [ngValue]="tipo.id">
                {{ tipo.nombre }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Concepto</span>
            <input [(ngModel)]="movementDraft.concepto" name="movConcepto" class="form-control" placeholder="Ej. Reparto zona norte">
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Monto ($) *</span>
            <input [(ngModel)]="movementDraft.monto" name="movMontoExtra" type="number" min="0" step="0.01" required class="form-control">
          </label>
        </ng-container>

        <ng-container *ngIf="movementDraft.tipo === 'pago'">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Monto pagado ($) *</span>
            <input [(ngModel)]="movementDraft.monto" name="movMontoPago" type="number" min="0" step="0.01" required class="form-control">
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Medio de pago</span>
            <select [(ngModel)]="movementDraft.medioPagoId" name="movMedioPago" class="form-control">
              <option *ngFor="let medio of mediosPagoCaja" [ngValue]="medio.id">{{ medio.label }}</option>
            </select>
          </label>
          <p class="text-xs text-gray-500">Se registrará un egreso en Caja al guardar.</p>
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Período desde</span>
              <input type="date" [(ngModel)]="movementDraft.periodoDesde" name="movPeriodoDesde" class="form-control">
            </label>
            <label class="block">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Período hasta</span>
              <input type="date" [(ngModel)]="movementDraft.periodoHasta" name="movPeriodoHasta" class="form-control">
            </label>
          </div>
        </ng-container>

        <label class="block">
          <span class="text-sm font-medium text-gray-700 mb-1 block">Notas</span>
          <textarea [(ngModel)]="movementDraft.notas" name="movNotas" rows="2" class="form-control"></textarea>
        </label>

        <div class="form-actions flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-gray-100 mt-2">
          <app-record-action-toolbar
            [showDuplicate]="canDuplicateMovementInModal"
            duplicateLabel="Duplicar"
            [duplicateDisabled]="movementSaving || !!deletingMovementId"
            (duplicateClick)="duplicateMovementInModal()"
            [showDelete]="canDeleteMovementInModal"
            deleteLabel="Eliminar"
            [deleteDisabled]="movementSaving || !!deletingMovementId"
            (deleteClick)="confirmDeleteEditingMovement()">
          </app-record-action-toolbar>
          <div class="flex justify-end gap-3 flex-wrap sm:ml-auto">
            <button type="button" (click)="closeMovementModal()" [class]="formCancelClass">Cancelar</button>
            <button
              type="button"
              [disabled]="movementSaving"
              [class]="formSubmitClass"
              (click)="saveMovement()">
              {{ movementSaving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </form>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="payLiquidationModalOpen"
      [title]="payLiquidationTarget?.liquidacionMovimientoId ? 'Registrar pago' : 'Pagar saldo del período'"
      [subtitle]="payLiquidationTarget?.subtitle ?? ''"
      maxWidthClass="max-w-md"
      (closed)="closePayLiquidationModal()">
      <div *ngIf="payLiquidationTarget as target" class="space-y-4">
        <app-transaction-save-banner [message]="payLiquidationSave.successMessage"></app-transaction-save-banner>
        <div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-1">
          <p class="text-base font-bold text-gray-900">{{ target.nombre }}</p>
          <p class="text-sm text-gray-600">{{ target.subtitle }}</p>
        </div>
        <div class="rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 flex justify-between items-center gap-3">
          <span class="text-sm text-teal-900">Monto · egreso en caja</span>
          <span class="text-lg font-bold tabular-nums text-teal-900">{{ formatMoney(target.monto) }}</span>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
          <select
            [(ngModel)]="payLiquidationMedioId"
            name="payLiquidationMedioId"
            class="form-control">
            <option *ngFor="let medio of mediosPagoCaja" [ngValue]="medio.id">{{ medio.label }}</option>
          </select>
        </div>
        <app-modal-form-footer
          [saving]="payingLiquidation"
          [successMessage]="payLiquidationSave.successMessage"
          primaryLabel="Confirmar pago"
          (cancelClick)="closePayLiquidationModal()"
          (primaryClick)="submitPayLiquidation()">
        </app-modal-form-footer>
      </div>
    </app-transaction-modal>
  `,
})
export class CollaboratorsComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private service = inject(CollaboratorsService);
  private dialog = inject(DialogService);
  private catalogConfig = inject(CatalogConfigService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private configSub?: Subscription;

  appConfig: AppConfig = DEFAULT_APP_CONFIG;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly compactListTitleClass = COMPACT_LIST_TITLE_CLASS;
  readonly compactListSubtitleClass = COMPACT_LIST_SUBTITLE_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly expandedNestedWrapClass = EXPANDED_NESTED_WRAP_CLASS;
  readonly moduleTableHeadNestedClass = MODULE_TABLE_HEAD_CELL_NESTED_CLASS;
  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly formSubmitClass = FORM_SUBMIT_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;

  movementSaving = false;

  payLiquidationModalOpen = false;
  payLiquidationTarget: PayLiquidationTarget | null = null;
  payLiquidationMedioId = 'efectivo';
  readonly payLiquidationSave = new TransactionSaveFeedback();

  expandedSummaryKeys: Record<string, boolean> = {};

  summaryPage = 1;
  movementsPage = 1;
  teamPage = 1;

  readonly tabs = [
    { id: 'resumen' as ActiveTab, label: 'Resumen a pagar' },
    { id: 'movimientos' as ActiveTab, label: 'Registros' },
    { id: 'equipo' as ActiveTab, label: 'Equipo' },
  ];

  activeTab: ActiveTab = 'resumen';
  periodFrom = weekStartDate();
  periodTo = weekEndDate();
  filterColaboradorId = '';
  movementSearch = '';

  collaborators: Collaborator[] = [];
  movements: CollaboratorMovement[] = [];
  summary: CollaboratorsPeriodSummary | null = null;

  collaboratorModalOpen = false;
  editingCollaborator: Collaborator | null = null;
  collaboratorDraft: Partial<Collaborator> = this.emptyCollaboratorDraft();

  movementModalOpen = false;
  editingMovement: CollaboratorMovement | null = null;
  movementDraft: Partial<CollaboratorMovement> = this.emptyMovementDraft('horas');
  movementHoursMode: HoursEntryMode = 'cantidad';
  movementHoraDesde = '09:00';
  movementHoraHasta = '17:00';

  deletingCollaboratorId: string | null = null;
  deletingMovementId: string | null = null;

  get collaboratorOptions(): SearchableSelectOption[] {
    return this.collaborators
      .filter((c) => c.id && String(c.nombre ?? '').trim())
      .sort((a, b) =>
        String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
      )
      .map((c) => ({
        value: c.id!,
        label: String(c.nombre).trim(),
      }));
  }

  get summaryRows(): CollaboratorSummaryRow[] {
    if (!this.summary) return [];
    if (!this.filterColaboradorId) return this.summary.colaboradores;
    return this.summary.colaboradores.filter((r) => r.colaboradorId === this.filterColaboradorId);
  }

  get paginatedSummaryRows(): CollaboratorSummaryRow[] {
    return paginateSlice(this.summaryRows, this.summaryPage, this.listPageSize);
  }

  get paginatedFilteredMovements(): CollaboratorMovement[] {
    return paginateSlice(this.filteredMovements, this.movementsPage, this.listPageSize);
  }

  get paginatedCollaborators(): Collaborator[] {
    return paginateSlice(this.collaborators, this.teamPage, this.listPageSize);
  }

  get filteredMovements(): CollaboratorMovement[] {
    const q = this.movementSearch.trim().toLowerCase();
    if (!q) return this.movements;
    return this.movements.filter((mov) => {
      const haystack = [
        mov.colaboradorNombre,
        this.collaboratorName(mov.colaboradorId),
        mov.concepto,
        mov.notas,
        this.movementTipoLabel(mov),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  get movementModalTitle(): string {
    if (this.editingMovement) return 'Editar registro';
    if (this.movementDraft.tipo === 'horas') return 'Registrar horas';
    if (this.movementDraft.tipo === 'extra') return 'Registrar extra';
    return 'Registrar pago';
  }

  get canDuplicateMovementInModal(): boolean {
    return !!this.editingMovement?.id && this.auth.canEditRecords;
  }

  get canDeleteMovementInModal(): boolean {
    return !!this.editingMovement?.id && this.auth.canDeleteRecords;
  }

  get resolvedMovementHoras(): number {
    if (this.movementDraft.tipo !== 'horas') return 0;
    if (this.movementHoursMode === 'franja') {
      return hoursFromTimeRange(this.movementHoraDesde, this.movementHoraHasta) ?? 0;
    }
    return Number(this.movementDraft.horas ?? 0);
  }

  get estimatedHoursAmount(): number {
    const horas = this.resolvedMovementHoras;
    const valor = this.resolvedValorHora();
    return Math.round(horas * valor * 100) / 100;
  }

  get mediosPagoCaja() {
    return getMediosPagoActivos(this.appConfig).filter((m) => m.comportamiento === 'caja_inmediata');
  }

  get collaboratorExtraTipos(): CollaboratorExtraTipoConfig[] {
    return getCollaboratorExtraTipos(this.appConfig);
  }

  ngOnInit(): void {
    bindListPageRefreshOnReturn({
      listPath: '/collaborators',
      reload: () => this.loadData(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.catalogConfig.getAppConfig().subscribe();
    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.loadData();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.payLiquidationSave.destroy();
  }

  get payingLiquidation(): boolean {
    return this.payLiquidationSave.saving;
  }

  onPeriodChange(): void {
    this.loadData();
  }

  loadData(): void {
    this.service.getCollaborators().subscribe({
      next: (rows) => (this.collaborators = rows),
    });
    this.service.getMovements({
      from: this.periodFrom,
      to: this.periodTo,
      colaboradorId: this.filterColaboradorId || undefined,
    }).subscribe({
      next: (rows) => (this.movements = rows),
    });
    this.service.getSummary(this.periodFrom, this.periodTo).subscribe({
      next: (summary) => (this.summary = summary),
    });
  }

  toggleSummaryExpand(colaboradorId: string): void {
    this.expandedSummaryKeys = {
      ...this.expandedSummaryKeys,
      [colaboradorId]: !this.expandedSummaryKeys[colaboradorId],
    };
  }

  isSummaryExpanded(colaboradorId: string): boolean {
    return !!this.expandedSummaryKeys[colaboradorId];
  }

  summaryMovementsCount(colaboradorId: string): number {
    return this.movementsForCollaborator(colaboradorId).length;
  }

  movementsForCollaborator(colaboradorId: string): CollaboratorMovement[] {
    return this.movements
      .filter((mov) => mov.colaboradorId === colaboradorId)
      .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));
  }

  movementHorasDetalle(mov: CollaboratorMovement): string {
    const horas = this.formatQty(mov.horas);
    const valor = this.formatMoney(mov.valorHora);
    if (mov.horaDesde && mov.horaHasta) {
      return `${horas} h (${mov.horaDesde}–${mov.horaHasta}) × ${valor}`;
    }
    return `${horas} h × ${valor}`;
  }

  openCollaboratorModal(collaborator?: Collaborator): void {
    this.editingCollaborator = collaborator ?? null;
    this.collaboratorDraft = collaborator
      ? { ...collaborator }
      : this.emptyCollaboratorDraft();
    this.collaboratorModalOpen = true;
  }

  closeCollaboratorModal(): void {
    this.collaboratorModalOpen = false;
    this.editingCollaborator = null;
  }

  saveCollaborator(): void {
    const nombre = String(this.collaboratorDraft.nombre ?? '').trim();
    if (!nombre) return;

    const payload: Partial<Collaborator> = {
      ...this.collaboratorDraft,
      nombre,
      valorHora: Number(this.collaboratorDraft.valorHora) || undefined,
      montoFijoPeriodo: Number(this.collaboratorDraft.montoFijoPeriodo) || undefined,
    };

    const req = this.editingCollaborator?.id
      ? this.service.updateCollaborator(this.editingCollaborator.id, payload)
      : this.service.createCollaborator(payload);

    req.subscribe({
      next: () => {
        this.closeCollaboratorModal();
        this.loadData();
      },
      error: () =>
        this.dialog.alert({ title: 'Error', message: 'No se pudo guardar el colaborador.' }),
    });
  }

  confirmDeleteCollaborator(collaborator: Collaborator): void {
    if (!collaborator.id || !this.auth.canDeleteRecords || this.deletingCollaboratorId) return;

    this.dialog
      .confirm({
        title: 'Eliminar colaborador',
        message: `¿Eliminar a ${collaborator.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok || !collaborator.id) return;

        this.deletingCollaboratorId = collaborator.id;
        this.service.deleteCollaborator(collaborator.id).subscribe({
          next: () => {
            this.deletingCollaboratorId = null;
            this.loadData();
          },
          error: () => {
            this.deletingCollaboratorId = null;
            this.dialog.alert({ title: 'Error', message: 'No se pudo eliminar el colaborador.' });
          },
        });
      });
  }

  openMovementModal(tipo: MovementModalMode, movement?: CollaboratorMovement): void {
    this.editingMovement = movement ?? null;
    if (movement) {
      this.movementDraft = {
        ...movement,
        medioPagoId: movement.medioPagoId ?? 'efectivo',
      };
      if (movement.tipo === 'horas') {
        if (movement.horaDesde && movement.horaHasta) {
          this.movementHoursMode = 'franja';
          this.movementHoraDesde = movement.horaDesde;
          this.movementHoraHasta = movement.horaHasta;
        } else {
          this.movementHoursMode = 'cantidad';
          this.resetDefaultTimeRange();
        }
      }
    } else {
      this.movementDraft = this.emptyMovementDraft(tipo);
      this.movementDraft.colaboradorId = this.filterColaboradorId || '';
      this.movementDraft.periodoDesde = this.periodFrom;
      this.movementDraft.periodoHasta = this.periodTo;
      if (tipo === 'horas') {
        this.movementHoursMode = 'cantidad';
        this.resetDefaultTimeRange();
        this.applyCollaboratorDefaultValorHora(false);
      }
    }
    this.movementModalOpen = true;
  }

  setHoursEntryMode(mode: HoursEntryMode): void {
    this.movementHoursMode = mode;
    if (mode === 'franja') {
      this.syncHorasFromTimeRange();
    }
  }

  syncHorasFromTimeRange(): void {
    const horas = hoursFromTimeRange(this.movementHoraDesde, this.movementHoraHasta);
    if (horas !== null) {
      this.movementDraft.horas = horas;
    }
  }

  onMovementColaboradorChange(): void {
    this.applyCollaboratorDefaultValorHora(!this.editingMovement);
  }

  private applyCollaboratorDefaultValorHora(overwrite: boolean): void {
    if (this.movementDraft.tipo !== 'horas') return;
    const collab = this.collaborators.find((c) => c.id === this.movementDraft.colaboradorId);
    const configured = Number(collab?.valorHora ?? 0);
    if (configured <= 0) return;
    if (overwrite || !Number(this.movementDraft.valorHora)) {
      this.movementDraft.valorHora = configured;
    }
  }

  private resolvedValorHora(): number {
    if (Number(this.movementDraft.valorHora) > 0) {
      return Number(this.movementDraft.valorHora);
    }
    return Number(
      this.collaborators.find((c) => c.id === this.movementDraft.colaboradorId)?.valorHora ?? 0
    );
  }

  private resetDefaultTimeRange(): void {
    this.movementHoraDesde = '09:00';
    this.movementHoraHasta = '17:00';
  }

  onMovementRowClick(mov: CollaboratorMovement): void {
    if (!this.auth.canEditRecords) return;
    this.editMovement(mov);
  }

  editMovement(mov: CollaboratorMovement): void {
    this.openMovementModal(mov.tipo as MovementModalMode, mov);
  }

  closeMovementModal(): void {
    this.movementModalOpen = false;
    this.editingMovement = null;
  }

  duplicateMovementInModal(): void {
    if (!this.canDuplicateMovementInModal) return;
    this.editingMovement = null;
  }

  canPayBalance(row: CollaboratorSummaryRow): boolean {
    return this.auth.canEditRecords && row.pendientePeriodo > 0;
  }

  canPayAccrual(mov: CollaboratorMovement): boolean {
    if (!this.auth.canEditRecords) return false;
    if (mov.tipo !== 'horas' && mov.tipo !== 'extra') return false;
    return !this.isAccrualLiquidated(mov) && Number(mov.monto) > 0;
  }

  isAccrualLiquidated(mov: CollaboratorMovement): boolean {
    if (!mov.id || (mov.tipo !== 'horas' && mov.tipo !== 'extra')) return false;
    if (
      this.movements.some(
        (p) => p.tipo === 'pago' && p.liquidacionMovimientoId === mov.id
      )
    ) {
      return true;
    }
    const row = this.summaryRows.find((r) => r.colaboradorId === mov.colaboradorId);
    return !!row && row.pendientePeriodo <= 0;
  }

  openPayAccrual(mov: CollaboratorMovement, event: Event): void {
    event.stopPropagation();
    if (!this.canPayAccrual(mov)) return;
    this.payLiquidationTarget = {
      colaboradorId: mov.colaboradorId,
      nombre: mov.colaboradorNombre || this.collaboratorName(mov.colaboradorId),
      monto: Number(mov.monto),
      subtitle: `Pago del día ${this.formatDate(mov.fecha)}`,
      liquidacionMovimientoId: mov.id,
      periodoDesde: mov.fecha?.slice(0, 10),
      periodoHasta: mov.fecha?.slice(0, 10),
    };
    this.payLiquidationMedioId = 'efectivo';
    this.payLiquidationModalOpen = true;
  }

  openPayBalance(row: CollaboratorSummaryRow, event: Event): void {
    event.stopPropagation();
    if (!this.canPayBalance(row)) return;
    this.payLiquidationTarget = {
      colaboradorId: row.colaboradorId,
      nombre: row.nombre,
      monto: row.pendientePeriodo,
      subtitle: `Saldo pendiente del período (${formatDisplayDateRange(this.periodFrom, this.periodTo, '–')})`,
      periodoDesde: this.periodFrom,
      periodoHasta: this.periodTo,
    };
    this.payLiquidationMedioId = 'efectivo';
    this.payLiquidationModalOpen = true;
  }

  closePayLiquidationModal(): void {
    this.payLiquidationModalOpen = false;
    this.payLiquidationTarget = null;
    this.payLiquidationSave.clearSuccess();
    this.payLiquidationSave.endSave();
  }

  submitPayLiquidation(): void {
    const target = this.payLiquidationTarget;
    if (!target || target.monto <= 0) return;
    if (!this.payLiquidationSave.tryBeginSave()) return;

    const notas = target.liquidacionMovimientoId
      ? `Liquidación registro ${target.periodoDesde ?? ''}`
      : `Liquidación período ${target.periodoDesde ?? ''} – ${target.periodoHasta ?? ''} · ${target.nombre}`;

    this.service
      .createMovement({
        colaboradorId: target.colaboradorId,
        tipo: 'pago',
        fecha: todayDate(),
        monto: target.monto,
        medioPagoId: this.payLiquidationMedioId,
        liquidacionMovimientoId: target.liquidacionMovimientoId,
        periodoDesde: target.periodoDesde,
        periodoHasta: target.periodoHasta,
        notas,
      })
      .pipe(finalize(() => this.payLiquidationSave.endSave()))
      .subscribe({
        next: () => {
          this.payLiquidationSave.showSuccess('Pago registrado');
          window.setTimeout(() => {
            this.closePayLiquidationModal();
            this.loadData();
          }, 700);
        },
        error: (err) => {
          const msg =
            typeof err?.error?.error === 'string'
              ? err.error.error
              : 'No se pudo registrar el pago.';
          this.dialog.alert({ title: 'Error', message: msg });
        },
      });
  }

  confirmDeleteEditingMovement(): void {
    if (!this.editingMovement) return;
    this.confirmDeleteMovement(this.editingMovement);
  }

  saveMovement(): void {
    const payload = this.buildMovementPayload();
    if (!payload) {
      this.dialog.alert({
        title: 'Datos incompletos',
        message:
          this.movementDraft.tipo === 'horas'
            ? 'Elegí colaborador, fecha y horas (o un rango de horario válido).'
            : 'Completá colaborador, fecha y los campos obligatorios.',
      });
      return;
    }

    if (this.movementSaving) return;
    this.movementSaving = true;

    const req = this.editingMovement?.id
      ? this.service.updateMovement(this.editingMovement.id, payload)
      : this.service.createMovement(payload);

    req.subscribe({
      next: () => {
        this.movementSaving = false;
        this.closeMovementModal();
        this.loadData();
      },
      error: (err) => {
        this.movementSaving = false;
        const msg =
          typeof err?.error?.error === 'string'
            ? err.error.error
            : 'No se pudo guardar el registro.';
        this.dialog.alert({ title: 'Error', message: msg });
      },
    });
  }

  private buildMovementPayload(): Partial<CollaboratorMovement> | null {
    const colaboradorId = String(this.movementDraft.colaboradorId ?? '').trim();
    const fecha = String(this.movementDraft.fecha ?? '').trim().slice(0, 10);
    const tipo = this.movementDraft.tipo;
    if (!colaboradorId || !fecha || !tipo) return null;

    const notas = String(this.movementDraft.notas ?? '').trim() || undefined;

    if (tipo === 'horas') {
      const horas = this.resolvedMovementHoras;
      if (!Number.isFinite(horas) || horas <= 0) return null;
      const valorHora = this.resolvedValorHora();
      const payload: Partial<CollaboratorMovement> = {
        colaboradorId,
        tipo,
        fecha,
        horas,
        valorHora: valorHora > 0 ? valorHora : undefined,
        monto: this.estimatedHoursAmount,
        notas,
      };
      if (this.movementHoursMode === 'franja') {
        payload.horaDesde = this.movementHoraDesde;
        payload.horaHasta = this.movementHoraHasta;
      }
      return payload;
    }

    if (tipo === 'extra') {
      const monto = Number(this.movementDraft.monto);
      if (!Number.isFinite(monto) || monto <= 0) return null;
      return {
        colaboradorId,
        tipo,
        fecha,
        extraTipo: this.movementDraft.extraTipo ?? this.collaboratorExtraTipos[0]?.id,
        concepto: String(this.movementDraft.concepto ?? '').trim() || undefined,
        monto,
        notas,
      };
    }

    const monto = Number(this.movementDraft.monto);
    if (!Number.isFinite(monto) || monto <= 0) return null;
    return {
      colaboradorId,
      tipo,
      fecha,
      monto,
      medioPagoId: this.movementDraft.medioPagoId ?? 'efectivo',
      periodoDesde: String(this.movementDraft.periodoDesde ?? '').trim().slice(0, 10) || undefined,
      periodoHasta: String(this.movementDraft.periodoHasta ?? '').trim().slice(0, 10) || undefined,
      notas,
    };
  }

  confirmDeleteMovement(mov: CollaboratorMovement): void {
    if (!mov.id || !this.auth.canDeleteRecords || this.deletingMovementId) return;

    const name = mov.colaboradorNombre || this.collaboratorName(mov.colaboradorId);
    this.dialog
      .confirm({
        title: 'Eliminar registro',
        message: `¿Eliminar este registro de ${name} (${this.movementTipoLabel(mov).toLowerCase()})? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok || !mov.id) return;

        this.deletingMovementId = mov.id;
        this.service.deleteMovement(mov.id).subscribe({
          next: () => {
            this.deletingMovementId = null;
            if (this.editingMovement?.id === mov.id) {
              this.closeMovementModal();
            }
            this.loadData();
          },
          error: () => {
            this.deletingMovementId = null;
            this.dialog.alert({ title: 'Error', message: 'No se pudo eliminar el registro.' });
          },
        });
      });
  }

  collaboratorName(id: string): string {
    return this.collaborators.find((c) => c.id === id)?.nombre ?? '—';
  }

  modalidadLabel(value: Collaborator['modalidad']): string {
    return MODALIDAD_LABELS[value] ?? value;
  }

  periodoLabel(value: Collaborator['periodoReferencia']): string {
    return PERIODO_LABELS[value] ?? value;
  }

  movementTipoLabel(mov: CollaboratorMovement): string {
    if (mov.tipo === 'extra' && mov.extraTipo) {
      return getCollaboratorExtraTipoLabel(this.appConfig, mov.extraTipo);
    }
    return MOVEMENT_TIPO_LABELS[mov.tipo];
  }

  extraLabel(value?: CollaboratorMovement['extraTipo']): string {
    return value ? getCollaboratorExtraTipoLabel(this.appConfig, value) : 'Extra';
  }

  hasConfiguredExtraTipo(id?: string): boolean {
    const key = String(id ?? '').trim();
    if (!key) return false;
    return this.collaboratorExtraTipos.some((tipo) => tipo.id === key);
  }

  formatMoney(value: number | null | undefined): string {
    return formatMoneyValue(value);
  }

  formatQty(value: number | null | undefined): string {
    return Number(value ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  }

  formatDate(value?: string | null): string {
    return formatDisplayDate(value);
  }

  formatPeriodRange(from?: string | null, to?: string | null): string {
    return formatDisplayDateRange(from, to, '→');
  }

  private emptyCollaboratorDraft(): Partial<Collaborator> {
    return {
      nombre: '',
      telefono: '',
      email: '',
      notas: '',
      modalidad: 'por_hora',
      periodoReferencia: 'semana',
      activo: true,
    };
  }

  private emptyMovementDraft(tipo: MovementModalMode): Partial<CollaboratorMovement> {
    return {
      tipo,
      fecha: todayDate(),
      extraTipo: tipo === 'extra' ? this.collaboratorExtraTipos[0]?.id : undefined,
      horas: tipo === 'horas' ? 8 : undefined,
      monto: tipo === 'pago' ? undefined : tipo === 'extra' ? undefined : undefined,
      medioPagoId: tipo === 'pago' ? 'efectivo' : undefined,
    };
  }
}
