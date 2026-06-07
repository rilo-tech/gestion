import { DestroyRef, inject, Injector, runInInjectionContext } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { LayoutNavService } from '../services/layout-nav.service';

export function normalizeListPath(url: string): string {
  return url.split('?')[0].replace(/\/$/, '') || '/';
}

/** Ruta hija del módulo (alta/edición/detalle), p. ej. /sales/abc/edit bajo /sales. */
export function isModuleSubRoute(path: string, listPath: string): boolean {
  const normalized = normalizeListPath(path);
  const list = normalizeListPath(listPath);
  if (normalized === list) return false;
  return normalized.startsWith(`${list}/`);
}

/**
 * Recarga el listado al volver a la grilla del módulo:
 * - desde un formulario/detalle (/clients/new → /clients)
 * - desde otro módulo (Configuración → Ventas)
 * - al volver a tocar el mismo ítem del menú estando ya en la grilla
 */
export function bindListPageRefreshOnReturn(options: {
  listPath: string;
  reload: () => void;
  reset?: () => void;
  router?: Router;
  destroyRef?: DestroyRef;
  /**
   * Injector del componente. Necesario cuando esta función se llama fuera de un
   * contexto de inyección (p. ej. desde ngOnInit): inject()/toObservable() exigen
   * dicho contexto y, sin él, Angular lanza NG0203.
   */
  injector?: Injector;
}): void {
  if (options.injector) {
    runInInjectionContext(options.injector, () => bindListPageRefreshCore(options));
    return;
  }
  bindListPageRefreshCore(options);
}

function bindListPageRefreshCore(options: {
  listPath: string;
  reload: () => void;
  reset?: () => void;
  router?: Router;
  destroyRef?: DestroyRef;
}): void {
  const router = options.router ?? inject(Router);
  const destroyRef = options.destroyRef ?? inject(DestroyRef);
  const nav = inject(LayoutNavService);
  const listPath = normalizeListPath(options.listPath);
  let previousUrl = router.url;

  const refreshList = () => {
    options.reset?.();
    options.reload();
  };

  router.events
    .pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe((event) => {
      const currentUrl = event.urlAfterRedirects;
      const currentPath = normalizeListPath(currentUrl);
      const previousPath = normalizeListPath(previousUrl);
      previousUrl = currentUrl;

      if (currentPath === listPath && previousPath !== listPath) {
        refreshList();
      }
    });

  toObservable(nav.listRootToken)
    .pipe(
      filter((req): req is { path: string; token: number } => !!req && req.path === listPath),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe(() => refreshList());
}
