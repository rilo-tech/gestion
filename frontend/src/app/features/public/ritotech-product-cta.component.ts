import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  TRIAL_PRODUCT_LABELS,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import {
  DEFAULT_PHONE_DIAL,
  PHONE_COUNTRY_OPTIONS,
  dialFromCountryName,
  formatPhoneDisplay,
  parsePhoneInput,
} from '../../../../../shared/phone.ts';

@Component({
  selector: 'app-ritotech-product-cta',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  host: { class: 'block' },
  template: `
    <ng-container *ngIf="!auth.currentUser || auth.isPlatformAdmin; else loggedIn">
      <a
        [routerLink]="['/registro']"
        [queryParams]="{ producto: product }"
        [class]="guestClass">
        {{ guestLabel }}
      </a>
    </ng-container>

    <ng-template #loggedIn>
      <p *ngIf="!auth.isSupervisor" class="text-xs text-gray-400 leading-relaxed">
        Pedile al administrador de la cuenta que sume o reactive este servicio desde Planes.
      </p>

      <ng-container *ngIf="auth.isSupervisor">
        <p *ngIf="isOperational" class="text-xs text-teal-300 font-medium">
          Lo tenés activo.
          <a [routerLink]="auth.planRoute" class="underline hover:text-teal-200">Ir a Plan</a>
        </p>

        <ng-container *ngIf="!isOperational && !showPhoneForm">
          <button
            type="button"
            (click)="startAdd()"
            [disabled]="busy"
            [class]="actionClass">
            {{ busy ? 'Procesando…' : actionLabel }}
          </button>
        </ng-container>

        <div
          *ngIf="showPhoneForm"
          class="rounded-lg border border-teal-800 bg-teal-950/40 p-3 space-y-3 text-left">
          <p class="text-sm font-medium text-white">Confirmá el celular de RILO Bot</p>
          <p class="text-xs text-gray-400 leading-relaxed">
            Es obligatorio. Te mandamos un código por WhatsApp a ese número.
          </p>
          <ng-container *ngIf="phoneStep === 'phone'">
            <div class="flex gap-2">
              <select
                [(ngModel)]="phoneDial"
                name="ctaPhoneDial"
                class="shrink-0 min-w-[6.5rem] px-2 py-2 rounded-lg border border-gray-700 bg-gray-950 text-sm">
                <option *ngFor="let country of phoneCountries" [ngValue]="country.dial">
                  +{{ country.dial }}
                </option>
              </select>
              <input
                [(ngModel)]="phoneLocal"
                name="ctaPhoneLocal"
                inputmode="tel"
                placeholder="99 123 456"
                class="min-w-0 flex-1 px-3 py-2 rounded-lg border border-gray-700 bg-gray-950 text-sm">
            </div>
            <p *ngIf="formattedPhonePreview" class="text-xs text-gray-500">Se usará {{ formattedPhonePreview }}</p>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                (click)="sendCode()"
                [disabled]="busy"
                class="text-sm font-semibold text-teal-300 hover:underline disabled:opacity-60">
                {{ busy ? 'Enviando…' : 'Enviar código' }}
              </button>
              <button type="button" (click)="cancelPhone()" class="text-sm text-gray-500 hover:underline">
                Cancelar
              </button>
            </div>
          </ng-container>
          <ng-container *ngIf="phoneStep === 'code'">
            <p class="text-xs text-gray-400">Código enviado a {{ pendingPhoneDisplay }}.</p>
            <p *ngIf="devOtp" class="text-xs font-mono text-amber-300">Código de prueba: {{ devOtp }}</p>
            <input
              [(ngModel)]="otpCode"
              name="ctaOtp"
              inputmode="numeric"
              maxlength="6"
              placeholder="123456"
              class="w-full max-w-[10rem] px-3 py-2 rounded-lg border border-gray-700 bg-gray-950 text-sm tracking-widest">
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                (click)="confirmCode()"
                [disabled]="busy || otpCode.trim().length !== 6"
                class="text-sm font-semibold text-teal-300 hover:underline disabled:opacity-60">
                {{ busy ? 'Confirmando…' : 'Confirmar y sumar' }}
              </button>
              <button type="button" (click)="phoneStep = 'phone'" class="text-sm text-gray-500 hover:underline">
                Cambiar número
              </button>
            </div>
          </ng-container>
        </div>

        <p *ngIf="error" class="mt-2 text-xs text-red-400">{{ error }}</p>
      </ng-container>
    </ng-template>
  `,
})
export class RitotechProductCtaComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  @Input({ required: true }) product!: TrialProductId;
  @Input() guestLabel = 'Probar 30 días';
  @Input() variant: 'primary' | 'secondary' | 'compact' = 'primary';

  busy = false;
  error = '';
  showPhoneForm = false;
  phoneStep: 'phone' | 'code' = 'phone';
  phoneDial = DEFAULT_PHONE_DIAL;
  phoneLocal = '';
  otpCode = '';
  pendingPhone = '';
  devOtp = '';
  readonly phoneCountries = PHONE_COUNTRY_OPTIONS;

  get guestClass(): string {
    if (this.variant === 'compact') {
      return 'shrink-0 inline-flex justify-center rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 whitespace-nowrap';
    }
    if (this.variant === 'secondary') {
      return 'shrink-0 inline-flex justify-center self-start rounded-lg px-4 py-2.5 text-sm font-semibold bg-gray-800 hover:bg-gray-700';
    }
    return 'shrink-0 inline-flex justify-center self-start rounded-lg px-4 py-2.5 text-sm font-semibold bg-teal-600 hover:bg-teal-500';
  }

  get actionClass(): string {
    return `${this.guestClass} disabled:opacity-60`;
  }

  get isOperational(): boolean {
    if (this.product === 'whatsapp') return this.auth.canAccessWhatsapp;
    if (this.product === 'erp') return this.auth.canAccessErpWeb;
    return this.auth.canAccessWhatsapp && this.auth.canAccessErpWeb;
  }

  get isPaused(): boolean {
    if (this.product === 'whatsapp') return this.auth.isWhatsappPaused;
    if (this.product === 'erp') return this.auth.isErpPaused;
    return this.auth.isWhatsappPaused || this.auth.isErpPaused;
  }

  get actionLabel(): string {
    const name = TRIAL_PRODUCT_LABELS[this.product];
    if (this.isPaused) return `Reactivar ${this.product === 'completo' ? 'ambos' : name}`;
    if (this.product === 'erp') return 'Sumar RILO Gestión';
    if (this.product === 'whatsapp') return 'Sumar RILO Bot';
    return `Sumar ${name}`;
  }

  get whatsappPhoneVerified(): boolean {
    const cv = this.auth.currentBusiness?.contactVerification;
    return Boolean(cv?.phone?.trim() && cv.phoneVerified === true);
  }

  get formattedPhonePreview(): string {
    const e164 = parsePhoneInput(this.phoneDial, this.phoneLocal);
    return e164 ? formatPhoneDisplay(e164) : '';
  }

  get pendingPhoneDisplay(): string {
    return this.pendingPhone ? formatPhoneDisplay(this.pendingPhone) : '';
  }

  startAdd() {
    this.error = '';
    const needsPhone =
      (this.product === 'whatsapp' || this.product === 'completo') &&
      !this.auth.canAccessWhatsapp &&
      !this.whatsappPhoneVerified;
    if (needsPhone) {
      this.showPhoneForm = true;
      this.phoneStep = 'phone';
      this.prefillPhone();
      return;
    }
    this.completeAdd();
  }

  cancelPhone() {
    this.showPhoneForm = false;
    this.phoneStep = 'phone';
    this.error = '';
  }

  sendCode() {
    const phone = parsePhoneInput(this.phoneDial, this.phoneLocal);
    if (!phone) {
      this.error = 'Ingresá un celular válido.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.auth.sendWhatsappPhoneCode(phone).subscribe({
      next: (res) => {
        this.busy = false;
        this.pendingPhone = res.phone;
        this.devOtp = res.devCode ?? '';
        this.phoneStep = 'code';
      },
      error: (err: { error?: { error?: string } }) => {
        this.busy = false;
        this.error = err?.error?.error || 'No se pudo enviar el código.';
      },
    });
  }

  confirmCode() {
    if (!this.pendingPhone || this.otpCode.trim().length !== 6 || this.busy) return;
    this.busy = true;
    this.error = '';
    this.auth.verifyWhatsappPhone(this.pendingPhone, this.otpCode.trim()).subscribe({
      next: () => {
        this.busy = false;
        this.showPhoneForm = false;
        this.completeAdd();
      },
      error: (err: { error?: { error?: string } }) => {
        this.busy = false;
        this.error = err?.error?.error || 'No se pudo confirmar el número.';
      },
    });
  }

  private completeAdd() {
    this.busy = true;
    this.error = '';
    this.auth.enableProduct(this.product).subscribe({
      next: () => {
        this.busy = false;
        void this.router.navigateByUrl(this.auth.homeRoute);
      },
      error: (err: { status?: number; error?: { error?: string; checkoutProduct?: string } }) => {
        this.busy = false;
        if (err?.status === 402) {
          const producto = err.error?.checkoutProduct ?? 'completo';
          void this.router.navigate(['/activar-suscripcion'], { queryParams: { producto } });
          return;
        }
        this.error = err?.error?.error || 'No se pudo sumar el servicio.';
      },
    });
  }

  private prefillPhone() {
    const existing = this.auth.currentBusiness?.contactVerification?.phone?.trim() ?? '';
    const fromCountry = dialFromCountryName(String(this.auth.currentBusiness?.lifecycle?.pais ?? ''));
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
}
