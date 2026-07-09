import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  TRIAL_PRODUCT_LABELS,
  isTrialProductId,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import { TRIAL_RUBROS } from '../../../../../shared/trial-registration.ts';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import type { GeoCountryOption } from '../../../../../shared/geo.ts';
import {
  DEFAULT_PHONE_DIAL,
  dialFromCountryName,
  formatPhoneDisplay,
  parsePhoneInput,
} from '../../../../../shared/phone.ts';
import { TrialRegistrationService } from '../../core/services/trial-registration.service';
import { LocationLookupService } from '../../core/services/location-lookup.service';
import { AuthService } from '../../core/services/auth.service';
import { HttpErrorResponse } from '@angular/common/http';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../shared/components/searchable-select/searchable-select.component';
import { PasswordInputComponent } from '../../shared/components/password-input/password-input.component';
import { FORM_LABEL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import {
  clearTrialRegisterDraft,
  loadTrialRegisterDraft,
  saveTrialRegisterDraft,
} from './trial-register-draft';

type Step = 'intro' | 'form' | 'email' | 'creating' | 'done';

@Component({
  selector: 'app-trial-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SearchableSelectComponent, PasswordInputComponent],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-teal-950 text-white">
      <div class="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <div class="text-center mb-8">
          <p class="text-teal-400 font-bold tracking-tight text-2xl">RILO Gestión</p>
          <h1 class="text-2xl sm:text-3xl font-bold mt-3">Probá gratis {{ trialDays }} días</h1>
          <p class="text-gray-400 text-sm mt-2 max-w-md mx-auto">
            {{ productIntro }}
          </p>
          <p *ngIf="selectedProductLabel" class="mt-3 inline-flex rounded-full bg-violet-900/50 border border-violet-700/60 px-3 py-1 text-xs text-violet-200">
            Producto: {{ selectedProductLabel }}
          </p>
        </div>

        <div *ngIf="step === 'intro'" class="space-y-4">
          <ul class="text-sm text-gray-300 space-y-2 bg-gray-900/60 rounded-xl border border-gray-800 p-4">
            <li>✓ Plan Intermedio durante la prueba</li>
            <li>✓ Verificación por email (sin costo de SMS)</li>
            <li>✓ Tus datos quedan guardados si decidís pagar después</li>
          </ul>
          <button
            type="button"
            (click)="openForm()"
            class="w-full rounded-xl bg-teal-600 py-3 font-semibold hover:bg-teal-500">
            Empezar registro
          </button>
          <p class="text-center text-sm text-gray-500">
            ¿Ya tenés cuenta?
            <a routerLink="/login" class="text-teal-400 hover:underline">Ingresar</a>
          </p>
        </div>

        <form *ngIf="step === 'form'" (submit)="submitForm(); $event.preventDefault()" class="space-y-4">
          <div>
            <label [class]="formLabelClass" for="businessName">Nombre del negocio *</label>
            <input
              id="businessName"
              [(ngModel)]="form.businessName"
              name="businessName"
              required
              placeholder="Ej: Mi Empresa"
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          </div>
          <div>
            <label [class]="formLabelClass" for="rubro">Rubro *</label>
            <select
              id="rubro"
              [(ngModel)]="form.rubro"
              name="rubro"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
              <option value="" disabled>Seleccioná un rubro</option>
              <option *ngFor="let r of rubros" [value]="r.id">{{ r.label }}</option>
            </select>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label [class]="formLabelClass" for="pais">País *</label>
              <app-searchable-select
                [(ngModel)]="form.pais"
                name="pais"
                [labeledOptions]="countrySelectOptions"
                (ngModelChange)="onCountrySelected($event)"
                placeholder="Buscar país..."
                [inputClass]="trialFieldClass"
                emptyMessage="Sin coincidencias"
                [emptyOptionsMessage]="loadingCountries ? 'Cargando países...' : 'No hay países disponibles'"
                [listHint]="loadingCountries ? 'Cargando países...' : ''">
              </app-searchable-select>
            </div>
            <div>
              <label [class]="formLabelClass" for="ciudad">Ciudad *</label>
              <app-searchable-select
                *ngIf="form.pais; else cityNeedsCountry"
                [(ngModel)]="form.ciudad"
                name="ciudad"
                [options]="cityOptions"
                [allowCustomValue]="true"
                placeholder="Buscar ciudad..."
                [inputClass]="trialFieldClass"
                emptyMessage="Sin coincidencias — podés escribir la tuya"
                [emptyOptionsMessage]="loadingCities ? 'Cargando ciudades...' : 'Escribí el nombre de tu ciudad'"
                [listHint]="loadingCities ? 'Cargando ciudades...' : (cityOptions.length ? 'Podés buscar o escribir otra ciudad' : '')">
              </app-searchable-select>
              <ng-template #cityNeedsCountry>
                <input
                  disabled
                  placeholder="Elegí un país primero"
                  class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-500 opacity-70">
              </ng-template>
            </div>
          </div>
          <p *ngIf="geoError" class="text-xs text-amber-300">{{ geoError }}</p>
          <div>
            <label [class]="formLabelClass" for="ownerName">Nombre y apellido del responsable *</label>
            <input
              id="ownerName"
              [(ngModel)]="form.ownerName"
              name="ownerName"
              required
              placeholder="Ej: Ana Pérez"
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          </div>
          <div>
            <label [class]="formLabelClass" for="email">Email *</label>
            <input
              id="email"
              [(ngModel)]="form.email"
              name="email"
              type="email"
              required
              autocomplete="email"
              placeholder="tu@email.com"
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
          </div>
          <div>
            <label [class]="formLabelClass" for="phone">Teléfono / WhatsApp *</label>
            <div class="flex gap-2">
              <div
                class="flex shrink-0 items-center justify-center min-w-[4.5rem] px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-200"
                [attr.title]="'Código según ' + form.pais"
                aria-hidden="true">
                +{{ form.phoneCountryCode }}
              </div>
              <input
                id="phone"
                [(ngModel)]="form.phone"
                name="phone"
                required
                inputmode="tel"
                autocomplete="tel-national"
                [placeholder]="phonePlaceholder"
                class="min-w-0 flex-1 px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm">
            </div>
            <p *ngIf="formattedPhonePreview" class="text-xs text-gray-500 mt-1">
              Se guardará como {{ formattedPhonePreview }}
            </p>
          </div>
          <div>
            <label [class]="formLabelClass" for="password">Contraseña *</label>
            <app-password-input
              inputId="password"
              [(ngModel)]="form.password"
              name="password"
              required
              autocomplete="new-password"
              placeholder="Mínimo 8 caracteres">
            </app-password-input>
          </div>
          <input tabindex="-1" autocomplete="off" [(ngModel)]="form.website" name="website"
            class="hidden" aria-hidden="true">
          <div class="flex items-start gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              id="acceptTerms"
              [(ngModel)]="form.acceptTerms"
              name="acceptTerms"
              class="mt-0.5 rounded shrink-0">
            <label for="acceptTerms" class="cursor-pointer leading-relaxed">
              Acepto los
              <a
                href="/legal/terminos"
                target="_blank"
                rel="noopener noreferrer"
                class="text-teal-400 hover:underline"
                (click)="onLegalLinkClick($event)">Términos de uso</a>
              y la
              <a
                href="/legal/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                class="text-teal-400 hover:underline"
                (click)="onLegalLinkClick($event)">Política de privacidad</a>
              *
            </label>
          </div>
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

        <div *ngIf="step === 'email'" class="space-y-4">
          <p class="text-sm text-gray-300" *ngIf="emailSent">
            Enviamos un código a <span class="text-white font-medium">{{ form.email }}</span>.
            Revisá también la carpeta de spam.
          </p>
          <p class="text-sm text-amber-300" *ngIf="!emailSent && devOtp">
            No se pudo enviar el email. Usá este código de prueba:
            <span class="block mt-1 text-lg font-mono tracking-widest text-white">{{ devOtp }}</span>
          </p>
          <p class="text-sm text-gray-300" *ngIf="!emailSent && !devOtp">
            Pedimos un código para <span class="text-white font-medium">{{ form.email }}</span>.
          </p>
          <div>
            <label [class]="formLabelClass" for="otp">Código de verificación *</label>
            <input
              id="otp"
              [(ngModel)]="otpCode"
              name="otp"
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="6 dígitos"
              class="w-full px-4 py-3 rounded-lg border border-gray-700 bg-gray-950 text-center text-lg tracking-widest">
          </div>
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
            <p class="text-sm text-gray-400 mt-3">{{ doneMessage }}</p>
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
export class TrialRegisterComponent implements OnInit, OnDestroy {
  private trialService = inject(TrialRegistrationService);
  private locationLookup = inject(LocationLookupService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly rubros = TRIAL_RUBROS;
  readonly trialDays = DEFAULT_TRIAL_DAYS;
  readonly formLabelClass = `${FORM_LABEL_CLASS} !text-gray-300`;
  readonly trialFieldClass =
    'w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-sm text-white outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-gray-500';
  readonly supportWhatsapp = (import.meta as { env?: Record<string, string> }).env?.['VITE_SUPPORT_WHATSAPP_URL'] ?? '';

  countrySelectOptions: SearchableSelectOption[] = [];
  cityOptions: string[] = [];
  private countries: GeoCountryOption[] = [];
  private selectedCountryIso = '';
  loadingCountries = false;
  loadingCities = false;
  geoError = '';

  get phonePlaceholder(): string {
    if (this.form.phoneCountryCode === '598') return '99 123 456';
    if (this.form.phoneCountryCode === '54') return '11 2345 6789';
    return 'Número sin código de país';
  }

  get formattedPhonePreview(): string {
    const e164 = parsePhoneInput(this.form.phoneCountryCode, this.form.phone);
    return e164 ? formatPhoneDisplay(e164) : '';
  }

  step: Step = 'intro';
  loading = false;
  error = '';
  registrationId = '';
  otpCode = '';
  devOtp = '';
  emailSent = false;
  loginHint: { businessCode: string; loginUsername: string } | null = null;
  trialProduct: TrialProductId = 'completo';

  get selectedProductLabel(): string {
    return TRIAL_PRODUCT_LABELS[this.trialProduct] ?? '';
  }

  get productIntro(): string {
    if (this.trialProduct === 'whatsapp') {
      return 'Probá RiloBot por WhatsApp. Cargá pedidos y ventas escribiendo mensajes.';
    }
    if (this.trialProduct === 'erp') {
      return 'Panel web para clientes, stock, caja y reportes. Sin WhatsApp IA en la prueba base.';
    }
    return 'WhatsApp + panel web. Pedidos, caja, stock, clientes y reportes.';
  }

  get doneMessage(): string {
    if (this.trialProduct === 'whatsapp') {
      return 'Escribinos por WhatsApp con el número que registraste para empezar a cargar operaciones.';
    }
    if (this.trialProduct === 'erp') {
      return 'Ingresá al panel web con tu usuario y contraseña.';
    }
    return 'Podés usar el panel web y también WhatsApp con el mismo número registrado.';
  }

  form = {
    businessName: '',
    rubro: '',
    pais: 'Uruguay',
    ciudad: '',
    ownerName: '',
    email: '',
    phoneCountryCode: DEFAULT_PHONE_DIAL,
    phone: '',
    password: '',
    acceptTerms: false,
    whatsappOptIn: false,
    marketingEmailOptIn: true,
    website: '',
  };

  ngOnInit() {
    this.restoreDraft();
    if (this.step === 'form' && !this.countries.length) {
      this.loadGeoData();
    }

    this.route.queryParamMap.subscribe((params) => {
      const producto = params.get('producto');
      if (producto && isTrialProductId(producto)) {
        this.trialProduct = producto;
        if (producto === 'whatsapp') this.form.whatsappOptIn = true;
      }
      const utmSource = params.get('utm_source');
      const utmCampaign = params.get('utm_campaign');
      if (utmSource) (this.form as { utmSource?: string }).utmSource = utmSource;
      if (utmCampaign) (this.form as { utmCampaign?: string }).utmCampaign = utmCampaign;
    });
  }

  ngOnDestroy() {
    this.persistDraft();
  }

  onLegalLinkClick(event: MouseEvent) {
    event.stopPropagation();
    this.persistDraft();
  }

  openForm() {
    this.step = 'form';
    this.persistDraft();
    if (!this.countries.length) {
      this.loadGeoData();
    }
  }

  private restoreDraft() {
    const draft = loadTrialRegisterDraft();
    if (!draft) return;

    Object.assign(this.form, draft.form);
    this.registrationId = draft.registrationId ?? '';
    this.otpCode = draft.otpCode ?? '';
    if (draft.step && draft.step !== 'intro') {
      this.step = draft.step;
    }
  }

  private persistDraft() {
    if (this.step === 'done' || this.step === 'creating') return;
    saveTrialRegisterDraft({
      step: this.step,
      form: { ...this.form },
      registrationId: this.registrationId,
      otpCode: this.otpCode,
    });
  }

  onCountrySelected(nameEs: string) {
    const country =
      this.countries.find((entry) => entry.nameEs === nameEs) ??
      this.countries.find((entry) => entry.nameEs.toLowerCase() === nameEs.trim().toLowerCase()) ??
      null;
    if (country) {
      this.applyCountry(country, true);
      this.persistDraft();
      return;
    }
    this.syncPhoneCountryFromPais(nameEs);
    this.form.ciudad = '';
    this.cityOptions = [];
  }

  private loadGeoData() {
    this.loadingCountries = true;
    this.geoError = '';
    this.locationLookup.listCountries().subscribe({
      next: (countries) => {
        this.countries = countries;
        this.countrySelectOptions = this.locationLookup.toCountrySelectOptions(countries);
        this.loadingCountries = false;

        const preferred =
          countries.find((entry) => entry.nameEs === this.form.pais) ??
          countries.find((entry) => entry.iso2 === 'UY') ??
          countries[0] ??
          null;
        if (preferred) {
          this.applyCountry(preferred, false);
        }
      },
      error: () => {
        this.loadingCountries = false;
        this.geoError = 'No se pudieron cargar los países. Revisá tu conexión y recargá la página.';
        this.syncPhoneCountryFromPais(this.form.pais);
      },
    });
  }

  private applyCountry(country: GeoCountryOption, clearCityIfChanged: boolean) {
    const countryChanged =
      clearCityIfChanged &&
      this.selectedCountryIso !== '' &&
      this.selectedCountryIso !== country.iso2;
    this.selectedCountryIso = country.iso2;
    this.form.pais = country.nameEs;
    this.form.phoneCountryCode = country.dialCode;
    if (countryChanged) {
      this.form.ciudad = '';
    }
    this.loadCities(country);
  }

  private loadCities(country: GeoCountryOption) {
    this.loadingCities = true;
    this.locationLookup.listCities(country.nameEs, country.nameEn).subscribe({
      next: (cities) => {
        this.cityOptions = cities;
        this.loadingCities = false;
      },
      error: () => {
        this.cityOptions = [];
        this.loadingCities = false;
      },
    });
  }

  private syncPhoneCountryFromPais(pais: string) {
    const fromApi = this.countries.find(
      (entry) => entry.nameEs.toLowerCase() === pais.trim().toLowerCase()
    );
    if (fromApi) {
      this.form.phoneCountryCode = fromApi.dialCode;
      return;
    }
    const dial = dialFromCountryName(pais);
    if (dial) this.form.phoneCountryCode = dial;
  }

  submitForm() {
    this.error = '';
    if (!this.form.pais.trim() || !this.form.ciudad.trim()) {
      this.error = 'Completá país y ciudad.';
      return;
    }
    if (!this.form.phone.trim()) {
      this.error = 'Ingresá tu teléfono.';
      return;
    }
    this.loading = true;
    this.trialService
      .register({
        ...this.form,
        phoneCountryCode: this.form.phoneCountryCode,
        acceptTerms: this.form.acceptTerms,
        trialProduct: this.trialProduct,
      })
      .subscribe({
        next: (res) => {
          this.registrationId = res.registrationId;
          this.persistDraft();
          this.sendOtpAndGoEmail();
        },
        error: (err) => {
          this.loading = false;
          this.error = this.readError(err);
        },
      });
  }

  private sendOtpAndGoEmail() {
    this.trialService.sendPhoneCode(this.registrationId).subscribe({
      next: (res) => {
        this.loading = false;
        this.emailSent = res.emailSent === true;
        this.devOtp = res.devCode ?? '';
        this.step = 'email';
        this.persistDraft();
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
        this.emailSent = res.emailSent === true;
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
        this.loading = false;
        this.step = 'done';
        clearTrialRegisterDraft();
      },
      error: (err) => {
        this.step = 'email';
        this.loading = false;
        this.error = this.readError(err);
      },
    });
  }

  enterApp() {
    void this.router.navigate([this.auth.homeRoute]);
  }

  private readError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return err.error?.error ?? 'No se pudo completar el registro.';
    }
    return 'No se pudo completar el registro.';
  }
}
