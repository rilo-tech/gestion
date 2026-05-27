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

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.authToken;
  if (
    !token ||
    req.url.includes('/api/auth/login') ||
    req.url.includes('/api/auth/google')
  ) {
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
