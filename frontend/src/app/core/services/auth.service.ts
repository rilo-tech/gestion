import { Injectable, inject } from '@angular/core';
import {
  Permission,
  PERMISSIONS,
  USER_ROLE_LABELS,
  UserRole,
  userHasPermission,
  canManageSettings,
  canManageUsers,
  canStaffViewOrder,
} from '../constants/permissions';
import { AppUser } from './user.service';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of, throwError, NEVER } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from 'firebase/auth';
import { firebaseAuth, googleAuthProvider, isAuthEmulatorEnabled } from '../config/firebase';
import { GOOGLE_LOGIN_BUSINESS_KEY, GOOGLE_LOGIN_SCOPE_KEY } from '../constants/google-auth-storage';
import { getGoogleRedirectResultOnce } from '../utils/google-auth-redirect';
import { PublicBusinessInfo } from './business.service';
import type { SubscriptionModuleId } from '../../../../../shared/subscription-modules.ts';
import {
  normalizePlatformAccess,
  type ClientPlatformAccess,
} from '../../../../../shared/platform-access.ts';
import {
  AUTH_BUSINESS_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  DEFAULT_BUSINESS_ID,
} from '../constants/auth-storage';

export type AuthScope = 'company' | 'platform';

export interface AuthSession {
  token: string;
  user: SessionUser;
  businessId?: string;
  scope?: AuthScope;
  business?: PublicBusinessInfo;
}

export interface SessionUser {
  id?: string;
  nombre: string;
  email?: string;
  loginUsername?: string;
  rol: UserRole | 'superadmin';
  permisos?: Permission[];
  activo?: boolean;
  tema?: 'light' | 'dark';
  hasPassword?: boolean;
  hasGoogle?: boolean;
  colaboradorId?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private currentUserSubject = new BehaviorSubject<SessionUser | null>(null);
  private businessSubject = new BehaviorSubject<PublicBusinessInfo | null>(null);
  private token: string | null = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  private businessId: string | null = localStorage.getItem(AUTH_BUSINESS_STORAGE_KEY);
  private scope: AuthScope = 'company';

  readonly currentUser$ = this.currentUserSubject.asObservable();
  readonly business$ = this.businessSubject.asObservable();
  readonly isAuthenticated$ = this.currentUser$.pipe(map((user) => !!user));

  get currentUser(): SessionUser | null {
    return this.currentUserSubject.value;
  }

  get authToken(): string | null {
    return this.token;
  }

  get currentBusinessId(): string {
    return this.businessId ?? DEFAULT_BUSINESS_ID;
  }

  get currentBusiness(): PublicBusinessInfo | null {
    return this.businessSubject.value;
  }

  get appBrandTitle(): string {
    if (this.isPlatformAdmin) return 'RILO Plataforma';
    return this.currentBusiness?.nombre?.trim() || 'RILO Gestión';
  }

  get authScope(): AuthScope {
    return this.scope;
  }

  get isPlatformAdmin(): boolean {
    return this.scope === 'platform';
  }

  get currentUserName(): string {
    return this.currentUser?.nombre?.trim() || 'Usuario';
  }

  get currentRole(): UserRole | 'superadmin' {
    return this.currentUser?.rol ?? 'staff';
  }

  get currentRoleLabel(): string {
    if (this.isPlatformAdmin) return 'Superadmin plataforma';
    return USER_ROLE_LABELS[this.currentRole as UserRole] ?? this.currentRole;
  }

  /** Etiqueta corta del rol para la barra superior. */
  get currentRoleShortLabel(): string {
    if (this.isPlatformAdmin) return 'Superadmin';
    const short: Record<UserRole, string> = {
      supervisor: 'Administrador',
      admin: 'Admin delegado',
      staff: 'Operador',
    };
    return short[this.currentRole as UserRole] ?? this.currentRoleLabel;
  }

  get homeRoute(): string {
    if (this.isPlatformAdmin) return '/platform';
    if (!this.canAccessErpWeb) return '/mi-cuenta';
    return '/dashboard';
  }

  get platformAccess(): ClientPlatformAccess {
    return normalizePlatformAccess(this.currentBusiness?.platformAccess);
  }

  get canAccessErpWeb(): boolean {
    if (this.isPlatformAdmin) return true;
    return this.platformAccess.erpWebEnabled;
  }

  get canAccessWhatsapp(): boolean {
    return this.platformAccess.whatsappEnabled;
  }

  get userInitial(): string {
    return (this.currentUserName.trim()[0] ?? 'U').toUpperCase();
  }

  get isSupervisor(): boolean {
    return this.currentRole === 'supervisor';
  }

  /** Administrador principal de la empresa (rol supervisor). */
  get isCompanyAdmin(): boolean {
    return this.isSupervisor;
  }

  get isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

  get isPrivileged(): boolean {
    return this.isSupervisor || this.isAdmin;
  }

  get canEditRecords(): boolean {
    return this.hasPermission(PERMISSIONS.RECORDS_EDIT);
  }

  get canDeleteRecords(): boolean {
    return this.hasPermission(PERMISSIONS.RECORDS_DELETE);
  }

  get canViewStockCosts(): boolean {
    return this.hasPermission(PERMISSIONS.ECONOMICS_VIEW);
  }

  get canViewStockPrices(): boolean {
    return this.hasPermission(PERMISSIONS.STOCK_VIEW_PRICES);
  }

  get canChangeOrderStatus(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_CHANGE_STATUS);
  }

  get canViewEconomics(): boolean {
    return this.hasModule('economics') && this.hasPermission(PERMISSIONS.ECONOMICS_VIEW);
  }

  get canViewReports(): boolean {
    return this.hasModule('reports') && this.hasPermission(PERMISSIONS.REPORTS_VIEW);
  }

  get canAccessCash(): boolean {
    return this.hasModule('caja') && this.hasPermission(PERMISSIONS.CASH_ACCESS);
  }

  get canViewAccountBalance(): boolean {
    return this.hasPermission(PERMISSIONS.ACCOUNT_BALANCE_VIEW);
  }

  get canEditPersonalization(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_PERSONALIZATION);
  }

  get canViewOrderSalePrice(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_SALE_PRICE);
  }

  /** Pagos y saldo pendiente en pedidos (precio de venta o saldos de cuenta). */
  get canViewOrderBalance(): boolean {
    return this.canViewAccountBalance || this.canViewOrderSalePrice;
  }

  /** Registrar pagos en pedidos (caja completa o precio de venta en pedidos). */
  get canRegisterOrderPayments(): boolean {
    return this.canAccessCash || this.canViewOrderSalePrice;
  }

  get canViewAllOrders(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_ALL);
  }

  get canViewDeliveredOrders(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_DELIVERED);
  }

  get canPrintOrders(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_PRINT);
  }

  get canCreateSales(): boolean {
    return this.hasPermission(PERMISSIONS.SALES_CREATE);
  }

  get canViewSalesHistory(): boolean {
    return this.hasPermission(PERMISSIONS.SALES_VIEW_HISTORY);
  }

  get canViewSalesSummary(): boolean {
    return this.hasPermission(PERMISSIONS.SALES_VIEW_SUMMARY);
  }

  get canAccessSales(): boolean {
    return this.hasModule('core') && (this.canCreateSales || this.canViewSalesHistory);
  }

  get canAccessPurchases(): boolean {
    return this.hasModule('core') && this.hasPermission(PERMISSIONS.PURCHASES_ACCESS);
  }

  get canAccessPayables(): boolean {
    return this.hasModule('payables') && this.hasPermission(PERMISSIONS.PAYABLES_ACCESS);
  }

  get canAccessCollaborators(): boolean {
    return this.hasModule('collaborators') && this.hasPermission(PERMISSIONS.COLLABORATORS_ACCESS);
  }

  /** Colaborador vinculado al operador (configurado por el administrador). */
  get linkedCollaboratorId(): string | null {
    const id = String(this.currentUser?.colaboradorId ?? '').trim();
    return id || null;
  }

  /** Operador que solo puede ver/gestionar sus propias horas. */
  get isOwnCollaboratorScope(): boolean {
    if (this.isPrivileged) return false;
    return !!this.linkedCollaboratorId && this.canAccessCollaborators;
  }

  get canViewPriceCatalog(): boolean {
    return this.hasModule('price_catalog') && this.hasPermission(PERMISSIONS.PRICES_VIEW);
  }

  get canManagePriceCatalog(): boolean {
    return this.hasModule('price_catalog') && this.hasPermission(PERMISSIONS.PRICES_MANAGE);
  }

  get canAccessOrders(): boolean {
    return this.hasModule('pedidos');
  }

  canViewOrder(estado?: string): boolean {
    const user = this.currentUser;
    if (!user || user.activo === false) return false;
    return canStaffViewOrder(user.rol as UserRole, user.permisos, estado);
  }

  get canManageUsers(): boolean {
    if (this.isPlatformAdmin) return false;
    return canManageUsers(this.currentRole as UserRole);
  }

  get canManageSettings(): boolean {
    if (this.isPlatformAdmin) return false;
    return canManageSettings(
      this.currentRole as UserRole,
      this.currentUser?.permisos as Permission[] | undefined
    );
  }

  initialize(): Observable<boolean> {
    if (!this.token) {
      this.currentUserSubject.next(null);
      return of(false);
    }

    return this.http.get<{ user: SessionUser; business?: PublicBusinessInfo; businessId?: string; scope?: AuthScope }>(
      '/api/auth/me'
    ).pipe(
      tap(({ user, business, businessId, scope }) => {
        this.scope = scope ?? 'company';
        this.setSession(this.token!, user, businessId, business);
      }),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      })
    );
  }

  login(
    login: string,
    password: string,
    options?: { businessId?: string; scope?: AuthScope }
  ): Observable<AuthSession> {
    return this.http
      .post<AuthSession>('/api/auth/login', {
        login,
        password,
        businessId: options?.businessId,
        scope: options?.scope ?? 'company',
      })
      .pipe(tap((session) => this.applySession(session)));
  }

  /** Establece sesión tras registro autoservicio (token ya emitido por backend). */
  establishTrialSession(session: AuthSession): void {
    this.applySession(session);
  }

  loginWithGoogle(businessId: string): Observable<AuthSession> {
    sessionStorage.setItem(GOOGLE_LOGIN_SCOPE_KEY, 'company');
    sessionStorage.setItem(GOOGLE_LOGIN_BUSINESS_KEY, businessId);

    if (this.shouldUseGoogleRedirect()) {
      return from(signInWithRedirect(firebaseAuth, googleAuthProvider)).pipe(switchMap(() => NEVER));
    }

    return from(signInWithPopup(firebaseAuth, googleAuthProvider)).pipe(
      catchError((err) => {
        const code = (err as { code?: string })?.code;
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment'
        ) {
          return from(signInWithRedirect(firebaseAuth, googleAuthProvider)).pipe(switchMap(() => NEVER));
        }
        return throwError(() => err);
      }),
      switchMap((credential) => {
        const user = credential.user;
        if (!user) {
          return throwError(() => new Error('NO_GOOGLE_USER'));
        }
        this.clearGoogleLoginPending();
        return this.exchangeGoogleUser(user, 'company', businessId);
      })
    );
  }

  loginWithGooglePlatform(): Observable<AuthSession> {
    sessionStorage.setItem(GOOGLE_LOGIN_SCOPE_KEY, 'platform');
    sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);

    if (this.shouldUseGoogleRedirect()) {
      return from(signInWithRedirect(firebaseAuth, googleAuthProvider)).pipe(switchMap(() => NEVER));
    }

    return from(signInWithPopup(firebaseAuth, googleAuthProvider)).pipe(
      catchError((err) => {
        const code = (err as { code?: string })?.code;
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment'
        ) {
          return from(signInWithRedirect(firebaseAuth, googleAuthProvider)).pipe(switchMap(() => NEVER));
        }
        return throwError(() => err);
      }),
      switchMap((credential) => {
        const user = credential.user;
        if (!user) {
          return throwError(() => new Error('NO_GOOGLE_USER'));
        }
        this.clearGoogleLoginPending();
        return this.exchangeGoogleUser(user, 'platform');
      })
    );
  }

  completeGoogleRedirectLogin(): Observable<AuthSession> {
    const pendingScope = sessionStorage.getItem(GOOGLE_LOGIN_SCOPE_KEY);
    const pendingBusiness = sessionStorage.getItem(GOOGLE_LOGIN_BUSINESS_KEY)?.trim();
    const hasPendingGoogleLogin = pendingScope === 'platform' || !!pendingBusiness;

    if (!hasPendingGoogleLogin) {
      return throwError(() => new Error('NO_REDIRECT'));
    }

    return from(getGoogleRedirectResultOnce()).pipe(
      switchMap((credential) =>
        this.resolveFirebaseUserAfterRedirect(credential?.user ?? null, hasPendingGoogleLogin)
      ),
      switchMap((firebaseUser) => {
        if (!firebaseUser) {
          return throwError(() => new Error('NO_REDIRECT'));
        }

        const scope = (sessionStorage.getItem(GOOGLE_LOGIN_SCOPE_KEY) ?? 'company') as AuthScope;
        const businessId = sessionStorage.getItem(GOOGLE_LOGIN_BUSINESS_KEY)?.trim();
        this.clearGoogleLoginPending();

        if (scope === 'platform') {
          return this.exchangeGoogleUser(firebaseUser, 'platform');
        }

        if (!businessId) {
          return throwError(() => new Error('Falta el código de empresa. Volvé a intentarlo.'));
        }

        return this.exchangeGoogleUser(firebaseUser, 'company', businessId);
      })
    );
  }

  logout() {
    this.http.post('/api/auth/logout', {}).subscribe({ complete: () => this.clearSession() });
    this.clearSession();
  }

  refreshUsers(): Observable<AppUser[]> {
    return this.http.get<AppUser[]>(`/api/users/${this.currentBusinessId}`).pipe(
      tap((users) => {
        const current = this.currentUser;
        if (current?.id) {
          const updated = users.find((user) => user.id === current.id);
          if (updated) {
            this.currentUserSubject.next(updated);
          }
        }
      })
    );
  }

  changePassword(payload: {
    currentPassword?: string;
    newPassword: string;
  }): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>('/api/auth/me/password', payload).pipe(
      tap(() => {
        const current = this.currentUser;
        if (current) {
          this.currentUserSubject.next({ ...current, hasPassword: true });
        }
      })
    );
  }

  updateProfile(payload: {
    nombre: string;
    email?: string;
    loginUsername: string;
  }): Observable<{ user: SessionUser }> {
    return this.http.patch<{ user: SessionUser }>('/api/auth/me/profile', payload).pipe(
      tap(({ user }) => {
        this.currentUserSubject.next(user);
      })
    );
  }

  hasPermission(permission: Permission): boolean {
    const user = this.currentUser;
    if (!user || user.activo === false) return false;
    return userHasPermission(user.rol as UserRole, user.permisos, permission);
  }

  hasModule(moduleId: SubscriptionModuleId): boolean {
    if (this.isPlatformAdmin) return true;
    const entitlements = this.currentBusiness?.entitlements;
    if (!entitlements) return true;
    if (moduleId === 'core') return true;
    if (moduleId === 'order_photos') {
      if (entitlements.order_photos === true) return true;
      return entitlements.pedidos === true;
    }
    return entitlements[moduleId] === true;
  }

  get isTrialExpired(): boolean {
    return this.currentBusiness?.trialStatus === 'expired';
  }

  get isTrialExpiringSoon(): boolean {
    return (
      this.currentBusiness?.trialExpiringSoon === true &&
      this.currentBusiness?.trialStatus === 'active'
    );
  }

  get trialDaysRemaining(): number | null {
    const days = this.currentBusiness?.trialDaysRemaining;
    return days === null || days === undefined ? null : days;
  }

  private shouldUseGoogleRedirect(): boolean {
    return isAuthEmulatorEnabled;
  }

  private clearGoogleLoginPending(): void {
    sessionStorage.removeItem(GOOGLE_LOGIN_SCOPE_KEY);
    sessionStorage.removeItem(GOOGLE_LOGIN_BUSINESS_KEY);
  }

  private exchangeGoogleUser(
    firebaseUser: User,
    scope: AuthScope,
    businessId?: string
  ): Observable<AuthSession> {
    return from(firebaseUser.getIdToken()).pipe(
      switchMap((idToken) =>
        this.http.post<AuthSession>(
          '/api/auth/google',
          scope === 'platform'
            ? { idToken, scope: 'platform' }
            : { idToken, businessId, scope: 'company' }
        )
      ),
      tap((session) => this.applySession(session))
    );
  }

  private resolveFirebaseUserAfterRedirect(
    initialUser: User | null,
    hasPendingGoogleLogin: boolean
  ): Observable<User | null> {
    if (initialUser) return of(initialUser);
    if (firebaseAuth.currentUser) return of(firebaseAuth.currentUser);
    if (!hasPendingGoogleLogin) return of(null);

    return new Observable<User | null>((subscriber) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = (user: User | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        subscriber.next(user);
        subscriber.complete();
      };

      unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
        if (user) finish(user);
      });
      const timer = setTimeout(() => finish(firebaseAuth.currentUser), 8000);

      return () => {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
      };
    });
  }

  private applySession(session: AuthSession) {
    this.scope = session.scope ?? 'company';
    this.setSession(session.token, session.user, session.businessId, session.business);
  }

  private setSession(
    token: string,
    user: SessionUser,
    businessId?: string,
    business?: PublicBusinessInfo | null
  ) {
    this.token = token;
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);

    if (businessId) {
      this.businessId = businessId;
      localStorage.setItem(AUTH_BUSINESS_STORAGE_KEY, businessId);
    } else if (this.scope === 'platform') {
      this.businessId = null;
      localStorage.removeItem(AUTH_BUSINESS_STORAGE_KEY);
    }

    this.currentUserSubject.next(user);
    this.businessSubject.next(business ?? null);
  }

  private clearSession() {
    this.token = null;
    this.businessId = null;
    this.scope = 'company';
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_BUSINESS_STORAGE_KEY);
    this.currentUserSubject.next(null);
    this.businessSubject.next(null);
  }
}
