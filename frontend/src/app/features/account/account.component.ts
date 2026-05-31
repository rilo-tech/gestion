import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 w-full max-w-2xl mx-auto">
      <div class="mb-6 sm:mb-8">
        <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Mi cuenta</h1>
        <p class="text-sm sm:text-base text-gray-500 mt-1 desc-lg-only">
          Datos de tu sesión y seguridad de acceso.
        </p>
      </div>

      <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 mb-6">
        <h2 class="text-sm font-bold text-gray-900 mb-1">Tu perfil</h2>
        <p class="text-sm text-gray-500 mb-4">
          Podés cambiar tu nombre y usuario de acceso. El rol solo lo modifica un administrador.
        </p>

        <form (submit)="saveProfile(); $event.preventDefault()" class="space-y-4 max-w-md">
          <div>
            <label class="form-label">Nombre</label>
            <input
              [(ngModel)]="profileNombre"
              name="profileNombre"
              autocomplete="name"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <div>
            <label class="form-label">Rol</label>
            <p class="px-4 py-2.5 rounded-lg border border-gray-100 bg-gray-50 text-sm font-medium text-gray-700">
              {{ auth.currentRoleLabel }}
            </p>
          </div>

          <div>
            <label class="form-label">Email</label>
            <input
              type="email"
              [(ngModel)]="profileEmail"
              name="profileEmail"
              autocomplete="email"
              placeholder="tu.email@gmail.com"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
            <p class="text-xs text-gray-500 mt-1.5">
              <ng-container *ngIf="auth.isPlatformAdmin">
                Si cargás acá el mismo email de Google, la próxima vez podés ingresar con Google en
                acceso plataforma.
              </ng-container>
              <ng-container *ngIf="!auth.isPlatformAdmin">
                Si cargás acá el mismo email de Google, la próxima vez podés ingresar con el botón de Google
                o usando ese email como usuario.
              </ng-container>
            </p>
          </div>

          <div>
            <label class="form-label">Usuario de acceso</label>
            <input
              [(ngModel)]="profileLoginUsername"
              name="profileLoginUsername"
              autocomplete="username"
              placeholder="Ej. admin"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
            <p class="text-xs text-gray-500 mt-1.5">
              Es el nombre con el que ingresás junto con la contraseña.
            </p>
          </div>

          <p *ngIf="profileErrorMessage" class="text-sm text-red-600">{{ profileErrorMessage }}</p>
          <p *ngIf="profileSuccessMessage" class="text-sm text-teal-700">{{ profileSuccessMessage }}</p>

          <div class="form-actions pt-2">
            <button
              type="submit"
              [disabled]="savingProfile"
              class="form-btn-primary rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingProfile ? 'Guardando...' : 'Guardar perfil' }}
            </button>
          </div>
        </form>
      </article>

      <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <h2 class="text-sm font-bold text-gray-900">Contraseña</h2>
        <p class="text-sm text-gray-500 mt-1 mb-4">
          {{
            requiresCurrentPassword
              ? 'Ingresá tu contraseña actual y elegí una nueva.'
              : 'Todavía no tenés contraseña. Definí una para poder ingresar con usuario y contraseña.'
          }}
        </p>

        <form (submit)="submitPassword(); $event.preventDefault()" class="space-y-4 max-w-md">
          <div *ngIf="requiresCurrentPassword">
            <label class="form-label">Contraseña actual</label>
            <input
              type="password"
              [(ngModel)]="currentPassword"
              name="currentPassword"
              autocomplete="current-password"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <div>
            <label class="form-label">Nueva contraseña</label>
            <input
              type="password"
              [(ngModel)]="newPassword"
              name="newPassword"
              autocomplete="new-password"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <div>
            <label class="form-label">Confirmar nueva contraseña</label>
            <input
              type="password"
              [(ngModel)]="confirmPassword"
              name="confirmPassword"
              autocomplete="new-password"
              class="form-control outline-none focus:ring-2 focus:ring-teal-500">
          </div>

          <p *ngIf="passwordErrorMessage" class="text-sm text-red-600">{{ passwordErrorMessage }}</p>
          <p *ngIf="passwordSuccessMessage" class="text-sm text-teal-700">{{ passwordSuccessMessage }}</p>

          <div class="form-actions pt-2">
            <button
              type="submit"
              [disabled]="savingPassword"
              class="form-btn-primary rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingPassword ? 'Guardando...' : 'Actualizar contraseña' }}
            </button>
          </div>
        </form>
      </article>

      <p *ngIf="!auth.isPlatformAdmin" class="mt-6 text-sm text-gray-500">
        También podés cambiar el tema en
        <a routerLink="/apariencia" class="text-teal-700 font-medium hover:underline">
          Apariencia
        </a>.
      </p>
    </div>
  `,
})
export class AccountComponent implements OnInit {
  readonly auth = inject(AuthService);

  profileNombre = '';
  profileEmail = '';
  profileLoginUsername = '';
  savingProfile = false;
  profileErrorMessage = '';
  profileSuccessMessage = '';

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  savingPassword = false;
  passwordErrorMessage = '';
  passwordSuccessMessage = '';

  ngOnInit() {
    this.loadProfileFromSession();
  }

  get requiresCurrentPassword(): boolean {
    return this.auth.currentUser?.hasPassword !== false;
  }

  loadProfileFromSession() {
    const user = this.auth.currentUser;
    this.profileNombre = user?.nombre?.trim() ?? '';
    this.profileEmail = user?.email?.trim() ?? '';
    this.profileLoginUsername = user?.loginUsername?.trim() ?? '';
  }

  saveProfile() {
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';

    const nombre = this.profileNombre.trim();
    const email = this.profileEmail.trim();
    const loginUsername = this.profileLoginUsername.trim().toLowerCase();

    if (!nombre) {
      this.profileErrorMessage = 'Ingresá tu nombre.';
      return;
    }

    if (!loginUsername) {
      this.profileErrorMessage = 'Ingresá tu usuario de acceso.';
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.profileErrorMessage = 'Ingresá un email válido.';
      return;
    }

    this.savingProfile = true;
    this.auth
      .updateProfile({
        nombre,
        email,
        loginUsername,
      })
      .subscribe({
        next: () => {
          this.savingProfile = false;
          this.loadProfileFromSession();
          this.profileSuccessMessage = email
            ? 'Perfil actualizado. Ya podés ingresar con Google o con ese email como usuario.'
            : 'Perfil actualizado correctamente.';
        },
        error: (err) => {
          this.savingProfile = false;
          this.profileErrorMessage = err?.error?.error || 'No se pudo actualizar el perfil.';
        },
      });
  }

  submitPassword() {
    this.passwordErrorMessage = '';
    this.passwordSuccessMessage = '';

    const newPassword = this.newPassword.trim();
    const confirmPassword = this.confirmPassword.trim();

    if (this.requiresCurrentPassword && !this.currentPassword) {
      this.passwordErrorMessage = 'Ingresá tu contraseña actual.';
      return;
    }

    if (!newPassword) {
      this.passwordErrorMessage = 'Ingresá la nueva contraseña.';
      return;
    }

    if (newPassword.length < 4) {
      this.passwordErrorMessage = 'La contraseña debe tener al menos 4 caracteres.';
      return;
    }

    if (newPassword !== confirmPassword) {
      this.passwordErrorMessage = 'Las contraseñas nuevas no coinciden.';
      return;
    }

    this.savingPassword = true;
    this.auth
      .changePassword({
        currentPassword: this.requiresCurrentPassword ? this.currentPassword : undefined,
        newPassword,
      })
      .subscribe({
        next: () => {
          this.savingPassword = false;
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.passwordSuccessMessage = 'Contraseña actualizada correctamente.';
        },
        error: (err) => {
          this.savingPassword = false;
          this.passwordErrorMessage = err?.error?.error || 'No se pudo actualizar la contraseña.';
        },
      });
  }
}
