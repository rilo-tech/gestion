import { Injectable, signal } from '@angular/core';

function normalizeListPath(url: string): string {
  return url.split('?')[0].replace(/\/$/, '') || '/';
}

@Injectable({ providedIn: 'root' })
export class LayoutNavService {
  readonly mobileMenuOpen = signal(false);
  /** Desktop: rail acoplado de herramientas secundarias. */
  readonly toolsRailOpen = signal(false);
  /** Mobile drawer: vista principal vs lista de herramientas. */
  readonly mobileDrawerView = signal<'main' | 'tools'>('main');
  /** Se incrementa cuando el usuario vuelve a tocar el mismo módulo en el menú. */
  readonly listRootToken = signal<{ path: string; token: number } | null>(null);
  private listRootCounter = 0;

  openMobileMenu(): void {
    this.mobileMenuOpen.set(true);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
    this.mobileDrawerView.set('main');
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => {
      if (open) this.mobileDrawerView.set('main');
      return !open;
    });
  }

  openToolsRail(): void {
    this.toolsRailOpen.set(true);
  }

  closeToolsRail(): void {
    this.toolsRailOpen.set(false);
  }

  toggleToolsRail(): void {
    this.toolsRailOpen.update((open) => !open);
  }

  showMobileTools(): void {
    this.mobileDrawerView.set('tools');
    if (!this.mobileMenuOpen()) this.mobileMenuOpen.set(true);
  }

  showMobileMain(): void {
    this.mobileDrawerView.set('main');
  }

  requestListRoot(path: string): void {
    this.listRootCounter += 1;
    this.listRootToken.set({ path: normalizeListPath(path), token: this.listRootCounter });
  }
}
