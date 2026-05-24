import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ADMIN_ASSIGNABLE_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  Permission,
  ROLE_PRESETS,
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

@Component({
  selector: 'app-settings-users-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="space-y-4 sm:space-y-6">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Usuarios y permisos</h2>
        <p class="text-sm text-gray-500 mt-1">
          Como administrador de la empresa podés crear operadores y asignar permisos.
          El plan y la suscripción los gestiona la plataforma RILO.
        </p>
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
                 [class.text-amber-700]="info.estadoSuscripcion === 'suspendida'"
                 [class.text-red-700]="info.estadoSuscripcion === 'vencida'">
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

      <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <h3 class="text-sm font-bold text-gray-900 mb-1">Nuevo usuario</h3>
        <p class="text-xs text-gray-500 mb-4">
          Los administradores delegados y operadores cuentan dentro del límite del plan.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input [(ngModel)]="draft.nombre" name="newUserNombre" placeholder="Nombre *"
                 class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
          <input [(ngModel)]="draft.email" name="newUserEmail" placeholder="Email"
                 class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
          <input [(ngModel)]="draft.loginUsername" name="newUserLogin" placeholder="Usuario de acceso"
                 class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
          <input [(ngModel)]="draft.password" name="newUserPassword" type="password" placeholder="Contraseña inicial"
                 class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
          <select [(ngModel)]="draft.rol" name="newUserRol"
                  class="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm md:col-span-2">
            <option value="staff">{{ roleLabels.staff }}</option>
            <option value="admin" [disabled]="!canCreateAdministrator">{{ roleLabels.admin }}</option>
          </select>
        </div>
        <button type="button" (click)="createUser()" [disabled]="creatingUser || !canCreateSelectedRole"
                class="mt-4 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
          {{ creatingUser ? 'Creando...' : createButtonLabel }}
        </button>
      </article>

      <div *ngIf="loadingUsers" class="py-8 text-center text-sm text-gray-400">Cargando usuarios...</div>

      <div class="space-y-4">
        <article
          *ngFor="let user of users"
          class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-bold text-gray-900">{{ user.nombre }}</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                  {{ roleLabels[user.rol] }}
                </span>
                <span *ngIf="user.id === auth.currentUser?.id" class="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700">
                  Vos
                </span>
              </div>
              <p class="text-sm text-gray-500 mt-1">
                {{ user.email || 'Sin email' }}
                <span *ngIf="user.loginUsername"> · Usuario: {{ user.loginUsername }}</span>
              </p>
              <p class="text-xs text-gray-400 mt-1">
                <span *ngIf="user.hasPassword">Contraseña</span>
                <span *ngIf="user.hasPassword && user.hasGoogle"> · </span>
                <span *ngIf="user.hasGoogle">Google</span>
              </p>
            </div>
            <label *ngIf="user.rol !== 'supervisor'" class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" [(ngModel)]="user.activo" [name]="'activo' + user.id"
                     (change)="saveUser(user)" class="rounded border-gray-300 text-teal-600">
              Activo
            </label>
          </div>

          <p *ngIf="user.rol === 'supervisor'" class="text-sm text-gray-500">
            Administrador principal de la empresa. Acceso completo y gestión de operadores.
          </p>
          <p *ngIf="user.rol === 'admin'" class="text-sm text-gray-500">
            Administrador delegado con acceso completo al negocio, sin gestionar usuarios.
          </p>

          <ng-container *ngIf="user.rol === 'staff'">
            <div class="flex flex-wrap gap-2 mb-4">
              <button
                *ngFor="let preset of presetEntries"
                type="button"
                (click)="applyPreset(user, preset.key)"
                class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Perfil {{ preset.value.label }}
              </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label
                *ngFor="let perm of assignablePermissions"
                class="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2.5 cursor-pointer hover:border-teal-100">
                <input
                  type="checkbox"
                  [checked]="hasPermission(user, perm.key)"
                  (change)="togglePermission(user, perm.key, $any($event.target).checked)"
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600">
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-gray-800">{{ perm.label }}</span>
                  <span *ngIf="perm.description" class="block text-xs text-gray-500">{{ perm.description }}</span>
                </span>
              </label>
            </div>

            <div class="mt-4 flex justify-end">
              <button type="button" (click)="saveUser(user)" [disabled]="savingUserId === user.id"
                      class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                {{ savingUserId === user.id ? 'Guardando...' : 'Guardar permisos' }}
              </button>
            </div>
          </ng-container>
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
  readonly presetEntries = Object.entries(ROLE_PRESETS).map(([key, value]) => ({ key, value }));

  users: AppUser[] = [];
  business: PublicBusinessInfo | null = null;
  loadingUsers = false;
  creatingUser = false;
  savingUserId: string | null = null;

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

  togglePermission(user: AppUser, permission: Permission, checked: boolean) {
    const current = new Set(user.permisos ?? []);
    if (checked) current.add(permission);
    else current.delete(permission);
    user.permisos = sanitizeStaffPermissions([...current]);
  }

  applyPreset(user: AppUser, presetKey: string) {
    const preset = ROLE_PRESETS[presetKey];
    if (!preset) return;
    user.permisos = sanitizeStaffPermissions(preset.permisos);
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
