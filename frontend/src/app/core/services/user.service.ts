import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Permission, UserRole } from '../constants/permissions';
import { TenantService } from './tenant.service';

export interface AppUser {
  id?: string;
  nombre: string;
  email?: string;
  loginUsername?: string;
  rol: UserRole;
  permisos: Permission[];
  activo: boolean;
  tema?: 'light' | 'dark';
  hasPassword?: boolean;
  hasGoogle?: boolean;
  colaboradorId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserPayload extends AppUser {
  password?: string;
}

export interface PaginatedUsers {
  items: AppUser[];
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getUsers(): Observable<AppUser[]> {
    return this.http.get<AppUser[]>(`/api/users/${this.businessId}`);
  }

  getUsersPage(limit = 120, cursor?: string): Observable<PaginatedUsers> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedUsers>(`/api/users/${this.businessId}`, { params });
  }

  getUser(userId: string): Observable<AppUser> {
    return this.http.get<AppUser>(`/api/users/${this.businessId}/${userId}`);
  }

  createUser(user: CreateUserPayload): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/users/${this.businessId}`, user);
  }

  updateUser(userId: string, user: CreateUserPayload): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`/api/users/${this.businessId}/${userId}`, user);
  }

  deleteUser(userId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/users/${this.businessId}/${userId}`);
  }
}
