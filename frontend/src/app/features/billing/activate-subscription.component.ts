import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  discountedMonthly,
  formatCatalogPriceLabel,
  introDiscountLabel,
} from '../../../../../shared/commercial-catalog.ts';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';

type BillingPlan = {
  id: string;
  name: string;
  description: string;
  featured?: boolean;
  currency: string;
  amountMonthly: number;
  amountYearly?: number;
  priceLabel: string;
  priceLabelYearly?: string;
  country: string;
};

type BillingInterval = 'month' | 'year';
type LiteLimits = {
  maxClientes: number;
  maxProductos: number;
  maxAccionesIaMes: number;
  maxOperacionesMes: number;
};

@Component({
  selector: 'app-activate-subscription',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div class="max-w-lg w-full rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6 sm:p-8 space-y-5">
        <div class="text-center">
          <p class="text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">
            {{ stageEyebrow }}
          </p>
          <h1 class="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{{ stageTitle }}</h1>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            {{ stageBody }}
          </p>
        </div>

        <div
          *ngIf="statusMessage"
          class="rounded-xl border px-3 py-2.5 text-sm"
          [class.border-teal-200]="statusKind === 'success'"
          [class.bg-teal-50]="statusKind === 'success'"
          [class.text-teal-900]="statusKind === 'success'"
          [class.dark:border-teal-800]="statusKind === 'success'"
          [class.dark:bg-teal-950/40]="statusKind === 'success'"
          [class.dark:text-teal-200]="statusKind === 'success'"
          [class.border-amber-200]="statusKind === 'pending'"
          [class.bg-amber-50]="statusKind === 'pending'"
          [class.text-amber-900]="statusKind === 'pending'"
          [class.border-red-200]="statusKind === 'error'"
          [class.bg-red-50]="statusKind === 'error'"
          [class.text-red-900]="statusKind === 'error'">
          {{ statusMessage }}
        </div>

        <section
          *ngIf="showLiteLimits"
          class="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 space-y-2">
          <p class="text-sm font-semibold text-amber-950 dark:text-amber-100">Plan libre (sin tarjeta)</p>
          <p class="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
            Después de la prueba seguís usando RILO. Recién pedimos pago si te pasás de estos techos o si querés más IA.
          </p>
          <ul class="grid grid-cols-2 gap-2 text-xs">
            <li class="rounded-lg bg-white/70 dark:bg-gray-950/40 px-2.5 py-2">
              <span class="block text-gray-500 dark:text-gray-400">Clientes</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">hasta {{ lite.maxClientes }}</span>
            </li>
            <li class="rounded-lg bg-white/70 dark:bg-gray-950/40 px-2.5 py-2">
              <span class="block text-gray-500 dark:text-gray-400">Productos</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">hasta {{ lite.maxProductos }}</span>
            </li>
            <li class="rounded-lg bg-white/70 dark:bg-gray-950/40 px-2.5 py-2">
              <span class="block text-gray-500 dark:text-gray-400">Cargas WhatsApp / mes</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">hasta {{ lite.maxOperacionesMes }}</span>
            </li>
            <li class="rounded-lg bg-white/70 dark:bg-gray-950/40 px-2.5 py-2">
              <span class="block text-gray-500 dark:text-gray-400">Acciones IA / mes</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">hasta {{ lite.maxAccionesIaMes }}</span>
            </li>
          </ul>
        </section>

        <p
          *ngIf="showIntroBanner"
          class="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 text-sm text-teal-900 dark:text-teal-100 leading-relaxed">
          Si activás un plan pago ahora: <strong>{{ introLabel }}</strong> en el cobro mensual.
          Después, el precio de lista. El anual no usa esta promo: ya trae 2 meses off.
        </p>

        <p *ngIf="countryLabel" class="text-xs text-center text-gray-500 dark:text-gray-400">
          País de cobro: <span class="font-semibold text-gray-700 dark:text-gray-200">{{ countryLabel }}</span>
          · Moneda: {{ currency }}
        </p>

        <div *ngIf="loadingPlans" class="text-center text-sm text-gray-500 py-6">Cargando planes…</div>

        <div *ngIf="!loadingPlans && plans.length" class="space-y-3">
          <button
            type="button"
            *ngFor="let plan of plans"
            (click)="selectedProductId = plan.id"
            class="w-full text-left rounded-xl border p-4 transition"
            [class.border-teal-500]="selectedProductId === plan.id"
            [class.bg-teal-50]="selectedProductId === plan.id"
            [class.dark:bg-teal-950/40]="selectedProductId === plan.id"
            [class.border-gray-200]="selectedProductId !== plan.id"
            [class.dark:border-gray-700]="selectedProductId !== plan.id"
            [class.bg-white]="selectedProductId !== plan.id"
            [class.dark:bg-gray-900]="selectedProductId !== plan.id">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-semibold text-gray-900 dark:text-gray-100">{{ plan.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{{ plan.description }}</p>
              </div>
              <span *ngIf="plan.featured" class="text-[10px] font-bold uppercase text-teal-700 dark:text-teal-400 shrink-0">
                Recomendado
              </span>
            </div>
            <p class="mt-2 text-sm font-bold text-teal-700 dark:text-teal-400">
              {{ plan.priceLabel }}
            </p>
          </button>
        </div>

        <p *ngIf="!loadingPlans && !plans.length && error" class="text-sm text-red-600 text-center">{{ error }}</p>
        <p *ngIf="error && plans.length" class="text-sm text-red-600 text-center">
          {{ error }}
          <a
            *ngIf="error.includes('celular')"
            routerLink="/mi-cuenta"
            class="block mt-1 font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            Ir a Mi cuenta
          </a>
        </p>

        <button
          type="button"
          (click)="pay()"
          [disabled]="paying || !selectedProductId || !checkoutAvailable"
          class="w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {{ payLabel }}
        </button>
        <p *ngIf="selectedChargeHint" class="text-xs text-center text-gray-500 dark:text-gray-400 leading-relaxed">
          {{ selectedChargeHint }}
        </p>

        <p *ngIf="!checkoutAvailable && !loadingPlans" class="text-xs text-center text-amber-700 dark:text-amber-300">
          El checkout online todavía no está configurado para tu país. Escribinos por WhatsApp y te activamos el plan.
        </p>

        <a
          *ngIf="canStayFree"
          [routerLink]="auth.homeRoute"
          class="block w-full rounded-xl border border-gray-200 dark:border-gray-700 py-3 text-center text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
          {{ stayFreeLabel }}
        </a>

        <a
          *ngIf="whatsappUrl"
          [href]="whatsappUrl"
          target="_blank"
          rel="noopener"
          class="block w-full rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 py-3 text-center text-sm font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100">
          WhatsApp de soporte
        </a>

        <a routerLink="/mi-cuenta" class="block text-center text-sm text-teal-700 dark:text-teal-400 hover:underline">
          Mi cuenta
        </a>
        <button type="button" (click)="logout()" class="block w-full text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-300">
          Cerrar sesión
        </button>
      </div>
    </div>
  `,
})
export class ActivateSubscriptionComponent implements OnInit {
  readonly auth = inject(AuthService);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  readonly whatsappUrl =
    (import.meta as { env?: Record<string, string> }).env?.['VITE_SUPPORT_WHATSAPP_URL'] ?? '';

  plans: BillingPlan[] = [];
  selectedProductId = 'whatsapp';
  billingInterval: BillingInterval = 'month';
  countryLabel = '';
  country: BillingCountryCode = 'UY';
  currency = '';
  checkoutAvailable = false;
  loadingPlans = true;
  paying = false;
  error = '';
  statusMessage = '';
  statusKind: 'success' | 'pending' | 'error' | '' = '';
  trialDays = DEFAULT_COMMERCIAL_CATALOG.trialDays;
  lite: LiteLimits = DEFAULT_COMMERCIAL_CATALOG.lite;
  introDiscountMonths = DEFAULT_COMMERCIAL_CATALOG.introDiscountMonths;
  introDiscountPercent = DEFAULT_COMMERCIAL_CATALOG.introDiscountPercent;
  introMonthsRemaining = 0;

  async ngOnInit() {
    const status = this.route.snapshot.queryParamMap.get('status');
    if (status === 'success') {
      this.statusKind = 'success';
      this.statusMessage =
        'Pago recibido. Actualizamos tu cuenta; si todavía ves la prueba, esperá unos segundos y recargá.';
      await firstValueFrom(this.auth.initialize()).catch(() => false);
    } else if (status === 'pending') {
      this.statusKind = 'pending';
      this.statusMessage = 'Pago pendiente. Cuando Mercado Pago lo apruebe, tu plan se activa solo.';
    } else if (status === 'failure') {
      this.statusKind = 'error';
      this.statusMessage = 'El pago no se completó. Podés intentar de nuevo.';
    }

    await this.loadPlans();
  }

  get billingMode(): string {
    return this.auth.currentBusiness?.billingMode ?? '';
  }

  get isBlocked(): boolean {
    return this.billingMode === 'blocked';
  }

  get canStayFree(): boolean {
    return this.billingMode === 'trial';
  }

  get showLiteLimits(): boolean {
    return false;
  }

  get showIntroBanner(): boolean {
    return false;
  }

  get introLabel(): string {
    return introDiscountLabel({
      ...DEFAULT_COMMERCIAL_CATALOG,
      introDiscountMonths: this.introDiscountMonths,
      introDiscountPercent: this.introDiscountPercent,
    });
  }

  get stageEyebrow(): string {
    if (this.billingMode === 'trial') return 'Todavía en prueba';
    if (this.isBlocked || this.auth.isTrialExpired) return 'Prueba vencida';
    return 'Plan pago';
  }

  get stageTitle(): string {
    if (this.billingMode === 'trial') return 'No hace falta pagar ahora';
    if (this.isBlocked || this.auth.isTrialExpired) return 'Tu prueba gratuita terminó';
    return 'Activar o renovar plan';
  }

  get stageBody(): string {
    if (this.billingMode === 'trial') {
      const days = this.auth.trialDaysRemaining;
      const daysText = days != null ? `Quedan ${days} día${days === 1 ? '' : 's'}. ` : '';
      return `${daysText}La prueba es sin tarjeta. Podés seguir usándola y contratar cuando quieras.`;
    }
    if (this.isBlocked || this.auth.isTrialExpired) {
      return 'Tus datos siguen guardados. Elegí un plan para continuar usando RILO.';
    }
    return 'Renovás la cobertura o cambiás de producto. Mercado Pago o marcado desde la plataforma.';
  }

  get stayFreeLabel(): string {
    return 'Seguir en la prueba, sin pagar';
  }

  get payLabel(): string {
    if (this.paying) return 'Abriendo Mercado Pago…';
    return 'Contratar mes con Mercado Pago';
  }

  get selectedChargeHint(): string {
    const plan = this.plans.find((row) => row.id === this.selectedProductId);
    if (!plan) return '';
    return `Hoy ${plan.priceLabel}. Suscripción mensual. Cancelás cuando quieras.`;
  }

  introPriceFor(plan: BillingPlan): string {
    return formatCatalogPriceLabel(this.country, discountedMonthly(plan.amountMonthly, this.introDiscountPercent));
  }

  async loadPlans() {
    this.loadingPlans = true;
    this.error = '';
    try {
      const data = await firstValueFrom(
        this.http.get<{
          available: boolean;
          country: BillingCountryCode;
          currency: string;
          products: BillingPlan[];
          message?: string | null;
          trialDays?: number;
          lite?: LiteLimits;
          introDiscountMonths?: number;
          introDiscountPercent?: number;
          introMonthsRemaining?: number;
        }>('/api/billing/plans')
      );
      this.plans = data.products ?? [];
      this.checkoutAvailable = data.available === true;
      this.currency = data.currency;
      this.country = data.country === 'AR' ? 'AR' : 'UY';
      this.countryLabel = data.country === 'AR' ? 'Argentina' : 'Uruguay';
      this.trialDays = data.trialDays ?? this.trialDays;
      if (data.lite) this.lite = data.lite;
      else if (this.auth.liteLimits) {
        this.lite = {
          maxClientes: this.auth.liteLimits.maxClientes,
          maxProductos: this.auth.liteLimits.maxProductos,
          maxAccionesIaMes: this.auth.liteLimits.maxAccionesIaMes,
          maxOperacionesMes: this.auth.liteLimits.maxOperacionesMes ?? this.lite.maxOperacionesMes,
        };
      }
      this.introDiscountMonths = data.introDiscountMonths ?? this.introDiscountMonths;
      this.introDiscountPercent = data.introDiscountPercent ?? this.introDiscountPercent;
      this.introMonthsRemaining = data.introMonthsRemaining ?? 0;
      const fromQuery = this.route.snapshot.queryParamMap.get('producto');
      if (fromQuery && this.plans.some((p) => p.id === fromQuery)) {
        this.selectedProductId = fromQuery;
      } else if (this.auth.canAccessWhatsapp && !this.auth.canAccessErpWeb && this.plans.some((p) => p.id === 'completo')) {
        this.selectedProductId = 'completo';
      } else if (!this.auth.canAccessWhatsapp && this.auth.canAccessErpWeb && this.plans.some((p) => p.id === 'completo')) {
        this.selectedProductId = 'completo';
      } else if (this.plans.some((p) => p.id === 'whatsapp')) {
        this.selectedProductId = 'whatsapp';
      } else if (this.plans[0]) {
        this.selectedProductId = this.plans[0].id;
      }
      if (!data.available && data.message) {
        this.error = data.message;
      }
    } catch {
      this.error = 'No se pudieron cargar los planes.';
      this.plans = [];
      this.checkoutAvailable = false;
    } finally {
      this.loadingPlans = false;
    }
  }

  async pay() {
    if (!this.selectedProductId || this.paying || !this.checkoutAvailable) return;
    this.paying = true;
    this.error = '';
    try {
      const data = await firstValueFrom(
        this.http.post<{ checkoutUrl: string }>('/api/billing/checkout', {
          productId: this.selectedProductId,
          billingInterval: 'month',
        })
      );
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      this.error = 'No se recibió URL de pago.';
    } catch (err: unknown) {
      const body =
        err && typeof err === 'object' && 'error' in err
          ? (err as { error?: { error?: string; code?: string } }).error
          : undefined;
      if (body?.code === 'WHATSAPP_PHONE_REQUIRED') {
        this.error = 'Confirmá el celular en Mi cuenta antes de pagar RILO Bot.';
        this.paying = false;
        return;
      }
      this.error = body?.error || 'No se pudo iniciar el pago.';
    } finally {
      this.paying = false;
    }
  }

  logout() {
    this.auth.logout();
  }
}
