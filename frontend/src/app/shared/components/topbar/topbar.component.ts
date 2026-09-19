import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { ThemeService } from '../../../core/services/theme.service';
import {
  AutomationsService,
  type ErpNoticeDto,
  type RiloNoticeSeverity,
} from '../../../core/services/automations.service';
import { Router, RouterLink } from '@angular/router';

const BADGE_POLL_MS = 60_000;

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  host: { style: 'display: contents' },
  template: `
    <header
      class="relative z-[90] min-h-14 shrink-0 border-b border-gray-100 dark:border-gray-800 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm px-3 sm:px-6 py-1 flex items-center justify-between gap-2 lg:h-14 lg:py-0">
      <button
        type="button"
        class="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        [attr.aria-label]="nav.mobileMenuOpen() ? 'Cerrar menú' : 'Abrir menú'"
        [attr.aria-expanded]="nav.mobileMenuOpen()"
        (click)="nav.toggleMobileMenu()">
        <i-lucide [name]="nav.mobileMenuOpen() ? 'x' : 'menu'" class="w-5 h-5"></i-lucide>
      </button>

      <div class="flex-1 min-w-0 lg:hidden pr-1">
        <a
          [routerLink]="auth.homeRoute"
          (click)="nav.closeMobileMenu()"
          class="block min-w-0 text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100 leading-none truncate whitespace-nowrap hover:text-teal-700 dark:hover:text-teal-400 active:opacity-80">
          {{ auth.appBrandTitle }}
        </a>
      </div>

      <div class="inline-flex items-center gap-1.5 sm:gap-2.5 ml-auto">
        <div *ngIf="showAvisosBell" class="relative" data-avisos-bell>
          <button
            type="button"
            (click)="toggleAvisosDropdown($event)"
            title="RILO te avisa"
            aria-label="RILO te avisa"
            [attr.aria-expanded]="avisosOpen"
            class="relative inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
            <i-lucide name="bell" class="w-4 h-4"></i-lucide>
            <span
              *ngIf="unreadCount > 0"
              class="absolute top-1.5 right-1.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-teal-600 text-[10px] font-bold leading-[1.05rem] text-white text-center">
              {{ unreadCount > 9 ? '9+' : unreadCount }}
            </span>
          </button>

          <div
            *ngIf="avisosOpen"
            class="absolute right-0 top-full mt-1.5 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden z-[100]">
            <div class="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800">
              <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">RILO te avisa</p>
              <p class="text-[11px] text-gray-500 mt-0.5">
                {{ unreadCount > 0 ? unreadCount + ' sin leer' : 'Sin pendientes nuevos' }}
              </p>
            </div>
            <div *ngIf="preview.length === 0" class="px-3.5 py-6 text-center text-xs text-gray-500">
              Todo al día
            </div>
            <a
              *ngFor="let notice of preview"
              routerLink="/avisos"
              (click)="closeAvisos()"
              class="block px-3.5 py-2.5 border-b border-gray-50 dark:border-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span
                  *ngIf="notice.severity"
                  class="inline-flex rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                  [ngClass]="previewSeverityClass(notice.severity)">
                  {{ previewSeverityLabel(notice.severity) }}
                </span>
                <span
                  *ngIf="notice.unread"
                  class="inline-flex h-1.5 w-1.5 rounded-full bg-teal-500"
                  aria-hidden="true"></span>
              </div>
              <p class="text-xs font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
                {{ previewHeadline(notice) }}
              </p>
              <p *ngIf="previewDetail(notice)" class="mt-0.5 text-[11px] text-gray-500 line-clamp-2 leading-snug">
                {{ previewDetail(notice) }}
              </p>
            </a>
            <a
              routerLink="/avisos"
              (click)="closeAvisos()"
              class="block px-3.5 py-2.5 text-center text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50/60 dark:hover:bg-teal-950/30">
              Ver todos los avisos
            </a>
          </div>
        </div>

        <a
          *ngIf="auth.canManageSettings && auth.canAccessErpWeb"
          routerLink="/settings"
          title="Configuración"
          aria-label="Configuración"
          class="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <i-lucide name="settings" class="w-4 h-4"></i-lucide>
        </a>

        <button
          type="button"
          (click)="openAppearance()"
          [title]="theme.preference() === 'dark' ? 'Apariencia · fondo oscuro activo' : 'Apariencia · fondo claro activo'"
          class="hidden sm:inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <i-lucide [name]="theme.preference() === 'dark' ? 'sun' : 'moon'" class="w-4 h-4"></i-lucide>
        </button>

        <button
          type="button"
          (click)="openAccount()"
          title="Mi cuenta"
          aria-label="Mi cuenta"
          class="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 min-w-0 min-h-11">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-semibold">
            {{ auth.userInitial }}
          </span>
          <span class="min-w-0 text-left hidden md:block">
            <span class="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">
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
          aria-label="Cerrar sesión"
          class="hidden sm:inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <i-lucide name="log-out" class="w-4 h-4"></i-lucide>
        </button>
      </div>
    </header>
  `,
})
export class TopbarComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly nav = inject(LayoutNavService);
  readonly theme = inject(ThemeService);
  private readonly automations = inject(AutomationsService);
  private router = inject(Router);

  avisosOpen = false;
  unreadCount = 0;
  preview: ErpNoticeDto[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  get showAvisosBell(): boolean {
    return !this.auth.isPlatformAdmin && !!this.auth.currentBusinessId;
  }

  ngOnInit() {
    if (!this.showAvisosBell) return;
    this.refreshBadge();
    this.pollTimer = setInterval(() => this.refreshBadge(), BADGE_POLL_MS);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.avisosOpen) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-avisos-bell]')) return;
    this.avisosOpen = false;
  }

  toggleAvisosDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.avisosOpen = !this.avisosOpen;
    if (this.avisosOpen) this.refreshBadge();
  }

  closeAvisos() {
    this.avisosOpen = false;
  }

  previewHeadline(notice: ErpNoticeDto): string {
    const title = String(notice.title ?? '').trim();
    if (!title) return 'Aviso';
    const parts = title.split(/\s*·\s*/);
    return parts[0]?.trim() || title;
  }

  previewDetail(notice: ErpNoticeDto): string {
    const title = String(notice.title ?? '').trim();
    const parts = title.split(/\s*·\s*/);
    const fromTitle = parts.length >= 2 ? parts.slice(1).join(' · ').trim() : '';
    return fromTitle || String(notice.body ?? '').trim();
  }

  previewSeverityLabel(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'Urgente';
    if (severity === 'info') return 'Info';
    return 'Atención';
  }

  previewSeverityClass(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200';
    if (severity === 'info') return 'bg-gray-100 text-teal-800 dark:bg-gray-800 dark:text-teal-200';
    return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  }

  private refreshBadge() {
    if (!this.auth.currentBusinessId || this.auth.isPlatformAdmin) return;
    this.automations.badge().subscribe({
      next: (res) => {
        this.unreadCount = res.unreadCount ?? 0;
            this.preview = (res.preview ?? []).slice(0, 3);
      },
      error: () => {
        /* silent: no spam if avisos API fails */
      },
    });
  }

  openAccount() {
    const route = this.auth.isPlatformAdmin ? '/platform/mi-cuenta' : '/mi-cuenta';
    this.router.navigate([route]);
  }

  openAppearance() {
    const route = this.auth.isPlatformAdmin ? '/platform/apariencia' : '/apariencia';
    this.router.navigate([route]);
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
