import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { BusinessService, type ClientUsageSummary } from '../../core/services/business.service';
import { AddonsService, type AddonsSnapshot, type ClientWhatsappLine } from '../../core/services/addons.service';
import { UserService, type CreateUserPayload } from '../../core/services/user.service';
import { DEFAULT_STAFF_PERMISSIONS } from '../../core/constants/permissions';
import { DialogService } from '../../core/services/dialog.service';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { PlanStatusCardComponent } from '../../shared/components/plan-status-card/plan-status-card.component';
import { RitotechVisualGuideComponent } from '../public/ritotech-visual-guide.component';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { riloBotManualLines, whatsappCopyForRubro } from '../../../../../shared/whatsapp-copy.ts';
import { TRIAL_RUBROS } from '../../../../../shared/trial-registration.ts';
import { isBusinessProfileIncomplete } from '../../../../../shared/business-profile-completion.ts';
import { LocationLookupService } from '../../core/services/location-lookup.service';
import {
  AutomationsService,
  type ErpNoticeDto,
  type ProgressiveOfferDto,
} from '../../core/services/automations.service';
import {
  SummaryService,
  type ResumenActivityItem,
  type ResumenCashDto,
  type ResumenClientBalance,
  type ResumenHoyDto,
  type ResumenOrderItem,
  type ResumenPayableItem,
} from '../../core/services/summary.service';

type OnboardingItem = { id: string; label: string };
type ResumenHoyCard = { id: string; label: string; value: string; hint?: string };

@Component({
  selector: 'app-home-redirect',
  standalone: true,
  template: '',
})
export class HomeRedirectComponent {
  constructor() {
    const auth = inject(AuthService);
    const router = inject(Router);
    void router.navigateByUrl(auth.homeRoute, { replaceUrl: true });
  }
}

@Component({
  selector: 'app-client-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    PlanStatusCardComponent,
    RitotechVisualGuideComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="w-full max-w-3xl mx-auto min-w-0 space-y-5">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {{ auth.isSummaryWebTenant ? 'Resumen RILO' : ('Hola, ' + auth.currentUserName) }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ subtitle }}
          </p>
        </div>

        <section
          class="rounded-2xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm p-4 sm:p-5 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-bold text-amber-950 dark:text-amber-100">Necesita tu atención</h2>
            <a
              routerLink="/avisos"
              class="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">
              Ver avisos
            </a>
          </div>
          <p *ngIf="attentionLoading" class="text-xs text-gray-500">Revisando…</p>
          <ng-container *ngIf="!attentionLoading">
            <p *ngIf="attentionCount === 0" class="text-sm text-gray-600 dark:text-gray-400">
              Todo al día
            </p>
            <ul *ngIf="attentionCount > 0" class="space-y-1.5">
              <li
                *ngFor="let line of attentionLines"
                class="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                {{ line }}
              </li>
            </ul>
            <p *ngIf="attentionCount > 0" class="text-xs text-amber-800/80 dark:text-amber-200/80">
              {{ attentionCount }} situación{{ attentionCount === 1 ? '' : 'es' }} abierta{{ attentionCount === 1 ? '' : 's' }}
            </p>
          </ng-container>
        </section>

        <ng-container *ngIf="auth.isSummaryWebTenant">
          <p *ngIf="summaryLoading" class="text-sm text-gray-500">Cargando resumen…</p>
          <p *ngIf="summaryError" class="text-sm text-red-600">{{ summaryError }}</p>

          <section
            *ngIf="hoyCards.length"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Hoy</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div
                *ngFor="let card of hoyCards"
                class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{{ card.label }}</p>
                <p class="mt-0.5 text-base font-bold tabular-nums text-gray-900">{{ card.value }}</p>
                <p *ngIf="card.hint" class="text-[11px] text-gray-400 mt-0.5">{{ card.hint }}</p>
              </div>
            </div>
          </section>

          <section
            *ngIf="summaryActivity.length"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Actividad reciente</h2>
            <ul class="space-y-2">
              <li
                *ngFor="let row of summaryActivity"
                class="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2">
                <span class="shrink-0 text-[11px] font-semibold tabular-nums text-teal-700 mt-0.5">
                  {{ formatActivityTime(row.at) }}
                </span>
                <span class="min-w-0 text-sm text-gray-800 leading-snug">{{ row.label }}</span>
              </li>
            </ul>
          </section>

          <section
            *ngIf="summaryOrders.length"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Pedidos abiertos</h2>
            <article
              *ngFor="let order of summaryOrders"
              class="rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-3 space-y-1.5">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-gray-900">
                    {{ order.clientName || 'Cliente' }}
                    <span class="text-gray-400 font-medium">· #{{ order.label }}</span>
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {{ order.estadoLabel }}
                    <span *ngIf="order.fechaEntrega"> · entrega {{ order.fechaEntrega }}</span>
                  </p>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-sm font-bold tabular-nums text-gray-900">{{ formatMoney(order.total) }}</p>
                  <p *ngIf="order.saldo > 0.009" class="text-xs font-semibold tabular-nums text-orange-600">
                    Saldo {{ formatMoney(order.saldo) }}
                  </p>
                </div>
              </div>
              <a
                [href]="whatsappHref(order.whatsappPrefill)"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex text-xs font-semibold text-teal-700 hover:underline">
                Escribir a RILO
              </a>
            </article>
          </section>

          <section
            *ngIf="summaryBalances.length"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Clientes con saldo</h2>
            <div
              *ngFor="let row of summaryBalances"
              class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">{{ row.name }}</p>
                <p class="text-xs font-semibold tabular-nums text-orange-600">{{ formatMoney(row.balance) }}</p>
              </div>
              <a
                [href]="whatsappHref(balancePrefill(row.name))"
                target="_blank"
                rel="noopener noreferrer"
                class="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100">
                Preguntarle a RILO
              </a>
            </div>
          </section>

          <section
            *ngIf="summaryCash"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Caja</h2>
            <div class="grid grid-cols-3 gap-2.5">
              <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ingresos hoy</p>
                <p class="mt-0.5 text-sm font-bold tabular-nums text-teal-700">{{ formatMoney(summaryCash.ingresosHoy) }}</p>
              </div>
              <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Egresos hoy</p>
                <p class="mt-0.5 text-sm font-bold tabular-nums text-gray-900">{{ formatMoney(summaryCash.egresosHoy) }}</p>
              </div>
              <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Saldo</p>
                <p class="mt-0.5 text-sm font-bold tabular-nums text-gray-900">{{ formatMoney(summaryCash.saldo) }}</p>
              </div>
            </div>
          </section>

          <section
            *ngIf="summaryPayables.length"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <h2 class="text-sm font-bold text-gray-900">Próximos pagos</h2>
            <div
              *ngFor="let row of summaryPayables"
              class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">{{ row.beneficiario || 'Pago' }}</p>
                <p class="text-xs text-gray-500">
                  {{ row.fechaVencimiento }}
                  <span *ngIf="row.displayEstado"> · {{ row.displayEstado }}</span>
                </p>
              </div>
              <p class="text-sm font-bold tabular-nums text-gray-900 shrink-0">{{ formatMoney(row.monto) }}</p>
            </div>
          </section>
        </ng-container>

        <section
          *ngIf="showProfileCompletion"
          class="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30 p-4 sm:p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-sm font-bold text-amber-950 dark:text-amber-100">
                Terminemos de configurar tu negocio
              </h2>
              <p class="text-sm text-amber-900/80 dark:text-amber-100/70 mt-1">
                Rubro, país y ciudad. Podés seguir usando RILO mientras tanto.
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 text-amber-800/70 hover:text-amber-950 dark:text-amber-200/70"
              aria-label="Cerrar por ahora"
              (click)="dismissProfileBanner()">
              <i-lucide name="x" class="h-4 w-4"></i-lucide>
            </button>
          </div>
          <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              [(ngModel)]="profileDraft.rubro"
              name="profileRubro"
              class="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:bg-gray-950 dark:border-amber-900">
              <option *ngFor="let r of rubros" [value]="r.id">{{ r.label }}</option>
            </select>
            <input
              [(ngModel)]="profileDraft.pais"
              name="profilePais"
              list="profile-countries"
              placeholder="País"
              class="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:bg-gray-950 dark:border-amber-900" />
            <datalist id="profile-countries">
              <option *ngFor="let c of countryNames" [value]="c"></option>
            </datalist>
            <input
              [(ngModel)]="profileDraft.ciudad"
              name="profileCiudad"
              placeholder="Ciudad"
              class="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:bg-gray-950 dark:border-amber-900" />
          </div>
          <button
            type="button"
            class="mt-3 inline-flex items-center rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
            [disabled]="savingProfile"
            (click)="saveProfileCompletion()">
            {{ savingProfile ? 'Guardando…' : 'Guardar' }}
          </button>
          <p *ngIf="profileError" class="mt-2 text-xs text-red-700">{{ profileError }}</p>
        </section>

        <section
          *ngIf="offer"
          class="rounded-2xl border border-teal-200 bg-teal-50/80 dark:border-teal-800 dark:bg-teal-950/40 p-4 sm:p-5 space-y-3">
          <p class="text-sm font-semibold text-teal-900 dark:text-teal-100">{{ offer.title }}</p>
          <p class="text-sm text-teal-900/80 dark:text-teal-100/80 leading-relaxed">{{ offer.body }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
              (click)="acceptOffer()">
              Sí, a esta hora
            </button>
            <button
              type="button"
              class="rounded-lg border border-teal-300 dark:border-teal-700 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-200"
              (click)="deferOffer()">
              Ahora no
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs text-teal-700/80 dark:text-teal-300/80"
              (click)="declineOffer()">
              No volver a preguntar
            </button>
          </div>
        </section>

        <section
          *ngIf="auth.canAccessErpWeb && !auth.isSummaryWebTenant && notices.length"
          class="rounded-2xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 sm:p-5 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-bold text-amber-950 dark:text-amber-100">Para tener en cuenta</h2>
            <a routerLink="/avisos" class="text-xs font-semibold text-amber-800 dark:text-amber-200 hover:underline">
              Ver avisos
            </a>
          </div>
          <article
            *ngFor="let notice of notices"
            class="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-white/80 dark:bg-gray-950/40 px-3 py-3 space-y-2">
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ notice.title }}</p>
            <p class="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed">{{ notice.body }}</p>
            <div class="flex flex-wrap gap-2 pt-1">
              <a
                *ngIf="notice.route"
                [routerLink]="notice.route"
                class="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">
                Ver
              </a>
              <button type="button" class="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline" (click)="resolveNotice(notice)">
                Resolver
              </button>
              <button type="button" class="text-xs text-gray-500 hover:underline" (click)="hideNotice(notice)">
                Ocultar
              </button>
              <button type="button" class="text-xs text-gray-500 hover:underline" (click)="muteNotice(notice)">
                No volver a mostrar este aviso
              </button>
            </div>
          </article>
        </section>

        <section
          *ngIf="usage && showBotQuota"
          class="rounded-2xl border border-teal-900/40 bg-gray-900 text-white shadow-sm p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-5">
          <div class="relative h-28 w-28 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 80 80" class="h-full w-full -rotate-90">
              <circle cx="40" cy="40" r="32" fill="none" class="stroke-gray-800" stroke-width="8" />
              <circle
                cx="40"
                cy="40"
                r="32"
                fill="none"
                class="stroke-teal-400"
                stroke-width="8"
                stroke-linecap="round"
                [attr.stroke-dasharray]="ringCircumference"
                [attr.stroke-dashoffset]="ringOffset" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-lg font-bold tabular-nums text-white">{{ quotaPct }}%</span>
            </div>
          </div>
          <div class="min-w-0 flex-1 text-center sm:text-left">
            <p class="text-xs font-semibold uppercase tracking-wide text-teal-400">Este mes</p>
            <p class="text-base font-semibold text-white mt-0.5">
              Acciones por WhatsApp
            </p>
            <p *ngIf="usage.ai.unlimited" class="text-sm text-gray-300 mt-1">
              {{ usage.ai.used }} usadas · sin tope mensual
            </p>
            <p *ngIf="!usage.ai.unlimited" class="text-sm text-gray-300 mt-1">
              {{ usage.ai.used }} de {{ usage.ai.max }} · quedan {{ remaining }}
            </p>
            <p *ngIf="renewalLabel" class="text-xs text-gray-500 mt-1">{{ renewalLabel }}</p>
          </div>
        </section>

        <section
          *ngIf="usage && showBotQuota && last7Days.length"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5">
          <p class="text-xs font-semibold text-gray-800">Últimos 7 días</p>
          <p class="text-[11px] text-gray-500 mt-0.5">Acciones por WhatsApp (agregado diario)</p>
          <div class="mt-3 flex items-end gap-1.5 h-16">
            <div *ngFor="let day of last7Days" class="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <div
                class="w-full rounded-sm bg-teal-600/80 min-h-[2px]"
                [style.height.%]="day.pct"
                [title]="day.date + ': ' + day.actions"></div>
              <span class="text-[9px] text-gray-400 leading-none">{{ day.label }}</span>
            </div>
          </div>
        </section>

        <section
          *ngIf="addons && auth.canAccessWhatsapp && auth.isSupervisor"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-bold text-gray-900">WhatsApp</h2>
              <p class="text-xs text-gray-500 mt-0.5">RILO Bot · misma empresa, varios números</p>
            </div>
            <button
              type="button"
              (click)="addWhatsappNumber()"
              [disabled]="addingWa"
              class="text-sm font-semibold text-teal-700 hover:underline">
              + Agregar número
            </button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p class="text-xs text-gray-500">Números incluidos</p>
              <p class="font-semibold">{{ addons.whatsapp.included }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Números adicionales</p>
              <p class="font-semibold">{{ addons.whatsapp.extraContracted }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Precio número adicional</p>
              <p class="font-semibold">{{ addons.currency }} {{ addons.whatsapp.extraUnit }} / mes</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Costo adicional</p>
              <p class="font-semibold">{{ addons.currency }} {{ addons.whatsapp.extraCost }} / mes</p>
            </div>
          </div>
          <div *ngFor="let line of addons.whatsapp.lines" class="rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-medium text-gray-900">{{ line.phone || 'Sin número' }}</p>
                <p class="text-xs text-gray-500">
                  {{ line.kind === 'primary' ? 'Número principal' : 'Número adicional' }}
                  · {{ lineStatusLabel(line) }}
                  <span *ngIf="line.addedAt || line.createdAt"> · alta {{ (line.addedAt || line.createdAt) | date:'shortDate' }}</span>
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  *ngIf="line.status === 'pending'"
                  type="button"
                  (click)="connectLine(line)"
                  class="text-xs font-semibold text-teal-700 hover:underline">
                  Conectar
                </button>
                <button
                  *ngIf="line.kind === 'primary'"
                  type="button"
                  (click)="startReplacePrimary()"
                  class="text-xs font-semibold text-gray-600 hover:underline">
                  Reemplazar principal
                </button>
                <button
                  *ngIf="line.kind !== 'primary' && line.status !== 'disconnected'"
                  type="button"
                  (click)="releaseLine(line)"
                  class="text-xs font-semibold text-red-700 hover:underline">
                  Liberar
                </button>
              </div>
            </div>
            <div *ngIf="pendingLineId === line.id" class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                [(ngModel)]="pendingPhone"
                name="pendingPhone"
                placeholder="+598 99 000 000"
                class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <input
                *ngIf="codeSent"
                [(ngModel)]="pendingCode"
                name="pendingCode"
                placeholder="Código"
                class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <button
                type="button"
                (click)="submitPendingLine()"
                class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                {{ codeSent ? 'Verificar' : 'Enviar código' }}
              </button>
            </div>
            <div *ngIf="replacingPrimary && line.kind === 'primary'" class="mt-2 space-y-2">
              <p class="text-xs text-gray-500">Nuevo número principal. Recibís un código por WhatsApp. El historial se conserva.</p>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  [(ngModel)]="replacePhone"
                  name="replacePhone"
                  placeholder="+598 99 000 000"
                  class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                <input
                  *ngIf="replaceCodeSent"
                  [(ngModel)]="replaceCode"
                  name="replaceCode"
                  placeholder="Código"
                  class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                <button
                  type="button"
                  (click)="submitReplacePrimary()"
                  class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                  {{ replaceCodeSent ? 'Verificar' : 'Enviar código' }}
                </button>
              </div>
              <button type="button" class="text-xs text-gray-500 hover:underline" (click)="cancelReplacePrimary()">
                Cancelar
              </button>
            </div>
          </div>
        </section>

        <section
          *ngIf="onboardingItems.length"
          class="rounded-2xl border border-gray-800 bg-gray-900 text-white shadow-sm p-4 sm:p-6">
          <h2 class="text-sm font-bold text-white">Primeros pasos</h2>
          <ul class="mt-3 space-y-2">
            <li *ngFor="let item of onboardingItems">
              <label class="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-950 text-teal-500 focus:ring-teal-500"
                  [checked]="isOnboardingDone(item.id)"
                  (change)="toggleOnboarding(item.id)" />
                <span
                  class="text-sm"
                  [class.text-gray-500]="isOnboardingDone(item.id)"
                  [class.line-through]="isOnboardingDone(item.id)"
                  [class.text-gray-200]="!isOnboardingDone(item.id)">
                  {{ item.label }}
                </span>
              </label>
            </li>
          </ul>
        </section>

        <section
          *ngIf="auth.canAccessWhatsapp && !auth.canAccessErpWeb"
          class="rounded-2xl border border-teal-900/40 bg-gray-900 text-white shadow-sm p-4 sm:p-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-white">Empezar con RILO Bot</h2>
              <p class="text-sm text-gray-400 mt-1 leading-relaxed">
                Guía conversacional por WhatsApp según lo que contrataste.
              </p>
            </div>
            <span
              class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
              [class.bg-teal-500/20]="whatsappGuideDone"
              [class.text-teal-300]="whatsappGuideDone"
              [class.bg-amber-500/20]="!whatsappGuideDone"
              [class.text-amber-200]="!whatsappGuideDone">
              {{ whatsappGuideStatusLabel }}
            </span>
          </div>
          <p class="text-sm text-gray-300 mt-3">
            Escribile <span class="font-semibold text-white">guía</span> al número de RILO Bot que registraste
            para abrir el menú interactivo.
          </p>
        </section>

        <section
          *ngIf="auth.canAccessWhatsapp"
          class="rounded-2xl border border-gray-800 bg-gray-900 text-white shadow-sm p-4 sm:p-6">
          <h2 class="text-sm font-bold text-white mb-1">Cómo usar RILO Bot</h2>
          <p class="text-sm text-gray-400 mb-3 leading-relaxed">
            Escribile como hablás. Si la instrucción es clara, RILO actúa. Si necesita información, te pregunta. Las acciones sensibles requieren confirmación.
          </p>
          <ul class="space-y-1.5 text-sm text-gray-300 mb-4">
            <li *ngFor="let line of botManualLines">• {{ line }}</li>
          </ul>
          <app-ritotech-visual-guide
            triggerLabel="Cómo usarlo"
            defaultTab="whatsapp"
            [showSignupCta]="false">
          </app-ritotech-visual-guide>
        </section>

        <a
          *ngIf="auth.canAccessErpWeb && !auth.isSummaryWebTenant"
          routerLink="/dashboard"
          class="flex items-center gap-3 bg-gray-900 text-white rounded-2xl border border-teal-900/50 px-5 py-4 hover:border-teal-700 transition-colors">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
            <i-lucide name="layout-dashboard" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-bold">Entrar a RILO Gestión</span>
            <span class="block text-xs text-gray-400 mt-0.5">Controlalo acá cuando querés ver todo</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 text-gray-500"></i-lucide>
        </a>

        <p
          *ngIf="auth.isFullWebTenant && auth.canAccessWhatsapp"
          class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          También podés cargar por WhatsApp: es la misma información que ves en el panel.
        </p>

        <a
          *ngIf="auth.isSupervisor && !auth.hasErpEntitlement"
          routerLink="/activar-suscripcion"
          [queryParams]="{ producto: 'erp' }"
          class="flex items-center gap-3 bg-gray-900 text-white rounded-2xl border border-teal-900/50 px-5 py-4 hover:border-teal-700 transition-colors">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
            <i-lucide name="layout-dashboard" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-bold">Agregar RILO Gestión</span>
            <span class="block text-xs text-gray-400 mt-0.5">Sumá el panel web a tu plan actual</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 text-gray-500"></i-lucide>
        </a>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            *ngIf="auth.isSupervisor"
            routerLink="/plan"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Mi plan
          </a>
          <a
            *ngIf="auth.isSupervisor"
            routerLink="/activar-suscripcion"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Facturación
          </a>
          <a
            routerLink="/mi-cuenta"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Mi cuenta
          </a>
          <a
            *ngIf="auth.canAccessErpWeb && auth.canManageSettings && !auth.isSummaryWebTenant"
            routerLink="/settings"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Usuarios
          </a>
        </div>

        <app-plan-status-card *ngIf="auth.isSupervisor" variant="home"></app-plan-status-card>
      </div>
    </div>
  `,
})
export class ClientHomeComponent implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private businessApi = inject(BusinessService);
  private addonsApi = inject(AddonsService);
  private usersApi = inject(UserService);
  private dialog = inject(DialogService);
  private automationsApi = inject(AutomationsService);
  private locationLookup = inject(LocationLookupService);
  private summaryApi = inject(SummaryService);
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly ringCircumference = 2 * Math.PI * 32;
  readonly rubros = TRIAL_RUBROS;

  usage: ClientUsageSummary | null = null;
  addons: AddonsSnapshot | null = null;
  notices: ErpNoticeDto[] = [];
  offer: ProgressiveOfferDto | null = null;
  attentionLoading = false;
  attentionCount = 0;
  attentionLines: string[] = [];
  doneIds = new Set<string>();
  profileBannerDismissed = false;
  savingProfile = false;
  profileError = '';
  countryNames: string[] = [];
  profileDraft = { rubro: 'otro', pais: 'Uruguay', ciudad: '' };
  addingWa = false;
  pendingLineId: string | null = null;
  pendingPhone = '';
  pendingCode = '';
  codeSent = false;
  replacingPrimary = false;
  replacePhone = '';
  replaceCode = '';
  replaceCodeSent = false;
  showCreateUser = false;
  creatingUser = false;
  newUser = { nombre: '', email: '', password: '' };
  whatsappOnboardingStatus: 'not_started' | 'in_progress' | 'completed' | 'skipped' = 'not_started';

  summaryLoading = false;
  summaryError = '';
  summaryHoy: ResumenHoyDto | null = null;
  summaryActivity: ResumenActivityItem[] = [];
  summaryOrders: ResumenOrderItem[] = [];
  summaryBalances: ResumenClientBalance[] = [];
  summaryCash: ResumenCashDto | null = null;
  summaryPayables: ResumenPayableItem[] = [];

  ngOnInit() {
    console.info('[client-home:init]');
    this.loadOnboarding();
    this.loadProfileDraft();
    this.profileBannerDismissed = this.isProfileBannerDismissed();
    this.locationLookup.listCountries().subscribe({
      next: (rows) => {
        this.countryNames = rows.map((c) => c.nameEs);
      },
    });
    queueMicrotask(() => this.loadHomeData());
  }

  get showProfileCompletion(): boolean {
    if (this.auth.isPlatformAdmin || !this.auth.isSupervisor) return false;
    if (this.profileBannerDismissed) return false;
    const biz = this.auth.currentBusiness;
    if (biz?.profileIncomplete === true) return true;
    return isBusinessProfileIncomplete(biz?.lifecycle ?? null);
  }

  dismissProfileBanner() {
    this.profileBannerDismissed = true;
    try {
      sessionStorage.setItem(this.profileBannerKey(), '1');
    } catch {
      /* ignore */
    }
  }

  saveProfileCompletion() {
    const businessId = this.auth.currentBusinessId;
    if (!businessId) return;
    const ciudad = this.profileDraft.ciudad.trim();
    if (!this.profileDraft.rubro.trim() || !this.profileDraft.pais.trim() || !ciudad) {
      this.profileError = 'Completá rubro, país y ciudad.';
      return;
    }
    this.profileError = '';
    this.savingProfile = true;
    this.businessApi
      .updateLifecycleProfile(businessId, {
        rubro: this.profileDraft.rubro.trim(),
        pais: this.profileDraft.pais.trim(),
        ciudad,
      })
      .subscribe({
        next: (business) => {
          this.savingProfile = false;
          this.auth.updateCurrentBusiness(business);
          this.profileBannerDismissed = false;
          try {
            sessionStorage.removeItem(this.profileBannerKey());
          } catch {
            /* ignore */
          }
        },
        error: (err) => {
          this.savingProfile = false;
          this.profileError = err?.error?.error || 'No se pudo guardar.';
        },
      });
  }

  private loadProfileDraft() {
    const life = this.auth.currentBusiness?.lifecycle;
    this.profileDraft = {
      rubro: String(life?.rubro ?? 'otro').trim() || 'otro',
      pais: String(life?.pais ?? 'Uruguay').trim() || 'Uruguay',
      ciudad: isBusinessProfileIncomplete(life) && !String(life?.ciudad ?? '').trim()
        ? ''
        : String(life?.ciudad ?? '').trim().toLowerCase() === 'a completar'
          ? ''
          : String(life?.ciudad ?? '').trim(),
    };
  }

  private profileBannerKey(): string {
    return `rilo-profile-banner-dismiss-${this.auth.currentBusinessId || 'anon'}`;
  }

  private isProfileBannerDismissed(): boolean {
    try {
      return sessionStorage.getItem(this.profileBannerKey()) === '1';
    } catch {
      return false;
    }
  }

  private loadHomeData() {
    const businessId = this.auth.currentBusinessId;
    if (!businessId || this.auth.isPlatformAdmin) return;
    this.businessApi.getUsage(businessId).subscribe({
      next: (usage) => {
        this.usage = usage;
      },
    });
    if (this.auth.canAccessWhatsapp) {
      this.businessApi.getWhatsAppOnboarding(businessId).subscribe({
        next: (row) => {
          this.whatsappOnboardingStatus = row.status ?? 'not_started';
        },
      });
    }
    if (this.auth.isSupervisor || this.auth.isSummaryWebTenant) {
      this.loadAddons();
    }
    this.loadAutomationsHome();
    if (this.auth.isSummaryWebTenant) {
      this.loadSummaryPanel();
    }
  }

  private loadSummaryPanel() {
    this.summaryLoading = true;
    this.summaryError = '';
    forkJoin({
      hoy: this.summaryApi.getHoy(),
      activity: this.summaryApi.getActivity(12),
      orders: this.summaryApi.getOrders(),
      balances: this.summaryApi.getBalances(),
      cash: this.summaryApi.getCash(),
      payables: this.summaryApi.getPayables(),
    }).subscribe({
      next: (res) => {
        this.summaryLoading = false;
        this.summaryHoy = res.hoy;
        this.summaryActivity = (res.activity ?? []).filter((row) => !!row.label);
        this.summaryOrders = res.orders ?? [];
        this.summaryBalances = res.balances ?? [];
        this.summaryCash = res.cash;
        this.summaryPayables = res.payables ?? [];
      },
      error: (err) => {
        this.summaryLoading = false;
        this.summaryError = err?.error?.error || 'No se pudo cargar el resumen.';
      },
    });
  }

  get hoyCards(): ResumenHoyCard[] {
    const hoy = this.summaryHoy;
    if (!hoy) return [];
    const cards: ResumenHoyCard[] = [];
    if (hoy.ventasHoy > 0.009) {
      cards.push({ id: 'ventas', label: 'Ventas hoy', value: this.formatMoney(hoy.ventasHoy) });
    }
    if (hoy.cobradoHoy > 0.009) {
      cards.push({ id: 'cobrado', label: 'Cobrado hoy', value: this.formatMoney(hoy.cobradoHoy) });
    }
    if (hoy.cajaSaldo !== 0 || hoy.ventasHoy > 0 || hoy.cobradoHoy > 0) {
      cards.push({ id: 'caja', label: 'Caja', value: this.formatMoney(hoy.cajaSaldo) });
    }
    if (hoy.pedidosAbiertos > 0) {
      cards.push({
        id: 'abiertos',
        label: 'Pedidos abiertos',
        value: String(hoy.pedidosAbiertos),
      });
    }
    if (hoy.paraHoy > 0) {
      cards.push({ id: 'paraHoy', label: 'Para hoy', value: String(hoy.paraHoy) });
    }
    if (hoy.porCobrar > 0.009) {
      cards.push({ id: 'porCobrar', label: 'Por cobrar', value: this.formatMoney(hoy.porCobrar) });
    }
    if (hoy.pagosProximosCount > 0) {
      cards.push({
        id: 'pagos',
        label: 'Pagos próximos',
        value: String(hoy.pagosProximosCount),
        hint: this.formatMoney(hoy.pagosProximosMonto),
      });
    }
    return cards;
  }

  formatMoney(value: number): string {
    return formatMoneyValue(value);
  }

  formatActivityTime(at: string): string {
    const raw = String(at ?? '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw.slice(11, 16) || raw.slice(0, 10);
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  balancePrefill(name: string): string {
    const label = String(name ?? '').trim() || 'este cliente';
    return `¿Cuánto me debe ${label}?`;
  }

  whatsappHref(prefill: string): string {
    const text = encodeURIComponent(String(prefill ?? '').trim());
    const phone = this.riloWhatsappPhoneDigits();
    if (phone) return `https://wa.me/${phone}?text=${text}`;
    return `https://wa.me/?text=${text}`;
  }

  private riloWhatsappPhoneDigits(): string {
    const lines = this.addons?.whatsapp?.lines ?? [];
    const preferred =
      lines.find((line) => line.kind === 'primary' && line.phone && line.status !== 'disconnected') ||
      lines.find((line) => line.phone && line.enabled && line.status !== 'disconnected') ||
      lines.find((line) => !!line.phone);
    const raw = String(preferred?.phone ?? '').trim();
    return raw.replace(/\D+/g, '');
  }

  private loadAutomationsHome() {
    this.attentionLoading = true;
    this.automationsApi.attentionSummary().subscribe({
      next: (res) => {
        this.attentionCount = res.count ?? 0;
        this.attentionLines = res.lines ?? [];
        this.attentionLoading = false;
      },
      error: () => {
        this.attentionLoading = false;
      },
    });
    if (this.auth.canAccessErpWeb && !this.auth.isSummaryWebTenant) {
      this.automationsApi.listNotices({ tab: 'hoy' }).subscribe({
        next: (res) => {
          this.notices = res.notices ?? [];
        },
      });
    }
    this.automationsApi.listOffers().subscribe({
      next: (res) => {
        this.offer = res.offers?.[0] ?? null;
      },
    });
  }

  acceptOffer() {
    if (!this.offer) return;
    const id = this.offer.id;
    this.automationsApi.respondOffer(id, 'accepted').subscribe({
      next: () => {
        this.offer = null;
        this.dialog.alert({
          title: 'Listo',
          message: 'Activamos el aviso. Podés ajustar horario en Configuración → RILO te avisa.',
        });
      },
    });
  }

  deferOffer() {
    if (!this.offer) return;
    this.automationsApi.respondOffer(this.offer.id, 'deferred').subscribe({
      next: () => {
        this.offer = null;
      },
    });
  }

  declineOffer() {
    if (!this.offer) return;
    this.automationsApi.respondOffer(this.offer.id, 'declined').subscribe({
      next: () => {
        this.offer = null;
      },
    });
  }

  resolveNotice(notice: ErpNoticeDto) {
    this.automationsApi.updateNotice(notice.id, 'resolved').subscribe({
      next: () => {
        this.notices = this.notices.filter((n) => n.id !== notice.id);
      },
    });
  }

  hideNotice(notice: ErpNoticeDto) {
    this.automationsApi.updateNotice(notice.id, 'hidden').subscribe({
      next: () => {
        this.notices = this.notices.filter((n) => n.id !== notice.id);
      },
    });
  }

  muteNotice(notice: ErpNoticeDto) {
    this.automationsApi.updateNotice(notice.id, 'muted').subscribe({
      next: () => {
        this.notices = this.notices.filter((n) => n.id !== notice.id);
      },
    });
  }

  private loadAddons() {
    this.addonsApi.getSnapshot().subscribe({
      next: (row) => {
        this.addons = row;
      },
    });
  }

  createExtraUser() {
    const nombre = this.newUser.nombre.trim();
    if (!nombre) {
      this.dialog.alert({ title: 'Campo requerido', message: 'Ingresá el nombre.' });
      return;
    }
    const payload: CreateUserPayload = {
      nombre,
      email: this.newUser.email.trim().toLowerCase(),
      loginUsername: (this.newUser.email || this.newUser.nombre).trim().toLowerCase(),
      rol: 'staff',
      permisos: [...DEFAULT_STAFF_PERMISSIONS],
      activo: true,
      password: this.newUser.password.trim() || undefined,
    };
    this.creatingUser = true;
    this.usersApi.createUser(payload).subscribe({
      next: () => {
        this.creatingUser = false;
        this.showCreateUser = false;
        this.newUser = { nombre: '', email: '', password: '' };
        this.loadAddons();
      },
      error: (err) => {
        this.creatingUser = false;
        if (err?.error?.code === 'BILLING_CONFIRMATION_REQUIRED' && err?.error?.quote) {
          const quote = err.error.quote;
          this.dialog
            .confirm({
              title: 'Confirmar y agregar',
              message:
                `Costo: +${quote.extraUnit} / mes\n` +
                `Total anterior: ${quote.oldTotal}\n` +
                `Nuevo total mensual: ${quote.newTotal}\n` +
                `Se aplica: ${quote.appliedAt || 'próxima renovación'}\n\n` +
                (quote.policyCopy || 'Se suma a tu próxima renovación.'),
              confirmLabel: 'Confirmar y agregar',
            })
            .subscribe((ok) => {
              if (!ok) return;
              this.creatingUser = true;
              this.usersApi.createUser({ ...payload, confirmBilling: true }).subscribe({
                next: () => {
                  this.creatingUser = false;
                  this.showCreateUser = false;
                  this.newUser = { nombre: '', email: '', password: '' };
                  this.loadAddons();
                },
                error: (retryErr) => {
                  this.creatingUser = false;
                  this.dialog.alert({
                    title: 'Error',
                    message: retryErr?.error?.error || 'No se pudo crear el usuario.',
                  });
                },
              });
            });
          return;
        }
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo crear el usuario.',
        });
      },
    });
  }

  lineStatusLabel(line: ClientWhatsappLine): string {
    if (line.status === 'pending') return 'pendiente';
    if (line.status === 'disconnected' || !line.enabled) return 'desconectado';
    return 'activo';
  }

  addWhatsappNumber() {
    this.addingWa = true;
    this.addonsApi.quoteWhatsapp().subscribe({
      next: (quote) => {
        this.dialog
          .confirm({
            title: 'Número adicional RILO Bot',
            message:
              `Total actual: ${quote.oldTotal}\n` +
              `Adicional: +${quote.extraUnit} / mes\n` +
              `Nuevo total mensual: ${quote.newTotal}\n` +
              `Se aplica: ${quote.appliedAt || 'próxima renovación'}\n\n` +
              (quote.policyCopy || 'Se suma a tu próxima renovación.'),
            confirmLabel: 'Agregar número',
          })
          .subscribe((ok) => {
            this.addingWa = false;
            if (!ok) return;
            this.addonsApi.addWhatsappNumber(true).subscribe({
              next: (res) => {
                this.pendingLineId = res.line.id;
                this.pendingPhone = '';
                this.pendingCode = '';
                this.codeSent = false;
                this.loadAddons();
              },
              error: (err) => {
                this.dialog.alert({
                  title: 'Error',
                  message: err?.error?.error || 'No se pudo agregar el número.',
                });
              },
            });
          });
      },
      error: () => {
        this.addingWa = false;
      },
    });
  }

  connectLine(line: ClientWhatsappLine) {
    this.pendingLineId = line.id;
    this.pendingPhone = line.phone || '';
    this.pendingCode = '';
    this.codeSent = false;
  }

  submitPendingLine() {
    if (!this.pendingLineId || !this.pendingPhone.trim()) return;
    if (!this.codeSent) {
      this.addonsApi.sendWhatsappCode(this.pendingLineId, this.pendingPhone).subscribe({
        next: () => {
          this.codeSent = true;
        },
        error: (err) => {
          this.dialog.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo enviar el código.',
          });
        },
      });
      return;
    }
    this.addonsApi.verifyWhatsapp(this.pendingLineId, this.pendingPhone, this.pendingCode).subscribe({
      next: () => {
        this.pendingLineId = null;
        this.codeSent = false;
        this.loadAddons();
      },
      error: (err) => {
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo verificar el número.',
        });
      },
    });
  }

  releaseLine(line: ClientWhatsappLine) {
    this.dialog
      .confirm({
        title: 'Liberar número',
        message: 'Se desactiva este número. El historial de la empresa se conserva.',
        confirmLabel: 'Liberar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.addonsApi.releaseWhatsapp(line.id).subscribe({
          next: () => this.loadAddons(),
          error: (err) => {
            this.dialog.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo liberar el número.',
            });
          },
        });
      });
  }

  replacePrimary() {
    this.startReplacePrimary();
  }

  startReplacePrimary() {
    this.replacingPrimary = true;
    this.replacePhone = '';
    this.replaceCode = '';
    this.replaceCodeSent = false;
  }

  cancelReplacePrimary() {
    this.replacingPrimary = false;
    this.replacePhone = '';
    this.replaceCode = '';
    this.replaceCodeSent = false;
  }

  submitReplacePrimary() {
    const phone = this.replacePhone.trim();
    if (!phone) return;
    if (!this.replaceCodeSent) {
      this.addonsApi.replacePrimary(phone).subscribe({
        next: (res) => {
          this.replaceCodeSent = true;
          if (res.devCode) this.replaceCode = res.devCode;
        },
        error: (err) => {
          this.dialog.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo iniciar el reemplazo.',
          });
        },
      });
      return;
    }
    this.addonsApi.replacePrimary(phone, this.replaceCode).subscribe({
      next: () => {
        this.cancelReplacePrimary();
        this.loadAddons();
      },
      error: (err) => {
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo reemplazar el número.',
        });
      },
    });
  }

  get last7Days(): { date: string; actions: number; pct: number; label: string }[] {
    const rows = (this.usage?.dailyUsage ?? []).slice(-7);
    const max = Math.max(1, ...rows.map((row) => row.actions || 0));
    return rows.map((row) => ({
      date: row.date,
      actions: row.actions || 0,
      pct: Math.max(8, Math.round(((row.actions || 0) / max) * 100)),
      label: row.date.slice(8),
    }));
  }

  get subtitle(): string {
    if (this.auth.isSummaryWebTenant) {
      return 'Lo que anotás por WhatsApp queda ordenado acá. Sin panel ERP completo.';
    }
    if (this.auth.canAccessWhatsapp && this.auth.canAccessErpWeb) {
      return 'Cargás por WhatsApp o en el panel. Es la misma información.';
    }
    if (this.auth.canAccessWhatsapp) {
      return 'El trabajo del día a día es por WhatsApp. Acá ves tu cupo y cómo usarlo.';
    }
    return 'Resumen de tu cuenta.';
  }

  get showBotQuota(): boolean {
    return this.auth.canAccessWhatsapp === true;
  }

  get quotaPct(): number {
    if (!this.usage || this.usage.ai.unlimited || !this.usage.ai.max) return 0;
    return Math.min(100, Math.round((Math.max(0, this.usage.ai.used) / this.usage.ai.max) * 100));
  }

  get ringOffset(): number {
    return this.ringCircumference * (1 - this.quotaPct / 100);
  }

  get remaining(): number {
    if (!this.usage || this.usage.ai.unlimited) return 0;
    return Math.max(0, this.usage.ai.max - this.usage.ai.used);
  }

  get renewalLabel(): string {
    const period = this.usage?.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return '';
    const [year, month] = period.split('-').map(Number);
    const next = new Date(year, month, 1);
    const when = next.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    return `Se renueva el ${when}`;
  }

  get botCopy() {
    return whatsappCopyForRubro(this.auth.currentBusiness?.lifecycle?.rubro);
  }

  get botManualLines(): string[] {
    return riloBotManualLines(this.botCopy);
  }

  get whatsappGuideDone(): boolean {
    return this.whatsappOnboardingStatus === 'completed' || this.whatsappOnboardingStatus === 'skipped';
  }

  get whatsappGuideStatusLabel(): string {
    switch (this.whatsappOnboardingStatus) {
      case 'completed':
        return 'Configurado';
      case 'skipped':
        return 'Omitido';
      case 'in_progress':
        return 'En curso';
      default:
        return 'Pendiente';
    }
  }

  get onboardingItems(): OnboardingItem[] {
    const items: OnboardingItem[] = [];
    if (this.auth.canAccessWhatsapp) {
      items.push({ id: 'write-bot', label: 'Escribí al número de RILO Bot (como hablás)' });
      items.push({ id: 'try-example', label: 'Probá un ejemplo: venta, pedido o “¿cuánto hay en caja?”' });
      items.push({ id: 'see-quota', label: 'Revisá tu cupo de mensajes / acciones de este mes' });
      items.push({ id: 'enable-daily', label: 'Opcional: activá un resumen diario en RILO te avisa' });
    }
    if (this.auth.canAccessErpWeb && !this.auth.isSummaryWebTenant) {
      items.push({ id: 'biz-basics', label: 'Completá solo lo básico del negocio (nombre / rubro)' });
      items.push({ id: 'open-erp', label: 'Entrá al panel y ubicá clientes, productos, pedidos y caja' });
      if (!this.auth.canAccessWhatsapp) {
        items.push({ id: 'enable-notice', label: 'Opcional: activá un aviso en RILO te avisa' });
      }
    }
    if (this.auth.isSummaryWebTenant) {
      items.push({ id: 'see-summary', label: 'Mirás el resumen de hoy, pedidos y saldos en esta pantalla' });
    }
    return items;
  }

  isOnboardingDone(id: string): boolean {
    return this.doneIds.has(id);
  }

  toggleOnboarding(id: string) {
    if (this.doneIds.has(id)) this.doneIds.delete(id);
    else this.doneIds.add(id);
    this.doneIds = new Set(this.doneIds);
    this.saveOnboarding();
  }

  private storageKey(): string {
    return `rilo-onboarding-v1-${this.auth.currentBusinessId || 'anon'}`;
  }

  private loadOnboarding() {
    try {
      const raw = localStorage.getItem(this.storageKey());
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      this.doneIds = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.doneIds = new Set();
    }
  }

  private saveOnboarding() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify([...this.doneIds]));
    } catch {
      /* ignore quota / private mode */
    }
  }
}
