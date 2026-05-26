import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ADMIN_ASSIGNABLE_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  Permission,
  STAFF_PERMISSION_GROUPS,
  sanitizeStaffPermissions,
  USER_ROLE_LABELS,
  UserRole,
} from '../../core/constants/permissions';
import { AppUser, CreateUserPayload, UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import {
  BusinessService,
  PublicBusinessInfo,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-settings-users-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="space-y-4 sm:space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900">Usuarios y permisos</h2>
          <p class="text-sm text-gray-500 mt-1 desc-lg-only">
            Como administrador de la empresa podés crear operadores y asignar permisos.
            El plan y la suscripción los gestiona la plataforma RILO.
          </p>
        </div>
        <button
          type="button"
          (click)="toggleCreateUserForm()"
          class="text-sm font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0 self-start sm:self-auto">
          {{ showCreateUserForm ? 'Cancelar' : '+ Crear usuario' }}
        </button>
      </div>

      <article *ngIf="business as info" class="bg-teal-50 border border-teal-100 rounded-xl p-4 sm:p-5">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">Tu empresa</p>
            <h3 class="text-lg font-bold text-gray-900">{{ info.nombre }}</h3>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <div>
              <p class="text-gray-500">Plan</p>
              <p class="font-semibold text-gray-900">{{ info.plan.nombre }}</p>
            </div>
            <div>
              <p class="text-gray-500">Suscripción</p>
              <p class="font-semibold" [class.text-green-700]="info.estadoSuscripcion === 'activa'"
                 [class.text-red-700]="info.estadoSuscripcion === 'suspendida' || info.estadoSuscripcion === 'vencida'">
                {{ statusLabels[info.estadoSuscripcion] }}
              </p>
            </div>
            <div>
              <p class="text-gray-500">Administradores</p>
              <p class="font-semibold text-gray-900">
                {{ info.administradoresActivos }} / {{ info.plan.limiteAdministradores }}
              </p>
            </div>
            <div>
              <p class="text-gray-500">Operadores</p>
              <p class="font-semibold text-gray-900">
                {{ info.operadoresActivos }} / {{ info.plan.limiteOperadores }}
              </p>
            </div>
            <div>
              <p class="text-gray-500">Total usuarios</p>
              <p class="font-semibold text-gray-900">
                {{ info.usuariosActivos }} / {{ info.plan.limiteUsuariosTotal }}
              </p>
            </div>
            <div>
              <p class="text-gray-500">Cupos libres</p>
              <p class="font-semibold text-gray-900">
                {{ info.administradoresDisponibles }} admin · {{ info.operadoresDisponibles }} op.
              </p>
            </div>
          </div>
        </div>
      </article>

      <article
        *ngIf="showCreateUserForm"
        class="rounded-xl border shadow-sm overflow-hidden bg-teal-50/40 border-teal-100">
        <div class="border-l-4 border-l-teal-500 p-4 sm:p-5">
          <h3 class="font-bold text-gray-900 mb-1">Nuevo usuario</h3>
          <p class="text-sm text-gray-600 mb-4 desc-lg-only">
            Los administradores delegados y operadores cuentan dentro del límite del plan.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input [(ngModel)]="draft.nombre" name="newUserNombre" placeholder="Nombre *"
                   class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <input [(ngModel)]="draft.email" name="newUserEmail" placeholder="Email"
                   class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <input [(ngModel)]="draft.loginUsername" name="newUserLogin" placeholder="Usuario de acceso *"
                   class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <input [(ngModel)]="draft.password" name="newUserPassword" type="password" placeholder="Contraseña inicial"
                   class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <select [(ngModel)]="draft.rol" name="newUserRol"
                    class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm md:col-span-2">
              <option value="staff">{{ roleLabels.staff }}</option>
              <option value="admin" [disabled]="!canCreateAdministrator">{{ roleLabels.admin }}</option>
            </select>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              (click)="showCreateUserForm = false"
              class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">
              Cancelar
            </button>
            <button
              type="button"
              (click)="createUser()"
              [disabled]="creatingUser || !canCreateSelectedRole"
              class="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ creatingUser ? 'Creando...' : createButtonLabel }}
            </button>
          </div>
        </div>
      </article>

      <div *ngIf="loadingUsers" class="py-8 text-center text-sm text-gray-400">Cargando usuarios...</div>

      <div class="space-y-3">
        <article
          *ngFor="let user of users"
          class="rounded-xl border shadow-sm overflow-hidden"
          [ngClass]="getUserCardShellClass(user)">
          <div
            role="button"
            tabindex="0"
            (click)="toggleUserPanel(user.id)"
            (keydown.enter)="toggleUserPanel(user.id)"
            class="border-l-4 p-4 sm:p-5 cursor-pointer transition-colors hover:bg-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            [ngClass]="getUserAccentClass(user)">
            <div class="flex items-center gap-3 min-w-0">
              <span
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                [ngClass]="getUserAvatarClass(user)">
                {{ getUserInitial(user) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-bold text-gray-900">{{ user.nombre }}</h3>
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold" [ngClass]="getUserRoleBadgeClass(user)">
                    {{ roleLabels[user.rol] }}
                  </span>
                  <span *ngIf="user.id === auth.currentUser?.id" class="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
                    Vos
                  </span>
                  <span
                    *ngIf="user.rol !== 'supervisor'"
                    class="px-2 py-0.5 rounded-full text-xs font-semibold"
                    [class.bg-green-100]="user.activo !== false"
                    [class.text-green-800]="user.activo !== false"
                    [class.bg-gray-200]="user.activo === false"
                    [class.text-gray-600]="user.activo === false">
                    {{ user.activo !== false ? 'Activo' : 'Inactivo' }}
                  </span>
                </div>
                <p class="text-sm text-gray-600 mt-1 truncate">
                  {{ getUserCollapsedSummary(user) }}
                </p>
              </div>
              <i-lucide
                [name]="isUserExpanded(user.id) ? 'chevron-up' : 'chevron-down'"
                class="w-5 h-5 shrink-0 text-gray-400">
              </i-lucide>
            </div>
          </div>

          <div
            *ngIf="isUserExpanded(user.id)"
            class="border-t border-gray-200/80 bg-white/80 px-4 sm:px-5 py-4 sm:py-5"
            (click)="$event.stopPropagation()">
            <div class="rounded-lg border border-gray-100 bg-white p-4 mb-4 space-y-2 text-sm">
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500">Email</span>
                <span class="font-medium text-gray-900">{{ user.email || 'Sin email' }}</span>
              </div>
              <div *ngIf="user.loginUsername" class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500">Usuario</span>
                <span class="font-medium text-gray-900">{{ user.loginUsername }}</span>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500">Acceso</span>
                <span class="font-medium text-gray-900">
                  <span *ngIf="user.hasPassword">Contraseña</span>
                  <span *ngIf="user.hasPassword && user.hasGoogle"> · </span>
                  <span *ngIf="user.hasGoogle">Google</span>
                  <span *ngIf="!user.hasPassword && !user.hasGoogle">Sin métodos registrados</span>
                </span>
              </div>
              <p *ngIf="user.id === auth.currentUser?.id" class="text-xs text-teal-700 pt-1">
                <a routerLink="/mi-cuenta" class="font-medium hover:underline">Cambiar mi contraseña</a>
              </p>
            </div>

            <label
              *ngIf="user.rol !== 'supervisor'"
              class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm mb-4 cursor-pointer">
              <input
                type="checkbox"
                [(ngModel)]="user.activo"
                [name]="'activo' + user.id"
                class="rounded border-gray-300 text-teal-600">
              Cuenta activa
            </label>

            <p *ngIf="user.rol === 'supervisor'" class="text-sm text-gray-600 mb-4 desc-lg-only">
              Administrador principal de la empresa. Acceso completo y gestión de operadores.
            </p>
            <p *ngIf="user.rol === 'admin'" class="text-sm text-gray-600 mb-4 desc-lg-only">
              Administrador delegado con acceso completo al negocio, sin gestionar usuarios.
            </p>

            <ng-container *ngIf="user.rol === 'staff'">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Permisos del operador
              </p>
              <div class="space-y-4">
                <div *ngFor="let group of staffPermissionGroups" class="space-y-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">{{ group.label }}</p>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label
                      *ngFor="let perm of group.permissions"
                      class="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 cursor-pointer hover:border-teal-200">
                      <input
                        type="checkbox"
                        [checked]="hasPermission(user, perm.key)"
                        (change)="togglePermission(user, perm.key, $any($event.target).checked)"
                        class="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600">
                      <span class="min-w-0">
                        <span class="block text-sm font-medium text-gray-800">{{ perm.label }}</span>
                        <span *ngIf="perm.description" class="block text-xs text-gray-500 desc-lg-only">{{ perm.description }}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </ng-container>

            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                (click)="toggleUserPanel(user.id)"
                class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cerrar
              </button>
              <button
                *ngIf="user.rol !== 'supervisor'"
                type="button"
                (click)="saveUser(user)"
                [disabled]="savingUserId === user.id"
                class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                {{
                  savingUserId === user.id
                    ? 'Guardando...'
                    : (user.rol === 'staff' ? 'Guardar cambios' : 'Guardar estado')
                }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  `,
})
export class SettingsUsersPanelComponent implements OnInit {
  readonly auth = inject(AuthService);
  private userService = inject(UserService);
  private businessService = inject(BusinessService);
  private dialogService = inject(DialogService);

  readonly roleLabels = USER_ROLE_LABELS;
  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;
  readonly assignablePermissions = ADMIN_ASSIGNABLE_PERMISSIONS;
  readonly staffPermissionGroups = STAFF_PERMISSION_GROUPS;

  users: AppUser[] = [];
  business: PublicBusinessInfo | null = null;
  loadingUsers = false;
  creatingUser = false;
  savingUserId: string | null = null;
  expandedUserId: string | null = null;
  showCreateUserForm = false;

  draft = {
    nombre: '',
    email: '',
    loginUsername: '',
    password: '',
    rol: 'staff' as UserRole,
  };

  get canCreateAdministrator(): boolean {
    if (!this.business) return false;
    return this.business.administradoresDisponibles > 0 && this.business.usuariosDisponibles > 0;
  }

  get canCreateOperator(): boolean {
    if (!this.business) return true;
    return this.business.operadoresDisponibles > 0 && this.business.usuariosDisponibles > 0;
  }

  get canCreateSelectedRole(): boolean {
    return this.draft.rol === 'admin' ? this.canCreateAdministrator : this.canCreateOperator;
  }

  get createButtonLabel(): string {
    if (!this.canCreateSelectedRole) {
      return this.draft.rol === 'admin'
        ? 'Sin cupo de administradores'
        : 'Sin cupo de operadores';
    }
    return this.draft.rol === 'admin' ? 'Crear administrador' : 'Crear operador';
  }

  ngOnInit() {
    this.loadBusiness();
    this.loadUsers();
  }

  hasPermission(user: AppUser, permission: Permission): boolean {
    return (user.permisos ?? []).includes(permission);
  }

  isUserExpanded(userId?: string): boolean {
    return !!userId && this.expandedUserId === userId;
  }

  toggleUserPanel(userId?: string) {
    if (!userId) return;
    this.expandedUserId = this.expandedUserId === userId ? null : userId;
    if (this.expandedUserId) {
      this.showCreateUserForm = false;
    }
  }

  toggleCreateUserForm() {
    this.showCreateUserForm = !this.showCreateUserForm;
    if (this.showCreateUserForm) {
      this.expandedUserId = null;
    }
  }

  getUserCollapsedSummary(user: AppUser): string {
    if (user.rol === 'supervisor') {
      return 'Administrador principal · acceso completo';
    }
    if (user.rol === 'admin') {
      return 'Administrador delegado · acceso completo al negocio';
    }
    return this.getPermissionSummary(user);
  }

  getUserInitial(user: AppUser): string {
    return (user.nombre.trim()[0] ?? 'U').toUpperCase();
  }

  getPermissionCount(user: AppUser): number {
    return (user.permisos ?? []).filter((permission) =>
      this.assignablePermissions.some((item) => item.key === permission)
    ).length;
  }

  getPermissionSummary(user: AppUser): string {
    const count = this.getPermissionCount(user);
    if (count === 0) return 'Sin permisos asignados todavía.';
    return `${count} permiso${count === 1 ? '' : 's'} activo${count === 1 ? '' : 's'}.`;
  }

  getUserCardShellClass(user: AppUser): string {
    if (user.rol === 'supervisor') return 'bg-violet-50/60 border-violet-100';
    if (user.rol === 'admin') return 'bg-sky-50/60 border-sky-100';
    return 'bg-teal-50/40 border-teal-100';
  }

  getUserAccentClass(user: AppUser): string {
    if (user.rol === 'supervisor') return 'border-l-violet-500';
    if (user.rol === 'admin') return 'border-l-sky-500';
    return 'border-l-teal-500';
  }

  getUserAvatarClass(user: AppUser): string {
    if (user.rol === 'supervisor') return 'bg-violet-600 text-white';
    if (user.rol === 'admin') return 'bg-sky-600 text-white';
    return 'bg-teal-600 text-white';
  }

  getUserRoleBadgeClass(user: AppUser): string {
    if (user.rol === 'supervisor') return 'bg-violet-100 text-violet-800';
    if (user.rol === 'admin') return 'bg-sky-100 text-sky-800';
    return 'bg-teal-100 text-teal-800';
  }

  togglePermission(user: AppUser, permission: Permission, checked: boolean) {
    const current = new Set(user.permisos ?? []);
    if (checked) current.add(permission);
    else current.delete(permission);
    user.permisos = sanitizeStaffPermissions([...current]);
  }

  createUser() {
    if (!this.draft.nombre.trim()) {
      this.dialogService.alert({ title: 'Campo requerido', message: 'Ingresá el nombre.' });
      return;
    }

    const payload: CreateUserPayload = {
      nombre: this.draft.nombre.trim(),
      email: this.draft.email.trim().toLowerCase(),
      loginUsername: (this.draft.loginUsername || this.draft.email || this.draft.nombre)
        .trim()
        .toLowerCase(),
      rol: this.draft.rol === 'admin' ? 'admin' : 'staff',
      permisos: [...DEFAULT_STAFF_PERMISSIONS],
      activo: true,
      password: this.draft.password.trim() || undefined,
    };

    this.creatingUser = true;
    this.userService.createUser(payload).subscribe({
      next: () => {
        this.creatingUser = false;
        this.showCreateUserForm = false;
        this.draft = {
          nombre: '',
          email: '',
          loginUsername: '',
          password: '',
          rol: 'staff',
        };
        this.loadBusiness();
        this.loadUsers();
      },
      error: (err) => {
        this.creatingUser = false;
        this.dialogService.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo crear el usuario.',
        });
      },
    });
  }

  saveUser(user: AppUser) {
    if (!user.id || user.rol === 'supervisor') return;

    const payload: CreateUserPayload = {
      nombre: user.nombre,
      email: user.email ?? '',
      loginUsername: user.loginUsername ?? '',
      rol: user.rol,
      permisos: user.rol === 'staff' ? sanitizeStaffPermissions(user.permisos) : [],
      activo: user.activo !== false,
    };

    this.savingUserId = user.id;
    this.userService.updateUser(user.id, payload).subscribe({
      next: () => {
        this.savingUserId = null;
        this.auth.refreshUsers().subscribe();
        this.loadBusiness();
        this.loadUsers();
      },
      error: (err) => {
        this.savingUserId = null;
        this.dialogService.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo guardar el usuario.',
        });
      },
    });
  }

  private loadBusiness() {
    this.businessService.getBusinessInfo(this.auth.currentBusinessId).subscribe({
      next: (business) => {
        this.business = business;
      },
      error: () => {
        this.business = this.auth.currentBusiness;
      },
    });
  }

  private loadUsers() {
    this.loadingUsers = true;
    this.userService.getUsers().subscribe({
      next: (users) => {
        this.users = users.map((user) => ({
          ...user,
          permisos:
            user.rol === 'staff'
              ? sanitizeStaffPermissions(user.permisos)
              : [],
        }));
        this.loadingUsers = false;
      },
      error: () => {
        this.loadingUsers = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los usuarios.',
        });
      },
    });
  }
}
