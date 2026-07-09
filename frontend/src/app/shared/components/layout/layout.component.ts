import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { AppDialogComponent } from '../app-dialog/app-dialog.component';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { AuthService } from '../../../core/services/auth.service';
import { trialBannerDismissStorageKey } from '../../../core/constants/auth-storage';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    LucideAngularModule,
    SidebarComponent,
    TopbarComponent,
    AppDialogComponent,
  ],
  template: `
    <div class="flex h-screen bg-gray-50 overflow-hidden">
      <button
        *ngIf="nav.mobileMenuOpen()"
        type="button"
        class="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-[1px] lg:hidden"
        aria-label="Cerrar menú"
        (click)="nav.closeMobileMenu()">
      </button>

      <app-sidebar></app-sidebar>
      <app-dialog></app-dialog>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <app-topbar></app-topbar>
        <div
          *ngIf="!auth.isPlatformAdmin && !auth.canAccessErpWeb && auth.canAccessWhatsapp"
          class="shrink-0 border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-sm text-teal-950">
          Tu plan opera por <span class="font-semibold">WhatsApp</span>. Escribí al número que registraste para cargar pedidos y ventas.
          <a routerLink="/mi-cuenta" class="ml-2 font-semibold text-teal-800 hover:underline">Ver mi cuenta</a>
        </div>
        <div
          *ngIf="showTrialExpiringBanner"
          class="shrink-0 border-b border-violet-200 bg-violet-50 px-3 py-2.5 sm:px-4 text-sm text-violet-950 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-100 flex items-center gap-3">
          <p class="min-w-0 flex-1">
            Tu prueba vence en {{ auth.trialDaysRemaining }} día{{ auth.trialDaysRemaining === 1 ? '' : 's' }}.
          </p>
          <div class="flex shrink-0 items-center gap-2">
            <a
              routerLink="/activar-suscripcion"
              class="inline-flex items-center rounded-lg bg-violet-600 px-3 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:bg-violet-500 dark:hover:bg-violet-400 dark:text-white">
              Activar suscripción
            </a>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-violet-700 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:text-violet-200 dark:hover:bg-violet-900/60"
              aria-label="Cerrar aviso de prueba"
              (click)="dismissTrialBanner()">
              <i-lucide name="x" class="h-4 w-4"></i-lucide>
            </button>
          </div>
        </div>
        <div
          *ngIf="auth.isTrialExpired"
          class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          Tu período de prueba finalizó. Contactá a RILO para continuar usando el sistema.
        </div>
        <main class="flex-1 overflow-y-auto overflow-x-hidden">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
})
export class LayoutComponent implements OnInit {
  readonly nav = inject(LayoutNavService);
  readonly auth = inject(AuthService);

  /** Días restantes al cerrar el aviso; si bajan, el banner vuelve a mostrarse. */
  private dismissedAtTrialDays: number | null = null;

  ngOnInit() {
    this.dismissedAtTrialDays = this.readDismissedAtTrialDays();
  }

  get showTrialExpiringBanner(): boolean {
    const days = this.auth.trialDaysRemaining;
    if (!this.auth.isTrialExpiringSoon || days == null) return false;
    if (this.dismissedAtTrialDays == null) return true;
    return days < this.dismissedAtTrialDays;
  }

  dismissTrialBanner() {
    const businessId = this.auth.currentBusinessId;
    const days = this.auth.trialDaysRemaining;
    if (businessId && days != null) {
      localStorage.setItem(trialBannerDismissStorageKey(businessId), String(days));
      this.dismissedAtTrialDays = days;
    }
  }

  private readDismissedAtTrialDays(): number | null {
    const businessId = this.auth.currentBusinessId;
    if (!businessId) return null;
    const raw = localStorage.getItem(trialBannerDismissStorageKey(businessId));
    if (raw == null || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
