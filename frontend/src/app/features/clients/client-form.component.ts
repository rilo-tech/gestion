import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from './client-form-panel.component';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, ConfigSettingsLinkComponent, ClientFormPanelComponent],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <div class="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div class="min-w-0">
          <a
            routerLink="/clients"
            class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 mb-3">
            <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
            Volver a clientes
          </a>
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">
            {{ isEditing ? 'Editar cliente' : 'Nuevo cliente' }}
          </h1>
          <p *ngIf="isEditing" class="text-sm sm:text-base text-gray-500 mt-1">
            Datos de contacto y etiquetas del cliente.
          </p>
          <app-config-settings-link
            settingsTab="clientes"
            message="¿Falta una etiqueta?"
            linkLabel="Configurala acá">
          </app-config-settings-link>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 max-w-4xl">
        <app-client-form-panel
          [clientId]="clientId"
          [prefillNombre]="prefillNombre"
          [wideLayout]="true"
          [showConfigLink]="false"
          (saved)="onSaved($event)"
          (cancelled)="goBack()"
          (deleted)="goBack()">
        </app-client-form-panel>
      </div>
    </div>
  `,
})
export class ClientFormComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  clientId: string | null = null;
  prefillNombre = '';

  get isEditing(): boolean {
    return !!this.clientId;
  }

  ngOnInit() {
    this.clientId = this.route.snapshot.paramMap.get('id');
    this.prefillNombre = this.route.snapshot.queryParamMap.get('nombre')?.trim() ?? '';
  }

  onSaved(event: ClientFormSaveEvent) {
    if (!this.clientId) {
      this.clientId = event.id;
      this.router.navigate(['/clients', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.router.navigate(['/clients']);
  }
}
