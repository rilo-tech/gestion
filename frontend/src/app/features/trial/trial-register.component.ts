import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TRIAL_RUBROS } from '../../../../../shared/trial-registration.ts';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import { TrialRegistrationService } from '../../core/services/trial-registration.service';
import { AuthService } from '../../core/services/auth.service';
import { HttpErrorResponse } from '@angular/common/http';

type Step = 'intro' | 'form' | 'phone' | 'creating' | 'done';

@Component({
  selector: 'app-trial-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-teal-950 text-white">
      <div class="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <div class="text-center mb-8">
          <p class="text-teal-400 font-bold tracking-tight text-2xl">RILO Gestión</p>
          <h1 class="text-2xl sm:text-3xl font-bold mt-3">Probá gratis {{ trialDays }} días</h1>
          <p class="text-gray-400 text-sm mt-2 max-w-md mx-auto">
            Pedidos, caja, stock, clientes y reportes. Sin llamadas obligatorias — empezá ahora y configurá tu negocio.
          </p>
        </div>

        <div *ngIf="step === 'intro'" class="space-y-4">
          <ul class="text-sm text-gray-300 space-y-2 bg-gray-900/60 rounded-xl border border-gray-800 p-4">
            <li>✓ Plan Intermedio durante la prueba</li>
            <li>✓ Verificación por SMS al teléfono</li>
            <li>✓ Tus datos quedan guardados si decidís pagar después</li>
          </ul>
          <button
            type="button"
            (click)="step = 'form'"
            class="w-full rounded-xl bg-teal-600 py-3 font-semibold hover:bg-teal-500">
            Empezar registro
          </button>
          <p class="text-center text-sm text-gray-500">
            ¿Ya tenés cuenta?
            <a routerLink="/" class="text-teal-400 hover:underline">Ingresar</a>
          </p>
        </div>

        <form *ngIf="step === 'form'" (submit)="submitForm(); $event.preventDefault()" class="space-y-3">
          <input [(ngModel)]="form.businessName" name="businessName" required placeholder="Nombre del negocio *"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          <select [(ngModel)]="form.rubro" name="rubro" required
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
            <option value="" disabled>Rubro *</option>
            <option *ngFor="let r of rubros" [value]="r.id">{{ r.label }}</option>
          </select>
          <div class="grid grid-cols-2 gap-3">
            <input [(ngModel)]="form.pais" name="pais" required placeholder="País *"
              class="px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
            <input [(ngModel)]="form.ciudad" name="ciudad" required placeholder="Ciudad *"
              class="px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          </div>
          <input [(ngModel)]="form.ownerName" name="ownerName" required placeholder="Nombre y apellido responsable *"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          <input [(ngModel)]="form.email" name="email" type="email" required placeholder="Email *"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          <input [(ngModel)]="form.phone" name="phone" required placeholder="Teléfono / WhatsApp (ej: 099 123 456) *"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          <input [(ngModel)]="form.password" name="password" type="password" required
            placeholder="Contraseña (mín. 8 caracteres) *"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          <input tabindex="-1" autocomplete="off" [(ngModel)]="form.website" name="website"
            class="hidden" aria-hidden="true">
          <label class="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
            <input type="checkbox" [(ngModel)]="form.acceptTerms" name="acceptTerms" class="mt-0.5 rounded">
            <span>Acepto términos y política de privacidad *</span>
          </label>
          <label class="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" [(ngModel)]="form.whatsappOptIn" name="whatsappOptIn" class="mt-0.5 rounded">
            <span>Quiero recibir ayuda por WhatsApp (opcional, sin llamadas)</span>
          </label>
          <p *ngIf="error" class="text-sm text-red-400">{{ error }}</p>
          <button type="submit" [disabled]="loading"
            class="w-full rounded-xl bg-teal-600 py-3 font-semibold hover:bg-teal-500 disabled:opacity-60">
            {{ loading ? 'Enviando...' : 'Continuar' }}
          </button>
        </form>

        <div *ngIf="step === 'phone'" class="space-y-4">
          <p class="text-sm text-gray-300">
            Enviamos un código a <span class="text-white font-medium">{{ form.phone }}</span>.
            <span *ngIf="devOtp" class="block mt-2 text-amber-300 text-xs">Modo dev: {{ devOtp }}</span>
          </p>
          <input [(ngModel)]="otpCode" name="otp" maxlength="6" placeholder="Código de 6 dígitos"
            class="w-full px-4 py-3 rounded-lg border border-gray-700 bg-gray-950 text-center text-lg tracking-widest">
          <p *ngIf="error" class="text-sm text-red-400">{{ error }}</p>
          <button type="button" (click)="verifyOtp()" [disabled]="loading"
            class="w-full rounded-xl bg-teal-600 py-3 font-semibold disabled:opacity-60">
            {{ loading ? 'Verificando...' : 'Verificar y crear mi cuenta' }}
          </button>
          <button type="button" (click)="resendOtp()" [disabled]="loading"
            class="w-full text-sm text-teal-400 hover:underline">
            Reenviar código
          </button>
        </div>

        <div *ngIf="step === 'creating'" class="text-center py-12 text-gray-400">
          Creando tu empresa y acceso...
        </div>

        <div *ngIf="step === 'done'" class="space-y-4 text-center">
          <div class="rounded-xl border border-teal-800 bg-teal-950/50 p-5">
            <p class="text-lg font-semibold text-teal-300">¡Listo! Tu prueba está activa</p>
            <p class="text-sm text-gray-300 mt-2">
              Código de empresa: <span class="font-mono text-white">{{ loginHint?.businessCode }}</span><br>
              Usuario: <span class="font-mono text-white">{{ loginHint?.loginUsername }}</span>
            </p>
          </div>
          <button type="button" (click)="enterApp()"
            class="w-full rounded-xl bg-teal-600 py-3 font-semibold hover:bg-teal-500">
            Entrar al sistema
          </button>
        </div>

        <p *ngIf="supportWhatsapp" class="text-center text-xs text-gray-500 mt-8">
          ¿Necesitás ayuda?
          <a [href]="supportWhatsapp" target="_blank" rel="noopener" class="text-teal-500 hover:underline">WhatsApp</a>
          (opcional)
        </p>
      </div>
    </div>
  `,
})
export class TrialRegisterComponent implements OnInit {
  private trialService = inject(TrialRegistrationService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly rubros = TRIAL_RUBROS;
  readonly trialDays = DEFAULT_TRIAL_DAYS;
  readonly supportWhatsapp = (import.meta as { env?: Record<string, string> }).env?.['VITE_SUPPORT_WHATSAPP_URL'] ?? '';

  step: Step = 'intro';
  loading = false;
  error = '';
  registrationId = '';
  otpCode = '';
  devOtp = '';
  loginHint: { businessCode: string; loginUsername: string } | null = null;

  form = {
    businessName: '',
    rubro: '',
    pais: 'Uruguay',
    ciudad: '',
    ownerName: '',
    email: '',
    phone: '',
    password: '',
    acceptTerms: false,
    whatsappOptIn: false,
    marketingEmailOptIn: true,
    website: '',
  };

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const utmSource = params.get('utm_source');
      const utmCampaign = params.get('utm_campaign');
      if (utmSource) (this.form as { utmSource?: string }).utmSource = utmSource;
      if (utmCampaign) (this.form as { utmCampaign?: string }).utmCampaign = utmCampaign;
    });
  }

  submitForm() {
    this.error = '';
    this.loading = true;
    this.trialService
      .register({
        ...this.form,
        acceptTerms: this.form.acceptTerms,
      })
      .subscribe({
        next: (res) => {
          this.registrationId = res.registrationId;
          this.sendOtpAndGoPhone();
        },
        error: (err) => {
          this.loading = false;
          this.error = this.readError(err);
        },
      });
  }

  private sendOtpAndGoPhone() {
    this.trialService.sendPhoneCode(this.registrationId).subscribe({
      next: (res) => {
        this.loading = false;
        this.devOtp = res.devCode ?? '';
        this.step = 'phone';
      },
      error: (err) => {
        this.loading = false;
        this.error = this.readError(err);
      },
    });
  }

  resendOtp() {
    this.error = '';
    this.loading = true;
    this.trialService.sendPhoneCode(this.registrationId).subscribe({
      next: (res) => {
        this.loading = false;
        this.devOtp = res.devCode ?? '';
      },
      error: (err) => {
        this.loading = false;
        this.error = this.readError(err);
      },
    });
  }

  verifyOtp() {
    this.error = '';
    this.loading = true;
    this.trialService.verifyPhone(this.registrationId, this.otpCode.trim()).subscribe({
      next: () => this.completeRegistration(),
      error: (err) => {
        this.loading = false;
        this.error = this.readError(err);
      },
    });
  }

  private completeRegistration() {
    this.step = 'creating';
    this.trialService.complete(this.registrationId).subscribe({
      next: (res) => {
        this.loginHint = res.loginHint;
        this.auth.establishTrialSession({
          token: res.token,
          user: {
            ...res.user,
            activo: true,
            permisos: [],
            hasPassword: true,
            hasGoogle: false,
          },
          businessId: res.businessId,
          business: res.business,
          scope: 'company',
        });
        void this.trialService.sendEmailVerification(this.registrationId).subscribe();
        this.loading = false;
        this.step = 'done';
      },
      error: (err) => {
        this.step = 'phone';
        this.loading = false;
        this.error = this.readError(err);
      },
    });
  }

  enterApp() {
    void this.router.navigate(['/dashboard']);
  }

  private readError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return err.error?.error ?? 'No se pudo completar el registro.';
    }
    return 'No se pudo completar el registro.';
  }
}
