import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { FormFooterComponent } from '../../shared/components/form-shell/form-footer.component';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { whatsappCopyForRubro } from '../../../../../shared/whatsapp-copy.ts';
import { productLabelForAccess } from '../../../../../shared/platform-access.ts';

type AccountPanel = 'profile' | 'password' | null;

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, FormFooterComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="w-full max-w-2xl mx-auto min-w-0">
        <div class="mb-6 sm:mb-8">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{{ pageTitle }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ pageSubtitle }}
          </p>
        </div>

        <article
          *ngIf="isWhatsappHome"
          class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 mb-4">
          <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">Cómo usar RILO Bot</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Operás desde WhatsApp. Acá no hay listados: el bot confirma cada operación con SÍ o NO.
          </p>
          <p *ngIf="registeredPhone" class="text-sm text-gray-800 dark:text-gray-200 mb-3">
            Número registrado:
            <span class="font-semibold">{{ registeredPhone }}</span>
          </p>
          <p *ngIf="!registeredPhone" class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Escribí al número de RILO Bot con el WhatsApp que registraste al crear la cuenta.
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">{{ botCopy.productHint }}</p>
          <ul class="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            <li>• “{{ botCopy.exampleSale }}”</li>
            <li>• “{{ botCopy.exampleOrder }}”</li>
            <li>• “¿Cuánto debe Pedro?” / “¿Cuánto vendí hoy?”</li>
            <li>• Dudas: escribí <span class="font-semibold">Consultame</span></li>
          </ul>
        </article>

        <article class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 mb-4">
          <div class="flex items-start gap-3 sm:gap-4">
            <span
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-lg font-semibold"
              aria-hidden="true">
              {{ auth.userInitial }}
            </span>
            <div class="min-w-0 flex-1">
              <h2 class="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                {{ savedNombre }}
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ auth.currentRoleLabel }}</p>
            </div>
          </div>

          <dl *ngIf="openPanel !== 'profile'" class="mt-4 space-y-3">
            <div>
              <dt class="text-xs text-gray-500 dark:text-gray-400">Email</dt>
              <dd class="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                {{ savedEmail || 'Sin email' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 dark:text-gray-400">Usuario de acceso</dt>
              <dd class="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                {{ savedUsername || '—' }}
              </dd>
            </div>
          </dl>

          <p
            *ngIf="openPanel !== 'profile' && profileSuccessMessage"
            class="mt-3 text-sm font-medium text-teal-700 dark:text-teal-400"
            role="status">
            {{ profileSuccessMessage }}
          </p>

          <div *ngIf="openPanel !== 'profile'" class="mt-4">
            <button
              type="button"
              (click)="openProfile()"
              class="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
              <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
              Editar mis datos
            </button>
          </div>

          <form
            *ngIf="openPanel === 'profile'"
            (submit)="saveProfile(); $event.preventDefault()"
            class="mt-5 space-y-4 max-w-md">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              El rol lo cambia un administrador. El resto lo podés actualizar vos.
            </p>
            <div>
              <label class="form-label">Nombre</label>
              <input
                [(ngModel)]="profileNombre"
                name="profileNombre"
                autocomplete="name"
                class="form-control outline-none focus:ring-2 focus:ring-teal-500">
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
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Si es el mismo de Google, también podés entrar con ese botón.
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
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Es con el que ingresás junto con la contraseña.
              </p>
            </div>
            <p *ngIf="profileErrorMessage" class="text-sm text-red-600 dark:text-red-400">
              {{ profileErrorMessage }}
            </p>
            <app-form-footer
              mode="inline"
              saveLabel="Guardar cambios"
              cancelLabel="Cancelar"
              [saving]="savingProfile"
              [saveAsSubmit]="true"
              (cancelClick)="closePanel()">
            </app-form-footer>
          </form>
        </article>

        <article class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 mb-4">
          <div class="flex items-start gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              aria-hidden="true">
              <i-lucide name="lock" class="w-5 h-5"></i-lucide>
            </span>
            <div class="min-w-0 flex-1">
              <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100">Contraseña</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {{
                  requiresCurrentPassword
                    ? 'Tu cuenta ya tiene contraseña. Cambiala solo si la necesitás.'
                    : 'Todavía no tenés una. Definila para entrar con usuario y contraseña.'
                }}
              </p>
            </div>
          </div>

          <p
            *ngIf="openPanel !== 'password' && passwordSuccessMessage"
            class="mt-3 text-sm font-medium text-teal-700 dark:text-teal-400"
            role="status">
            {{ passwordSuccessMessage }}
          </p>

          <div *ngIf="openPanel !== 'password'" class="mt-4">
            <button
              type="button"
              (click)="openPassword()"
              [class]="
                requiresCurrentPassword
                  ? 'inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
                  : 'inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-700'
              ">
              {{ requiresCurrentPassword ? 'Cambiar contraseña' : 'Definir contraseña' }}
            </button>
          </div>

          <form
            *ngIf="openPanel === 'password'"
            (submit)="submitPassword(); $event.preventDefault()"
            class="mt-5 space-y-4 max-w-md">
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
              <label class="form-label">Repetir nueva contraseña</label>
              <input
                type="password"
                [(ngModel)]="confirmPassword"
                name="confirmPassword"
                autocomplete="new-password"
                class="form-control outline-none focus:ring-2 focus:ring-teal-500">
            </div>
            <p *ngIf="passwordErrorMessage" class="text-sm text-red-600 dark:text-red-400">
              {{ passwordErrorMessage }}
            </p>
            <app-form-footer
              mode="inline"
              [saveLabel]="requiresCurrentPassword ? 'Actualizar contraseña' : 'Guardar contraseña'"
              cancelLabel="Cancelar"
              [saving]="savingPassword"
              [saveAsSubmit]="true"
              (cancelClick)="closePanel()">
            </app-form-footer>
          </form>
        </article>

        <a
          *ngIf="!auth.isPlatformAdmin"
          routerLink="/apariencia"
          class="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:px-6 sm:py-4 mb-4 hover:border-teal-200 hover:bg-teal-50/40 dark:hover:border-teal-800 dark:hover:bg-teal-950/30 transition-colors">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            aria-hidden="true">
            <i-lucide [name]="theme.preference() === 'dark' ? 'sun' : 'moon'" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-gray-900 dark:text-gray-100">Apariencia</span>
            <span class="block text-sm text-gray-500 dark:text-gray-400">Claro, oscuro o el del celular.</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 shrink-0 text-gray-400"></i-lucide>
        </a>

        <section *ngIf="auth.isSupervisor && !auth.isPlatformAdmin" class="mt-6">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2 px-0.5">
            Empresa
          </h2>
          <a
            routerLink="/plan"
            class="flex items-start gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:px-6 sm:py-5 hover:border-teal-200 hover:bg-teal-50/40 dark:hover:border-teal-800 dark:hover:bg-teal-950/30 transition-colors">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
              aria-hidden="true">
              <i-lucide name="credit-card" class="w-5 h-5"></i-lucide>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-bold text-gray-900 dark:text-gray-100">Plan y suscripción</span>
              <span class="block text-sm text-gray-800 dark:text-gray-200 mt-0.5">{{ planProductLabel }}</span>
              <span class="block text-sm text-gray-500 dark:text-gray-400 mt-1">
                RILO Gestión {{ erpChannelLabel }} · RILO Bot {{ rilobotChannelLabel }}
              </span>
              <span class="mt-2 inline-flex text-sm font-semibold text-teal-700 dark:text-teal-400">
                Administrar plan
              </span>
            </span>
            <i-lucide name="chevron-right" class="w-5 h-5 shrink-0 text-gray-400 mt-1"></i-lucide>
          </a>
        </section>
      </div>
    </div>
  `,
})
export class AccountComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly pageShellClass = PAGE_SHELL_CLASS;

  openPanel: AccountPanel = null;

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

  private successTimer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.loadProfileFromSession();
  }

  ngOnDestroy() {
    this.clearSuccessTimer();
  }

  get requiresCurrentPassword(): boolean {
    return this.auth.currentUser?.hasPassword !== false;
  }

  get isWhatsappHome(): boolean {
    return !this.auth.isPlatformAdmin && this.auth.canAccessWhatsapp && !this.auth.canAccessErpWeb;
  }

  get pageTitle(): string {
    return this.isWhatsappHome ? 'Inicio' : 'Mi cuenta';
  }

  get pageSubtitle(): string {
    if (this.isWhatsappHome) {
      return 'Tu negocio está activo. El trabajo del día a día es por WhatsApp.';
    }
    return 'Tus datos de acceso. Editá solo lo que necesites.';
  }

  get registeredPhone(): string {
    return this.auth.currentBusiness?.contactVerification?.phone?.trim() ?? '';
  }

  get botCopy() {
    return whatsappCopyForRubro(this.auth.currentBusiness?.lifecycle?.rubro);
  }

  get savedNombre(): string {
    return this.auth.currentUserName;
  }

  get savedEmail(): string {
    return this.auth.currentUser?.email?.trim() ?? '';
  }

  get savedUsername(): string {
    return this.auth.currentUser?.loginUsername?.trim() ?? '';
  }

  get planProductLabel(): string {
    return productLabelForAccess(this.auth.platformAccess);
  }

  get erpChannelLabel(): string {
    if (this.auth.canAccessErpWeb) return 'activo';
    if (this.auth.isErpPaused) return 'inactivo';
    return 'no incluido';
  }

  get rilobotChannelLabel(): string {
    if (this.auth.canAccessWhatsapp) return 'activo';
    if (this.auth.isWhatsappPaused) return 'inactivo';
    return 'no incluido';
  }

  openProfile() {
    this.loadProfileFromSession();
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';
    this.resetPasswordFields();
    this.openPanel = 'profile';
  }

  openPassword() {
    this.resetPasswordFields();
    this.passwordErrorMessage = '';
    this.passwordSuccessMessage = '';
    this.loadProfileFromSession();
    this.openPanel = 'password';
  }

  closePanel() {
    this.loadProfileFromSession();
    this.resetPasswordFields();
    this.profileErrorMessage = '';
    this.passwordErrorMessage = '';
    this.openPanel = null;
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
          this.openPanel = null;
          this.showTimedSuccess(
            'profile',
            email
              ? 'Listo. Ya podés entrar con Google o con ese email como usuario.'
              : 'Tus datos se actualizaron.'
          );
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
          this.resetPasswordFields();
          this.openPanel = null;
          this.showTimedSuccess('password', 'Contraseña actualizada.');
        },
        error: (err) => {
          this.savingPassword = false;
          this.passwordErrorMessage = err?.error?.error || 'No se pudo actualizar la contraseña.';
        },
      });
  }

  private resetPasswordFields() {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
  }

  private showTimedSuccess(kind: 'profile' | 'password', message: string) {
    this.clearSuccessTimer();
    if (kind === 'profile') {
      this.profileSuccessMessage = message;
      this.passwordSuccessMessage = '';
    } else {
      this.passwordSuccessMessage = message;
      this.profileSuccessMessage = '';
    }
    this.successTimer = setTimeout(() => {
      this.profileSuccessMessage = '';
      this.passwordSuccessMessage = '';
    }, 4000);
  }

  private clearSuccessTimer() {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = undefined;
    }
  }
}
