import { Observable, from, of, throwError, TimeoutError } from 'rxjs';
import { catchError, finalize, switchMap, tap, timeout } from 'rxjs/operators';

export const LOGIN_FLOW_TIMEOUT_MS = 30_000;

export type LoginNavigationFailure = {
  code: 'NAVIGATION_FALSE' | 'NAVIGATION_ERROR';
  cause?: unknown;
};

export function isLoginNavigationFailure(err: unknown): err is LoginNavigationFailure {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    ((err as LoginNavigationFailure).code === 'NAVIGATION_FALSE' ||
      (err as LoginNavigationFailure).code === 'NAVIGATION_ERROR')
  );
}

export type AuthenticatedLoginPipelineDeps = {
  homeRoute: () => string;
  navigateByUrl: (url: string) => Promise<boolean>;
  currentUrl?: () => string;
  onHttpResponse?: () => void;
  onHomeRoute?: (route: string) => void;
  onNavigateStart?: (route: string) => void;
  onNavigateEnd?: (route: string, ok: boolean, url: string) => void;
  onFinally: () => void;
};

/** Login HTTP + navegación Angular como un único flujo RxJS. */
export function createAuthenticatedLoginPipeline(
  login$: Observable<unknown>,
  deps: AuthenticatedLoginPipelineDeps
): Observable<boolean> {
  return login$.pipe(
    tap(() => deps.onHttpResponse?.()),
    tap(() => deps.onHomeRoute?.(deps.homeRoute())),
    switchMap(() => {
      const target = deps.homeRoute();
      deps.onNavigateStart?.(target);
      return from(deps.navigateByUrl(target)).pipe(
        tap((ok) => deps.onNavigateEnd?.(target, ok, deps.currentUrl?.() ?? '')),
        switchMap((ok) =>
          ok ? of(true) : throwError(() => ({ code: 'NAVIGATION_FALSE' as const }))
        ),
        catchError((err) => {
          if (isLoginNavigationFailure(err)) return throwError(() => err);
          return throwError(() => ({ code: 'NAVIGATION_ERROR' as const, cause: err }));
        })
      );
    }),
    timeout({ first: LOGIN_FLOW_TIMEOUT_MS }),
    catchError((err) => {
      if (err instanceof TimeoutError || (err as { name?: string })?.name === 'TimeoutError') {
        return throwError(() => ({ code: 'NAVIGATION_ERROR' as const, cause: err }));
      }
      return throwError(() => err);
    }),
    finalize(deps.onFinally)
  );
}
