import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemePreference, ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-settings-appearance-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="space-y-4 sm:space-y-6 max-w-2xl">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Apariencia</h2>
        <p class="text-sm text-gray-500 mt-1 desc-lg-only">
          Elegí cómo querés ver la aplicación. La preferencia se guarda en tu usuario.
        </p>
      </div>

      <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            (click)="setTheme('light')"
            class="rounded-xl border p-4 text-left transition-colors"
            [class.border-teal-500]="theme.preference() === 'light'"
            [class.ring-2]="theme.preference() === 'light'"
            [class.ring-teal-500/30]="theme.preference() === 'light'"
            [class.border-gray-200]="theme.preference() !== 'light'">
            <span class="block text-sm font-semibold text-gray-900">Fondo claro</span>
            <span class="block text-xs text-gray-500 mt-1 desc-lg-only">Ideal para ambientes luminosos.</span>
            <span class="mt-3 block h-10 rounded-lg border theme-preview-swatch-light"></span>
          </button>

          <button
            type="button"
            (click)="setTheme('dark')"
            class="rounded-xl border p-4 text-left transition-colors"
            [class.border-teal-500]="theme.preference() === 'dark'"
            [class.ring-2]="theme.preference() === 'dark'"
            [class.ring-teal-500/30]="theme.preference() === 'dark'"
            [class.border-gray-200]="theme.preference() !== 'dark'">
            <span class="block text-sm font-semibold text-gray-900">Fondo oscuro</span>
            <span class="block text-xs text-gray-500 mt-1 desc-lg-only">Similar al login, más cómodo de noche.</span>
            <span class="mt-3 block h-10 rounded-lg border theme-preview-swatch-dark"></span>
          </button>
        </div>
      </article>
    </section>
  `,
})
export class SettingsAppearancePanelComponent {
  readonly theme = inject(ThemeService);

  setTheme(preference: ThemePreference) {
    this.theme.setPreference(preference);
  }
}
