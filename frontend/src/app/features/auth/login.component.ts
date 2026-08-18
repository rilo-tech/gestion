import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { mapGoogleAuthError } from '../../core/utils/google-auth-error';
import { isAuthEmulatorEnabled, isFirebaseClientConfigured } from '../../core/config/firebase';
import { GOOGLE_LOGIN_BUSINESS_KEY, GOOGLE_LOGIN_SCOPE_KEY, GOOGLE_LOGIN_UI_ENABLED } from '../../core/constants/google-auth-storage';
import { hasPendingGoogleLogin } from '../../core/utils/google-auth-redirect';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
  API_HTML_RESPONSE_MESSAGE,
  isHtmlInsteadOfJsonError,
} from '../../core/utils/api-response-error';
import { PasswordInputComponent } from '../../shared/components/password-input/password-input.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PasswordInputComponent],
  styles: [
    `
      .login-field:-webkit-autofill,
      .login-field:-webkit-autofill:hover,
      .login-field:-webkit-autofill:focus {
        -webkit-text-fill-color: #fff;
        box-shadow: 0 0 0 1000px #030712 inset;
        caret-color: #fff;
      }
    `,
  ],
  template: `
    <div class="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div class="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-8 shadow-2xl">
        <div class="mb-8 text-center">
          <img
            src="/brand/rilotech-lockup-on-dark.png"
            alt="RiloTech"
            width="240"
            height="80"
            class="mx-auto mt-1 h-20 w-auto object-contain sm:h-24"
            decoding="async" />
          <p class="text-sm text-gray-400 mt-1.5">Ingresá para continuar</p>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Si usás RiloBot, operás por WhatsApp. Acá ves tu cuenta o el panel, según el plan.
          </p>
        </div>

        <form (submit)="submitPasswordLogin(); $event.preventDefault()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Usuario</label>
            <input
              [(ngModel)]="login"
              name="login"
              autocomplete="username"
              class="login-field w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1" for="login-password">Contraseña</label>
            <app-password-input
              inputId="login-password"
              [(ngModel)]="password"
              name="password"
              autocomplete="current-password"
              inputClass="login-field text-white">
            </app-password-input>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Empresa</label>
            <input
              [(ngModel)]="businessCode"
              name="businessCode"
              placeholder="Ej: rilo, fs"
              autocomplete="organization"
              class="login-field w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
            <p class="mt-1 text-xs text-gray-500">Código que te dio RILO al contratar el servicio.</p>
          </div>

          <p *ngIf="googleRedirectPending" class="text-sm text-amber-400">
            Completando login con Google...
          </p>

          <p *ngIf="sessionExpiredMessage" class="text-sm text-amber-400">
            {{ sessionExpiredMessage }}
          </p>

          <p *ngIf="subscriptionBlockedMessage" class="text-sm text-amber-400">
            {{ subscriptionBlockedMessage }}
          </p>

          <p *ngIf="errorMessage" class="text-sm text-red-400">{{ errorMessage }}</p>

          <button
            type="submit"
            [disabled]="submitting || googleRedirectPending"
            class="w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-gray-900 hover:bg-teal-400 disabled:opacity-60">
            {{ submitting ? 'Ingresando...' : 'Ingresar' }}
          </button>
          <p *ngIf="submitting" class="text-xs text-center text-gray-500">
            Esperá unos segundos. Si no responde, vas a ver el error acá.
          </p>
        </form>

        <div *ngIf="googleLoginUiEnabled" class="my-6 flex items-center gap-3">
          <div class="h-px flex-1 bg-gray-800"></div>
          <span class="text-xs text-gray-500 uppercase">o</span>
          <div class="h-px flex-1 bg-gray-800"></div>
        </div>

        <button
          *ngIf="googleLoginUiEnabled"
          type="button"
          (click)="submitGoogleLogin()"
          [disabled]="submitting || googleRedirectPending"
          class="w-full rounded-xl border border-gray-700 bg-gray-950 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60">
          {{ googleRedirectPending ? 'Volviendo de Google...' : 'Continuar con Google' }}
        </button>

        <p *ngIf="googleLoginUiEnabled" class="mt-6 text-xs text-center text-gray-500 leading-relaxed">
          Cargá el código de empresa antes de usar Google. Tu email debe estar registrado en Mi cuenta.
        </p>

        <p *ngIf="googleLoginUiEnabled && !isFirebaseClientConfigured && !isAuthEmulatorEnabled" class="mt-3 text-xs text-center text-amber-500/90 leading-relaxed">
          Google no está configurado: falta <span class="font-mono">VITE_FIREBASE_API_KEY</span> en el
          <span class="font-mono">.env</span> de la raíz del repo. Reiniciá el servidor después de guardarlo.
        </p>

        <p *ngIf="googleLoginUiEnabled && isAuthEmulatorEnabled" class="mt-3 text-xs text-center text-amber-500/90 leading-relaxed">
          Modo desarrollo: Google usa el emulador local (no es la cuenta real). Tras confirmar el email
          volvés al login y entrás automáticamente.
        </p>

        <p class="mt-8 pt-6 border-t border-gray-800 text-center text-sm text-gray-400">
          ¿Querés probar el sistema?
          <a routerLink="/registro" class="text-teal-400 font-semibold hover:underline">30 días gratis</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly isAuthEmulatorEnabled = isAuthEmulatorEnabled;
  readonly isFirebaseClientConfigured = isFirebaseClientConfigured;
  readonly googleLoginUiEnabled = GOOGLE_LOGIN_UI_ENABLED;

  businessCode = '';
  login = '';
  password = '';
  submitting = false;
  googleRedirectPending = false;
  errorMessage = '';
  subscriptionBlockedMessage = '';
  sessionExpiredMessage = '';

  private mapLoginError(err: unknown): string {
    if (err instanceof TimeoutError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'TimeoutError')) {
      return 'El servidor tardó demasiado en responder. Probá de nuevo.';
    }

    if (isHtmlInsteadOfJsonError(err)) {
      return API_HTML_RESPONSE_MESSAGE;
    }

    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.';
      }

      const backendMessage =
        (typeof err.error === 'object' &&
          err.error !== null &&
          'error' in err.error &&
          typeof (err.error as { error?: unknown }).error === 'string' &&
          (err.error as { error: string }).error) ||
        (typeof err.error === 'string' ? err.error : '') ||
        '';
      if (backendMessage && !backendMessage.trim().startsWith('<')) return backendMessage;

      if (err.status === 401) {
        return 'Usuario, contraseña o código de empresa incorrectos.';
      }
      if (err.status === 404) {
        return 'No encontramos esa empresa. Revisá el código (ej: prueba).';
      }
      if (err.status >= 500) {
        return 'El servidor tuvo un problema al ingresar. Probá de nuevo en un momento.';
      }
    }

    const message =
      typeof err === 'object' &&
      err !== null &&
      'message' in err &&
      typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '';
    return message || 'No se pudo iniciar sesión.';
  }

  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('session') === 'expired') {
      this.sessionExpiredMessage =
        'Tu sesión venció. Volvé a ingresar con tu usuario y contraseña.';
    }

    if (this.route.snapshot.queryParamMap.get('subscription') === 'inactive') {
      this.subscriptionBlockedMessage =
        'La suscripción de tu empresa está desactivada. Contactá a RILO para reactivarla.';
    }

    const pendingBusinessId = sessionStorage.getItem(GOOGLE_LOGIN_BUSINESS_KEY);
    const pendingScope = sessionStorage.getItem(GOOGLE_LOGIN_SCOPE_KEY);
    if (pendingScope === 'platform') {
      return;
    }
    if (pendingBusinessId) {
      this.businessCode = pendingBusinessId;
      this.googleRedirectPending = true;
      this.errorMessage = '';
    }

    if (!hasPendingGoogleLogin()) {
      return;
    }

    this.auth.completeGoogleRedirectLogin().subscribe({
      next: () => {
        this.googleRedirectPending = false;
        this.router.navigate([this.auth.homeRoute]);
      },
      error: (err) => {
        this.googleRedirectPending = false;
        if (err?.message === 'NO_REDIRECT') {
          if (pendingBusinessId) {
            this.errorMessage =
              'Google no devolvió la sesión al volver. Probá de nuevo (debería abrirse una ventana de Google). Si persiste, ingresá con usuario y contraseña.';
          }
          sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
          sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
          return;
        }
        sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
        sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
        this.errorMessage = this.mapLoginError(err) || mapGoogleAuthError(err);
      },
    });
  }

  submitPasswordLogin() {
    if (!this.login.trim() || !this.password) {
      this.errorMessage = 'Ingresá usuario y contraseña.';
      return;
    }

    if (!this.businessCode.trim()) {
      this.errorMessage = 'Ingresá el código de tu empresa.';
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    this.auth
      .login(this.login.trim(), this.password, {
        businessId: this.businessCode.trim().toLowerCase(),
        scope: 'company',
      })
      .pipe(finalize(() => {
        this.submitting = false;
      }))
      .subscribe({
        next: () => {
          void this.router.navigateByUrl(this.auth.homeRoute);
        },
        error: (err) => {
          this.errorMessage = this.mapLoginError(err);
        },
      });
  }

  submitGoogleLogin() {
    if (!this.businessCode.trim()) {
      this.errorMessage = 'Ingresá el código de tu empresa para usar Google.';
      return;
    }

    if (!this.isFirebaseClientConfigured && !this.isAuthEmulatorEnabled) {
      this.errorMessage =
        'Google no está configurado. Agregá VITE_FIREBASE_API_KEY al .env de la raíz del proyecto y reiniciá npm run dev.';
      return;
    }

    this.errorMessage = '';
    this.auth.loginWithGoogle(this.businessCode.trim().toLowerCase()).subscribe({
      next: () => {
        this.router.navigate([this.auth.homeRoute]);
      },
      error: (err) => {
        this.googleRedirectPending = false;
        sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
        this.errorMessage = this.mapLoginError(err) || mapGoogleAuthError(err);
      },
    });
  }
}
