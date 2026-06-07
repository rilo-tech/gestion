import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

function isSubscriptionAccessError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('suscripción') ||
    normalized.includes('suscripcion') ||
    normalized.includes('plan asignado')
  );
}

function isPublicAuthRoute(url: string): boolean {
  return (
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/google') ||
    url.includes('/api/auth/logout')
  );
}

let redirectingForExpiredSession = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.authToken;
  if (!token || isPublicAuthRoute(req.url)) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    })
  ).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPublicAuthRoute(req.url)) {
        if (!redirectingForExpiredSession) {
          redirectingForExpiredSession = true;
          auth.logout();
          void router
            .navigate(['/login'], { queryParams: { session: 'expired' } })
            .finally(() => {
              redirectingForExpiredSession = false;
            });
        }
        return throwError(() => error);
      }

      if (
        error.status === 403 &&
        !auth.isPlatformAdmin &&
        isSubscriptionAccessError(String(error.error?.error ?? ''))
      ) {
        auth.logout();
        router.navigate(['/login'], {
          queryParams: { subscription: 'inactive' },
        });
      }
      return throwError(() => error);
    })
  );
};
