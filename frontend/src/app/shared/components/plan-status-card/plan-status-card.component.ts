import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import {
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../../core/services/business.service';
import { formatMoneyValue } from '../../pipes/money.pipe';
import { productLabelForAccess, type TrialProductId } from '../../../../../../shared/platform-access.ts';
import {
  DEFAULT_PHONE_DIAL,
  PHONE_COUNTRY_OPTIONS,
  dialFromCountryName,
  formatPhoneDisplay,
  parsePhoneInput,
} from '../../../../../../shared/phone.ts';

@Component({
  selector: 'app-plan-status-card',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  host: { class: 'block' },
  template: `
    <article
      *ngIf="business"
      class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6">
      <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">{{ heading }}</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {{ subtitle }}
      </p>

      <div class="space-y-3 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-gray-500 dark:text-gray-400">Empresa</span>
          <span class="font-medium text-gray-900 dark:text-gray-100">{{ business.nombre }}</span>
          <span class="text-xs font-mono text-gray-400">({{ business.id }})</span>
        </div>

        <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
          <p class="text-xs text-gray-500 dark:text-gray-400">Plan</p>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ productLabel }}</p>
        </div>

        <div class="rounded-lg px-3 py-2 border" [ngClass]="billingToneClass">
          <p class="text-xs text-gray-500 dark:text-gray-400">Estado y pago</p>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ billingHeadline }}</p>
          <p *ngIf="billingDetail" class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            {{ billingDetail }}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
            <p class="text-xs text-gray-500 dark:text-gray-400">Panel web</p>
            <p
              class="font-medium"
              [ngClass]="auth.canAccessErpWeb ? 'text-teal-700 dark:text-teal-400' : 'text-gray-400'">
              {{ auth.canAccessErpWeb ? 'Activo' : 'No incluido' }}
            </p>
          </div>
          <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
            <p class="text-xs text-gray-500 dark:text-gray-400">RiloBot (WhatsApp)</p>
            <p
              class="font-medium"
              [ngClass]="auth.canAccessWhatsapp ? 'text-teal-700 dark:text-teal-400' : 'text-gray-400'">
              {{ auth.canAccessWhatsapp ? 'Activo' : 'No incluido' }}
            </p>
          </div>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{{ channelHint }}</p>

        <p *ngIf="enableError" class="text-xs text-red-600 dark:text-red-400">{{ enableError }}</p>

        <div
          *ngIf="showWhatsappPhoneForm"
          class="rounded-lg border border-teal-100 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/30 px-3 py-3 space-y-3">
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">Confirmá el celular de RiloBot</p>
          <p class="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            Es obligatorio. Te mandamos un código por WhatsApp a ese número para verificarlo.
          </p>

          <ng-container *ngIf="whatsappPhoneStep === 'phone'">
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300" for="rilobot-phone">
              Celular / WhatsApp
            </label>
            <div class="flex gap-2">
              <select
                [(ngModel)]="phoneDial"
                name="rilobotPhoneDial"
                class="shrink-0 min-w-[6.5rem] px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm">
                <option *ngFor="let country of phoneCountries" [ngValue]="country.dial">
                  +{{ country.dial }}
                </option>
              </select>
              <input
                id="rilobot-phone"
                [(ngModel)]="phoneLocal"
                name="rilobotPhoneLocal"
                inputmode="tel"
                autocomplete="tel-national"
                placeholder="99 123 456"
                class="min-w-0 flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm">
            </div>
            <p *ngIf="formattedPhonePreview" class="text-xs text-gray-500">Se usará {{ formattedPhonePreview }}</p>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                (click)="sendWhatsappCode()"
                [disabled]="enabling"
                class="inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-60">
                {{ enabling ? 'Enviando…' : 'Enviar código' }}
              </button>
              <button
                type="button"
                (click)="cancelWhatsappPhoneFlow()"
                class="inline-flex text-sm text-gray-500 hover:underline">
                Cancelar
              </button>
            </div>
          </ng-container>

          <ng-container *ngIf="whatsappPhoneStep === 'code'">
            <p class="text-xs text-gray-600 dark:text-gray-400">
              Código enviado a <span class="font-medium text-gray-800 dark:text-gray-200">{{ pendingPhoneDisplay }}</span>.
            </p>
            <p *ngIf="otpHint" class="text-xs text-gray-500">{{ otpHint }}</p>
            <p *ngIf="devOtp" class="text-xs font-mono text-amber-700 dark:text-amber-400">
              Código de prueba: {{ devOtp }}
            </p>
            <input
              [(ngModel)]="otpCode"
              name="rilobotOtp"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="123456"
              class="w-full max-w-[10rem] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm tracking-widest">
            <p class="text-xs text-gray-500">
              Si no llega,
              <a [href]="rilobotWaLink" target="_blank" rel="noopener" class="text-teal-700 dark:text-teal-400 hover:underline">escribí Hola a RiloBot</a>
              y pedí el código de nuevo.
            </p>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                (click)="confirmWhatsappCode()"
                [disabled]="enabling || otpCode.trim().length !== 6"
                class="inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-60">
                {{ enabling ? 'Confirmando…' : 'Confirmar número' }}
              </button>
              <button
                type="button"
                (click)="whatsappPhoneStep = 'phone'; enableError = ''"
                class="inline-flex text-sm text-gray-500 hover:underline">
                Cambiar número
              </button>
            </div>
          </ng-container>
        </div>

        <div *ngIf="!showWhatsappPhoneForm" class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            *ngIf="canEnableMissingInTrial"
            type="button"
            (click)="enableMissingChannel()"
            [disabled]="enabling"
            class="inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-60">
            {{ enabling ? 'Activando…' : missingChannelCta }}
          </button>
          <button
            *ngIf="needsWhatsappPhone && !canEnableMissingInTrial"
            type="button"
            (click)="startWhatsappPhoneFlow()"
            class="inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            {{ payCtaLabel }}
          </button>
          <a
            *ngIf="(!canEnableMissingInTrial || isTrialActive) && !needsWhatsappPhone"
            routerLink="/activar-suscripcion"
            [queryParams]="checkoutQueryParams"
            class="inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            {{ canEnableMissingInTrial ? 'Ver planes y pago' : payCtaLabel }}
          </a>
        </div>
      </div>
    </article>
  `,
})
export class PlanStatusCardComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  /** `home`: copy para clientes solo WhatsApp. `settings`: copy dentro del ERP. */
  @Input() variant: 'home' | 'settings' = 'settings';

  enabling = false;
  enableError = '';
  showWhatsappPhoneForm = false;
  whatsappPhoneStep: 'phone' | 'code' = 'phone';
  phoneDial = DEFAULT_PHONE_DIAL;
  phoneLocal = '';
  otpCode = '';
  pendingPhone = '';
  otpHint = '';
  devOtp = '';
  readonly phoneCountries = PHONE_COUNTRY_OPTIONS;
  readonly rilobotWaLink = (() => {
    const raw =
      (import.meta as { env?: Record<string, string> }).env?.['VITE_RILOBOT_WHATSAPP'] ??
      '15551379594';
    return `https://wa.me/${raw.replace(/\D/g, '')}`;
  })();

  get business() {
    return this.auth.currentBusiness;
  }

  get productLabel(): string {
    return productLabelForAccess(this.auth.platformAccess);
  }

  get heading(): string {
    return this.variant === 'home' ? 'Tu plan' : 'Plan, pago y canales';
  }

  get subtitle(): string {
    if (this.variant === 'home') {
      return 'Estado de tu prueba o suscripción. El trabajo del día a día es por WhatsApp.';
    }
    return 'Qué tenés activo en este negocio y cómo está el pago.';
  }

  get isTrialActive(): boolean {
    return this.business?.enPrueba === true && this.business?.trialStatus === 'active';
  }

  get isTrialExpired(): boolean {
    return this.auth.isTrialExpired;
  }

  get isLitePlan(): boolean {
    return this.auth.isLitePlan;
  }

  get isPaidOk(): boolean {
    return (
      !this.isTrialActive &&
      !this.isLitePlan &&
      !this.isTrialExpired &&
      this.business?.estadoSuscripcion === 'activa' &&
      this.business?.estadoPago === 'al_dia'
    );
  }

  get isPaymentIssue(): boolean {
    if (this.isTrialActive || this.isLitePlan || this.isTrialExpired) return false;
    return (
      this.auth.isPaymentOverdue ||
      this.auth.isPaymentPending ||
      this.auth.isPaymentDueSoon ||
      this.business?.estadoSuscripcion === 'suspendida' ||
      this.business?.estadoSuscripcion === 'vencida'
    );
  }

  get billingToneClass(): string {
    if (this.isTrialActive) {
      return 'bg-violet-50 border-violet-100 dark:bg-violet-950/40 dark:border-violet-900';
    }
    if (this.isLitePlan) {
      return 'bg-amber-50 border-amber-100 dark:bg-amber-950/40 dark:border-amber-900';
    }
    if (this.isTrialExpired) {
      return 'bg-amber-50 border-amber-100 dark:bg-amber-950/40 dark:border-amber-900';
    }
    if (this.isPaidOk) {
      return 'bg-teal-50 border-teal-100 dark:bg-teal-950/40 dark:border-teal-900';
    }
    if (this.isPaymentIssue) {
      return 'bg-orange-50 border-orange-100 dark:bg-orange-950/40 dark:border-orange-900';
    }
    return 'border-gray-100 dark:border-gray-700';
  }

  get billingHeadline(): string {
    if (this.isTrialActive) return 'Prueba gratuita activa';
    if (this.isLitePlan) return 'Plan libre';
    if (this.isTrialExpired) return 'Prueba vencida';
    const status = this.business?.estadoSuscripcion;
    if (status && status !== 'activa') {
      return SUBSCRIPTION_STATUS_LABELS[status];
    }
    const pago = this.business?.estadoPago;
    return pago ? `Suscripción activa · ${SUBSCRIPTION_PAYMENT_STATUS_LABELS[pago]}` : 'Suscripción activa';
  }

  get billingDetail(): string {
    const parts: string[] = [];
    if (this.isTrialActive) {
      const days = this.auth.trialDaysRemaining;
      if (days != null) {
        parts.push(`Quedan ${days} día${days === 1 ? '' : 's'}`);
      }
      const end = this.formatDate(this.business?.trialEndDate);
      if (end) parts.push(`vence ${end}`);
    } else if (this.isLitePlan) {
      const limits = this.auth.liteLimits;
      const end = this.formatDate(this.business?.trialEndDate);
      if (end) parts.push(`La prueba venció el ${end}`);
      if (limits) {
        parts.push(
          `Hasta ${limits.maxClientes} clientes, ${limits.maxProductos} productos` +
            (limits.maxOperacionesMes ? `, ${limits.maxOperacionesMes} cargas WhatsApp` : '') +
            ` y ${limits.maxAccionesIaMes} acciones IA al mes`
        );
      } else {
        parts.push('Seguís operando con techos. Activá un plan cuando crezcas.');
      }
    } else if (this.isTrialExpired) {
      const end = this.formatDate(this.business?.trialEndDate);
      parts.push(end ? `Venció el ${end}. Activá un plan para seguir usando RILO.` : 'Activá un plan para seguir usando RILO.');
    } else {
      const until = this.formatDate(this.business?.paidUntil);
      if (until) {
        const days = this.auth.paymentDaysRemaining;
        if (days != null && days >= 0) {
          parts.push(`Cubierto hasta ${until} (${days} día${days === 1 ? '' : 's'})`);
        } else if (days != null && days < 0) {
          parts.push(`Cobertura venció el ${until}`);
        } else {
          parts.push(`Cubierto hasta ${until}`);
        }
      }
      const interval = this.business?.billingInterval;
      if (interval === 'year') parts.push('Facturación anual');
      else if (interval === 'month') parts.push('Facturación mensual');
      const amount = this.business?.montoMensualEsperado;
      if (typeof amount === 'number' && amount > 0) {
        parts.push(`Cuota ${formatMoneyValue(amount)} / mes`);
      }
      if (this.business?.ultimoPagoFecha) {
        const paidOn = this.formatDate(this.business.ultimoPagoFecha);
        const paidAmount =
          typeof this.business.ultimoPagoMonto === 'number'
            ? formatMoneyValue(this.business.ultimoPagoMonto)
            : '';
        parts.push(
          paidAmount && paidOn ? `Último pago ${paidAmount} el ${paidOn}` : `Último pago ${paidOn || paidAmount}`
        );
      }
    }
    return parts.join(' · ');
  }

  get channelHint(): string {
    const wa = this.auth.canAccessWhatsapp;
    const erp = this.auth.canAccessErpWeb;
    if (wa && !erp) {
      return 'Tu plan opera por WhatsApp. El panel web se suma desde esta misma cuenta, sin registrarte de nuevo. El historial ya está en el ERP.';
    }
    if (erp && wa) {
      return 'RiloBot está activo: podés cargar por WhatsApp y controlar todo en este panel.';
    }
    if (erp && !wa) {
      return 'Este negocio usa el panel web. Para activar RiloBot desde acá tenés que cargar y confirmar el celular.';
    }
    return 'No hay canales operativos en este negocio.';
  }

  get missingProduct(): TrialProductId | null {
    const wa = this.auth.canAccessWhatsapp;
    const erp = this.auth.canAccessErpWeb;
    if (wa && !erp) return 'erp';
    if (erp && !wa) return 'whatsapp';
    return null;
  }

  get canEnableMissingInTrial(): boolean {
    return (
      this.auth.isSupervisor &&
      this.isTrialActive &&
      this.missingProduct != null
    );
  }

  get missingChannelCta(): string {
    if (this.missingProduct === 'erp') return 'Sumar el panel web a esta cuenta';
    if (this.missingProduct === 'whatsapp') return 'Activar RiloBot en esta cuenta';
    return 'Sumar módulo';
  }

  get checkoutQueryParams(): { producto: string } {
    const missing = this.missingProduct;
    if (missing === 'erp' || missing === 'whatsapp') {
      return { producto: 'completo' };
    }
    return { producto: this.auth.platformAccess.trialProduct ?? 'whatsapp' };
  }

  get whatsappPhoneVerified(): boolean {
    const cv = this.business?.contactVerification;
    return Boolean(cv?.phone?.trim() && cv.phoneVerified === true);
  }

  get needsWhatsappPhone(): boolean {
    return this.auth.isSupervisor && this.missingProduct === 'whatsapp' && !this.whatsappPhoneVerified;
  }

  get formattedPhonePreview(): string {
    const e164 = parsePhoneInput(this.phoneDial, this.phoneLocal);
    return e164 ? formatPhoneDisplay(e164) : '';
  }

  get pendingPhoneDisplay(): string {
    return this.pendingPhone ? formatPhoneDisplay(this.pendingPhone) : '';
  }

  get payCtaLabel(): string {
    if (this.isTrialExpired || this.auth.isPaymentOverdue || this.business?.estadoSuscripcion === 'vencida') {
      return 'Activar o renovar plan';
    }
    if (this.isTrialActive) return 'Ver opciones de activación';
    if (this.missingProduct === 'whatsapp') return 'Activar RiloBot';
    if (this.missingProduct === 'erp') return 'Sumar el panel web';
    return 'Ver planes y pago';
  }

  enableMissingChannel() {
    const product = this.missingProduct;
    if (!product || this.enabling) return;
    if (product === 'whatsapp' && !this.whatsappPhoneVerified) {
      this.startWhatsappPhoneFlow();
      return;
    }
    this.completeEnableOrCheckout(product);
  }

  startWhatsappPhoneFlow() {
    this.showWhatsappPhoneForm = true;
    this.whatsappPhoneStep = 'phone';
    this.enableError = '';
    this.otpCode = '';
    this.devOtp = '';
    this.otpHint = '';
    this.prefillPhone();
  }

  cancelWhatsappPhoneFlow() {
    this.showWhatsappPhoneForm = false;
    this.whatsappPhoneStep = 'phone';
    this.enableError = '';
    this.otpCode = '';
    this.devOtp = '';
  }

  sendWhatsappCode() {
    const phone = parsePhoneInput(this.phoneDial, this.phoneLocal);
    if (!phone) {
      this.enableError = 'Ingresá un celular válido.';
      return;
    }
    this.enabling = true;
    this.enableError = '';
    this.auth.sendWhatsappPhoneCode(phone).subscribe({
      next: (res) => {
        this.enabling = false;
        this.pendingPhone = res.phone;
        this.otpHint = res.hint ?? '';
        this.devOtp = res.devCode ?? '';
        this.whatsappPhoneStep = 'code';
      },
      error: (err: { error?: { error?: string } }) => {
        this.enabling = false;
        this.enableError = err?.error?.error || 'No se pudo enviar el código.';
      },
    });
  }

  confirmWhatsappCode() {
    if (!this.pendingPhone || this.otpCode.trim().length !== 6 || this.enabling) return;
    this.enabling = true;
    this.enableError = '';
    this.auth.verifyWhatsappPhone(this.pendingPhone, this.otpCode.trim()).subscribe({
      next: () => {
        this.enabling = false;
        this.showWhatsappPhoneForm = false;
        const product = this.missingProduct ?? 'whatsapp';
        this.completeEnableOrCheckout(product);
      },
      error: (err: { error?: { error?: string } }) => {
        this.enabling = false;
        this.enableError = err?.error?.error || 'No se pudo confirmar el número.';
      },
    });
  }

  private completeEnableOrCheckout(product: TrialProductId) {
    this.enabling = true;
    this.enableError = '';
    this.auth.enableProduct(product).subscribe({
      next: () => {
        this.enabling = false;
        void this.router.navigateByUrl(this.auth.homeRoute);
      },
      error: (err: { status?: number; error?: { error?: string; checkoutProduct?: string } }) => {
        this.enabling = false;
        if (err?.status === 402) {
          const producto = err.error?.checkoutProduct ?? 'completo';
          void this.router.navigate(['/activar-suscripcion'], { queryParams: { producto } });
          return;
        }
        this.enableError = err?.error?.error || 'No se pudo habilitar el módulo.';
      },
    });
  }

  private prefillPhone() {
    const existing = this.business?.contactVerification?.phone?.trim() ?? '';
    const fromCountry = dialFromCountryName(String(this.business?.lifecycle?.pais ?? ''));
    if (fromCountry) this.phoneDial = fromCountry;
    if (!existing.startsWith('+')) {
      this.phoneLocal = existing.replace(/\D/g, '');
      return;
    }
    const digits = existing.slice(1);
    const sorted = [...PHONE_COUNTRY_OPTIONS].sort((a, b) => b.dial.length - a.dial.length);
    for (const country of sorted) {
      if (digits.startsWith(country.dial)) {
        this.phoneDial = country.dial;
        this.phoneLocal = digits.slice(country.dial.length);
        return;
      }
    }
    this.phoneLocal = digits;
  }

  private formatDate(value?: string | null): string {
    if (!value) return '';
    const iso = value.includes('T') ? value : `${value.slice(0, 10)}T12:00:00`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return date.toLocaleDateString('es-AR');
  }
}
