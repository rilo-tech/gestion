import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  Collaborator,
  CollaboratorMovement,
  CollaboratorsPeriodSummary,
  CollaboratorsService,
  CollaboratorSummaryRow,
  EXTRA_TIPO_LABELS,
  MODALIDAD_LABELS,
  monthStartDate,
  MOVEMENT_TIPO_LABELS,
  PERIODO_LABELS,
  todayDate,
  weekStartDate,
} from '../../core/services/collaborators.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getMediosPagoActivos,
} from '../../core/services/catalog-config.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

type PeriodPreset = 'semana' | 'mes' | 'custom';
type ActiveTab = 'resumen' | 'movimientos' | 'equipo';
type MovementModalMode = 'horas' | 'extra' | 'pago';

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
    ModulePageHeaderComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Colaboradores"
        description="Horarios, sueldos, extras (repartos, aguinaldo, premios) y pagos. Flexible por semana, mes o período custom."
        [showMobileSearch]="activeTab === 'movimientos'"
        [(searchQuery)]="movementSearch"
        (searchQueryChange)="movementsPage = 1"
        searchFieldName="movementSearchMobile"
        activityModule="collaborators">
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
          <div class="flex flex-wrap gap-2 mb-4">
            <button
              *ngFor="let preset of periodPresets"
              type="button"
              (click)="applyPreset(preset.value)"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors"
              [class.border-teal-600]="activePreset === preset.value"
              [class.bg-teal-50]="activePreset === preset.value"
              [class.text-teal-700]="activePreset === preset.value"
              [class.border-gray-200]="activePreset !== preset.value"
              [class.text-gray-600]="activePreset !== preset.value">
              {{ preset.label }}
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Desde</span>
              <input type="date" [(ngModel)]="periodFrom" name="periodFrom" (change)="onPeriodChange()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Hasta</span>
              <input type="date" [(ngModel)]="periodTo" name="periodTo" (change)="onPeriodChange()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Filtrar colaborador</span>
              <app-searchable-select
                [(ngModel)]="filterColaboradorId"
                name="filterColaborador"
                [options]="collaboratorOptions"
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
        <div [class]="tableScrollClass">
          <table [class]="tableMinWidthClass">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Colaborador</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Horas</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Por horas</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Extras</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Devengado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pagado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pendiente</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Saldo total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let row of paginatedSummaryRows"
                [class]="listTableRowClass"
                (click)="selectCollaborator(row.colaboradorId)">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">
                  {{ row.nombre }}
                  <span *ngIf="!row.activo" class="ml-2 text-xs text-gray-400">(inactivo)</span>
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
              </tr>
              <tr *ngIf="!summaryRows.length">
                <td colspan="8" class="px-6 py-10 text-center text-sm text-gray-400">Sin movimientos en el período.</td>
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

      <div *ngIf="activeTab === 'movimientos'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="movementSearch"
            (queryChange)="movementsPage = 1"
            name="movementSearch"
            placeholder="Buscar por colaborador, concepto o notas...">
          </app-list-search-field>
        </div>
        <div [class]="tableScrollClass">
          <table [class]="tableMinWidthClass">
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
                  <span *ngIf="mov.tipo === 'pago'">Pago<span *ngIf="mov.periodoDesde"> · {{ formatDate(mov.periodoDesde) }}–{{ formatDate(mov.periodoHasta) }}</span></span>
                  <p *ngIf="mov.notas" class="text-xs text-gray-400 mt-0.5">{{ mov.notas }}</p>
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums font-semibold" [class.text-teal-700]="mov.tipo === 'pago'">
                  {{ formatMoney(mov.monto) }}
                </td>
                <td *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-right" (click)="$event.stopPropagation()">
                  <app-list-row-actions
                    [showDelete]="auth.canDeleteRecords"
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
          [page]="movementsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredMovements.length"
          (pageChange)="movementsPage = $event">
        </app-list-pagination>
      </div>

      <div *ngIf="activeTab === 'equipo'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div [class]="tableScrollClass">
          <table [class]="tableMinWidthClass">
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
          [page]="teamPage"
          [pageSize]="listPageSize"
          [totalItems]="collaborators.length"
          (pageChange)="teamPage = $event">
        </app-list-pagination>
      </div>
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
          (cancelClick)="closeCollaboratorModal()">
        </app-form-panel-footer>
      </form>
    </app-transaction-modal>

    <app-transaction-modal [open]="movementModalOpen" [title]="movementModalTitle" maxWidthClass="max-w-lg" (closed)="closeMovementModal()">
      <form class="space-y-4" (ngSubmit)="saveMovement()">
        <label class="block">
          <span class="text-sm font-medium text-gray-700 mb-1 block">Colaborador *</span>
          <app-searchable-select [(ngModel)]="movementDraft.colaboradorId" name="movColaborador" [options]="collaboratorOptions" placeholder="Elegí colaborador" emptyListMessage="Sin colaboradores"></app-searchable-select>
        </label>
        <label class="block">
          <span class="text-sm font-medium text-gray-700 mb-1 block">Fecha *</span>
          <input type="date" [(ngModel)]="movementDraft.fecha" name="movFecha" required class="form-control">
        </label>

        <ng-container *ngIf="movementDraft.tipo === 'horas'">
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Horas *</span>
              <input [(ngModel)]="movementDraft.horas" name="movHoras" type="number" min="0.25" step="0.25" required class="form-control">
            </label>
            <label class="block">
              <span class="text-sm font-medium text-gray-700 mb-1 block">Valor hora ($)</span>
              <input [(ngModel)]="movementDraft.valorHora" name="movValorHora" type="number" min="0" step="0.01" class="form-control">
            </label>
          </div>
          <p class="text-xs text-gray-500">Estimado: {{ formatMoney(estimatedHoursAmount) }}</p>
        </ng-container>

        <ng-container *ngIf="movementDraft.tipo === 'extra'">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 mb-1 block">Tipo de extra</span>
            <select [(ngModel)]="movementDraft.extraTipo" name="movExtraTipo" class="form-control">
              <option value="reparto">Reparto</option>
              <option value="premio">Premio</option>
              <option value="aguinaldo">Aguinaldo</option>
              <option value="bonificacion">Bonificación</option>
              <option value="otro">Otro</option>
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

        <app-form-panel-footer
          saveLabel="Guardar"
          (cancelClick)="closeMovementModal()">
        </app-form-panel-footer>
      </form>
    </app-transaction-modal>
  `,
})
export class CollaboratorsComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private service = inject(CollaboratorsService);
  private dialog = inject(DialogService);
  private catalogConfig = inject(CatalogConfigService);
  private configSub?: Subscription;

  appConfig: AppConfig = DEFAULT_APP_CONFIG;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;

  summaryPage = 1;
  movementsPage = 1;
  teamPage = 1;

  readonly periodPresets = [
    { value: 'semana' as PeriodPreset, label: 'Esta semana' },
    { value: 'mes' as PeriodPreset, label: 'Este mes' },
    { value: 'custom' as PeriodPreset, label: 'Personalizado' },
  ];

  readonly tabs = [
    { id: 'resumen' as ActiveTab, label: 'Resumen a pagar' },
    { id: 'movimientos' as ActiveTab, label: 'Registros' },
    { id: 'equipo' as ActiveTab, label: 'Equipo' },
  ];

  activeTab: ActiveTab = 'resumen';
  activePreset: PeriodPreset = 'semana';
  periodFrom = weekStartDate();
  periodTo = todayDate();
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

  get collaboratorOptions() {
    return this.collaborators.filter((c) => c.id).map((c) => ({ value: c.id!, label: c.nombre }));
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

  get estimatedHoursAmount(): number {
    const horas = Number(this.movementDraft.horas ?? 0);
    const valor =
      Number(this.movementDraft.valorHora) > 0
        ? Number(this.movementDraft.valorHora)
        : Number(this.collaborators.find((c) => c.id === this.movementDraft.colaboradorId)?.valorHora ?? 0);
    return Math.round(horas * valor * 100) / 100;
  }

  get mediosPagoCaja() {
    return getMediosPagoActivos(this.appConfig).filter((m) => m.comportamiento === 'caja_inmediata');
  }

  ngOnInit(): void {
    this.catalogConfig.getAppConfig().subscribe();
    this.configSub = this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.loadData();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
  }

  applyPreset(preset: PeriodPreset): void {
    this.activePreset = preset;
    if (preset === 'semana') {
      this.periodFrom = weekStartDate();
      this.periodTo = todayDate();
    } else if (preset === 'mes') {
      this.periodFrom = monthStartDate();
      this.periodTo = todayDate();
    } else {
      return;
    }
    this.loadData();
  }

  onPeriodChange(): void {
    this.activePreset = 'custom';
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

  selectCollaborator(id: string): void {
    this.filterColaboradorId = id;
    this.activeTab = 'movimientos';
    this.loadData();
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
    if (!collaborator.id) return;
    this.dialog
      .confirm({
        title: 'Eliminar colaborador',
        message: `¿Eliminar a ${collaborator.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.deleteCollaborator(collaborator.id!).subscribe({
          next: () => this.loadData(),
          error: () =>
            this.dialog.alert({ title: 'Error', message: 'No se pudo eliminar el colaborador.' }),
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
    } else {
      this.movementDraft = this.emptyMovementDraft(tipo);
      this.movementDraft.colaboradorId = this.filterColaboradorId || '';
      this.movementDraft.periodoDesde = this.periodFrom;
      this.movementDraft.periodoHasta = this.periodTo;
    }
    this.movementModalOpen = true;
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

  saveMovement(): void {
    const payload = { ...this.movementDraft };
    if (!payload.colaboradorId || !payload.fecha) return;

    if (payload.tipo === 'horas') {
      payload.monto = this.estimatedHoursAmount;
    }

    const req = this.editingMovement?.id
      ? this.service.updateMovement(this.editingMovement.id, payload)
      : this.service.createMovement(payload);

    req.subscribe({
      next: () => {
        this.closeMovementModal();
        this.loadData();
      },
      error: () =>
        this.dialog.alert({ title: 'Error', message: 'No se pudo guardar el registro.' }),
    });
  }

  confirmDeleteMovement(mov: CollaboratorMovement): void {
    if (!mov.id) return;
    this.dialog
      .confirm({
        title: 'Eliminar registro',
        message: '¿Eliminar este movimiento?',
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.deleteMovement(mov.id!).subscribe({
          next: () => this.loadData(),
          error: () =>
            this.dialog.alert({ title: 'Error', message: 'No se pudo eliminar el registro.' }),
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
    if (mov.tipo === 'extra' && mov.extraTipo) return EXTRA_TIPO_LABELS[mov.extraTipo] ?? MOVEMENT_TIPO_LABELS.extra;
    return MOVEMENT_TIPO_LABELS[mov.tipo];
  }

  extraLabel(value?: CollaboratorMovement['extraTipo']): string {
    return value ? EXTRA_TIPO_LABELS[value] : 'Extra';
  }

  formatMoney(value: number | null | undefined): string {
    return '$' + Number(value ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  }

  formatQty(value: number | null | undefined): string {
    return Number(value ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
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
      extraTipo: tipo === 'extra' ? 'reparto' : undefined,
      horas: tipo === 'horas' ? 8 : undefined,
      monto: tipo === 'pago' ? undefined : tipo === 'extra' ? undefined : undefined,
      medioPagoId: tipo === 'pago' ? 'efectivo' : undefined,
    };
  }
}
