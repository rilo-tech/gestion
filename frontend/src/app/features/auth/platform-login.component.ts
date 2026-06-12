import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { mapGoogleAuthError } from '../../core/utils/google-auth-error';
import { isAuthEmulatorEnabled } from '../../core/config/firebase';
import { GOOGLE_LOGIN_SCOPE_KEY } from '../../core/constants/google-auth-storage';
import { hasPendingGoogleLogin } from '../../core/utils/google-auth-redirect';

@Component({
  selector: 'app-platform-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div class="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-8 shadow-2xl">
        <div class="mb-8 text-center">
          <h1 class="text-2xl font-bold text-teal-400 tracking-tight">RILO Plataforma</h1>
          <p class="text-sm text-gray-400 mt-2">Acceso interno de administración</p>
        </div>

        <form (submit)="submit(); $event.preventDefault()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Usuario</label>
            <input
              [(ngModel)]="login"
              name="login"
              autocomplete="username"
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Contraseña</label>
            <input
              type="password"
              [(ngModel)]="password"
              name="password"
              autocomplete="current-password"
              class="w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-950 text-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <p *ngIf="googleRedirectPending" class="text-sm text-amber-400">
            Completando login con Google...
          </p>

          <p *ngIf="errorMessage" class="text-sm text-red-400">{{ errorMessage }}</p>

          <button
            type="submit"
            [disabled]="loading || googleRedirectPending"
            class="w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-gray-900 hover:bg-teal-400 disabled:opacity-60">
            {{ loading ? 'Ingresando...' : 'Ingresar' }}
          </button>
        </form>

        <div class="my-6 flex items-center gap-3">
          <div class="h-px flex-1 bg-gray-800"></div>
          <span class="text-xs text-gray-500 uppercase">o</span>
          <div class="h-px flex-1 bg-gray-800"></div>
        </div>

        <button
          type="button"
          (click)="submitGoogleLogin()"
          [disabled]="loading || googleRedirectPending"
          class="w-full rounded-xl border border-gray-700 bg-gray-950 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60">
          {{ googleRedirectPending ? 'Volviendo de Google...' : 'Continuar con Google' }}
        </button>

        <p class="mt-6 text-xs text-center text-gray-500 leading-relaxed">
          Tu email de Google debe estar registrado en el superadmin de plataforma. Podés cargarlo en Mi cuenta
          después del primer ingreso con contraseña.
        </p>

        <p *ngIf="isAuthEmulatorEnabled" class="mt-3 text-xs text-center text-amber-500/90 leading-relaxed">
          Modo desarrollo: Google usa el emulador local (no es la cuenta real). Tras confirmar el email
          volvés acá y entrás automáticamente.
        </p>
      </div>
    </div>
  `,
})
export class PlatformLoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly isAuthEmulatorEnabled = isAuthEmulatorEnabled;

  login = '';
  password = '';
  loading = false;
  googleRedirectPending = false;
  errorMessage = '';

  ngOnInit() {
    if (sessionStorage.getItem(GOOGLE_LOGIN_SCOPE_KEY) === 'platform') {
      this.googleRedirectPending = true;
      this.errorMessage = '';
    }

    if (!hasPendingGoogleLogin()) {
      return;
    }

    this.auth.completeGoogleRedirectLogin().subscribe({
      next: () => {
        this.googleRedirectPending = false;
        this.router.navigate(['/platform']);
      },
      error: (err) => {
        this.googleRedirectPending = false;
        if (err?.message === 'NO_REDIRECT') {
          return;
        }
        this.errorMessage =
          err?.error?.error || mapGoogleAuthError(err) || 'No se pudo ingresar con Google.';
      },
    });
  }

  submit() {
    if (!this.login.trim() || !this.password) {
      this.errorMessage = 'Ingresá usuario y contraseña.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    this.auth
      .login(this.login.trim(), this.password, { scope: 'platform' })
      .subscribe({
        next: () => {
          this.loading = false;
          this.router.navigate(['/platform']);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err?.error?.error || 'No se pudo iniciar sesión.';
        },
      });
  }

  submitGoogleLogin() {
    this.errorMessage = '';
    this.auth.loginWithGooglePlatform().subscribe({
      next: () => {
        this.router.navigate(['/platform']);
      },
      error: (err) => {
        this.googleRedirectPending = false;
        sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
        this.errorMessage = mapGoogleAuthError(err);
      },
    });
  }
}
