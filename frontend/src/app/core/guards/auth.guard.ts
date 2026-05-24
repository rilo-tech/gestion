import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

function redirectIfAuthenticated(auth: AuthService, router: Router) {
  if (auth.currentUser) {
    return router.createUrlTree([auth.homeRoute]);
  }
  return auth.initialize().pipe(
    map((authenticated) =>
      authenticated ? router.createUrlTree([auth.homeRoute]) : true
    )
  );
}

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return true;
  }

  return auth.initialize().pipe(
    map((authenticated) => {
      if (authenticated) return true;
      return router.createUrlTree(['/']);
    })
  );
};

export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return redirectIfAuthenticated(auth, router);
};

export const platformGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return auth.isPlatformAdmin ? true : router.createUrlTree([auth.homeRoute]);
  }

  return auth.initialize().pipe(
    map((authenticated) => {
      if (!authenticated) return router.createUrlTree(['/']);
      return auth.isPlatformAdmin ? true : router.createUrlTree([auth.homeRoute]);
    })
  );
};

export const companyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
  }

  return auth.initialize().pipe(
    map((authenticated) => {
      if (!authenticated) return router.createUrlTree(['/']);
      return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
    })
  );
};

export const supervisorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.canManageUsers ? true : router.createUrlTree([auth.homeRoute]);
};
