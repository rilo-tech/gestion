import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Permission } from '../constants/permissions';
import { catchError, map, of, timeout } from 'rxjs';

const GUARD_INIT_TIMEOUT_MS = 12_000;

function probeSession(auth: AuthService) {
  return auth.initialize().pipe(
    timeout({ first: GUARD_INIT_TIMEOUT_MS }),
    catchError(() => of(false))
  );
}

function homeUrlTree(router: Router, auth: AuthService): UrlTree {
  return router.parseUrl(auth.homeRoute);
}

const ERP_WEB_EXEMPT_PATHS = [
  '/inicio',
  '/avisos',
  '/mi-cuenta',
  '/apariencia',
  '/activar-suscripcion',
  '/plan',
  '/onboarding',
  '/settings',
];

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return true;
  }

  return probeSession(auth).pipe(
    map((authenticated) => {
      if (authenticated) return true;
      return router.createUrlTree(['/login']);
    })
  );
};

/** /inicio es home de Bot (summary) o bot-only; Gestión full va al dashboard. */
export const botOnlyHomeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isPlatformAdmin || !auth.canAccessErpWeb || auth.isSummaryWebTenant) {
    return true;
  }
  return router.parseUrl('/dashboard');
};

export const loginGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // El usuario pidió ver el formulario (navbar "Ingresar"): no redirigir por token guardado.
  if (route.queryParamMap.get('manual') === '1') {
    return true;
  }

  const resolve = (authenticated: boolean) => {
    if (!authenticated) return true;
    return homeUrlTree(router, auth);
  };

  if (auth.currentUser) {
    return resolve(true);
  }

  if (!auth.authToken) {
    return true;
  }

  return probeSession(auth).pipe(map((authenticated) => resolve(authenticated)));
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

  return probeSession(auth).pipe(map((authenticated) => resolve(authenticated)));
};

export const platformGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return auth.isPlatformAdmin ? true : homeUrlTree(router, auth);
  }

  return probeSession(auth).pipe(
    map((authenticated) => {
      if (!authenticated) return router.createUrlTree(['/login']);
      return auth.isPlatformAdmin ? true : homeUrlTree(router, auth);
    })
  );
};

export const companyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) {
    return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
  }

  return probeSession(auth).pipe(
    map((authenticated) => {
      if (!authenticated) return router.createUrlTree(['/login']);
      return auth.isPlatformAdmin ? router.createUrlTree(['/platform']) : true;
    })
  );
};

/** Solo el administrador de la empresa (rol supervisor): plan y suscripción. */
export const supervisorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isSupervisor ? true : homeUrlTree(router, auth);
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

/** Wizard de perfil operativo (FASE 2). */
export const businessOnboardingGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (route.queryParamMap.get('edit') === '1' && auth.canManageSettings) return true;
  if (auth.needsBusinessOnboarding) return true;
  return homeUrlTree(router, auth);
};

/** Redirige al wizard si el perfil persistido no completó onboarding. */
export const pendingOnboardingGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const path = state.url.split('?')[0];
  if (path === '/onboarding') return true;
  if (!auth.needsBusinessOnboarding) return true;
  return router.createUrlTree(['/onboarding']);
};

/** Bloquea panel full si no hay ERP operativo o si es Resumen RILO (summary). */
export const erpWebGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const path = state.url.split('?')[0];
  if (ERP_WEB_EXEMPT_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
    return true;
  }
  if (auth.isPlatformAdmin) return true;
  if (auth.isSummaryWebTenant) {
    return router.createUrlTree(['/inicio']);
  }
  if (auth.canAccessErpWeb) return true;
  return router.createUrlTree(['/inicio']);
};

/** Si el trial venció o la cuenta está bloqueada, manda a contratar. Cuenta/Plan siguen accesibles. */
export const trialActiveGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const mode = auth.currentBusiness?.billingMode;
  if (mode === 'blocked' || mode === 'lite') {
    return router.createUrlTree(['/activar-suscripcion']);
  }
  return true;
};
