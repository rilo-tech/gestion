import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Client, ClientService } from '../../core/services/client.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { AuthService } from '../../core/services/auth.service';
import {
  defaultReportFromDate,
  defaultReportToDate,
  REPORT_GROUP_BY_OPTIONS,
  ReportGroupBy,
  ReportQuery,
  ReportResult,
  ReportsService,
} from '../../core/services/reports.service';
import { ReportsPrintService } from '../../core/services/reports-print.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  IconActionComponent,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';

type PeriodPreset = '7' | '30' | '90' | '365' | 'year' | 'custom';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    IconActionComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Reportes</h1>
          <p class="text-sm sm:text-base text-gray-500 desc-lg-only">
            Ventas, ganancias, stock sugerido y clientes inactivos. Combiná filtros y exportá a impresión.
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-icon-action
            label="Imprimir"
            variant="secondary"
            [disabled]="!report || loading"
            (clicked)="printReport()">
            <i-lucide name="printer" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Actualizar" [disabled]="loading" (clicked)="loadReport()">
            <i-lucide name="bar-chart-3" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Período</p>
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
              [class.text-gray-600]="activePreset !== preset.value"
              [class.hover:bg-gray-50]="activePreset !== preset.value">
              {{ preset.label }}
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Desde</span>
              <input
                type="date"
                [(ngModel)]="query.from"
                name="reportFrom"
                (change)="activePreset = 'custom'; loadReport()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Hasta</span>
              <input
                type="date"
                [(ngModel)]="query.to"
                name="reportTo"
                (change)="activePreset = 'custom'; loadReport()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Agrupar por</span>
              <select
                [(ngModel)]="query.groupBy"
                name="reportGroupBy"
                (change)="loadReport()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                <option *ngFor="let option of groupByOptions" [ngValue]="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Cliente</span>
              <app-searchable-select
                [(ngModel)]="query.clienteId"
                name="reportClient"
                [options]="clientOptions"
                placeholder="Todos los clientes"
                emptyListMessage="Sin clientes"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Producto</span>
              <app-searchable-select
                [(ngModel)]="query.productoId"
                name="reportProduct"
                [options]="productOptions"
                placeholder="Todos"
                emptyListMessage="Sin productos"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Categoría</span>
              <app-searchable-select
                [(ngModel)]="query.categoria"
                name="reportCategory"
                [options]="categoryOptions"
                placeholder="Todas"
                emptyListMessage="Sin categorías"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Tipo / modelo</span>
              <app-searchable-select
                [(ngModel)]="query.tipo"
                name="reportType"
                [options]="typeOptions"
                placeholder="Todos"
                emptyListMessage="Sin tipos"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Talle</span>
              <app-searchable-select
                [(ngModel)]="query.talle"
                name="reportSize"
                [options]="sizeOptions"
                placeholder="Todos"
                emptyListMessage="Sin talles"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Color</span>
              <app-searchable-select
                [(ngModel)]="query.color"
                name="reportColor"
                [options]="colorOptions"
                placeholder="Todos"
                emptyListMessage="Sin colores"
                (ngModelChange)="loadReport()">
              </app-searchable-select>
            </label>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              (click)="clearFilters()"
              class="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      <div *ngIf="error" class="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ error }}
      </div>

      <div *ngIf="loading" class="mb-6 rounded-xl border border-gray-100 bg-white px-4 py-8 text-center text-sm text-gray-500">
        Generando reporte...
      </div>

      <ng-container *ngIf="report && !loading">
        <div class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Ventas</p>
            <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ report.summary.ventasCount }}</p>
          </div>
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Unidades</p>
            <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ report.summary.unidadesVendidas }}</p>
          </div>
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Facturado</p>
            <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatMoney(report.summary.facturado) }}</p>
          </div>
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-teal-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Cobrado</p>
            <p class="text-xl sm:text-2xl font-bold text-teal-600 tabular-nums">{{ formatMoney(report.summary.cobrado) }}</p>
          </div>
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Ticket prom.</p>
            <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ formatMoney(report.summary.ticketPromedio) }}</p>
          </div>
          <div *ngIf="auth.canViewEconomics" class="bg-white p-4 sm:p-5 rounded-xl border border-emerald-100 shadow-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Ganancia</p>
            <p class="text-xl sm:text-2xl font-bold text-emerald-600 tabular-nums">{{ formatMoney(report.summary.ganancia) }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          <div class="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-gray-900">Detalle · {{ activeGroupByLabel }}</h2>
                <p class="text-xs text-gray-500 mt-0.5">
                  {{ report.period.days }} días · {{ report.groups.length }} filas
                </p>
              </div>
            </div>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-100">
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{{ activeGroupByLabel }}</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cant.</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Facturado</th>
                    <th *ngIf="auth.canViewEconomics" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Ganancia</th>
                    <th *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Stock</th>
                    <th *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Sug. 30 d</th>
                    <th *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Faltante</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr *ngFor="let row of report.groups" class="hover:bg-gray-50/80">
                    <td class="px-4 sm:px-6 py-3 text-sm text-gray-800 font-medium">{{ row.label }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-700">{{ row.cantidad }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-900 font-medium">{{ formatMoney(row.facturado) }}</td>
                    <td *ngIf="auth.canViewEconomics" class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-emerald-700">{{ formatMoney(row.ganancia) }}</td>
                    <td *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-600">{{ row.stockActual ?? 0 }}</td>
                    <td *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-600">{{ formatQty(row.stockSugeridoMes) }}</td>
                    <td *ngIf="query.groupBy === 'product'" class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums" [class.text-orange-600]="(row.faltanteMes ?? 0) > 0" [class.font-semibold]="(row.faltanteMes ?? 0) > 0">
                      {{ formatQty(row.faltanteMes) }}
                    </td>
                  </tr>
                  <tr *ngIf="!report.groups.length">
                    <td [attr.colspan]="query.groupBy === 'product' ? 7 : (auth.canViewEconomics ? 4 : 3)" class="px-6 py-8 text-center text-sm text-gray-400">
                      No hay ventas con estos filtros en el período seleccionado.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="space-y-6">
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
                <h2 class="text-sm font-semibold text-gray-900">Promedio mensual</h2>
                <p class="text-xs text-gray-500 mt-0.5">Basado en los meses del período filtrado</p>
              </div>
              <div class="p-4 sm:p-6 space-y-3 text-sm">
                <div class="flex justify-between gap-3">
                  <span class="text-gray-500">Unidades / mes</span>
                  <strong class="tabular-nums text-gray-900">{{ formatQty(report.promedioMensual.cantidad) }}</strong>
                </div>
                <div class="flex justify-between gap-3">
                  <span class="text-gray-500">Facturado / mes</span>
                  <strong class="tabular-nums text-gray-900">{{ formatMoney(report.promedioMensual.facturado) }}</strong>
                </div>
                <div *ngIf="auth.canViewEconomics" class="flex justify-between gap-3">
                  <span class="text-gray-500">Ganancia / mes</span>
                  <strong class="tabular-nums text-emerald-700">{{ formatMoney(report.promedioMensual.ganancia) }}</strong>
                </div>
                <p class="text-xs text-gray-400 pt-2 border-t border-gray-100">
                  {{ report.promedioMensual.mesesConDatos }} mes(es) con ventas en el rango.
                </p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
                <h2 class="text-sm font-semibold text-gray-900">Tendencia mensual</h2>
              </div>
              <div class="divide-y divide-gray-50">
                <div *ngFor="let row of report.monthlyTrend" class="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 text-sm">
                  <span class="text-gray-700 font-medium">{{ row.label }}</span>
                  <div class="text-right">
                    <div class="tabular-nums text-gray-900">{{ row.cantidad }} u. · {{ formatMoney(row.facturado) }}</div>
                    <div class="text-xs text-gray-400">{{ row.ventasCount }} ventas</div>
                  </div>
                </div>
                <div *ngIf="!report.monthlyTrend.length" class="px-6 py-6 text-center text-sm text-gray-400">
                  Sin datos mensuales.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="report.clientDetail" class="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 class="text-sm font-semibold text-gray-900">
                Qué compró · {{ report.clientDetail.clienteNombre }}
              </h2>
            </div>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-100">
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Producto</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cant.</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Facturado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr *ngFor="let row of report.clientDetail.productos">
                    <td class="px-4 sm:px-6 py-3 text-sm text-gray-800">{{ row.nombre }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ row.cantidad }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums font-medium">{{ formatMoney(row.facturado) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 class="text-sm font-semibold text-gray-900">Ventas del cliente en el período</h2>
            </div>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-100">
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Venta</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Unidades</th>
                    <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr *ngFor="let row of report.clientDetail.ventas">
                    <td class="px-4 sm:px-6 py-3 text-sm text-gray-600">{{ formatDate(row.fecha) }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm font-medium text-teal-700">#{{ row.ventaLabel }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ row.cantidadItems }}</td>
                    <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums font-medium">{{ formatMoney(row.total) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div *ngIf="report.collaboratorsSummary && auth.canAccessCollaborators" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
            <h2 class="text-sm font-semibold text-gray-900">Colaboradores · costo de personal</h2>
            <p class="text-xs text-gray-500 mt-0.5">Mismo período del reporte de ventas</p>
          </div>
          <div class="module-summary-kpis grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 p-4 sm:p-6 border-b border-gray-100">
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Horas</p>
              <p class="text-lg font-bold tabular-nums">{{ formatQty(report.collaboratorsSummary.totalHoras) }}</p>
            </div>
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Devengado</p>
              <p class="text-lg font-bold tabular-nums">{{ formatMoney(report.collaboratorsSummary.totalDevengado) }}</p>
            </div>
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Extras</p>
              <p class="text-lg font-bold text-amber-600 tabular-nums">{{ formatMoney(report.collaboratorsSummary.totalExtras) }}</p>
            </div>
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Pagado</p>
              <p class="text-lg font-bold text-teal-600 tabular-nums">{{ formatMoney(report.collaboratorsSummary.totalPagado) }}</p>
            </div>
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Pendiente</p>
              <p class="text-lg font-bold text-orange-600 tabular-nums">{{ formatMoney(report.collaboratorsSummary.totalPendientePeriodo) }}</p>
            </div>
            <div>
              <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Saldo acumulado</p>
              <p class="text-lg font-bold tabular-nums">{{ formatMoney(report.collaboratorsSummary.totalSaldoAcumulado) }}</p>
            </div>
          </div>
          <div [class]="tableScrollClass">
            <table [class]="tableMinWidthClass">
              <thead>
                <tr class="bg-gray-50 border-b border-gray-100">
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Colaborador</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Horas</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Devengado</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pagado</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Pendiente</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr *ngFor="let row of report.collaboratorsSummary.colaboradores">
                  <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">{{ row.nombre }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatQty(row.horas) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ formatMoney(row.devengado) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-teal-700">{{ formatMoney(row.pagado) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums" [class.text-orange-600]="row.pendientePeriodo > 0">{{ formatMoney(row.pendientePeriodo) }}</td>
                </tr>
                <tr *ngIf="!report.collaboratorsSummary.colaboradores.length">
                  <td colspan="5" class="px-6 py-8 text-center text-sm text-gray-400">Sin movimientos de colaboradores en el período.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-gray-900">Clientes · hace cuánto no compran</h2>
              <p class="text-xs text-gray-500 mt-0.5">Historial completo de ventas (no depende del período arriba)</p>
            </div>
            <input
              [(ngModel)]="inactiveMinDays"
              name="inactiveMinDays"
              type="number"
              min="0"
              placeholder="Mín. días sin comprar"
              class="w-full sm:w-48 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          </div>
          <div [class]="tableScrollClass">
            <table [class]="tableMinWidthClass">
              <thead>
                <tr class="bg-gray-50 border-b border-gray-100">
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Última compra</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Días</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Ventas</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total histórico</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr *ngFor="let row of filteredInactiveClients" class="hover:bg-gray-50/80">
                  <td class="px-4 sm:px-6 py-3 text-sm text-gray-800 font-medium">{{ row.nombre }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-gray-600">{{ formatDate(row.ultimaCompra) }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums" [class.text-orange-600]="(row.diasSinComprar ?? 0) >= 60" [class.font-semibold]="(row.diasSinComprar ?? 0) >= 60">
                    {{ row.diasSinComprar ?? '—' }}
                  </td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-600">{{ row.ventasCount }}</td>
                  <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-900">{{ formatMoney(row.totalHistorico) }}</td>
                </tr>
                <tr *ngIf="!filteredInactiveClients.length">
                  <td colspan="5" class="px-6 py-8 text-center text-sm text-gray-400">
                    No hay clientes que cumplan el filtro de inactividad.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </ng-container>
    </div>
  `,
})
export class ReportsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private reportsService = inject(ReportsService);
  private printService = inject(ReportsPrintService);
  private clientService = inject(ClientService);
  private stockService = inject(StockService);

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;
  readonly groupByOptions = REPORT_GROUP_BY_OPTIONS;

  readonly periodPresets: Array<{ value: PeriodPreset; label: string }> = [
    { value: '7', label: '7 días' },
    { value: '30', label: '30 días' },
    { value: '90', label: '90 días' },
    { value: '365', label: '12 meses' },
    { value: 'year', label: 'Año actual' },
    { value: 'custom', label: 'Personalizado' },
  ];

  query: ReportQuery = {
    from: defaultReportFromDate(),
    to: defaultReportToDate(),
    groupBy: 'product',
  };

  activePreset: PeriodPreset = '30';
  loading = false;
  error = '';
  report: ReportResult | null = null;
  inactiveMinDays: number | null = null;

  clients: Client[] = [];
  stock: StockItem[] = [];

  get clientOptions() {
    return this.clients
      .filter((c) => c.id)
      .map((c) => ({ value: c.id!, label: c.nombre }));
  }

  get productOptions() {
    return this.stock
      .filter((item) => item.id)
      .map((item) => ({ value: item.id!, label: item.nombre }));
  }

  get categoryOptions() {
    return this.uniqueOptions(this.stock.map((item) => item.categoria));
  }

  get typeOptions() {
    return this.uniqueOptions(
      this.stock.map((item) => item.tipo?.trim() || item.nombreBase?.trim() || '')
    );
  }

  get sizeOptions() {
    return this.uniqueOptions(this.stock.map((item) => item.talle));
  }

  get colorOptions() {
    return this.uniqueOptions(this.stock.map((item) => item.color));
  }

  get activeGroupByLabel(): string {
    return this.groupByOptions.find((o) => o.value === this.query.groupBy)?.label ?? 'Detalle';
  }

  get filteredInactiveClients() {
    if (!this.report) return [];
    const min = Number(this.inactiveMinDays ?? 0);
    if (!Number.isFinite(min) || min <= 0) return this.report.inactiveClients;
    return this.report.inactiveClients.filter(
      (row) => (row.diasSinComprar ?? 0) >= min
    );
  }

  ngOnInit(): void {
    this.clientService.getClients().subscribe({
      next: (clients) => (this.clients = clients),
    });
    this.stockService.getStock().subscribe({
      next: (stock) => (this.stock = stock),
    });
    this.loadReport();
  }

  applyPreset(preset: PeriodPreset): void {
    this.activePreset = preset;
    const today = new Date();
    const to = today.toISOString().slice(0, 10);

    if (preset === 'year') {
      this.query.from = `${today.getFullYear()}-01-01`;
      this.query.to = to;
    } else if (preset === 'custom') {
      return;
    } else {
      const days = Number(preset);
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - (days - 1));
      this.query.from = fromDate.toISOString().slice(0, 10);
      this.query.to = to;
    }

    this.loadReport();
  }

  clearFilters(): void {
    this.query = {
      from: this.query.from,
      to: this.query.to,
      groupBy: this.query.groupBy ?? 'product',
    };
    this.loadReport();
  }

  loadReport(): void {
    this.loading = true;
    this.error = '';
    this.reportsService.getReport(this.query).subscribe({
      next: (report) => {
        this.report = report;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo generar el reporte. Probá de nuevo.';
        this.loading = false;
      },
    });
  }

  printReport(): void {
    if (!this.report) return;
    this.printService.print(this.report, this.query.groupBy ?? 'product');
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

  private uniqueOptions(values: Array<string | undefined>) {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const raw of values) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ value, label: value });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }
}
