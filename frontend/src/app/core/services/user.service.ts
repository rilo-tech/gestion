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
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserPayload extends AppUser {
  password?: string;
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
