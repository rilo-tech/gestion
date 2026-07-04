import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import {
  PlatformService,
  SubscriptionStatus,
  type SubscriptionHistoryEntry,
} from '../../core/services/platform.service';
import {
  PublicBusinessInfo,
  PublicPlanInfo,
  SubscriptionPayment,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';
import { FormScreenHeaderComponent } from '../../shared/components/form-shell/form-screen-header.component';
import {
  PlatformSubscriptionEditorComponent,
  businessSubscriptionDraftFromPublic,
  emptyBusinessSubscriptionDraft,
  subscriptionDraftToPayload,
  type BusinessSubscriptionDraft,
} from './platform-subscription-editor.component';
import {
  DEFAULT_TRIAL_DAYS,
  TRIAL_STATUS_LABELS,
  type TrialStatus,
} from '../../../../../shared/trial-state.ts';

@Component({
  selector: 'app-platform-business-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    FormScreenHeaderComponent,
    PlatformSubscriptionEditorComponent,
  ],
  template: `
    <div class="min-h-full flex flex-col bg-gray-50">
      <div
        class="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3">
        <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <app-form-screen-header
            class="flex-1 min-w-0"
            [title]="business?.nombre ?? 'Empresa'"
            [subtitle]="business ? 'Código ' + business.id + ' · ' + business.plan.nombre : ''"
            backRouterLink="/platform"
            backLabel="Volver a empresas"
            [hideSubtitleOnMobile]="false">
          </app-form-screen-header>
          <button
            *ngIf="business"
            type="button"
            (click)="save()"
            [disabled]="saving"
            class="shrink-0 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ saving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>

      <div *ngIf="loading" class="flex-1 flex items-center justify-center text-gray-400 py-24">
        Cargando empresa...
      </div>

      <div *ngIf="!loading && !business" class="flex-1 flex flex-col items-center justify-center gap-3 py-24">
        <p class="text-gray-500">Empresa no encontrada.</p>
        <a routerLink="/platform" class="text-teal-700 font-semibold hover:underline">Volver al listado</a>
      </div>

      <div *ngIf="business" class="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Cuota mensual</p>
            <p class="text-xl font-bold text-gray-900 tabular-nums mt-1">{{ formatMoney(business.montoMensualEsperado) }}</p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Estado cobro</p>
            <span class="inline-flex mt-2 px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="billingStatusClass">
              {{ billingStatusLabel }}
            </span>
            <p class="text-xs text-gray-400 mt-1">{{ formatPeriodo(business.periodoPagoActual) }}</p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Usuarios</p>
            <p class="text-sm font-semibold text-gray-900 mt-2">
              Admins {{ business.administradoresActivos }}/{{ business.limitesEfectivos?.limiteAdministradores ?? business.plan.limiteAdministradores }}
            </p>
            <p class="text-sm text-gray-600">
              Ops {{ business.operadoresActivos }}/{{ business.limitesEfectivos?.limiteOperadores ?? business.plan.limiteOperadores }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Suscripción</p>
            <span class="inline-flex mt-2 px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="subscriptionStatusClass">
              {{ statusLabels[business.estadoSuscripcion] }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div class="xl:col-span-2 space-y-6">
            <section class="rounded-xl border border-violet-100 bg-violet-50/80 p-5 shadow-sm space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-violet-950">Período de prueba</h2>
                  <p class="text-sm text-violet-800 mt-1">
                    Mientras esté activa, no suma en control de cobros ni se exige pago mensual.
                  </p>
                </div>
                <label class="inline-flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    [checked]="business.enPrueba"
                    [disabled]="togglingTrial"
                    (change)="toggleTrial($any($event.target).checked)"
                    class="h-4 w-4 rounded border-violet-300 text-violet-600">
                  <span class="text-sm font-medium text-violet-900">En prueba</span>
                </label>
              </div>

              <div *ngIf="business.enPrueba" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-violet-800 mb-1">Inicio</label>
                  <input [(ngModel)]="business.trialStartDate" name="trialStart" type="date"
                    class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-violet-800 mb-1">Fin</label>
                  <input [(ngModel)]="business.trialEndDate" name="trialEnd" type="date"
                    class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                </div>
              </div>

              <div *ngIf="business.enPrueba" class="flex flex-wrap items-center gap-2">
                <span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="trialStatusClass">
                  {{ trialStatusLabel }}
                </span>
                <span *ngIf="business.trialDaysRemaining != null && business.trialStatus === 'active'" class="text-sm text-violet-800">
                  Vence en {{ business.trialDaysRemaining }} día{{ business.trialDaysRemaining === 1 ? '' : 's' }}
                </span>
                <button type="button" (click)="extendTrial()"
                  class="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100">
                  Extender {{ defaultTrialDays }} días
                </button>
                <button type="button" (click)="convertTrial()"
                  class="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
                  Convertir a pago
                </button>
              </div>
            </section>

            <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
              <h2 class="text-base font-semibold text-gray-900">Plan y acceso</h2>

              <label class="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  [checked]="business.estadoSuscripcion === 'activa'"
                  [disabled]="togglingSubscription"
                  (change)="toggleSubscription($any($event.target).checked)"
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600">
                <span>
                  <span class="block text-sm font-semibold text-gray-900">Suscripción activa</span>
                  <span class="block text-xs text-gray-500 mt-0.5">Si la desactivás, ningún usuario podrá ingresar.</span>
                </span>
              </label>

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Plan comercial</label>
                <select
                  [(ngModel)]="business.planId"
                  (ngModelChange)="onPlanChange()"
                  name="planId"
                  class="w-full max-w-md px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                  <option *ngFor="let plan of plans" [value]="plan.id">{{ plan.nombre }}</option>
                </select>
              </div>
            </section>

            <section *ngIf="activePlan as plan" class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 class="text-base font-semibold text-gray-900">Configuración comercial de esta empresa</h2>
              <p class="text-sm text-gray-500 mt-1 mb-4">
                Cupos, precios y módulos que aplican solo a {{ business.nombre }}. No afectan a otras empresas.
              </p>
              <app-platform-subscription-editor
                [plan]="plan"
                [draft]="subscriptionDraft"
                namePrefix="bizDetail"
                (draftChange)="subscriptionDraft = $event">
              </app-platform-subscription-editor>
            </section>
          </div>

          <div class="space-y-6">
            <section id="pagos" class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
              <h2 class="text-base font-semibold text-gray-900">Registrar pago</h2>
              <p *ngIf="business.enPrueba" class="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                Cuenta en prueba: el pago es opcional mientras dure el período.
              </p>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Período (AAAA-MM)</label>
                  <input [(ngModel)]="paymentDraft.periodo" name="payPeriodo" placeholder="2026-06"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Monto ($)</label>
                  <input [(ngModel)]="paymentDraft.monto" name="payMonto" type="number" min="0" step="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Fecha de pago</label>
                  <input [(ngModel)]="paymentDraft.fechaPago" name="payFecha" type="date"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                  <input [(ngModel)]="paymentDraft.notas" name="payNotas" placeholder="Transferencia..."
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
              </div>
              <button type="button" (click)="registerPayment()" [disabled]="registeringPayment"
                class="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                {{ registeringPayment ? 'Registrando...' : 'Registrar pago' }}
              </button>
            </section>

            <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 class="text-base font-semibold text-gray-900 mb-3">Historial comercial</h2>
              <div *ngIf="loadingHistory" class="text-sm text-gray-400 py-6 text-center">Cargando...</div>
              <div *ngIf="!loadingHistory && history.length === 0" class="text-sm text-gray-400 py-6 text-center">
                Sin cambios registrados.
              </div>
              <div *ngIf="!loadingHistory && history.length > 0" class="space-y-2 max-h-72 overflow-y-auto">
                <div *ngFor="let entry of history" class="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="font-medium text-gray-900">{{ formatHistoryEntry(entry) }}</span>
                    <span class="text-xs text-gray-500 shrink-0">{{ formatDateTime(entry.date) }}</span>
                  </div>
                  <p *ngIf="entry.note" class="text-xs text-gray-600 mt-1">{{ entry.note }}</p>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 class="text-base font-semibold text-gray-900 mb-3">Historial de pagos</h2>
              <div *ngIf="loadingPayments" class="text-sm text-gray-400 py-6 text-center">Cargando...</div>
              <div *ngIf="!loadingPayments && payments.length === 0" class="text-sm text-gray-400 py-6 text-center">
                Sin pagos registrados.
              </div>
              <div *ngIf="!loadingPayments && payments.length > 0" class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                  <thead>
                    <tr class="text-xs uppercase text-gray-400 border-b border-gray-100">
                      <th class="py-2 pr-2">Período</th>
                      <th class="py-2 pr-2 text-right">Monto</th>
                      <th class="py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50">
                    <tr *ngFor="let payment of payments">
                      <td class="py-2.5 pr-2 font-medium">{{ formatPeriodo(payment.periodo) }}</td>
                      <td class="py-2.5 pr-2 text-right tabular-nums">{{ formatMoney(payment.monto) }}</td>
                      <td class="py-2.5 text-gray-600">{{ formatDate(payment.fechaPago) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PlatformBusinessDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformService = inject(PlatformService);
  private dialogService = inject(DialogService);

  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;
  readonly paymentStatusLabels = SUBSCRIPTION_PAYMENT_STATUS_LABELS;
  readonly defaultTrialDays = DEFAULT_TRIAL_DAYS;
  readonly trialStatusLabels = TRIAL_STATUS_LABELS;

  business: (PublicBusinessInfo & { planId?: string }) | null = null;
  plans: PublicPlanInfo[] = [];
  subscriptionDraft: BusinessSubscriptionDraft = emptyBusinessSubscriptionDraft();
  payments: SubscriptionPayment[] = [];
  history: SubscriptionHistoryEntry[] = [];
  paymentDraft = { periodo: '', monto: 0, fechaPago: '', notas: '' };

  loading = true;
  saving = false;
  togglingTrial = false;
  togglingSubscription = false;
  registeringPayment = false;
  loadingPayments = false;
  loadingHistory = false;

  get activePlan(): PublicPlanInfo | null {
    if (!this.business) return null;
    const planId = this.business.planId ?? this.business.plan.id;
    return this.plans.find((p) => p.id === planId) ?? this.business.plan;
  }

  get billingStatusLabel(): string {
    if (!this.business) return '';
    if (this.business.enPrueba && this.business.trialStatus === 'expired') return 'Prueba vencida';
    if (this.business.trialBillingActive || (this.business.enPrueba && this.business.trialStatus === 'active')) {
      if (this.business.trialExpiringSoon && this.business.trialDaysRemaining != null) {
        return `Prueba · vence en ${this.business.trialDaysRemaining} d`;
      }
      return 'En prueba';
    }
    return this.paymentStatusLabels[this.business.estadoPago];
  }

  get billingStatusClass(): string {
    if (!this.business) return '';
    if (this.business.enPrueba && this.business.trialStatus === 'expired') return 'bg-amber-100 text-amber-900';
    if (this.business.trialBillingActive || (this.business.enPrueba && this.business.trialStatus === 'active')) {
      return this.business.trialExpiringSoon ? 'bg-orange-100 text-orange-900' : 'bg-violet-100 text-violet-800';
    }
    return this.paymentClass(this.business.estadoPago);
  }

  get subscriptionStatusClass(): string {
    if (!this.business) return '';
    return this.business.estadoSuscripcion === 'activa'
      ? 'bg-green-100 text-green-800'
      : 'bg-red-100 text-red-800';
  }

  get trialStatusLabel(): string {
    if (!this.business) return '';
    const s = this.business.trialStatus as TrialStatus | null | undefined;
    if (s && this.trialStatusLabels[s]) return this.trialStatusLabels[s];
    return this.business.enPrueba ? 'Prueba activa' : 'Sin prueba';
  }

  get trialStatusClass(): string {
    switch (this.business?.trialStatus) {
      case 'expired':
        return 'bg-amber-100 text-amber-900';
      case 'converted':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-violet-100 text-violet-800';
    }
  }

  ngOnInit() {
    this.platformService.getPlans().subscribe({
      next: (plans) => {
        this.plans = plans.filter((plan) => plan.activo);
      },
    });

    this.route.paramMap.subscribe((params) => {
      const businessId = params.get('businessId');
      if (!businessId) {
        void this.router.navigate(['/platform']);
        return;
      }
      this.loadBusiness(businessId);
    });

    this.route.fragment.subscribe((fragment) => {
      if (fragment === 'pagos') {
        setTimeout(() => document.getElementById('pagos')?.scrollIntoView({ behavior: 'smooth' }), 200);
      }
    });
  }

  private loadBusiness(businessId: string) {
    this.loading = true;
    this.platformService.getBusiness(businessId).subscribe({
      next: (business) => {
        this.business = { ...business, planId: business.planId };
        this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
        this.resetPaymentDraft(business);
        this.loading = false;
        this.loadPayments(businessId);
        this.loadHistory(businessId);
      },
      error: () => {
        this.business = null;
        this.loading = false;
      },
    });
  }

  onPlanChange() {
    const plan = this.activePlan;
    this.subscriptionDraft = {
      ...emptyBusinessSubscriptionDraft(),
      limiteAdministradores: plan?.limiteAdministradores ?? null,
      limiteOperadores: plan?.limiteOperadores ?? null,
      limiteUsuariosTotal: plan?.limiteUsuariosTotal ?? null,
      maxAmbitosCaja: plan?.maxAmbitosCaja ?? null,
      descuentoMensual: this.subscriptionDraft.descuentoMensual,
      notasComerciales: this.subscriptionDraft.notasComerciales,
    };
  }

  save(historyNote?: string) {
    if (!this.business) return;
    this.saving = true;
    this.platformService
      .updateBusiness(this.business.id, {
        planId: this.business.planId ?? this.business.plan.id,
        estadoSuscripcion: this.business.estadoSuscripcion as SubscriptionStatus,
        enPrueba: this.business.enPrueba,
        trialStartDate: this.business.trialStartDate || undefined,
        trialEndDate: this.business.trialEndDate || undefined,
        trialStatus: this.business.trialStatus ?? undefined,
        historyNote,
        ...subscriptionDraftToPayload(this.subscriptionDraft),
      })
      .subscribe({
        next: (updated) => {
          this.saving = false;
          this.business = { ...updated, planId: updated.planId };
          this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
          this.loadHistory(this.business.id);
        },
        error: (err) => {
          this.saving = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo guardar.',
          });
        },
      });
  }

  extendTrial() {
    if (!this.business) return;
    const base = this.business.trialEndDate
      ? new Date(`${this.business.trialEndDate}T12:00:00`)
      : new Date();
    base.setDate(base.getDate() + this.defaultTrialDays);
    this.business = {
      ...this.business,
      enPrueba: true,
      trialStatus: 'active',
      trialEndDate: base.toISOString().slice(0, 10),
    };
    this.save('Prueba extendida desde Plataforma');
  }

  convertTrial() {
    if (!this.business) return;
    this.business = { ...this.business, enPrueba: false, trialStatus: 'converted' };
    this.save('Prueba convertida a pago');
  }

  toggleTrial(enPrueba: boolean) {
    if (!this.business || enPrueba === this.business.enPrueba) return;
    this.togglingTrial = true;
    this.platformService.updateBusiness(this.business.id, { enPrueba }).subscribe({
      next: (updated) => {
        this.togglingTrial = false;
        this.business = { ...updated, planId: updated.planId };
      },
      error: () => {
        this.togglingTrial = false;
        this.dialogService.alert({ title: 'Error', message: 'No se pudo actualizar la prueba.' });
      },
    });
  }

  toggleSubscription(activa: boolean) {
    if (!this.business) return;
    const estado: SubscriptionStatus = activa ? 'activa' : 'suspendida';
    if (!activa) {
      this.dialogService
        .confirm({
          title: 'Desactivar suscripción',
          message: 'Los usuarios no podrán ingresar hasta reactivarla.',
          confirmLabel: 'Desactivar',
          variant: 'danger',
        })
        .subscribe((ok) => {
          if (ok) this.applySubscriptionStatus(estado);
        });
      return;
    }
    this.applySubscriptionStatus(estado);
  }

  private applySubscriptionStatus(estado: SubscriptionStatus) {
    if (!this.business) return;
    this.togglingSubscription = true;
    this.platformService.updateBusiness(this.business.id, { estadoSuscripcion: estado }).subscribe({
      next: (updated) => {
        this.togglingSubscription = false;
        this.business = { ...updated, planId: updated.planId };
      },
      error: () => {
        this.togglingSubscription = false;
        this.dialogService.alert({ title: 'Error', message: 'No se pudo actualizar la suscripción.' });
      },
    });
  }

  registerPayment() {
    if (!this.business) return;
    const periodo = this.paymentDraft.periodo.trim();
    const monto = Number(this.paymentDraft.monto);
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      this.dialogService.alert({ title: 'Período inválido', message: 'Usá formato AAAA-MM.' });
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      this.dialogService.alert({ title: 'Monto inválido', message: 'Ingresá un monto mayor a cero.' });
      return;
    }
    this.registeringPayment = true;
    this.platformService
      .registerBusinessPayment(this.business.id, {
        periodo,
        monto,
        fechaPago: this.paymentDraft.fechaPago || undefined,
        notas: this.paymentDraft.notas.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.registeringPayment = false;
          this.loadPayments(this.business!.id);
          this.platformService.getBusiness(this.business!.id).subscribe({
            next: (updated) => {
              this.business = { ...updated, planId: updated.planId };
              this.resetPaymentDraft(updated);
            },
          });
        },
        error: (err) => {
          this.registeringPayment = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo registrar el pago.',
          });
        },
      });
  }

  private loadPayments(businessId: string) {
    this.loadingPayments = true;
    this.platformService.getBusinessPayments(businessId).subscribe({
      next: (payments) => {
        this.payments = payments;
        this.loadingPayments = false;
      },
      error: () => {
        this.payments = [];
        this.loadingPayments = false;
      },
    });
  }

  private loadHistory(businessId: string) {
    this.loadingHistory = true;
    this.platformService.getSubscriptionHistory(businessId).subscribe({
      next: (history) => {
        this.history = history;
        this.loadingHistory = false;
      },
      error: () => {
        this.history = [];
        this.loadingHistory = false;
      },
    });
  }

  private resetPaymentDraft(business: PublicBusinessInfo) {
    const today = new Date();
    this.paymentDraft = {
      periodo: business.periodoPagoActual || this.currentPeriodo(today),
      monto: business.montoMensualEsperado || business.plan.precioMensual || 0,
      fechaPago: today.toISOString().slice(0, 10),
      notas: '',
    };
  }

  private currentPeriodo(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  formatMoney(value: number | undefined): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
      value ?? 0
    );
  }

  formatPeriodo(periodo: string | undefined): string {
    if (!periodo) return '—';
    const [year, month] = periodo.split('-');
    const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${names[Number(month) - 1] ?? month} ${year}`;
  }

  formatDate(value: string | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-AR');
  }

  formatDateTime(value: string | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }

  formatHistoryEntry(entry: SubscriptionHistoryEntry): string {
    const parts: string[] = [];
    if (entry.previousPlanId !== entry.newPlanId && entry.newPlanId) {
      parts.push(`Plan ${entry.previousPlanId ?? '—'} → ${entry.newPlanId}`);
    }
    if (entry.previousEnPrueba !== entry.newEnPrueba) {
      parts.push(entry.newEnPrueba ? 'Prueba activada' : 'Prueba finalizada');
    }
    if (!parts.length) parts.push(entry.changeType || 'Cambio comercial');
    return parts.join(' · ');
  }

  private paymentClass(status: PublicBusinessInfo['estadoPago']): string {
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
}
