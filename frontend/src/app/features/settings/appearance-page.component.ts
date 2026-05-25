import { Component } from '@angular/core';
import { SettingsAppearancePanelComponent } from './settings-appearance-panel.component';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';

@Component({
  selector: 'app-appearance-page',
  standalone: true,
  imports: [SettingsAppearancePanelComponent],
  template: `
    <div [class]="pageShellClass">
      <app-settings-appearance-panel></app-settings-appearance-panel>
    </div>
  `,
})
export class AppearancePageComponent {
  readonly pageShellClass = PAGE_SHELL_CLASS;
}
