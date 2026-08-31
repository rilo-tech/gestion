import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { mapGoogleAuthError } from '../../core/utils/google-auth-error';
import { isAuthEmulatorEnabled, isFirebaseClientConfigured } from '../../core/config/firebase';
import { GOOGLE_LOGIN_BUSINESS_KEY, GOOGLE_LOGIN_SCOPE_KEY, GOOGLE_LOGIN_UI_ENABLED } from '../../core/constants/google-auth-storage';
import { hasPendingGoogleLogin } from '../../core/utils/google-auth-redirect';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, TimeoutError, Observable } from 'rxjs';
import {
  API_HTML_RESPONSE_MESSAGE,
  isHtmlInsteadOfJsonError,
} from '../../core/utils/api-response-error';
import { PasswordInputComponent } from '../../shared/components/password-input/password-input.component';
import { RitotechPublicShellComponent } from '../public/ritotech-public-shell.component';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  createAuthenticatedLoginPipeline,
  isLoginNavigationFailure,
  LOGIN_FLOW_TIMEOUT_MS,
} from './login-flow';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PasswordInputComponent, RitotechPublicShellComponent],
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
    <app-ritotech-public-shell>
    <section class="max-w-md mx-auto px-4 py-10 sm:py-14">
      <div class="rounded-2xl border border-white/10 bg-gray-900/80 p-6 sm:p-8 shadow-2xl">
        <div class="mb-8 text-center">
          <h1 class="sr-only">Ingresar</h1>
          <img
            src="/brand/rilotech-lockup-on-dark.png"
            alt="RiloTech"
            width="128"
            height="128"
            class="h-20 sm:h-24 w-auto mx-auto object-contain"
            decoding="async" />
          <p class="text-sm text-gray-400 mt-2">Ingresá para continuar</p>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Si usás RILO Bot, operás por WhatsApp. Acá ves tu cuenta o RILO Gestión, según el plan.
          </p>
        </div>

        <form (ngSubmit)="submitPasswordLogin()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Usuario</label>
            <input
              [(ngModel)]="username"
              name="username"
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

          <details
            *ngIf="loginDebugDetail"
            class="rounded-lg border border-gray-800 bg-gray-950/80 p-3 text-xs text-gray-400">
            <summary class="cursor-pointer text-gray-300 select-none">
              Detalle técnico (para DevTools / soporte)
            </summary>
            <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">{{ loginDebugDetail }}</pre>
          </details>

          <button
            type="submit"
            [disabled]="submitting || (googleLoginUiEnabled && googleRedirectPending)"
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

        <p class="mt-8 pt-6 border-t border-gray-800 text-center text-sm text-gray-400">
          ¿Todavía no tenés cuenta?
          <a routerLink="/registro" [queryParams]="{ producto: 'completo' }" class="text-teal-400 font-semibold hover:underline">Probar {{ trialDays }} días</a>
        </p>
      </div>
    </section>
    </app-ritotech-public-shell>
  `,
})
export class LoginComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  readonly isAuthEmulatorEnabled = isAuthEmulatorEnabled;
  readonly isFirebaseClientConfigured = isFirebaseClientConfigured;
  readonly googleLoginUiEnabled = GOOGLE_LOGIN_UI_ENABLED;
  readonly trialDays = DEFAULT_TRIAL_DAYS;

  businessCode = '';
  username = '';
  password = '';
  submitting = false;
  googleRedirectPending = false;
  errorMessage = '';
  loginDebugDetail = '';
  subscriptionBlockedMessage = '';
  sessionExpiredMessage = '';

  private loginWatchdog: ReturnType<typeof setTimeout> | null = null;
  private loginFlowSub: Subscription | null = null;

  ngOnInit(): void {
    this.submitting = false;
    this.googleRedirectPending = false;

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
      sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
      sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
      return;
    }
    if (pendingBusinessId && !this.googleLoginUiEnabled) {
      sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
      sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
      this.businessCode = pendingBusinessId;
      return;
    }
    if (pendingBusinessId) {
      this.businessCode = pendingBusinessId;
      this.googleRedirectPending = true;
      this.errorMessage = '';
    }

    if (!hasPendingGoogleLogin()) return;

    this.submitting = true;
    this.startLoginWatchdog();
    this.runAuthenticatedLogin(this.auth.completeGoogleRedirectLogin(), () => {
      this.googleRedirectPending = false;
    });
  }

  ngOnDestroy(): void {
    this.loginFlowSub?.unsubscribe();
    this.clearLoginWatchdog();
  }

  submitPasswordLogin(): void {
    if (this.submitting) return;

    if (!this.username.trim() || !this.password) {
      this.errorMessage = 'Ingresá usuario y contraseña.';
      this.cdr.markForCheck();
      return;
    }

    if (!this.businessCode.trim()) {
      this.errorMessage = 'Ingresá el código de tu empresa.';
      this.cdr.markForCheck();
      return;
    }

    sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
    sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
    this.googleRedirectPending = false;
    this.errorMessage = '';
    this.loginDebugDetail = '';
    console.info('[login:start]');
    this.submitting = true;
    this.cdr.markForCheck();
    this.startLoginWatchdog();

    this.runAuthenticatedLogin(
      this.auth.login(this.username.trim(), this.password, {
        businessId: this.businessCode.trim().toLowerCase(),
        scope: 'company',
      })
    );
  }

  submitGoogleLogin(): void {
    if (!this.businessCode.trim()) {
      this.errorMessage = 'Ingresá el código de tu empresa para usar Google.';
      return;
    }

    if (!this.isFirebaseClientConfigured && !isAuthEmulatorEnabled) {
      this.errorMessage =
        'Google no está configurado. Agregá VITE_FIREBASE_API_KEY al .env de la raíz del proyecto y reiniciá npm run dev.';
      return;
    }

    this.errorMessage = '';
    this.submitting = true;
    console.info('[login:start]');
    this.startLoginWatchdog();
    this.runAuthenticatedLogin(this.auth.loginWithGoogle(this.businessCode.trim().toLowerCase()), () => {
      this.googleRedirectPending = false;
    });
  }

  /** Login HTTP + navegación Angular — un único flujo RxJS. */
  private runAuthenticatedLogin(login$: Observable<unknown>, onSuccess?: () => void): void {
    this.loginFlowSub?.unsubscribe();
    this.loginFlowSub = createAuthenticatedLoginPipeline(login$, {
      homeRoute: () => this.auth.homeRoute,
      navigateByUrl: (url) => this.navigateToAuthenticatedHome(url),
      currentUrl: () => this.router.url,
      onHttpResponse: () => console.info('[login:http:response]'),
      onHomeRoute: (route) => console.info('[login:home-route]', { route }),
      onNavigateStart: (target) => console.info('[login:navigate:start]', { target }),
      onNavigateEnd: (target, ok, url) => console.info('[login:navigate:end]', { target, ok, url }),
      onFinally: () => {
        console.info('[login:finally]');
        this.submitting = false;
        this.clearLoginWatchdog();
        this.cdr.markForCheck();
      },
    }).subscribe({
      next: () => onSuccess?.(),
      error: (err) => this.handleLoginFlowError(err),
    });
  }

  private navigateToAuthenticatedHome(target: string): Promise<boolean> {
    return this.router.navigateByUrl(target, { replaceUrl: true });
  }

  private handleLoginFlowError(err: unknown): void {
    if ((err as { message?: string })?.message === 'NO_REDIRECT') {
      this.googleRedirectPending = false;
      sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
      sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
      this.errorMessage =
        'Google no devolvió la sesión al volver. Probá de nuevo o ingresá con usuario y contraseña.';
    } else if (isLoginNavigationFailure(err)) {
      this.errorMessage = 'No pudimos abrir tu inicio. Intentá nuevamente.';
    } else {
      this.errorMessage = this.mapLoginError(err);
      this.loginDebugDetail = this.formatLoginDebug(err);
    }
    console.error('[login:error]', err);
    this.cdr.markForCheck();
  }

  private formatLoginDebug(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body =
        typeof err.error === 'string'
          ? err.error.slice(0, 400)
          : JSON.stringify(err.error ?? {}).slice(0, 400);
      return `HTTP ${err.status} ${err.statusText}\nURL: ${err.url ?? '/api/auth/login'}\n${body}`;
    }
    if (err instanceof TimeoutError || (err as { name?: string })?.name === 'TimeoutError') {
      return `Timeout: el flujo superó ${LOGIN_FLOW_TIMEOUT_MS / 1000}s (login + navegación).`;
    }
    if (err instanceof Error) {
      return `${err.name}: ${err.message}`;
    }
    return String(err);
  }

  private clearLoginWatchdog(): void {
    if (this.loginWatchdog) {
      clearTimeout(this.loginWatchdog);
      this.loginWatchdog = null;
    }
  }

  /** Cubre login HTTP + navegación; no resetea submitting (lo hace finalize). */
  private startLoginWatchdog(): void {
    this.clearLoginWatchdog();
    this.loginWatchdog = setTimeout(() => {
      if (!this.submitting) return;
      this.loginDebugDetail =
        'El flujo sigue en curso (>12s). Revisá F12 → Red: POST /api/auth/login y consola [login:navigate:end].';
      this.cdr.markForCheck();
    }, 12_000);
  }

  private mapLoginError(err: unknown): string {
    if (err instanceof TimeoutError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'TimeoutError')) {
      return 'No pudimos ingresar. Revisá tu conexión o intentá nuevamente.';
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
}
