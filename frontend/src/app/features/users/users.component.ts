import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AppUser, UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { PERMISSIONS, USER_ROLE_LABELS } from '../../core/constants/permissions';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import {
  ICON_ACTION_LINK_CLASS,
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { UserFormPanelComponent, UserFormSaveEvent } from './user-form-panel.component';
import { LucideAngularModule } from 'lucide-angular';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    HasPermissionDirective,
    TransactionModalComponent,
    UserFormPanelComponent,
    IconActionComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    CompactListRowComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Usuarios"
        description="Administrá quién accede al sistema y qué puede hacer cada persona."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="usersPage = 1"
        searchFieldName="usersSearchQueryMobile">
        <app-icon-action
          headerActions
          *appHasPermission="permissions.USERS_MANAGE"
          label="Nuevo usuario"
          (clicked)="openNewUser()">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
      </app-module-page-header>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="usersPage = 1"
            name="usersSearchQuery"
            placeholder="Buscar por nombre o email...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let user of paginatedFilteredUsers"
            (activate)="openUser(user)">
            <div compactTitle class="compact-list-title truncate">{{ user.nombre }}</div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              <ng-container *ngIf="user.email">{{ user.email }} · </ng-container>{{ roleLabels[user.rol] }}
            </div>
            <span
              compactTrailing
              class="px-2 py-0.5 text-[10px] rounded-full font-semibold shrink-0"
              [class.bg-green-50]="user.activo !== false"
              [class.text-green-700]="user.activo !== false"
              [class.bg-gray-100]="user.activo === false"
              [class.text-gray-500]="user.activo === false">
              {{ user.activo !== false ? 'Activo' : 'Inactivo' }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loadingUsers" [class]="compactListEmptyClass">Cargando usuarios...</p>
          <p *ngIf="!loadingUsers && users.length === 0" [class]="compactListEmptyClass">
            No hay usuarios cargados.
          </p>
          <p *ngIf="!loadingUsers && users.length > 0 && filteredUsers.length === 0" [class]="compactListEmptyClass">
            No se encontraron usuarios para "{{ searchQuery }}".
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:table-fixed sm:min-w-[640px]'">
            <colgroup class="hidden sm:table-column-group">
              <col />
              <col class="w-[8rem]" />
              <col class="w-[6rem]" />
              <col class="w-[5.5rem]" />
            </colgroup>
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
                <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Rol</th>
                <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                <th class="hidden sm:table-cell px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let user of paginatedFilteredUsers"
                (click)="openUser(user)"
                [class]="listTableRowClass">
                <td class="px-4 sm:px-6 py-3 sm:py-4">
                  <div class="font-medium text-gray-900 flex items-center gap-2">
                    <span
                      class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-800 text-sm font-semibold">
                      {{ getInitial(user) }}
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate">{{ user.nombre }}</span>
                      <span *ngIf="user.email" class="block text-xs text-gray-400 truncate">{{ user.email }}</span>
                      <span class="block text-xs text-gray-500 sm:hidden">{{ roleLabels[user.rol] }}</span>
                    </span>
                    <span
                      *ngIf="user.id === auth.currentUser?.id"
                      class="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-teal-50 text-teal-700">
                      Activo
                    </span>
                  </div>
                </td>
                <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">
                  {{ roleLabels[user.rol] }}
                </td>
                <td class="px-4 sm:px-6 py-3 sm:py-4">
                  <span
                    class="px-2 py-0.5 text-xs rounded-full font-semibold"
                    [class.bg-green-50]="user.activo !== false"
                    [class.text-green-700]="user.activo !== false"
                    [class.bg-gray-100]="user.activo === false"
                    [class.text-gray-500]="user.activo === false">
                    {{ user.activo !== false ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td class="hidden sm:table-cell px-4 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                  <app-list-row-actions
                    *appHasPermission="permissions.USERS_MANAGE"
                    [showDelete]="true"
                    [deleteDisabled]="user.id === auth.currentUser?.id"
                    (editClick)="openUser(user)"
                    (deleteClick)="confirmDeleteUser(user)">
                  </app-list-row-actions>
                </td>
              </tr>
              <tr *ngIf="loadingUsers">
                <td colspan="4" class="px-6 py-12 text-center text-gray-400">Cargando usuarios...</td>
              </tr>
              <tr *ngIf="!loadingUsers && users.length === 0">
                <td colspan="4" class="px-6 py-12 text-center text-gray-400">
                  No hay usuarios cargados.
                </td>
              </tr>
              <tr *ngIf="!loadingUsers && users.length > 0 && filteredUsers.length === 0">
                <td colspan="4" class="px-6 py-12 text-center text-gray-400">
                  No se encontraron usuarios para "{{ searchQuery }}".
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="usersPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredUsers.length"
          (pageChange)="usersPage = $event">
        </app-list-pagination>
      </app-compact-data-list>
    </div>

    <app-transaction-modal
      *ngIf="userModalOpen"
      layout="dialog"
      [title]="editingUserId ? 'Editar usuario' : 'Nuevo usuario'"
      subtitle="Definí el rol y los permisos de acceso."
      (closed)="closeUserModal()">
      <app-user-form-panel
        [userId]="editingUserId"
        (saved)="onUserSaved($event)"
        (cancelled)="closeUserModal()"
        (deleted)="onUserDeleted()">
      </app-user-form-panel>
    </app-transaction-modal>
  `,
})
export class UsersComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly permissions = PERMISSIONS;
  readonly roleLabels = USER_ROLE_LABELS;

  readonly auth = inject(AuthService);
  private userService = inject(UserService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  users: AppUser[] = [];
  loadingUsers = false;
  searchQuery = '';
  usersPage = 1;
  userModalOpen = false;
  editingUserId: string | null = null;

  get filteredUsers(): AppUser[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.users;
    return this.users.filter((user) => {
      const haystack = [user.nombre, user.email, this.roleLabels[user.rol]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  get paginatedFilteredUsers(): AppUser[] {
    return paginateSlice(this.filteredUsers, this.usersPage, this.listPageSize);
  }

  ngOnInit() {
    if (!this.auth.canManageUsers) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.loadUsers();
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('new') === '1') {
        this.openNewUser();
        return;
      }
      const editId = params.get('edit');
      if (editId) {
        this.openUserById(editId);
      }
    });
  }

  getInitial(user: AppUser): string {
    return (user.nombre?.trim()[0] ?? 'U').toUpperCase();
  }

  openNewUser() {
    this.editingUserId = null;
    this.userModalOpen = true;
  }

  openUser(user: AppUser) {
    if (!user.id) return;
    if (user.id === this.auth.currentUser?.id) {
      this.router.navigate(['/mi-cuenta']);
      return;
    }
    if (!this.auth.canManageUsers) return;
    this.editingUserId = user.id;
    this.userModalOpen = true;
  }

  openUserById(userId: string) {
    this.editingUserId = userId;
    this.userModalOpen = true;
  }

  closeUserModal() {
    this.userModalOpen = false;
    this.editingUserId = null;
    this.router.navigate(['/users'], { replaceUrl: true });
  }

  onUserSaved(event: UserFormSaveEvent) {
    this.editingUserId = event.id;
    this.loadUsers();
    this.auth.refreshUsers().subscribe();
  }

  onUserDeleted() {
    this.loadUsers();
    this.auth.refreshUsers().subscribe();
    this.closeUserModal();
  }

  confirmDeleteUser(user: AppUser) {
    if (!user.id || user.id === this.auth.currentUser?.id) return;

    this.dialogService
      .confirm({
        title: 'Eliminar usuario',
        message: `¿Eliminar a ${user.nombre}?`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !user.id) return;

        this.userService.deleteUser(user.id).subscribe({
          next: () => {
            this.loadUsers();
            this.auth.refreshUsers().subscribe();
          },
          error: (err) =>
            this.dialogService.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo eliminar el usuario.',
            }),
        });
      });
  }

  private loadUsers() {
    this.loadingUsers = true;
    this.userService.getUsers().subscribe({
      next: (users) => {
        this.users = users;
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
