import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import {
  ClientFormReturnTo,
  parseClientFormReturnTo,
} from '../../core/utils/form-return-context';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from './client-form-panel.component';
import { FormPageHeaderComponent } from '../../shared/components/form-shell';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import {
  bindUnsavedChangesHost,
  type UnsavedChangesHost,
} from '../../core/utils/unsaved-changes';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, ClientFormPanelComponent, FormPageHeaderComponent],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <app-form-page-header
        [title]="isEditing ? 'Editar cliente' : 'Nuevo cliente'"
        [subtitle]="isEditing ? 'Datos de contacto y etiquetas del cliente.' : ''"
        [backLabel]="backLabel"
        backShortLabel="Volver"
        [backAriaLabel]="backLabel"
        (backClick)="goBack()">
      </app-form-page-header>

      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-6 max-w-4xl">
        <app-client-form-panel
          #formPanel
          [clientId]="clientId"
          [prefillNombre]="prefillNombre"
          [wideLayout]="true"
          (saved)="onSaved($event)"
          (cancelled)="goBack()"
          (deleted)="goBack()">
        </app-client-form-panel>
      </div>
    </div>
  `,
})
export class ClientFormComponent implements OnInit, UnsavedChangesHost {
  readonly pageShellClass = PAGE_SHELL_CLASS;

  @ViewChild('formPanel') formPanel?: ClientFormPanelComponent;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navigationBack = inject(NavigationBackService);
  private readonly unsavedHostBinding = bindUnsavedChangesHost(this);
  private suppressPostSaveNavigation = false;

  clientId: string | null = null;
  prefillNombre = '';
  returnTo: ClientFormReturnTo = 'clients';
  returnOrderId: string | null = null;

  get isEditing(): boolean {
    return !!this.clientId;
  }

  get backLabel(): string {
    if (this.returnTo === 'orders') return 'Volver a pedido';
    if (this.returnTo === 'sales') return 'Volver a venta';
    return 'Volver a clientes';
  }

  ngOnInit() {
    this.clientId = this.route.snapshot.paramMap.get('id');
    this.prefillNombre = this.route.snapshot.queryParamMap.get('nombre')?.trim() ?? '';
    this.returnTo = parseClientFormReturnTo(this.route.snapshot.queryParamMap.get('returnTo'));
    this.returnOrderId = this.route.snapshot.queryParamMap.get('orderId');
  }

  hasUnsavedChanges(): boolean {
    return this.formPanel?.hasUnsavedChanges() === true;
  }

  persistUnsavedChanges(): Promise<boolean> {
    this.suppressPostSaveNavigation = true;
    return (this.formPanel?.persistUnsavedChanges() ?? Promise.resolve(true)).finally(() => {
      this.suppressPostSaveNavigation = false;
    });
  }

  onSaved(event: ClientFormSaveEvent) {
    if (this.suppressPostSaveNavigation) return;

    if (this.returnTo !== 'clients') {
      this.navigateBack(event.id);
      return;
    }

    if (!this.clientId) {
      this.clientId = event.id;
      this.router.navigate(['/clients', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.navigateBack(this.clientId ?? undefined);
  }

  private navigateBack(clienteId?: string) {
    if (this.returnTo === 'orders') {
      const commands = this.returnOrderId
        ? ['/orders', this.returnOrderId, 'edit']
        : ['/orders/new'];
      const queryParams: Record<string, string> = { restoreDraft: '1' };
      if (clienteId && !this.returnOrderId) {
        queryParams['clienteId'] = clienteId;
      }
      this.router.navigate(commands, { queryParams });
      return;
    }

    if (this.returnTo === 'sales') {
      const queryParams: Record<string, string> = { restoreDraft: '1' };
      if (clienteId) queryParams['clienteId'] = clienteId;
      this.router.navigate(['/sales/new'], { queryParams });
      return;
    }

    this.navigationBack.back(['/clients']);
  }
}
