import { Injectable } from '@angular/core';
import {
  Permission,
  PERMISSIONS,
  roleHasPermission,
  UserRole,
  USER_ROLE_LABELS,
} from '../constants/permissions';

/**
 * Placeholder de autenticación/roles hasta integrar login real.
 * Cambiar `currentRole` / `currentUserName` (o leerlos de sesión) para probar vistas restringidas.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /** TODO: reemplazar por usuario autenticado desde backend/sesión. */
  readonly currentUserName = 'RILO';
  readonly currentRole: UserRole = 'admin';

  get currentRoleLabel(): string {
    return USER_ROLE_LABELS[this.currentRole];
  }

  get userInitial(): string {
    return (this.currentUserName.trim()[0] ?? 'U').toUpperCase();
  }

  hasPermission(permission: Permission): boolean {
    return roleHasPermission(this.currentRole, permission);
  }

  get canViewOrderEconomics(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_ECONOMICS);
  }

  get canViewOrderSalePrice(): boolean {
    return this.hasPermission(PERMISSIONS.ORDERS_VIEW_SALE_PRICE);
  }
}
