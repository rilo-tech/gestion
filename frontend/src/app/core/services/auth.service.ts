import { Injectable, inject } from '@angular/core';
import {
  Permission,
  PERMISSIONS,
  USER_ROLE_LABELS,
  UserRole,
  userHasPermission,
  canManageSettings,
  canManageUsers,
} from '../constants/permissions';
import { AppUser } from './user.service';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, map, tap, catchError, of } from 'rxjs';
import { signInWithPopup } from 'firebase/auth';
import { firebaseAuth, googleAuthProvider } from '../config/firebase';
import { PublicBusinessInfo } from './business.service';
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

  get homeRoute(): string {
    return this.isPlatformAdmin ? '/platform' : '/dashboard';
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

  get canViewEconomics(): boolean {
    return this.hasPermission(PERMISSIONS.ECONOMICS_VIEW);
  }

  get canViewReports(): boolean {
    return this.hasPermission(PERMISSIONS.REPORTS_VIEW);
  }

  get canAccessCash(): boolean {
    return this.hasPermission(PERMISSIONS.CASH_ACCESS);
  }

  get canEditPersonalization(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_PERSONALIZATION);
  }

  get canViewOrderSalePrice(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_SALE_PRICE);
  }

  get canManageUsers(): boolean {
    if (this.isPlatformAdmin) return false;
    return canManageUsers(this.currentRole as UserRole);
  }

  get canManageSettings(): boolean {
    if (this.isPlatformAdmin) return false;
    return canManageSettings(this.currentRole as UserRole);
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

  loginWithGoogle(businessId: string): Observable<AuthSession> {
    return new Observable((observer) => {
      signInWithPopup(firebaseAuth, googleAuthProvider)
        .then(async (credential) => {
          const idToken = await credential.user.getIdToken();
          this.http.post<AuthSession>('/api/auth/google', { idToken, businessId }).subscribe({
            next: (session) => {
              this.applySession(session);
              observer.next(session);
              observer.complete();
            },
            error: (err) => observer.error(err),
          });
        })
        .catch((err) => observer.error(err));
    });
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

  hasPermission(permission: Permission): boolean {
    const user = this.currentUser;
    if (!user || user.activo === false) return false;
    return userHasPermission(user.rol as UserRole, user.permisos, permission);
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
