import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ADMIN_ASSIGNABLE_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  Permission,
  ROLE_PRESETS,
  STAFF_PERMISSION_GROUPS,
  sanitizeStaffPermissions,
  USER_ROLE_LABELS,
  UserRole,
  userHasPermission,
} from '../../core/constants/permissions';
import { AppUser, CreateUserPayload, UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import {
  BusinessService,
  PublicBusinessInfo,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  Collaborator,
  CollaboratorsService,
} from '../../core/services/collaborators.service';
import { LucideAngularModule } from 'lucide-angular';
import {
  PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE,
  PROGRESSIVE_LIST_FIRST_PAGE_SIZE,
  ProgressiveListSession,
} from '../../core/utils/progressive-list-load';

@Component({
  selector: 'app-settings-users-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="space-y-4 sm:space-y-6">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button
          *ngIf="expandedUserId && canSaveExpandedUser"
          type="button"
          (click)="saveExpandedUser()"
          [disabled]="!!savingUserId"
          title="Guardar usuario"
          aria-label="Guardar usuario"
          class="p-1.5 rounded-lg text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <i-lucide
            [name]="savingUserId ? 'loader-circle' : 'save'"
            class="w-5 h-5"
            [class.animate-spin]="!!savingUserId">
          </i-lucide>
        </button>
        <button
          type="button"
          (click)="toggleCreateUserForm()"
          class="text-sm font-semibold text-teal-700 hover:text-teal-900 dark:text-teal-400 hover:underline shrink-0">
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
            <label *ngIf="draft.rol === 'staff'" class="block md:col-span-2">
              <span class="text-xs font-medium text-gray-500 mb-1 block">Colaborador vinculado</span>
              <select
                [(ngModel)]="draft.colaboradorId"
                name="newUserColaborador"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                <option [ngValue]="null">Sin vincular</option>
                <option *ngFor="let collaborator of activeCollaborators" [ngValue]="collaborator.id">
                  {{ collaborator.nombre }}
                </option>
              </select>
              <span class="mt-1 block text-xs text-gray-500 desc-lg-only">
                Si lo vinculás y le das permiso de colaboradores, el operador verá solo sus horas al ingresar.
              </span>
            </label>
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
            class="border-l-4 p-4 sm:p-5 cursor-pointer transition-colors hover:bg-white/50 dark:hover:bg-gray-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            [ngClass]="getUserAccentClass(user)">
            <div class="flex items-center gap-3 min-w-0">
              <span
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                [ngClass]="getUserAvatarClass(user)">
                {{ getUserInitial(user) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-bold text-gray-900 dark:text-gray-100">{{ user.nombre }}</h3>
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold" [ngClass]="getUserRoleBadgeClass(user)">
                    {{ roleLabels[user.rol] }}
                  </span>
                  <span
                    *ngIf="user.id === auth.currentUser?.id"
                    class="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 dark:ring-1 dark:ring-teal-700/50">
                    Vos
                  </span>
                  <span
                    *ngIf="user.rol !== 'supervisor'"
                    class="px-2 py-0.5 rounded-full text-xs font-semibold"
                    [ngClass]="user.activo !== false
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'">
                    {{ user.activo !== false ? 'Activo' : 'Inactivo' }}
                  </span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                  {{ getUserCollapsedSummary(user) }}
                </p>
              </div>
              <i-lucide
                [name]="isUserExpanded(user.id) ? 'chevron-up' : 'chevron-down'"
                class="w-5 h-5 shrink-0 text-gray-400 dark:text-gray-500">
              </i-lucide>
            </div>
          </div>

          <div
            *ngIf="isUserExpanded(user.id)"
            class="border-t border-gray-200/80 bg-gray-50/90 dark:border-gray-700 dark:bg-gray-900/70 px-4 sm:px-5 py-4 sm:py-5"
            (click)="$event.stopPropagation()">
            <div class="rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/90 p-4 mb-4 space-y-2 text-sm">
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500 dark:text-gray-400">Email</span>
                <span class="font-medium text-gray-900 dark:text-gray-100">{{ user.email || 'Sin email' }}</span>
              </div>
              <div *ngIf="user.loginUsername" class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500 dark:text-gray-400">Usuario</span>
                <span class="font-medium text-gray-900 dark:text-gray-100">{{ user.loginUsername }}</span>
              </div>
              <div *ngIf="user.rol === 'staff'" class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500 dark:text-gray-400">Colaborador</span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {{ getCollaboratorLabel(user.colaboradorId) }}
                </span>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-gray-500 dark:text-gray-400">Acceso</span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  <span *ngIf="user.hasPassword">Contraseña</span>
                  <span *ngIf="user.hasPassword && user.hasGoogle"> · </span>
                  <span *ngIf="user.hasGoogle">Google</span>
                  <span *ngIf="!user.hasPassword && !user.hasGoogle">Sin métodos registrados</span>
                </span>
              </div>
              <p *ngIf="user.id === auth.currentUser?.id" class="text-xs text-teal-700 dark:text-teal-400 pt-1">
                <a routerLink="/mi-cuenta" class="font-medium hover:underline hover:text-teal-600 dark:hover:text-teal-300">Cambiar mi contraseña</a>
              </p>
            </div>

            <label
              *ngIf="user.rol !== 'supervisor'"
              class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-200 px-3 py-2.5 text-sm mb-4 cursor-pointer">
              <input
                type="checkbox"
                [(ngModel)]="user.activo"
                [name]="'activo' + user.id"
                class="rounded border-gray-300 text-teal-600">
              Cuenta activa
            </label>

            <p *ngIf="user.rol === 'supervisor'" class="text-sm text-gray-600 dark:text-gray-400 mb-4 desc-lg-only">
              Administrador principal de la empresa. Acceso completo y gestión de operadores.
            </p>
            <p *ngIf="user.rol === 'admin'" class="text-sm text-gray-600 dark:text-gray-400 mb-4 desc-lg-only">
              Administrador delegado con acceso completo al negocio, sin gestionar usuarios.
            </p>

            <ng-container *ngIf="user.rol === 'staff'">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                Permisos del operador
              </p>
              <div class="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  (click)="applyRolePreset(user, 'operador')"
                  class="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/50">
                  Perfil operador (pedidos)
                </button>
                <button
                  type="button"
                  (click)="applyRolePreset(user, 'operador_horas')"
                  class="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-900/50">
                  Perfil operador (mis horas)
                </button>
              </div>
              <label class="block mb-4">
                <span class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2 block">
                  Colaborador vinculado
                </span>
                <select
                  [(ngModel)]="user.colaboradorId"
                  [name]="'colaborador-' + user.id"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-600 text-sm">
                  <option [ngValue]="null">Sin vincular</option>
                  <option *ngFor="let collaborator of activeCollaborators" [ngValue]="collaborator.id">
                    {{ collaborator.nombre }}
                  </option>
                </select>
                <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400 desc-lg-only">
                  Con «Ver colaboradores» activo, el operador verá únicamente las horas de esta persona.
                </span>
              </label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-4 desc-lg-only">
                El perfil operador gestiona estados de pedidos (pendiente, en proceso, listo), ve total y saldo del cliente, precios en stock, puede imprimir pedidos y no ve costos ni ganancias.
              </p>
              <div class="space-y-4">
                <div *ngFor="let group of staffPermissionGroups" class="space-y-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{{ group.label }}</p>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label
                      *ngFor="let perm of group.permissions"
                      class="flex items-start gap-3 rounded-lg border border-gray-100 bg-white dark:border-gray-600 dark:bg-gray-800/90 px-3 py-2.5 cursor-pointer hover:border-teal-200 dark:hover:border-teal-700">
                      <input
                        type="checkbox"
                        [ngModel]="isStaffPermissionEnabled(user, perm.key)"
                        (ngModelChange)="setStaffPermission(user, perm.key, $event)"
                        [name]="'perm-' + user.id + '-' + perm.key"
                        class="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600">
                      <span class="min-w-0">
                        <span class="block text-sm font-medium text-gray-800 dark:text-gray-200">{{ perm.label }}</span>
                        <span *ngIf="perm.description" class="block text-xs text-gray-500 dark:text-gray-400 desc-lg-only">{{ perm.description }}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </ng-container>
          </div>
        </article>
      </div>
    </section>
  `,
})
export class SettingsUsersPanelComponent implements OnInit {
  readonly auth = inject(AuthService);
  private userService = inject(UserService);
  private collaboratorsService = inject(CollaboratorsService);
  private businessService = inject(BusinessService);
  private dialogService = inject(DialogService);

  readonly roleLabels = USER_ROLE_LABELS;
  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;
  readonly assignablePermissions = ADMIN_ASSIGNABLE_PERMISSIONS;
  readonly staffPermissionGroups = STAFF_PERMISSION_GROUPS;
  readonly rolePresets = ROLE_PRESETS;

  users: AppUser[] = [];
  collaborators: Collaborator[] = [];
  business: PublicBusinessInfo | null = null;
  loadingUsers = false;
  usersHasMore = false;
  usersCursor: string | null = null;
  private readonly listLoadSession = new ProgressiveListSession();
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
    colaboradorId: null as string | null,
  };

  get activeCollaborators(): Collaborator[] {
    return this.collaborators
      .filter((item) => item.id && item.activo !== false)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }

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
    this.loadCollaborators();
    this.loadUsers();
  }

  getCollaboratorLabel(colaboradorId?: string | null): string {
    const id = String(colaboradorId ?? '').trim();
    if (!id) return 'Sin vincular';
    const match = this.collaborators.find((item) => item.id === id);
    return match?.nombre?.trim() || 'Colaborador no encontrado';
  }

  isStaffPermissionEnabled(user: AppUser, permission: Permission): boolean {
    return userHasPermission('staff', user.permisos, permission);
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
    if (user.rol === 'supervisor') {
      return 'bg-violet-50/60 border-violet-100 dark:bg-violet-950/50 dark:border-violet-800/40';
    }
    if (user.rol === 'admin') {
      return 'bg-sky-50/60 border-sky-100 dark:bg-sky-950/50 dark:border-sky-800/40';
    }
    return 'bg-teal-50/40 border-teal-100 dark:bg-teal-950/40 dark:border-teal-800/40';
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
    if (user.rol === 'supervisor') {
      return 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200';
    }
    if (user.rol === 'admin') {
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200';
    }
    return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200';
  }

  setStaffPermission(user: AppUser, permission: Permission, enabled: boolean) {
    const current = new Set<Permission>(sanitizeStaffPermissions(user.permisos));
    if (enabled) current.add(permission);
    else current.delete(permission);
    user.permisos = [...current];
  }

  applyRolePreset(user: AppUser, presetKey: keyof typeof ROLE_PRESETS) {
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
      colaboradorId: this.draft.rol === 'staff' ? this.draft.colaboradorId : null,
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
          colaboradorId: null,
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

  get canSaveExpandedUser(): boolean {
    if (!this.expandedUserId || this.savingUserId) return false;
    const user = this.users.find((row) => row.id === this.expandedUserId);
    return !!user && user.rol !== 'supervisor';
  }

  saveExpandedUser() {
    if (!this.expandedUserId) return;
    const user = this.users.find((row) => row.id === this.expandedUserId);
    if (user) this.saveUser(user);
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
      colaboradorId: user.rol === 'staff' ? user.colaboradorId ?? null : null,
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

  private loadCollaborators() {
    this.collaboratorsService.getCollaborators().subscribe({
      next: (rows) => {
        this.collaborators = rows;
      },
      error: () => {
        this.collaborators = [];
      },
    });
  }

  private loadUsers() {
    const loadToken = this.listLoadSession.next();
    this.loadingUsers = true;
    this.userService.getUsersPage(PROGRESSIVE_LIST_FIRST_PAGE_SIZE).subscribe({
      next: (page) => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.users = page.items.map((user) => ({
          ...user,
          permisos:
            user.rol === 'staff' ? sanitizeStaffPermissions(user.permisos) : [],
        }));
        this.usersHasMore = page.hasMore;
        this.usersCursor = page.nextCursor;
        this.loadingUsers = false;
        if (page.hasMore && page.nextCursor) {
          this.loadRemainingUsersInBackground(loadToken);
        }
      },
      error: () => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.loadingUsers = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los usuarios.',
        });
      },
    });
  }

  private loadRemainingUsersInBackground(loadToken: number) {
    if (!this.listLoadSession.isActive(loadToken)) return;
    if (!this.usersHasMore || !this.usersCursor) return;

    this.userService.getUsersPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.usersCursor).subscribe({
      next: (page) => {
        if (!this.listLoadSession.isActive(loadToken)) return;
        this.users = [
          ...this.users,
          ...page.items.map((user) => ({
            ...user,
            permisos:
              user.rol === 'staff' ? sanitizeStaffPermissions(user.permisos) : [],
          })),
        ];
        this.usersHasMore = page.hasMore;
        this.usersCursor = page.nextCursor;
        if (page.hasMore && page.nextCursor) {
          this.loadRemainingUsersInBackground(loadToken);
        }
      },
    });
  }
}
