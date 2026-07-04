import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PlatformService,
  SubscriptionStatus,
  type PlatformTrialRow,
} from '../../core/services/platform.service';
import {
  PublicBusinessInfo,
  PublicPlanInfo,
  SubscriptionPaymentStatus,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import {
  DEFAULT_PLAN_MODULES,
  SELLABLE_SUBSCRIPTION_MODULE_CATALOG,
  normalizeModulesMap,
  type SubscriptionModuleId,
  type SubscriptionModulesMap,
} from '../../../../../shared/subscription-modules.ts';
import {
  DEFAULT_TRIAL_DAYS,
} from '../../../../../shared/trial-state.ts';

type PlatformTab = 'empresas' | 'pruebas' | 'pagos' | 'planes';
type PaymentFilter = 'all' | SubscriptionPaymentStatus | 'en_prueba';

@Component({
  selector: 'app-platform',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ListSearchFieldComponent,
  ],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Administración de plataforma</h1>
        <p class="text-sm text-gray-500 mt-1 desc-lg-only">
          Gestioná empresas, suscripciones y planes desde un solo lugar.
        </p>
      </div>

      <div class="flex gap-2 border-b border-gray-200">
        <button
          type="button"
          (click)="activeTab = 'empresas'"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'empresas'"
          [class.text-teal-700]="activeTab === 'empresas'"
          [class.border-transparent]="activeTab !== 'empresas'"
          [class.text-gray-500]="activeTab !== 'empresas'">
          Empresas
        </button>
        <button
          type="button"
          (click)="switchTab('pruebas')"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'pruebas'"
          [class.text-teal-700]="activeTab === 'pruebas'"
          [class.border-transparent]="activeTab !== 'pruebas'"
          [class.text-gray-500]="activeTab !== 'pruebas'">
          Pruebas activas
        </button>
        <button
          type="button"
          (click)="activeTab = 'pagos'"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'pagos'"
          [class.text-teal-700]="activeTab === 'pagos'"
          [class.border-transparent]="activeTab !== 'pagos'"
          [class.text-gray-500]="activeTab !== 'pagos'">
          Control de pagos
          <span
            *ngIf="paymentStats.vencido > 0"
            class="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
            {{ paymentStats.vencido }}
          </span>
        </button>
        <button
          type="button"
          (click)="activeTab = 'planes'"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'planes'"
          [class.text-teal-700]="activeTab === 'planes'"
          [class.border-transparent]="activeTab !== 'planes'"
          [class.text-gray-500]="activeTab !== 'planes'">
          Planes
        </button>
      </div>

      <!-- EMPRESAS -->
      <section *ngIf="activeTab === 'empresas'" class="space-y-4">
        <div class="flex items-center gap-2">
          <app-list-search-field
            mode="filter"
            [(query)]="businessSearchQuery"
            name="businessSearchQueryMobile"
            placeholder="Buscar..."
            [constrainWidth]="false"
            extraClass="sm:hidden flex-1 min-w-0">
          </app-list-search-field>
          <button
            type="button"
            (click)="toggleCreateBusinessForm()"
            class="shrink-0 text-sm font-semibold text-teal-700 hover:text-teal-900 hover:underline whitespace-nowrap">
            {{ showCreateBusinessForm ? 'Cancelar' : '+ Crear empresa' }}
          </button>
        </div>

        <article
          *ngIf="showCreateBusinessForm"
          class="rounded-xl border shadow-sm overflow-hidden bg-teal-50/40 border-teal-100">
          <div class="border-l-4 border-l-teal-500 p-4 sm:p-5">
            <h3 class="font-bold text-gray-900 mb-1">Nueva empresa / suscripción</h3>
            <p class="text-sm text-gray-600 mb-4">Creá la empresa y el administrador inicial.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                [(ngModel)]="businessDraft.id"
                placeholder="Código empresa * (ej: rilo, fs)"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="businessDraft.nombre"
                placeholder="Nombre comercial *"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <select
                [(ngModel)]="businessDraft.planId"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm md:col-span-2">
                <option *ngFor="let plan of activePlans" [value]="plan.id">
                  {{ plan.nombre }} · {{ formatMoney(plan.precioMensual) }}/mes
                </option>
              </select>
              <input
                [(ngModel)]="businessDraft.supervisorNombre"
                placeholder="Nombre admin *"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="businessDraft.supervisorEmail"
                placeholder="Email admin (para Google)"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="businessDraft.supervisorLogin"
                placeholder="Usuario admin *"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="businessDraft.supervisorPassword"
                type="password"
                placeholder="Contraseña inicial"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <label class="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-900 md:col-span-2 cursor-pointer">
                <input
                  type="checkbox"
                  [(ngModel)]="businessDraft.enPrueba"
                  (ngModelChange)="onCreateTrialToggle($event)"
                  name="businessDraftEnPrueba"
                  class="rounded border-violet-300 text-violet-600">
                Prueba gratis {{ defaultTrialDays }} días (Plan Intermedio, no suma en cobros)
              </label>
              <ng-container *ngIf="businessDraft.enPrueba">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Inicio de prueba</label>
                  <input
                    [(ngModel)]="businessDraft.trialStartDate"
                    name="businessDraftTrialStart"
                    type="date"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Fin de prueba</label>
                  <input
                    [(ngModel)]="businessDraft.trialEndDate"
                    name="businessDraftTrialEnd"
                    type="date"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
              </ng-container>
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                (click)="showCreateBusinessForm = false"
                class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">
                Cancelar
              </button>
              <button
                type="button"
                (click)="createBusiness()"
                [disabled]="creatingBusiness"
                class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                {{ creatingBusiness ? 'Creando...' : 'Crear empresa y admin' }}
              </button>
            </div>
          </div>
        </article>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div [class]="desktopListSearchWrapClass">
            <app-list-search-field
              mode="filter"
              [(query)]="businessSearchQuery"
              name="businessSearchQuery"
              placeholder="Buscar por nombre o código...">
            </app-list-search-field>
          </div>
          <div [class]="tableScrollClass">
            <table class="app-data-table w-full max-w-full text-left border-collapse sm:table-fixed">
              <colgroup class="hidden sm:table-column-group">
                <col class="w-[10rem]" />
                <col class="w-[6rem]" />
                <col class="w-[8rem]" />
                <col class="w-[7rem]" />
                <col class="w-[6rem]" />
                <col class="w-[7rem]" />
                <col class="w-[5rem]" />
              </colgroup>
              <thead>
                <tr class="bg-gray-50 border-b border-gray-100">
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Empresa</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Código</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cuota</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Pago mes</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Suscripción</th>
                  <th class="hidden sm:table-cell px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr
                  *ngFor="let business of filteredBusinesses"
                  (click)="openBusiness(business)"
                  class="hover:bg-gray-50 transition-colors cursor-pointer">
                  <td class="px-4 sm:px-6 py-3 sm:py-4">
                    <div class="font-medium text-gray-900 truncate flex items-center gap-2">
                      <span class="truncate">{{ business.nombre }}</span>
                      <span
                        *ngIf="isTrialExpiredBusiness(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-900">
                        Prueba vencida
                      </span>
                      <span
                        *ngIf="isTrialExpiringSoon(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-orange-100 text-orange-900">
                        Vence en {{ business.trialDaysRemaining }} d
                      </span>
                      <span
                        *ngIf="isActiveTrialBusiness(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-100 text-violet-800">
                        Prueba
                      </span>
                    </div>
                    <div class="sm:hidden text-xs text-gray-500 mt-0.5">{{ business.id }}</div>
                  </td>
                  <td class="hidden sm:table-cell px-6 py-4 text-sm font-mono text-gray-600">{{ business.id }}</td>
                  <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 truncate">{{ business.plan.nombre }}</td>
                  <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-900 text-right tabular-nums">
                    {{ formatMoney(business.montoMensualEsperado) }}
                  </td>
                  <td class="px-4 sm:px-6 py-3 sm:py-4">
                    <span
                      class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold"
                      [ngClass]="getBillingStatusClass(business)">
                      {{ getBillingStatusLabel(business) }}
                    </span>
                    <div class="text-xs text-gray-400 mt-0.5">{{ formatPeriodo(business.periodoPagoActual) }}</div>
                  </td>
                  <td class="hidden sm:table-cell px-6 py-4">
                    <div class="flex items-center gap-2" (click)="$event.stopPropagation()">
                      <label class="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          [checked]="isSubscriptionActive(business)"
                          [disabled]="togglingSubscriptionId === business.id"
                          (change)="toggleBusinessSubscription(business, $any($event.target).checked)"
                          class="rounded border-gray-300 text-teal-600">
                        <span class="text-sm text-gray-700">
                          {{ isSubscriptionActive(business) ? 'Activa' : statusLabels[business.estadoSuscripcion] }}
                        </span>
                      </label>
                    </div>
                  </td>
                  <td class="hidden sm:table-cell px-4 py-4 text-right" (click)="$event.stopPropagation()">
                    <button
                      type="button"
                      (click)="openBusiness(business)"
                      title="Ver detalle y pagos"
                      class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                      <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                    </button>
                  </td>
                </tr>
                <tr *ngIf="loadingBusinesses">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando empresas...</td>
                </tr>
                <tr *ngIf="!loadingBusinesses && businesses.length > 0 && filteredBusinesses.length === 0">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                    No se encontraron empresas para "{{ businessSearchQuery }}".
                  </td>
                </tr>
                <tr *ngIf="!loadingBusinesses && businesses.length === 0">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                    Todavía no hay empresas. Creá la primera con el botón de arriba.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section *ngIf="activeTab === 'pruebas'" class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <button type="button" (click)="trialFilter = 'active'; loadTrials()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border"
            [class.border-violet-300]="trialFilter === 'active'"
            [class.bg-violet-50]="trialFilter === 'active'">Activas</button>
          <button type="button" (click)="trialFilter = 'expiring'; loadTrials()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border"
            [class.border-orange-300]="trialFilter === 'expiring'"
            [class.bg-orange-50]="trialFilter === 'expiring'">Por vencer</button>
          <button type="button" (click)="trialFilter = 'expired'; loadTrials()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border"
            [class.border-amber-300]="trialFilter === 'expired'"
            [class.bg-amber-50]="trialFilter === 'expired'">Vencidas</button>
          <button type="button" (click)="trialFilter = 'all'; loadTrials()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200">Todas</button>
        </div>
        <div class="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table class="app-data-table w-full text-left text-sm">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-400">
                <th class="px-4 py-3">Empresa</th>
                <th class="px-4 py-3">Responsable</th>
                <th class="px-4 py-3">Contacto</th>
                <th class="px-4 py-3">Vence</th>
                <th class="px-4 py-3">Uso</th>
                <th class="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr *ngFor="let row of trialRows" class="hover:bg-gray-50 cursor-pointer" (click)="openBusinessById(row.businessId)">
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-900">{{ row.nombre }}</div>
                  <div class="text-xs text-gray-500 font-mono">{{ row.businessId }}</div>
                </td>
                <td class="px-4 py-3 text-gray-700">{{ row.ownerName || '—' }}</td>
                <td class="px-4 py-3 text-xs text-gray-600">
                  <div>{{ row.phone || '—' }} <span *ngIf="row.phoneVerified" class="text-green-600">✓</span></div>
                  <div>{{ row.email || '—' }} <span *ngIf="row.emailVerified" class="text-green-600">✓</span></div>
                </td>
                <td class="px-4 py-3">
                  <div>{{ formatDate(row.trialEndDate ?? undefined) }}</div>
                  <div class="text-xs text-gray-500" *ngIf="row.trialDaysRemaining != null">{{ row.trialDaysRemaining }} días</div>
                </td>
                <td class="px-4 py-3 text-xs text-gray-600">
                  P {{ row.usage.ordersCount }} · V {{ row.usage.salesCount }} · Prod {{ row.usage.productsCount }}
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-800">
                    {{ row.trialStatus || '—' }}
                  </span>
                </td>
              </tr>
              <tr *ngIf="loadingTrials">
                <td colspan="6" class="px-4 py-10 text-center text-gray-400">Cargando pruebas...</td>
              </tr>
              <tr *ngIf="!loadingTrials && trialRows.length === 0">
                <td colspan="6" class="px-4 py-10 text-center text-gray-400">No hay pruebas con este filtro.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- PAGOS -->
      <section *ngIf="activeTab === 'pagos'" class="space-y-4">
        <div class="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          Control de cobros mensuales por empresa activa (excluye cuentas en prueba).
          Período en curso: <span class="font-semibold">{{ formatPeriodo(currentPeriodoLabel) }}</span>.
          Hasta el día 10 se considera pendiente; después, vencido.
        </div>

        <div
          *ngIf="paymentStats.trialExpiringSoon > 0"
          class="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          {{ paymentStats.trialExpiringSoon }} cuenta{{ paymentStats.trialExpiringSoon === 1 ? '' : 's' }} en prueba
          vence{{ paymentStats.trialExpiringSoon === 1 ? '' : 'n' }} en los próximos 3 días.
        </div>
        <div
          *ngIf="paymentStats.trialExpired > 0"
          class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {{ paymentStats.trialExpired }} cuenta{{ paymentStats.trialExpired === 1 ? '' : 's' }} con prueba vencida.
          Revisá si convertís a pago, extendés o desactivás la suscripción.
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div class="rounded-xl border border-green-100 bg-green-50 p-4">
            <p class="text-xs font-bold uppercase text-green-600 mb-1">Al día</p>
            <p class="text-2xl font-bold text-green-800">{{ paymentStats.alDia }}</p>
          </div>
          <div class="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <p class="text-xs font-bold uppercase text-amber-600 mb-1">Pendientes</p>
            <p class="text-2xl font-bold text-amber-800">{{ paymentStats.pendiente }}</p>
          </div>
          <div class="rounded-xl border border-red-100 bg-red-50 p-4">
            <p class="text-xs font-bold uppercase text-red-600 mb-1">Vencidos</p>
            <p class="text-2xl font-bold text-red-800">{{ paymentStats.vencido }}</p>
          </div>
          <div class="rounded-xl border border-violet-100 bg-violet-50 p-4">
            <p class="text-xs font-bold uppercase text-violet-600 mb-1">En prueba</p>
            <p class="text-2xl font-bold text-violet-800">{{ paymentStats.enPrueba }}</p>
          </div>
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-xs font-bold uppercase text-gray-500 mb-1">Cobrado mes</p>
            <p class="text-lg font-bold text-gray-900 tabular-nums">{{ formatMoney(paymentStats.montoCobradoMes) }}</p>
          </div>
          <div class="rounded-xl border border-orange-100 bg-orange-50 p-4">
            <p class="text-xs font-bold uppercase text-orange-600 mb-1">Por cobrar</p>
            <p class="text-lg font-bold text-orange-800 tabular-nums">{{ formatMoney(paymentStats.montoPendiente) }}</p>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <app-list-search-field
            mode="filter"
            [(query)]="paymentSearchQuery"
            name="paymentSearchQueryMobile"
            placeholder="Buscar..."
            [constrainWidth]="false"
            extraClass="w-full sm:hidden">
          </app-list-search-field>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              *ngFor="let filter of paymentFilterOptions"
              (click)="paymentFilter = filter.value"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              [class.bg-teal-600]="paymentFilter === filter.value"
              [class.text-white]="paymentFilter === filter.value"
              [class.border-teal-600]="paymentFilter === filter.value"
              [class.bg-white]="paymentFilter !== filter.value"
              [class.text-gray-700]="paymentFilter !== filter.value"
              [class.border-gray-200]="paymentFilter !== filter.value"
              [class.hover:bg-gray-50]="paymentFilter !== filter.value">
              {{ filter.label }}
              <span *ngIf="filter.count !== null" class="ml-1 opacity-80">({{ filter.count }})</span>
            </button>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer shrink-0">
            <input
              type="checkbox"
              [(ngModel)]="includeSuspendedInPayments"
              name="includeSuspendedInPayments"
              class="rounded border-gray-300 text-teal-600">
            Incluir suspendidas
          </label>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div [class]="desktopListSearchWrapClass">
            <app-list-search-field
              mode="filter"
              [(query)]="paymentSearchQuery"
              name="paymentSearchQuery"
              placeholder="Buscar empresa por nombre o código...">
            </app-list-search-field>
          </div>
          <div [class]="tableScrollClass">
            <table class="app-data-table w-full max-w-full text-left border-collapse sm:table-fixed">
              <thead>
                <tr class="bg-gray-50 border-b border-gray-100">
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Empresa</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cuota</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                  <th class="hidden md:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Último pago</th>
                  <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Suscripción</th>
                  <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr
                  *ngFor="let business of filteredPaymentBusinesses"
                  class="hover:bg-gray-50 transition-colors">
                  <td class="px-4 sm:px-6 py-3 sm:py-4">
                    <div class="font-medium text-gray-900 truncate flex items-center gap-2">
                      <span class="truncate">{{ business.nombre }}</span>
                      <span
                        *ngIf="isTrialExpiredBusiness(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-900">
                        Prueba vencida
                      </span>
                      <span
                        *ngIf="isTrialExpiringSoon(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-orange-100 text-orange-900">
                        Vence en {{ business.trialDaysRemaining }} d
                      </span>
                      <span
                        *ngIf="isActiveTrialBusiness(business)"
                        class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-100 text-violet-800">
                        Prueba
                      </span>
                    </div>
                    <div class="text-xs text-gray-500 mt-0.5 font-mono">{{ business.id }}</div>
                  </td>
                  <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 truncate">{{ business.plan.nombre }}</td>
                  <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-900 text-right tabular-nums">
                    {{ formatMoney(business.montoMensualEsperado) }}
                  </td>
                  <td class="px-4 sm:px-6 py-3 sm:py-4">
                    <span
                      class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold"
                      [ngClass]="getBillingStatusClass(business)">
                      {{ getBillingStatusLabel(business) }}
                    </span>
                    <div class="text-xs text-gray-400 mt-0.5">{{ formatPeriodo(business.periodoPagoActual) }}</div>
                  </td>
                  <td class="hidden md:table-cell px-6 py-4 text-sm text-gray-600">
                    <ng-container *ngIf="business.ultimoPagoPeriodo; else noPaymentYet">
                      <div class="font-medium text-gray-900">{{ formatPeriodo(business.ultimoPagoPeriodo) }}</div>
                      <div class="text-xs text-gray-500 tabular-nums">
                        {{ formatMoney(business.ultimoPagoMonto) }} · {{ formatDate(business.ultimoPagoFecha) }}
                      </div>
                    </ng-container>
                    <ng-template #noPaymentYet>
                      <span class="text-gray-400">Sin pagos</span>
                    </ng-template>
                  </td>
                  <td class="hidden sm:table-cell px-6 py-4">
                    <span
                      class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold"
                      [ngClass]="getSubscriptionStatusClass(business.estadoSuscripcion)">
                      {{ statusLabels[business.estadoSuscripcion] }}
                    </span>
                  </td>
                  <td class="px-4 sm:px-6 py-3 sm:py-4">
                    <div class="flex items-center justify-end gap-1">
                      <button
                        *ngIf="countsForBilling(business) && business.estadoPago !== 'al_dia'"
                        type="button"
                        (click)="openBusinessForPayment(business)"
                        title="Registrar pago"
                        class="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                        <i-lucide name="wallet" class="w-3.5 h-3.5"></i-lucide>
                        Cobrar
                      </button>
                      <button
                        type="button"
                        (click)="openBusiness(business)"
                        title="Ver detalle e historial"
                        class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                        <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                      </button>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="loadingBusinesses">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando pagos...</td>
                </tr>
                <tr *ngIf="!loadingBusinesses && paymentControlBusinesses.length > 0 && filteredPaymentBusinesses.length === 0">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                    No hay empresas que coincidan con el filtro o la búsqueda.
                  </td>
                </tr>
                <tr *ngIf="!loadingBusinesses && paymentControlBusinesses.length === 0">
                  <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                    No hay empresas para controlar pagos.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- PLANES -->
      <section *ngIf="activeTab === 'planes'" class="space-y-4">
        <p class="text-sm text-gray-600 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
          Los planes son <strong>plantillas para empresas nuevas</strong>. Para cambiar operadores, módulos o precios de un cliente,
          abrí su ficha en Empresas. Al guardar un plan sin marcar «aplicar a existentes», las empresas actuales conservan su configuración.
        </p>
        <div class="flex justify-end">
          <button
            type="button"
            (click)="toggleCreatePlanForm()"
            class="text-sm font-semibold text-teal-700 hover:text-teal-900 hover:underline">
            {{ showCreatePlanForm ? 'Cancelar' : '+ Crear plan' }}
          </button>
        </div>

        <article
          *ngIf="showCreatePlanForm"
          class="rounded-xl border shadow-sm overflow-hidden bg-amber-50/50 border-amber-100">
          <div class="border-l-4 border-l-amber-500 p-4 sm:p-5">
            <h3 class="font-bold text-gray-900 mb-1">Nuevo plan</h3>
            <p class="text-sm text-gray-600 mb-4">Definí cupos, precios y módulos incluidos.</p>
            <div class="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                *ngFor="let tpl of planTemplateOptions"
                (click)="applyPlanDraftTemplate(tpl.id)"
                class="px-2.5 py-1 rounded-lg text-xs font-semibold border border-amber-200 bg-white text-amber-900 hover:bg-amber-100">
                Plantilla {{ tpl.label }}
              </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                [(ngModel)]="planDraft.id"
                placeholder="Id plan * (ej: plan_basico)"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.nombre"
                placeholder="Nombre *"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.precioBaseMensual"
                (ngModelChange)="planDraft.precioMensual = planDraft.precioBaseMensual"
                type="number"
                min="0"
                step="1"
                placeholder="Precio base ($/mes)"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.precioPorAdministrador"
                type="number"
                min="0"
                step="1"
                placeholder="$/admin/mes"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.precioPorOperador"
                type="number"
                min="0"
                step="1"
                placeholder="$/operador/mes"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.maxAmbitosCaja"
                type="number"
                min="0"
                step="1"
                placeholder="Máx. ámbitos caja"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.limiteAdministradores"
                type="number"
                min="1"
                placeholder="Límite administradores"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.limiteOperadores"
                type="number"
                min="0"
                placeholder="Límite operadores"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
              <input
                [(ngModel)]="planDraft.limiteUsuariosTotal"
                type="number"
                min="1"
                placeholder="Límite total (opcional)"
                class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm md:col-span-2">
            </div>
            <div class="mt-4">
              <h4 class="text-sm font-semibold text-gray-900 mb-2">Módulos incluidos</h4>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  *ngFor="let module of moduleCatalog"
                  class="inline-flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    [checked]="planDraftModuleEnabled(module.id)"
                    [disabled]="module.alwaysOn"
                    (change)="togglePlanDraftModule(module.id, $any($event.target).checked)"
                    class="mt-0.5 rounded border-gray-300 text-teal-600">
                  <span>
                    <span class="block font-medium text-gray-900">{{ module.label }}</span>
                    <span class="block text-xs text-gray-500">{{ module.description }}</span>
                  </span>
                </label>
              </div>
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                (click)="showCreatePlanForm = false"
                class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">
                Cancelar
              </button>
              <button
                type="button"
                (click)="createPlan()"
                [disabled]="creatingPlan"
                class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                {{ creatingPlan ? 'Creando...' : 'Crear plan' }}
              </button>
            </div>
          </div>
        </article>

        <div class="space-y-3">
          <article
            *ngFor="let plan of activePlans; let i = index"
            class="rounded-xl border shadow-sm overflow-hidden"
            [ngClass]="{
              'bg-teal-50/40 border-teal-100': i % 3 === 0,
              'bg-sky-50/60 border-sky-100': i % 3 === 1,
              'bg-violet-50/60 border-violet-100': i % 3 === 2
            }">
            <div
              role="button"
              tabindex="0"
              (click)="togglePlanPanel(plan.id)"
              (keydown.enter)="togglePlanPanel(plan.id)"
              class="border-l-4 p-4 sm:p-5 cursor-pointer transition-colors hover:bg-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              [ngClass]="{
                'border-l-teal-500': i % 3 === 0,
                'border-l-sky-500': i % 3 === 1,
                'border-l-violet-500': i % 3 === 2
              }">
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  [ngClass]="{
                    'bg-teal-600 text-white': i % 3 === 0,
                    'bg-sky-600 text-white': i % 3 === 1,
                    'bg-violet-600 text-white': i % 3 === 2
                  }">
                  {{ getPlanInitial(plan) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-bold text-gray-900">{{ plan.nombre }}</h3>
                    <span class="px-2 py-0.5 rounded-full text-xs font-mono bg-white/80 text-gray-600 border border-gray-200">
                      {{ plan.id }}
                    </span>
                    <span
                      class="px-2 py-0.5 rounded-full text-xs font-semibold"
                      [class.bg-green-100]="plan.activo"
                      [class.text-green-800]="plan.activo"
                      [class.bg-gray-200]="!plan.activo"
                      [class.text-gray-600]="!plan.activo">
                      {{ plan.activo ? 'Activo' : 'Inactivo' }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">
                    {{ formatMoney(plan.precioMensual) }}/mes ·
                    {{ plan.limiteAdministradores }} admin · {{ plan.limiteOperadores }} op · {{ plan.limiteUsuariosTotal }} total
                  </p>
                </div>
                <i-lucide
                  [name]="isPlanExpanded(plan.id) ? 'chevron-up' : 'chevron-down'"
                  class="w-5 h-5 shrink-0 text-gray-400">
                </i-lucide>
              </div>
            </div>

            <div
              *ngIf="isPlanExpanded(plan.id)"
              class="border-t border-gray-200/80 bg-white/80 px-4 sm:px-5 py-4 sm:py-5"
              (click)="$event.stopPropagation()">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
                  <input
                    [(ngModel)]="plan.nombre"
                    [name]="'planNombre' + plan.id"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Código</label>
                  <input
                    [value]="plan.id"
                    disabled
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Precio base ($/mes)</label>
                  <input
                    [(ngModel)]="plan.precioBaseMensual"
                    (ngModelChange)="plan.precioMensual = plan.precioBaseMensual"
                    [name]="'planPrecioBase' + plan.id"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">$/admin/mes</label>
                  <input
                    [(ngModel)]="plan.precioPorAdministrador"
                    [name]="'planPrecioAdmin' + plan.id"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">$/operador/mes</label>
                  <input
                    [(ngModel)]="plan.precioPorOperador"
                    [name]="'planPrecioOp' + plan.id"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Máx. ámbitos caja</label>
                  <input
                    [(ngModel)]="plan.maxAmbitosCaja"
                    [name]="'planMaxCaja' + plan.id"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Administradores</label>
                  <input
                    [(ngModel)]="plan.limiteAdministradores"
                    [name]="'planAdmins' + plan.id"
                    type="number"
                    min="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Operadores</label>
                  <input
                    [(ngModel)]="plan.limiteOperadores"
                    [name]="'planOps' + plan.id"
                    type="number"
                    min="0"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
                <div class="md:col-span-2">
                  <label class="block text-xs font-medium text-gray-500 mb-1">Total usuarios</label>
                  <input
                    [(ngModel)]="plan.limiteUsuariosTotal"
                    [name]="'planTotal' + plan.id"
                    type="number"
                    min="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                </div>
              </div>

              <label class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  [(ngModel)]="plan.activo"
                  [name]="'activo' + plan.id"
                  class="rounded border-gray-300 text-teal-600">
                Plan activo
              </label>

              <div class="mb-4">
                <h4 class="text-sm font-semibold text-gray-900 mb-2">Módulos incluidos en el plan</h4>
                <div class="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    *ngFor="let tpl of planTemplateOptions"
                    (click)="applyPlanTemplate(plan, tpl.id)"
                    class="px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                    Plantilla {{ tpl.label }}
                  </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    *ngFor="let module of moduleCatalog"
                    class="inline-flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      [checked]="planModuleEnabled(plan, module.id)"
                      [disabled]="module.alwaysOn"
                      (change)="togglePlanModule(plan, module.id, $any($event.target).checked)"
                      class="mt-0.5 rounded border-gray-300 text-teal-600">
                    <span>
                      <span class="block font-medium text-gray-900">{{ module.label }}</span>
                      <span class="block text-xs text-gray-500">{{ module.description }}</span>
                    </span>
                  </label>
                </div>
              </div>

              <label class="inline-flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm cursor-pointer mb-4">
                <input
                  type="checkbox"
                  [(ngModel)]="planApplyToExisting[plan.id]"
                  [name]="'applyExisting' + plan.id"
                  class="mt-0.5 rounded border-amber-300 text-amber-600">
                <span>
                  <span class="block font-medium text-amber-950">Aplicar también a empresas que ya usan este plan</span>
                  <span class="block text-xs text-amber-800 mt-0.5">
                    Dejalo desmarcado para no tocar clientes existentes. Solo las empresas nuevas tomarán la plantilla actualizada.
                  </span>
                </span>
              </label>

              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  (click)="togglePlanPanel(plan.id)"
                  class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">
                  Cerrar
                </button>
                <button
                  type="button"
                  (click)="savePlan(plan)"
                  [disabled]="savingPlanId === plan.id"
                  class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                  {{ savingPlanId === plan.id ? 'Guardando...' : 'Guardar plan' }}
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  `,
})
export class PlatformComponent implements OnInit {
  private platformService = inject(PlatformService);
  private dialogService = inject(DialogService);
  private router = inject(Router);

  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;
  readonly paymentStatusLabels = SUBSCRIPTION_PAYMENT_STATUS_LABELS;
  readonly moduleCatalog = SELLABLE_SUBSCRIPTION_MODULE_CATALOG;
  readonly defaultTrialDays = DEFAULT_TRIAL_DAYS;
  readonly planTemplateOptions = [
    { id: 'plan_basico', label: 'Básico' },
    { id: 'plan_intermedio', label: 'Intermedio' },
    { id: 'plan_profesional', label: 'Pro' },
  ];

  activeTab: PlatformTab = 'empresas';
  trialFilter: 'active' | 'expiring' | 'expired' | 'all' = 'active';
  trialRows: PlatformTrialRow[] = [];
  loadingTrials = false;
  businesses: (PublicBusinessInfo & { planId?: string })[] = [];
  plans: PublicPlanInfo[] = [];

  loadingBusinesses = false;
  creatingBusiness = false;
  creatingPlan = false;
  savingPlanId: string | null = null;
  togglingSubscriptionId: string | null = null;
  planApplyToExisting: Record<string, boolean> = {};

  showCreateBusinessForm = false;
  showCreatePlanForm = false;
  expandedPlanId: string | null = null;

  businessSearchQuery = '';
  paymentSearchQuery = '';
  paymentFilter: PaymentFilter = 'all';
  includeSuspendedInPayments = false;

  businessDraft = {
    id: '',
    nombre: '',
    planId: 'plan_basico',
    enPrueba: false,
    trialStartDate: '',
    trialEndDate: '',
    supervisorNombre: '',
    supervisorEmail: '',
    supervisorLogin: '',
    supervisorPassword: '',
  };

  planDraft = {
    id: '',
    nombre: '',
    precioMensual: 0,
    precioBaseMensual: 0,
    precioPorAdministrador: 0,
    precioPorOperador: 0,
    maxAmbitosCaja: 0,
    limiteAdministradores: 1,
    limiteOperadores: 2,
    limiteUsuariosTotal: 3,
  };

  planDraftModules: SubscriptionModulesMap = { ...DEFAULT_PLAN_MODULES.plan_basico };

  get activePlans(): PublicPlanInfo[] {
    return this.plans.filter((plan) => plan.activo);
  }

  get filteredBusinesses(): (PublicBusinessInfo & { planId?: string })[] {
    const query = this.businessSearchQuery.trim().toLowerCase();
    if (!query) return this.businesses;
    return this.businesses.filter(
      (business) =>
        business.nombre.toLowerCase().includes(query) ||
        business.id.toLowerCase().includes(query) ||
        business.plan.nombre.toLowerCase().includes(query)
    );
  }

  get currentPeriodoLabel(): string {
    return this.businesses[0]?.periodoPagoActual || this.currentPeriodo();
  }

  get paymentControlBusinesses(): (PublicBusinessInfo & { planId?: string })[] {
    if (this.includeSuspendedInPayments) return this.businesses;
    return this.businesses.filter((business) => business.estadoSuscripcion === 'activa');
  }

  get paymentStats() {
    const billable = this.businesses.filter((business) => this.countsForBilling(business));
    const trialActive = this.businesses.filter(
      (business) => business.estadoSuscripcion === 'activa' && this.isActiveTrialBusiness(business)
    );
    const trialExpiringSoon = this.businesses.filter(
      (business) => business.estadoSuscripcion === 'activa' && this.isTrialExpiringSoon(business)
    );
    const trialExpired = this.businesses.filter(
      (business) => business.estadoSuscripcion === 'activa' && this.isTrialExpiredBusiness(business)
    );

    const montoCobradoMes = billable
      .filter(
        (business) =>
          business.estadoPago === 'al_dia' &&
          business.ultimoPagoPeriodo === business.periodoPagoActual
      )
      .reduce(
        (sum, business) => sum + (business.ultimoPagoMonto ?? business.montoMensualEsperado),
        0
      );

    const montoPendiente = billable
      .filter((business) => business.estadoPago !== 'al_dia')
      .reduce((sum, business) => sum + business.montoMensualEsperado, 0);

    return {
      alDia: billable.filter((business) => business.estadoPago === 'al_dia').length,
      pendiente: billable.filter((business) => business.estadoPago === 'pendiente').length,
      vencido: billable.filter((business) => business.estadoPago === 'vencido').length,
      enPrueba: trialActive.length,
      trialExpiringSoon: trialExpiringSoon.length,
      trialExpired: trialExpired.length,
      montoCobradoMes,
      montoPendiente,
    };
  }

  get paymentFilterOptions(): { value: PaymentFilter; label: string; count: number | null }[] {
    const billable = this.businesses.filter((business) => this.countsForBilling(business));
    return [
      { value: 'all', label: 'Facturables', count: billable.length },
      { value: 'vencido', label: 'Vencidas', count: this.paymentStats.vencido },
      { value: 'pendiente', label: 'Pendientes', count: this.paymentStats.pendiente },
      { value: 'al_dia', label: 'Al día', count: this.paymentStats.alDia },
      { value: 'en_prueba', label: 'En prueba', count: this.paymentStats.enPrueba },
    ];
  }

  get filteredPaymentBusinesses(): (PublicBusinessInfo & { planId?: string })[] {
    let list = this.paymentControlBusinesses.filter(
      (business) => business.estadoSuscripcion === 'activa' || this.includeSuspendedInPayments
    );

    if (this.paymentFilter === 'en_prueba') {
      list = list.filter((business) => this.isTrialBusiness(business));
    } else if (this.paymentFilter !== 'all') {
      list = list.filter(
        (business) => this.countsForBilling(business) && business.estadoPago === this.paymentFilter
      );
    } else {
      list = list.filter(
        (business) => this.isTrialBusiness(business) || this.countsForBilling(business)
      );
    }

    const query = this.paymentSearchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (business) =>
          business.nombre.toLowerCase().includes(query) ||
          business.id.toLowerCase().includes(query) ||
          business.plan.nombre.toLowerCase().includes(query)
      );
    }

    const statusOrder: Record<SubscriptionPaymentStatus, number> = {
      vencido: 0,
      pendiente: 1,
      al_dia: 2,
    };

    return [...list].sort((left, right) => {
      if (this.isTrialBusiness(left) !== this.isTrialBusiness(right)) {
        return this.isTrialBusiness(left) ? 1 : -1;
      }
      const byStatus = statusOrder[left.estadoPago] - statusOrder[right.estadoPago];
      if (byStatus !== 0) return byStatus;
      return left.nombre.localeCompare(right.nombre, 'es');
    });
  }

  ngOnInit() {
    this.loadPlans();
    this.loadBusinesses();
  }

  switchTab(tab: PlatformTab) {
    this.activeTab = tab;
    if (tab === 'pruebas') this.loadTrials();
  }

  loadTrials() {
    this.loadingTrials = true;
    this.platformService.getTrials(this.trialFilter).subscribe({
      next: (rows) => {
        this.trialRows = rows;
        this.loadingTrials = false;
      },
      error: () => {
        this.trialRows = [];
        this.loadingTrials = false;
      },
    });
  }

  openBusinessById(businessId: string) {
    void this.router.navigate(['/platform', 'empresas', businessId]);
  }

  toggleCreateBusinessForm() {
    this.showCreateBusinessForm = !this.showCreateBusinessForm;
  }

  toggleCreatePlanForm() {
    this.showCreatePlanForm = !this.showCreatePlanForm;
    if (this.showCreatePlanForm) {
      this.expandedPlanId = null;
      this.planDraftModules = { ...DEFAULT_PLAN_MODULES.plan_basico };
    }
  }

  isPlanExpanded(planId: string): boolean {
    return this.expandedPlanId === planId;
  }

  togglePlanPanel(planId: string) {
    this.expandedPlanId = this.expandedPlanId === planId ? null : planId;
    if (this.expandedPlanId) {
      this.showCreatePlanForm = false;
    }
  }

  openBusiness(business: PublicBusinessInfo & { planId?: string }) {
    void this.router.navigate(['/platform', 'empresas', business.id]);
  }

  planDraftModuleEnabled(moduleId: SubscriptionModuleId): boolean {
    return this.planDraftModules[moduleId] === true;
  }

  togglePlanDraftModule(moduleId: SubscriptionModuleId, enabled: boolean) {
    this.planDraftModules = {
      ...this.planDraftModules,
      [moduleId]: moduleId === 'core' ? true : enabled,
    };
  }

  applyPlanDraftTemplate(templateId: string) {
    const template = DEFAULT_PLAN_MODULES[templateId];
    if (!template) return;
    this.planDraftModules = { ...template };
  }

  planModuleEnabled(plan: PublicPlanInfo, moduleId: SubscriptionModuleId): boolean {
    const modules = normalizeModulesMap(plan.modulosIncluidos, plan.id);
    return modules[moduleId] === true;
  }

  togglePlanModule(plan: PublicPlanInfo, moduleId: SubscriptionModuleId, enabled: boolean) {
    if (!plan.modulosIncluidos) {
      plan.modulosIncluidos = normalizeModulesMap(undefined, plan.id);
    }
    plan.modulosIncluidos[moduleId] = moduleId === 'core' ? true : enabled;
  }

  applyPlanTemplate(plan: PublicPlanInfo, templateId: string) {
    const template = DEFAULT_PLAN_MODULES[templateId];
    if (!template) return;
    plan.modulosIncluidos = { ...template };
  }

  private normalizePlan(plan: PublicPlanInfo): PublicPlanInfo {
    return {
      ...plan,
      precioBaseMensual: plan.precioBaseMensual ?? plan.precioMensual ?? 0,
      precioMensual: plan.precioBaseMensual ?? plan.precioMensual ?? 0,
      precioPorAdministrador: plan.precioPorAdministrador ?? 0,
      precioPorOperador: plan.precioPorOperador ?? 0,
      maxAmbitosCaja: plan.maxAmbitosCaja ?? 0,
      modulosIncluidos: normalizeModulesMap(plan.modulosIncluidos, plan.id),
      preciosAddonModulo: plan.preciosAddonModulo ?? {},
    };
  }

  openBusinessForPayment(business: PublicBusinessInfo & { planId?: string }) {
    void this.router.navigate(['/platform', 'empresas', business.id], { fragment: 'pagos' });
  }

  getPlanInitial(plan: PublicPlanInfo): string {
    return (plan.nombre.trim()[0] ?? 'P').toUpperCase();
  }

  getPaymentStatusClass(status: PublicBusinessInfo['estadoPago']): string {
    switch (status) {
      case 'al_dia':
        return 'bg-green-100 text-green-800';
      case 'pendiente':
        return 'bg-amber-100 text-amber-800';
      case 'vencido':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  isTrialBusiness(business: PublicBusinessInfo): boolean {
    return business.enPrueba === true;
  }

  isActiveTrialBusiness(business: PublicBusinessInfo): boolean {
    return business.trialBillingActive === true || (business.enPrueba === true && business.trialStatus === 'active');
  }

  isTrialExpiredBusiness(business: PublicBusinessInfo): boolean {
    return business.enPrueba === true && business.trialStatus === 'expired';
  }

  isTrialExpiringSoon(business: PublicBusinessInfo): boolean {
    return business.trialExpiringSoon === true && business.trialStatus === 'active';
  }

  countsForBilling(business: PublicBusinessInfo): boolean {
    if (business.estadoSuscripcion !== 'activa') return false;
    if (business.trialBillingActive === true) return false;
    if (business.trialBillingActive === false) return true;
    return !business.enPrueba;
  }

  getBillingStatusLabel(business: PublicBusinessInfo): string {
    if (this.isTrialExpiredBusiness(business)) return 'Prueba vencida';
    if (this.isActiveTrialBusiness(business)) {
      if (this.isTrialExpiringSoon(business) && business.trialDaysRemaining != null) {
        return `Prueba · vence en ${business.trialDaysRemaining} d`;
      }
      return 'En prueba';
    }
    return this.paymentStatusLabels[business.estadoPago];
  }

  getBillingStatusClass(business: PublicBusinessInfo): string {
    if (this.isTrialExpiredBusiness(business)) return 'bg-amber-100 text-amber-900';
    if (this.isActiveTrialBusiness(business)) {
      if (this.isTrialExpiringSoon(business)) return 'bg-orange-100 text-orange-900';
      return 'bg-violet-100 text-violet-800';
    }
    return this.getPaymentStatusClass(business.estadoPago);
  }

  onCreateTrialToggle(enPrueba: boolean) {
    if (enPrueba) {
      this.businessDraft.planId = 'plan_intermedio';
      if (!this.businessDraft.trialStartDate) {
        const today = new Date();
        const end = new Date(today);
        end.setDate(end.getDate() + this.defaultTrialDays);
        this.businessDraft.trialStartDate = today.toISOString().slice(0, 10);
        this.businessDraft.trialEndDate = end.toISOString().slice(0, 10);
      }
      return;
    }
    this.businessDraft.trialStartDate = '';
    this.businessDraft.trialEndDate = '';
  }

  getSubscriptionStatusClass(status: SubscriptionStatus): string {
    switch (status) {
      case 'activa':
        return 'bg-green-100 text-green-800';
      case 'suspendida':
        return 'bg-red-100 text-red-800';
      case 'vencida':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  isSubscriptionActive(business: PublicBusinessInfo): boolean {
    return business.estadoSuscripcion === 'activa';
  }

  toggleBusinessSubscription(
    business: PublicBusinessInfo & { planId?: string },
    activa: boolean
  ) {
    if (activa === this.isSubscriptionActive(business)) return;

    if (!activa) {
      this.dialogService
        .confirm({
          title: 'Desactivar suscripción',
          message:
            'Los usuarios de esta empresa no podrán ingresar hasta que reactives la suscripción.',
          confirmLabel: 'Desactivar',
          variant: 'danger',
        })
        .subscribe((confirmed) => {
          if (confirmed) {
            this.setBusinessSubscriptionActive(business, false);
          } else {
            this.loadBusinesses();
          }
        });
      return;
    }

    this.setBusinessSubscriptionActive(business, true);
  }

  private setBusinessSubscriptionActive(
    business: PublicBusinessInfo & { planId?: string },
    activa: boolean
  ) {
    const estadoSuscripcion: SubscriptionStatus = activa ? 'activa' : 'suspendida';
    this.togglingSubscriptionId = business.id;

    this.platformService
      .updateBusiness(business.id, { estadoSuscripcion })
      .subscribe({
        next: (updated) => {
          this.togglingSubscriptionId = null;
          business.estadoSuscripcion = updated.estadoSuscripcion;
          this.loadBusinesses();
        },
        error: (err) => {
          this.togglingSubscriptionId = null;
          this.loadBusinesses();
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo actualizar la suscripción.',
          });
        },
      });
  }

  formatMoney(value: number | undefined | null): string {
    const amount = Math.max(0, Number(value) || 0);
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  formatPeriodo(periodo: string | undefined): string {
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return periodo ?? '—';
    const [year, month] = periodo.split('-');
    const monthNames = [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    const monthIndex = Number(month) - 1;
    return `${monthNames[monthIndex] ?? month} ${year}`;
  }

  formatDate(value: string | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR');
  }

  createBusiness() {
    const id = this.businessDraft.id.trim().toLowerCase();
    const nombre = this.businessDraft.nombre.trim();
    const supervisorLogin = (
      this.businessDraft.supervisorLogin ||
      this.businessDraft.supervisorEmail ||
      this.businessDraft.supervisorNombre
    )
      .trim()
      .toLowerCase();

    if (!id || !nombre || !this.businessDraft.supervisorNombre.trim() || !supervisorLogin) {
      this.dialogService.alert({
        title: 'Campos requeridos',
        message: 'Completá código, nombre, admin y usuario de acceso.',
      });
      return;
    }

    this.creatingBusiness = true;
    const planId = this.businessDraft.enPrueba ? 'plan_intermedio' : this.businessDraft.planId;
    this.platformService
      .createBusiness({
        id,
        nombre,
        planId,
        enPrueba: this.businessDraft.enPrueba,
        trialStartDate: this.businessDraft.trialStartDate || undefined,
        trialEndDate: this.businessDraft.trialEndDate || undefined,
        supervisor: {
          nombre: this.businessDraft.supervisorNombre.trim(),
          email: this.businessDraft.supervisorEmail.trim().toLowerCase(),
          loginUsername: supervisorLogin,
          password: this.businessDraft.supervisorPassword.trim() || undefined,
        },
      })
      .subscribe({
        next: (result) => {
          this.creatingBusiness = false;
          this.showCreateBusinessForm = false;
          this.businesses = [...this.businesses, result.business].sort((a, b) =>
            a.nombre.localeCompare(b.nombre, 'es')
          );
          this.businessDraft = {
            id: '',
            nombre: '',
            planId: this.plans[0]?.id ?? 'plan_basico',
            enPrueba: false,
            trialStartDate: '',
            trialEndDate: '',
            supervisorNombre: '',
            supervisorEmail: '',
            supervisorLogin: '',
            supervisorPassword: '',
          };
        },
        error: (err) => {
          this.creatingBusiness = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo crear la empresa.',
          });
        },
      });
  }

  createPlan() {
    const id = this.planDraft.id.trim();
    const nombre = this.planDraft.nombre.trim();
    if (!id || !nombre) {
      this.dialogService.alert({ title: 'Campos requeridos', message: 'Id y nombre son obligatorios.' });
      return;
    }

    this.creatingPlan = true;
    const precioBase = Number(this.planDraft.precioBaseMensual ?? this.planDraft.precioMensual) || 0;
    this.platformService
      .createPlan({
        id,
        nombre,
        precioMensual: precioBase,
        precioBaseMensual: precioBase,
        precioPorAdministrador: Number(this.planDraft.precioPorAdministrador) || 0,
        precioPorOperador: Number(this.planDraft.precioPorOperador) || 0,
        maxAmbitosCaja: Number(this.planDraft.maxAmbitosCaja) || 0,
        modulosIncluidos: { ...this.planDraftModules },
        limiteAdministradores: Number(this.planDraft.limiteAdministradores),
        limiteOperadores: Number(this.planDraft.limiteOperadores),
        limiteUsuariosTotal: Number(this.planDraft.limiteUsuariosTotal) || undefined,
        activo: true,
      })
      .subscribe({
        next: () => {
          this.creatingPlan = false;
          this.showCreatePlanForm = false;
          this.planDraft = {
            id: '',
            nombre: '',
            precioMensual: 0,
            precioBaseMensual: 0,
            precioPorAdministrador: 0,
            precioPorOperador: 0,
            maxAmbitosCaja: 0,
            limiteAdministradores: 1,
            limiteOperadores: 2,
            limiteUsuariosTotal: 3,
          };
          this.planDraftModules = { ...DEFAULT_PLAN_MODULES.plan_basico };
          this.loadPlans();
        },
        error: (err) => {
          this.creatingPlan = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo crear el plan.',
          });
        },
      });
  }

  savePlan(plan: PublicPlanInfo) {
    const applyToExisting = this.planApplyToExisting[plan.id] === true;
    const save = () => {
      this.savingPlanId = plan.id;
      this.platformService
        .updatePlan(plan.id, {
          nombre: plan.nombre,
          precioMensual: Number(plan.precioBaseMensual ?? plan.precioMensual) || 0,
          precioBaseMensual: Number(plan.precioBaseMensual ?? plan.precioMensual) || 0,
          precioPorAdministrador: plan.precioPorAdministrador,
          precioPorOperador: plan.precioPorOperador,
          maxAmbitosCaja: plan.maxAmbitosCaja,
          modulosIncluidos: normalizeModulesMap(plan.modulosIncluidos, plan.id),
          preciosAddonModulo: plan.preciosAddonModulo,
          limiteAdministradores: plan.limiteAdministradores,
          limiteOperadores: plan.limiteOperadores,
          limiteUsuariosTotal: plan.limiteUsuariosTotal,
          activo: plan.activo,
          applyToExistingBusinesses: applyToExisting,
        })
        .subscribe({
          next: (result) => {
            this.savingPlanId = null;
            this.planApplyToExisting[plan.id] = false;
            this.loadPlans();
            this.loadBusinesses();
            const parts = [
              'Plan actualizado.',
              applyToExisting
                ? `Se aplicó a empresas existentes (${result.clearedFrozenCount} descongeladas).`
                : `Solo nuevas empresas (${result.frozenBusinessCount} congeladas con plantilla anterior).`,
            ];
            this.dialogService.alert({ title: 'Plan guardado', message: parts.join(' ') });
          },
          error: (err) => {
            this.savingPlanId = null;
            this.dialogService.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo actualizar el plan.',
            });
          },
        });
    };

    this.dialogService
      .confirm({
        title: 'Guardar plan',
        message: applyToExisting
          ? 'Los cambios se aplicarán a todas las empresas con este plan, incluidas las existentes.'
          : 'Las empresas actuales conservarán su plantilla anterior. Solo las nuevas usarán estos cambios.',
        confirmLabel: 'Guardar',
      })
      .subscribe((confirmed) => {
        if (confirmed) save();
      });
  }

  private currentPeriodo(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private loadBusinesses() {
    this.loadingBusinesses = true;
    this.platformService.getBusinesses().subscribe({
      next: (businesses) => {
        this.businesses = businesses.map((business) => ({
          ...business,
          planId: business.planId,
        }));
        this.loadingBusinesses = false;
      },
      error: () => {
        this.loadingBusinesses = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las empresas.',
        });
      },
    });
  }

  private loadPlans() {
    this.platformService.getPlans().subscribe({
      next: (plans) => {
        this.plans = [...plans]
          .map((plan) => this.normalizePlan(plan))
          .sort((a, b) => a.precioMensual - b.precioMensual);
        const firstActive = this.activePlans[0];
        if (!this.businessDraft.planId && firstActive) {
          this.businessDraft.planId = firstActive.id;
        }
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los planes.',
        });
      },
    });
  }
}
