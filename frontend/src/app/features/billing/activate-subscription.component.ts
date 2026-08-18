import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { firstValueFrom } from 'rxjs';

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

@Component({
  selector: 'app-activate-subscription',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div class="max-w-lg w-full rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 space-y-4">
        <div class="text-center">
          <div class="inline-flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-2xl">💳</div>
          <h1 class="mt-3 text-xl font-bold text-gray-900">Activar o renovar plan</h1>
          <p class="mt-2 text-sm text-gray-600 leading-relaxed">
            La prueba es <span class="font-medium text-gray-800">gratis y sin tarjeta</span>.
            Si ya venció, seguís más barato en plan libre con techos.
            Recién cobramos el precio de lista cuando activás (Mercado Pago o marcado desde la plataforma).
          </p>
        </div>

        <div
          *ngIf="statusMessage"
          class="rounded-xl border px-3 py-2.5 text-sm"
          [class.border-teal-200]="statusKind === 'success'"
          [class.bg-teal-50]="statusKind === 'success'"
          [class.text-teal-900]="statusKind === 'success'"
          [class.border-amber-200]="statusKind === 'pending'"
          [class.bg-amber-50]="statusKind === 'pending'"
          [class.text-amber-900]="statusKind === 'pending'"
          [class.border-red-200]="statusKind === 'error'"
          [class.bg-red-50]="statusKind === 'error'"
          [class.text-red-900]="statusKind === 'error'">
          {{ statusMessage }}
        </div>

        <p *ngIf="countryLabel" class="text-xs text-center text-gray-500">
          País de cobro: <span class="font-semibold text-gray-700">{{ countryLabel }}</span>
          · Moneda: {{ currency }}
        </p>

        <div *ngIf="loadingPlans" class="text-center text-sm text-gray-500 py-6">Cargando planes…</div>

        <div *ngIf="!loadingPlans && plans.length" class="flex rounded-xl border border-gray-200 p-1 gap-1">
          <button
            type="button"
            (click)="billingInterval = 'month'"
            class="flex-1 rounded-lg py-2 text-sm font-semibold transition"
            [class.bg-sky-600]="billingInterval === 'month'"
            [class.text-white]="billingInterval === 'month'"
            [class.text-gray-600]="billingInterval !== 'month'">
            Mensual
          </button>
          <button
            type="button"
            (click)="billingInterval = 'year'"
            class="flex-1 rounded-lg py-2 text-sm font-semibold transition"
            [class.bg-sky-600]="billingInterval === 'year'"
            [class.text-white]="billingInterval === 'year'"
            [class.text-gray-600]="billingInterval !== 'year'">
            Anual <span class="font-normal opacity-90">(2 meses off)</span>
          </button>
        </div>

        <div *ngIf="!loadingPlans && plans.length" class="space-y-3">
          <button
            type="button"
            *ngFor="let plan of plans"
            (click)="selectedProductId = plan.id"
            class="w-full text-left rounded-xl border p-4 transition"
            [class.border-teal-500]="selectedProductId === plan.id"
            [class.bg-teal-50]="selectedProductId === plan.id"
            [class.border-gray-200]="selectedProductId !== plan.id"
            [class.bg-white]="selectedProductId !== plan.id">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-semibold text-gray-900">{{ plan.name }}</p>
                <p class="text-xs text-gray-500 mt-1 leading-relaxed">{{ plan.description }}</p>
              </div>
              <span *ngIf="plan.featured" class="text-[10px] font-bold uppercase text-teal-700 shrink-0">Recomendado</span>
            </div>
            <p class="mt-2 text-sm font-bold text-teal-700">
              {{ billingInterval === 'year' ? (plan.priceLabelYearly || plan.priceLabel) : plan.priceLabel }}
            </p>
          </button>
        </div>

        <p *ngIf="!loadingPlans && !plans.length && error" class="text-sm text-red-600 text-center">{{ error }}</p>
        <p *ngIf="error && plans.length" class="text-sm text-red-600 text-center">
          {{ error }}
          <a
            *ngIf="error.includes('celular')"
            routerLink="/mi-cuenta"
            class="block mt-1 font-semibold text-teal-700 hover:underline">
            Ir a Mi cuenta
          </a>
        </p>

        <button
          type="button"
          (click)="pay()"
          [disabled]="paying || !selectedProductId || !checkoutAvailable"
          class="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {{
            paying
              ? 'Abriendo Mercado Pago…'
              : billingInterval === 'year'
                ? 'Pagar año con Mercado Pago'
                : 'Pagar mes con Mercado Pago'
          }}
        </button>

        <p *ngIf="!checkoutAvailable && !loadingPlans" class="text-xs text-center text-amber-700">
          El checkout online todavía no está configurado para tu país. Escribinos por WhatsApp y te activamos el plan.
        </p>

        <a
          *ngIf="whatsappUrl"
          [href]="whatsappUrl"
          target="_blank"
          rel="noopener"
          class="block w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-center text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
          WhatsApp de soporte
        </a>

        <a routerLink="/mi-cuenta" class="block text-center text-sm text-teal-700 hover:underline">Mi cuenta</a>
        <button type="button" (click)="logout()" class="block w-full text-sm text-gray-500 hover:text-gray-800">
          Cerrar sesión
        </button>
      </div>
    </div>
  `,
})
export class ActivateSubscriptionComponent implements OnInit {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  readonly whatsappUrl =
    (import.meta as { env?: Record<string, string> }).env?.['VITE_SUPPORT_WHATSAPP_URL'] ?? '';

  plans: BillingPlan[] = [];
  selectedProductId = 'whatsapp';
  billingInterval: BillingInterval = 'month';
  countryLabel = '';
  currency = '';
  checkoutAvailable = false;
  loadingPlans = true;
  paying = false;
  error = '';
  statusMessage = '';
  statusKind: 'success' | 'pending' | 'error' | '' = '';

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

  async loadPlans() {
    this.loadingPlans = true;
    this.error = '';
    try {
      const data = await firstValueFrom(
        this.http.get<{
          available: boolean;
          country: string;
          currency: string;
          products: BillingPlan[];
          message?: string | null;
        }>('/api/billing/plans')
      );
      this.plans = data.products ?? [];
      this.checkoutAvailable = data.available === true;
      this.currency = data.currency;
      this.countryLabel = data.country === 'AR' ? 'Argentina' : 'Uruguay';
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
          billingInterval: this.billingInterval,
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
        this.error = 'Confirmá el celular en Mi cuenta antes de pagar RiloBot.';
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
