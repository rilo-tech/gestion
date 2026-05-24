import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService, SessionUser } from './auth.service';
import { TenantService } from './tenant.service';

export type ThemePreference = 'light' | 'dark';

const PLATFORM_THEME_PREFIX = 'rilo-user-theme';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private tenant = inject(TenantService);

  readonly preference = signal<ThemePreference>('light');

  constructor() {
    this.auth.currentUser$.subscribe((user) => this.initializeFromUser(user));
  }

  initializeFromUser(user: SessionUser | null) {
    if (!user) {
      this.apply('light', { persist: false });
      return;
    }
    const stored = this.readStoredPreference(user);
    this.apply(stored ?? user.tema ?? 'light', { persist: false });
  }

  setPreference(theme: ThemePreference) {
    this.apply(theme, { persist: true });
  }

  toggle() {
    this.setPreference(this.preference() === 'dark' ? 'light' : 'dark');
  }

  private apply(theme: ThemePreference, options: { persist: boolean }) {
    const normalized: ThemePreference = theme === 'dark' ? 'dark' : 'light';
    this.preference.set(normalized);
    document.documentElement.classList.toggle('dark', normalized === 'dark');
    document.documentElement.style.colorScheme = normalized;

    if (!options.persist) return;

    const user = this.auth.currentUser;
    if (!user?.id) return;

    if (this.auth.isPlatformAdmin) {
      localStorage.setItem(this.platformStorageKey(user.id), normalized);
      return;
    }

    localStorage.setItem(this.companyStorageKey(user.id), normalized);
    this.http
      .patch<{ tema: ThemePreference }>(
        `/api/users/${this.tenant.businessId}/me/preferences`,
        { tema: normalized }
      )
      .subscribe({
        error: () => {
          // Mantener preferencia local aunque falle la red.
        },
      });
  }

  private readStoredPreference(user: SessionUser): ThemePreference | null {
    if (this.auth.isPlatformAdmin) {
      return this.normalizeTheme(localStorage.getItem(this.platformStorageKey(user.id!)));
    }

    const local = this.normalizeTheme(localStorage.getItem(this.companyStorageKey(user.id!)));
    if (local) return local;
    return this.normalizeTheme(user.tema);
  }

  private normalizeTheme(value: unknown): ThemePreference | null {
    return value === 'dark' ? 'dark' : value === 'light' ? 'light' : null;
  }

  private companyStorageKey(userId: string): string {
    return `${PLATFORM_THEME_PREFIX}-${this.tenant.businessId}-${userId}`;
  }

  private platformStorageKey(userId: string): string {
    return `${PLATFORM_THEME_PREFIX}-platform-${userId}`;
  }
}
