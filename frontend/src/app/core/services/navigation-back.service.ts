import { Location } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router, type NavigationExtras } from '@angular/router';
import { filter } from 'rxjs';

function normalizePath(url: string): string {
  return url.split('?')[0].replace(/\/$/, '') || '/';
}

const AUTH_PATHS = new Set(['/login', '/platform/login']);

/**
 * Navegación «volver atrás» unificada: usa el historial del navegador y,
 * si no hay pantalla anterior útil, cae al fallback del módulo.
 */
@Injectable({ providedIn: 'root' })
export class NavigationBackService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  private previousUrl: string | null = null;
  private currentUrl = this.router.url;

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const next = event.urlAfterRedirects;
        if (normalizePath(next) === normalizePath(this.currentUrl)) return;
        this.previousUrl = this.currentUrl;
        this.currentUrl = next;
      });
  }

  back(
    fallback: string | readonly unknown[] = '/dashboard',
    extras?: NavigationExtras
  ): void {
    const startPath = normalizePath(this.router.url);

    if (this.canUseHistoryBack(startPath)) {
      this.location.back();
      setTimeout(() => {
        if (normalizePath(this.router.url) === startPath) {
          void this.navigateFallback(fallback, extras);
        }
      }, 0);
      return;
    }

    void this.navigateFallback(fallback, extras);
  }

  private canUseHistoryBack(currentPath: string): boolean {
    if (typeof window !== 'undefined' && window.history.length <= 1) return false;
    if (!this.previousUrl) return false;

    const previousPath = normalizePath(this.previousUrl);
    if (previousPath === currentPath) return false;
    if (AUTH_PATHS.has(previousPath)) return false;

    return true;
  }

  private navigateFallback(
    fallback: string | readonly unknown[],
    extras?: NavigationExtras
  ): void {
    void this.router.navigate(
      typeof fallback === 'string' ? [fallback] : [...fallback],
      extras
    );
  }
}
