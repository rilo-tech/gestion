import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppUser, UserService } from '../../core/services/user.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  AuthService,
} from '../../core/services/auth.service';
import {
  DEFAULT_STAFF_PERMISSIONS,
  STAFF_PERMISSION_GROUPS,
  Permission,
  USER_ROLE_LABELS,
  UserRole,
  sanitizeStaffPermissions,
} from '../../core/constants/permissions';
import { LucideAngularModule } from 'lucide-angular';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';
import {
  FORM_CONTROL_CLASS,
  FORM_LABEL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';

export interface UserFormSaveEvent {
  id: string;
  user: AppUser;
}

@Component({
  selector: 'app-user-form-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SelectOnFocusDirective, FormPanelFooterComponent],
  template: `
    <div class="space-y-4">
      <div *ngIf="loadingUser" class="py-8 text-center text-sm text-gray-400">
        Cargando usuario...
      </div>

      <form
        *ngIf="!loadingUser"
        (submit)="saveUser(); $event.preventDefault()"
        class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label [class]="formLabelClass">Nombre *</label>
            <input
              [(ngModel)]="userForm.nombre"
              name="userNombre"
              required
              [class]="formControlClass">
          </div>
          <div>
            <label [class]="formLabelClass">Email</label>
            <input
              type="email"
              [(ngModel)]="userForm.email"
              name="userEmail"
              [class]="formControlClass">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label [class]="formLabelClass">Rol</label>
            <select
              [(ngModel)]="userForm.rol"
              name="userRol"
              (ngModelChange)="onRoleChange($event)"
              [class]="formControlClass">
              <option value="staff">{{ roleLabels.staff }}</option>
              <option value="admin">{{ roleLabels.admin }}</option>
            </select>
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 cursor-pointer w-full">
              <input
                type="checkbox"
                [(ngModel)]="userForm.activo"
                name="userActivo"
                class="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500">
              <span class="text-sm font-medium text-gray-700">Usuario activo</span>
            </label>
          </div>
        </div>

        <div class="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-4">
          <div>
            <h3 class="text-sm font-bold text-gray-900">Permisos</h3>
            <p *ngIf="userForm.rol === 'admin'" class="text-xs text-gray-500 mt-1">
              Los administradores tienen acceso completo a la aplicación.
            </p>
            <p *ngIf="userForm.rol !== 'admin'" class="text-xs text-gray-500 mt-1">
              Solo los administradores pueden editar, eliminar y ver costos o ganancias.
              Acá podés habilitar permisos extra para pedidos y ventas.
            </p>
          </div>

          <ng-container *ngIf="userForm.rol !== 'admin'">
            <div *ngFor="let group of staffPermissionGroups" class="space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">{{ group.label }}</p>
              <div class="space-y-2">
                <label
                  *ngFor="let perm of group.permissions"
                  class="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 cursor-pointer hover:border-teal-100">
                  <input
                    type="checkbox"
                    [checked]="hasPermissionSelected(perm.key)"
                    (change)="togglePermission(perm.key, $any($event.target).checked)"
                    class="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500">
                  <span class="min-w-0">
                    <span class="block text-sm font-medium text-gray-800">{{ perm.label }}</span>
                    <span *ngIf="perm.description" class="block text-xs text-gray-500 mt-0.5">{{ perm.description }}</span>
                  </span>
                </label>
              </div>
            </div>
          </ng-container>
        </div>

        <app-form-panel-footer
          [deleteLabel]="isEditing && auth.canManageUsers ? 'Eliminar usuario' : ''"
          [saveLabel]="isEditing ? 'Guardar' : 'Crear usuario'"
          [saving]="savingUser"
          (cancelClick)="cancelled.emit()"
          (deleteClick)="confirmDeleteUser()">
        </app-form-panel-footer>
      </form>
    </div>
  `,
})
export class UserFormPanelComponent implements OnChanges {
  readonly formControlClass = FORM_CONTROL_CLASS;
  readonly formLabelClass = FORM_LABEL_CLASS;

  @Input() userId: string | null = null;
  @Output() saved = new EventEmitter<UserFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  readonly auth = inject(AuthService);
  private userService = inject(UserService);
  private dialogService = inject(DialogService);

  readonly roleLabels = USER_ROLE_LABELS;
  readonly staffPermissionGroups = STAFF_PERMISSION_GROUPS;

  loadingUser = false;
  savingUser = false;
  userForm: AppUser = this.emptyUserForm();

  get isEditing(): boolean {
    return !!this.userId;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['userId']) {
      this.loadUser();
    }
  }

  onRoleChange(role: UserRole) {
    if (role === 'staff' && !this.userForm.permisos?.length) {
      this.userForm.permisos = [...DEFAULT_STAFF_PERMISSIONS];
    }
  }

  hasPermissionSelected(permission: Permission): boolean {
    return (this.userForm.permisos ?? []).includes(permission);
  }

  togglePermission(permission: Permission, checked: boolean) {
    const current = new Set(this.userForm.permisos ?? []);
    if (checked) {
      current.add(permission);
    } else {
      current.delete(permission);
    }
    this.userForm.permisos = [...current];
  }

  saveUser() {
    const nombre = this.userForm.nombre?.trim();
    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del usuario.',
      });
      return;
    }

    const payload: AppUser = {
      nombre,
      email: this.userForm.email?.trim() || '',
      rol: this.userForm.rol,
      permisos:
        this.userForm.rol === 'admin'
          ? []
          : sanitizeStaffPermissions(this.userForm.permisos),
      activo: this.userForm.activo !== false,
    };

    this.savingUser = true;
    const request = this.isEditing
      ? this.userService.updateUser(this.userId!, payload)
      : this.userService.createUser(payload);

    request.subscribe({
      next: (result) => {
        this.savingUser = false;
        this.saved.emit({ id: result.id, user: { ...payload, id: result.id } });
      },
      error: (err) => {
        this.savingUser = false;
        this.dialogService.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo guardar el usuario.',
        });
      },
    });
  }

  confirmDeleteUser() {
    if (!this.userId) return;

    this.dialogService
      .confirm({
        title: 'Eliminar usuario',
        message: `¿Eliminar a ${this.userForm.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.userService.deleteUser(this.userId!).subscribe({
          next: () => this.deleted.emit(),
          error: (err) =>
            this.dialogService.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo eliminar el usuario.',
            }),
        });
      });
  }

  private loadUser() {
    if (!this.userId) {
      this.userForm = this.emptyUserForm();
      return;
    }

    this.loadingUser = true;
    this.userService.getUser(this.userId).subscribe({
      next: (user) => {
        this.userForm = {
          nombre: user.nombre ?? '',
          email: user.email ?? '',
          rol: user.rol ?? 'staff',
          permisos:
            user.rol === 'admin'
              ? []
              : sanitizeStaffPermissions(user.permisos ?? DEFAULT_STAFF_PERMISSIONS),
          activo: user.activo !== false,
        };
        this.loadingUser = false;
      },
      error: () => {
        this.loadingUser = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el usuario.',
        });
        this.cancelled.emit();
      },
    });
  }

  private emptyUserForm(): AppUser {
    return {
      nombre: '',
      email: '',
      rol: 'staff',
      permisos: [...DEFAULT_STAFF_PERMISSIONS],
      activo: true,
    };
  }
}
