import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Permission } from '../constants/permissions';
import { map } from 'rxjs';

const ERP_WEB_EXEMPT_PATHS = ['/mi-cuenta', '/apariencia', '/activar-suscripcion'];

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
      return router.createUrlTree(['/login']);
    })
  );
};

export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return redirectIfAuthenticated(auth, router);
};

/** Permite /acceso-plataforma salvo que ya haya sesión de superadmin plataforma. */
export const platformLoginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const resolve = (authenticated: boolean) => {
    if (!authenticated) return true;
    return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
  };

  if (auth.currentUser) {
    return resolve(true);
  }

  return auth.initialize().pipe(map((authenticated) => resolve(authenticated)));
};

export const platformGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return auth.isPlatformAdmin ? true : router.createUrlTree([auth.homeRoute]);
  }

  return auth.initialize().pipe(
    map((authenticated) => {
      if (!authenticated) return router.createUrlTree(['/login']);
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
      if (!authenticated) return router.createUrlTree(['/login']);
      return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
    })
  );
};

export const supervisorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.canManageUsers ? true : router.createUrlTree([auth.homeRoute]);
};

export function requirePermission(permission: Permission): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.hasPermission(permission) ? true : router.createUrlTree(['/dashboard']);
  };
}

export function requireAnyPermission(...permissions: Permission[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return permissions.some((permission) => auth.hasPermission(permission))
      ? true
      : router.createUrlTree(['/dashboard']);
  };
}

export function requireModule(...moduleIds: import('../../../../../shared/subscription-modules.ts').SubscriptionModuleId[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return moduleIds.some((moduleId) => auth.hasModule(moduleId))
      ? true
      : router.createUrlTree(['/dashboard']);
  };
}

/** Bloquea el panel ERP si la empresa solo tiene WhatsApp; permite /mi-cuenta y similares. */
export const erpWebGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const path = state.url.split('?')[0];
  if (ERP_WEB_EXEMPT_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
    return true;
  }
  if (auth.isPlatformAdmin || auth.canAccessErpWeb) return true;
  return router.createUrlTree(['/mi-cuenta']);
};

/** Redirige al flujo de activación si la prueba venció (login permitido, operación bloqueada). */
export const trialActiveGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isTrialExpired) return true;
  return router.createUrlTree(['/activar-suscripcion']);
};
