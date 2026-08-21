import { Component } from '@angular/core';
import { PlanStatusCardComponent } from '../../shared/components/plan-status-card/plan-status-card.component';
import { FormBackButtonComponent } from '../../shared/components/form-shell/form-back-button.component';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';

@Component({
  selector: 'app-plan-page',
  standalone: true,
  imports: [PlanStatusCardComponent, FormBackButtonComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="w-full max-w-2xl mx-auto min-w-0">
        <div class="mb-6 sm:mb-8">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Plan y suscripción</h1>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Alta, baja y pago de la empresa. Los datos no se borran.
              </p>
            </div>
            <app-form-back-button
              routerLink="/mi-cuenta"
              label="Mi cuenta"
              shortLabel="Cuenta"
              ariaLabel="Volver a Mi cuenta">
            </app-form-back-button>
          </div>
        </div>
        <app-plan-status-card variant="settings"></app-plan-status-card>
      </div>
    </div>
  `,
})
export class PlanPageComponent {
  readonly pageShellClass = PAGE_SHELL_CLASS;
}
