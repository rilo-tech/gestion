import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

export type SettingsConfigTab = 'productos' | 'clientes' | 'proveedores' | 'caja' | 'pedidos' | 'stock';

@Component({
  selector: 'app-config-settings-link',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p class="text-xs text-gray-400 desc-lg-only" [class.mt-1]="compact" [class.mt-2]="!compact">
      {{ message }}
      <a
        [routerLink]="['/settings']"
        [queryParams]="{ tab: settingsTab }"
        class="text-teal-600 hover:text-teal-800 underline underline-offset-2">
        {{ linkLabel }}
      </a>.
    </p>
  `,
})
export class ConfigSettingsLinkComponent {
  @Input({ required: true }) settingsTab!: SettingsConfigTab;
  @Input() message = '¿Falta una opción?';
  @Input() linkLabel = 'Configurala acá';
  @Input() compact = false;
}
