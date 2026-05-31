import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { ThemeService } from '../../../core/services/theme.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <header
      class="relative z-50 h-14 shrink-0 border-b border-gray-100 bg-white/90 backdrop-blur-sm px-3 sm:px-6 flex items-center justify-between gap-3">
      <button
        type="button"
        class="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-600 hover:bg-gray-100"
        [attr.aria-label]="nav.mobileMenuOpen() ? 'Cerrar menú' : 'Abrir menú'"
        [attr.aria-expanded]="nav.mobileMenuOpen()"
        (click)="nav.toggleMobileMenu()">
        <i-lucide [name]="nav.mobileMenuOpen() ? 'x' : 'menu'" class="w-5 h-5"></i-lucide>
      </button>

      <div class="flex-1 min-w-0 lg:hidden">
        <p class="text-sm font-semibold text-gray-900 truncate">{{ auth.appBrandTitle }}</p>
      </div>

      <div class="inline-flex items-center gap-1.5 sm:gap-2.5 ml-auto">
        <button
          *ngIf="auth.canManageSettings"
          type="button"
          (click)="openSettings()"
          title="Configuración"
          class="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <i-lucide name="settings" class="w-4 h-4"></i-lucide>
        </button>

        <button
          type="button"
          (click)="openAppearance()"
          [title]="theme.preference() === 'dark' ? 'Apariencia · fondo oscuro activo' : 'Apariencia · fondo claro activo'"
          class="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <i-lucide [name]="theme.preference() === 'dark' ? 'sun' : 'moon'" class="w-4 h-4"></i-lucide>
        </button>

        <button
          type="button"
          (click)="openAccount()"
          title="Mi cuenta"
          class="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100 min-w-0">
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-semibold">
            {{ auth.userInitial }}
          </span>
          <span class="min-w-0 text-left hidden sm:block">
            <span class="block text-sm font-medium text-gray-900 truncate leading-tight">
              {{ auth.currentUserName }}
            </span>
            <span class="app-user-role block text-xs truncate leading-tight">
              {{ auth.currentRoleShortLabel }}
            </span>
          </span>
        </button>
        <button
          type="button"
          (click)="logout()"
          title="Cerrar sesión"
          class="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <i-lucide name="log-out" class="w-4 h-4"></i-lucide>
        </button>
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly auth = inject(AuthService);
  readonly nav = inject(LayoutNavService);
  readonly theme = inject(ThemeService);
  private router = inject(Router);

  openAccount() {
    const route = this.auth.isPlatformAdmin ? '/platform/mi-cuenta' : '/mi-cuenta';
    this.router.navigate([route]);
  }

  openAppearance() {
    const route = this.auth.isPlatformAdmin ? '/platform/apariencia' : '/apariencia';
    this.router.navigate([route]);
  }

  openSettings() {
    this.router.navigate(['/settings']);
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
