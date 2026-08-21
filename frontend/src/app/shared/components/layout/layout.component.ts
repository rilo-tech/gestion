import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { AppDialogComponent } from '../app-dialog/app-dialog.component';
import { ProductCoachTipComponent } from '../product-coach-tip/product-coach-tip.component';
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
    ProductCoachTipComponent,
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
      <app-product-coach-tip></app-product-coach-tip>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <app-topbar></app-topbar>
        <div
          *ngIf="!auth.isPlatformAdmin && !auth.canAccessErpWeb && auth.canAccessWhatsapp"
          class="shrink-0 border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-sm text-teal-950">
          Tu plan opera por <span class="font-semibold">WhatsApp</span>. Escribí al número de RILO Bot con el WhatsApp que registraste.
          <a routerLink="/mi-cuenta" class="ml-2 font-semibold text-teal-800 hover:underline">Ver inicio</a>
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
              Ver planes
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
          *ngIf="auth.isTrialExpired && !auth.isPlatformAdmin"
          class="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2.5 sm:px-4 text-sm text-amber-950 flex items-center gap-3">
          <p class="min-w-0 flex-1">
            Tu prueba gratuita terminó. Tus datos siguen guardados. Elegí un plan para continuar usando RILO.
          </p>
          <a
            routerLink="/activar-suscripcion"
            class="inline-flex shrink-0 items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs sm:text-sm font-semibold text-white hover:bg-amber-700">
            Elegir plan
          </a>
        </div>
        <div
          *ngIf="showPaymentDueBanner"
          class="shrink-0 border-b px-3 py-2.5 sm:px-4 text-sm flex items-center gap-3"
          [class.border-rose-200]="auth.isPaymentOverdue"
          [class.bg-rose-50]="auth.isPaymentOverdue"
          [class.text-rose-950]="auth.isPaymentOverdue"
          [class.border-amber-200]="!auth.isPaymentOverdue"
          [class.bg-amber-50]="!auth.isPaymentOverdue"
          [class.text-amber-950]="!auth.isPaymentOverdue">
          <p class="min-w-0 flex-1">{{ paymentBannerText }}</p>
          <a
            routerLink="/activar-suscripcion"
            class="inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs sm:text-sm font-semibold text-white"
            [ngClass]="auth.isPaymentOverdue ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'">
            Pagar ahora
          </a>
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

  get showPaymentDueBanner(): boolean {
    if (this.auth.isPlatformAdmin || this.auth.isTrialExpired) return false;
    if (this.auth.currentBusiness?.enPrueba) return false;
    return this.auth.isPaymentOverdue || this.auth.isPaymentDueSoon || this.auth.isPaymentPending;
  }

  get paymentBannerText(): string {
    const days = this.auth.paymentDaysRemaining;
    if (this.auth.isPaymentOverdue) {
      return 'Tu pago mensual está vencido. Renová la suscripción para no interrumpir el servicio.';
    }
    if (this.auth.isPaymentDueSoon && days != null) {
      return days === 0
        ? 'Tu cobertura vence hoy. Renová el plan para seguir operando.'
        : `Tu cobertura vence en ${days} día${days === 1 ? '' : 's'}. Podés pagar el próximo mes o el año.`;
    }
    if (this.auth.isPaymentPending) {
      return `Pago pendiente del período ${this.auth.currentBusiness?.periodoPagoActual ?? ''}. Tenés plazo hasta el día 10.`;
    }
    return 'Renová tu suscripción.';
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
