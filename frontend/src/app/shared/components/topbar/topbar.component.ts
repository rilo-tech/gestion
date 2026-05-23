import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutNavService } from '../../../core/services/layout-nav.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <header
      class="h-14 shrink-0 border-b border-gray-100 bg-white/90 backdrop-blur-sm px-3 sm:px-6 flex items-center justify-between gap-3">
      <button
        type="button"
        class="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-600 hover:bg-gray-100"
        [attr.aria-label]="nav.mobileMenuOpen() ? 'Cerrar menú' : 'Abrir menú'"
        [attr.aria-expanded]="nav.mobileMenuOpen()"
        (click)="nav.toggleMobileMenu()">
        <i-lucide [name]="nav.mobileMenuOpen() ? 'x' : 'menu'" class="w-5 h-5"></i-lucide>
      </button>

      <div class="flex-1 min-w-0 lg:hidden">
        <p class="text-sm font-semibold text-gray-900 truncate">RILO Gestión</p>
      </div>

      <button
        type="button"
        title="Próximamente: tu perfil y preferencias"
        class="inline-flex items-center gap-2.5 rounded-full border border-gray-100 bg-gray-50/90 pl-1 pr-2 sm:pr-3 py-1 hover:bg-gray-100 transition-colors max-w-[180px] sm:max-w-[220px] ml-auto lg:ml-0">
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-semibold">
          {{ auth.userInitial }}
        </span>
        <span class="min-w-0 text-left hidden sm:block">
          <span class="block text-sm font-medium text-gray-900 truncate leading-tight">
            {{ auth.currentUserName }}
          </span>
          <span class="block text-[11px] text-gray-500 truncate leading-tight">
            {{ auth.currentRoleLabel }}
          </span>
        </span>
      </button>
    </header>
  `,
})
export class TopbarComponent {
  readonly auth = inject(AuthService);
  readonly nav = inject(LayoutNavService);
}
