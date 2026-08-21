import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-ritotech-public-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-teal-950 text-white">
      <header class="border-b border-white/10 bg-gray-950/80 backdrop-blur sticky top-0 z-20">
        <div class="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <a routerLink="/" class="flex items-center gap-2.5 shrink-0 group" aria-label="RiloTech inicio">
            <img
              src="/brand/rilobot-mark.png"
              alt=""
              width="40"
              height="40"
              class="h-9 w-9 sm:h-10 sm:w-10 object-contain"
              decoding="async" />
            <img
              src="/brand/rilotech-wordmark-on-dark.png"
              alt="RiloTech"
              width="140"
              height="36"
              class="hidden sm:block h-7 sm:h-8 w-auto object-contain object-left max-w-[140px] sm:max-w-[160px]"
              decoding="async" />
            <span class="sr-only">RiloTech</span>
          </a>
          <nav class="hidden sm:flex items-center gap-5 text-sm text-gray-300">
            <a routerLink="/whatsapp" routerLinkActive="text-white" class="hover:text-white">RILO Bot</a>
            <a routerLink="/rilo-gestion" routerLinkActive="text-white" class="hover:text-white">RILO Gestión</a>
            <a
              routerLink="/"
              fragment="como-funciona"
              (click)="scrollToLandingSection('como-funciona')"
              class="hover:text-white hidden lg:inline">Cómo funciona</a>
            <a routerLink="/planes" routerLinkActive="text-white" class="hover:text-white">Precios</a>
            <a
              routerLink="/"
              fragment="landing-faq"
              (click)="scrollToLandingSection('landing-faq')"
              class="hover:text-white hidden md:inline">FAQ</a>
          </nav>
          <div class="flex items-center gap-2 shrink-0">
            <ng-container *ngIf="auth.isPlatformAdmin">
              <a
                routerLink="/platform/mi-cuenta"
                title="Mi cuenta"
                class="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5 min-w-0">
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-semibold"
                  aria-hidden="true">
                  {{ auth.userInitial }}
                </span>
                <span class="hidden sm:inline text-xs text-gray-300 max-w-[10rem] truncate" [title]="auth.currentUserName">
                  {{ auth.currentUserName }}
                </span>
              </a>
              <a
                routerLink="/platform"
                class="inline-flex rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold hover:bg-teal-500">
                Plataforma
              </a>
              <button
                type="button"
                (click)="logout()"
                class="inline-flex px-2.5 py-1.5 text-sm text-gray-400 hover:text-white">
                Salir
              </button>
            </ng-container>
            <ng-container *ngIf="auth.currentUser && !auth.isPlatformAdmin">
              <a
                routerLink="/mi-cuenta"
                title="Mi cuenta"
                class="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5 min-w-0 max-w-[14rem]">
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-semibold"
                  aria-hidden="true">
                  {{ auth.userInitial }}
                </span>
                <span class="min-w-0 text-left hidden sm:block">
                  <span class="block text-sm font-medium text-white truncate leading-tight">
                    {{ auth.currentUserName }}
                  </span>
                  <span class="block text-xs text-gray-400 truncate leading-tight">
                    {{ auth.currentRoleShortLabel }}
                  </span>
                </span>
              </a>
              <a
                [routerLink]="auth.homeRoute"
                class="inline-flex rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold hover:bg-teal-500">
                {{ homeCtaLabel }}
              </a>
              <button
                type="button"
                (click)="logout()"
                class="inline-flex px-2.5 py-1.5 text-sm text-gray-400 hover:text-white">
                Salir
              </button>
            </ng-container>
            <ng-container *ngIf="!auth.currentUser">
              <a
                routerLink="/login"
                class="inline-flex px-3 py-1.5 text-sm text-gray-300 hover:text-white">
                Ingresar
              </a>
              <a
                routerLink="/registro"
                [queryParams]="{ producto: 'completo' }"
                class="inline-flex rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold hover:bg-teal-500">
                Probar 30 días
              </a>
            </ng-container>
          </div>
        </div>
      </header>
      <main>
        <ng-content></ng-content>
      </main>
      <footer class="border-t border-white/10 mt-16 py-8 text-center text-xs text-gray-500">
        <div class="flex justify-center mb-3">
          <img
            src="/brand/rilotech-lockup-on-dark.png"
            alt="RiloTech"
            width="120"
            height="120"
            class="h-16 w-auto object-contain opacity-90"
            decoding="async" />
        </div>
        <p>RiloTech · RILO Gestión · Tu negocio desde WhatsApp o la web.</p>
        <p class="mt-2 max-w-lg mx-auto leading-relaxed">
          Los precios publicados son de referencia y pueden reajustarse. Si ya estás en un plan pago, te avisamos antes de cambiar tu cuota.
        </p>
        <p class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a routerLink="/legal/terminos" class="hover:text-gray-300">Términos</a>
          <a routerLink="/legal/privacidad" class="hover:text-gray-300">Privacidad</a>
          <a routerLink="/acceso-plataforma" class="hover:text-gray-300">Acceso plataforma</a>
        </p>
      </footer>
    </div>
  `,
})
export class RitotechPublicShellComponent {
  private router = inject(Router);
  readonly auth = inject(AuthService);

  get homeCtaLabel(): string {
    if (this.auth.canAccessErpWeb) return 'Ir al panel';
    if (this.auth.canAccessWhatsapp) return 'Mi cuenta';
    return 'Mi cuenta';
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/');
  }

  scrollToLandingSection(id: string) {
    const path = this.router.url.split('?')[0].split('#')[0];
    const scroll = () => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (path === '/' || path === '') {
      setTimeout(scroll, 0);
      return;
    }
    void this.router.navigate(['/'], { fragment: id }).then(() => {
      setTimeout(scroll, 80);
    });
  }

  scrollToLandingFaq() {
    this.scrollToLandingSection('landing-faq');
  }
}
