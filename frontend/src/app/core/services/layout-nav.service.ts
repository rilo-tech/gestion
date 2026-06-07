import { Injectable, signal } from '@angular/core';

function normalizeListPath(url: string): string {
  return url.split('?')[0].replace(/\/$/, '') || '/';
}

@Injectable({ providedIn: 'root' })
export class LayoutNavService {
  readonly mobileMenuOpen = signal(false);
  /** Se incrementa cuando el usuario vuelve a tocar el mismo módulo en el menú. */
  readonly listRootToken = signal<{ path: string; token: number } | null>(null);
  private listRootCounter = 0;

  openMobileMenu(): void {
    this.mobileMenuOpen.set(true);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  requestListRoot(path: string): void {
    this.listRootCounter += 1;
    this.listRootToken.set({ path: normalizeListPath(path), token: this.listRootCounter });
  }
}
