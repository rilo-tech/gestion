import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

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

          <p *ngIf="errorMessage" class="text-sm text-red-400">{{ errorMessage }}</p>

          <button
            type="submit"
            [disabled]="loading"
            class="w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-gray-900 hover:bg-teal-400 disabled:opacity-60">
            {{ loading ? 'Ingresando...' : 'Ingresar' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class PlatformLoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  login = '';
  password = '';
  loading = false;
  errorMessage = '';

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
}
