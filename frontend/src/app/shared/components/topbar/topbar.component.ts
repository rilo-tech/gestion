import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [],
  template: `
    <header
      class="h-14 shrink-0 border-b border-gray-100 bg-white/90 backdrop-blur-sm px-4 sm:px-6 flex items-center justify-end">
      <button
        type="button"
        title="Próximamente: tu perfil y preferencias"
        class="inline-flex items-center gap-2.5 rounded-full border border-gray-100 bg-gray-50/90 pl-1 pr-3 py-1 hover:bg-gray-100 transition-colors max-w-[220px]">
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
}
