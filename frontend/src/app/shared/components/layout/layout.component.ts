import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { AppDialogComponent } from '../app-dialog/app-dialog.component';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, SidebarComponent, TopbarComponent, AppDialogComponent],
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
          *ngIf="auth.isTrialExpiringSoon && auth.trialDaysRemaining != null"
          class="shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-950 flex flex-wrap items-center justify-between gap-2">
          <span>Tu prueba vence en {{ auth.trialDaysRemaining }} día{{ auth.trialDaysRemaining === 1 ? '' : 's' }}.</span>
          <a routerLink="/activar-suscripcion" class="text-sm font-semibold text-violet-800 hover:underline">Activar suscripción</a>
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
export class LayoutComponent {
  readonly nav = inject(LayoutNavService);
  readonly auth = inject(AuthService);
}
