import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import {
  SupplierFormPanelComponent,
  SupplierFormSaveEvent,
} from './supplier-form-panel.component';
import { FormPageHeaderComponent } from '../../shared/components/form-shell';
import { NavigationBackService } from '../../core/services/navigation-back.service';

@Component({
  selector: 'app-supplier-form',
  standalone: true,
  imports: [CommonModule, SupplierFormPanelComponent, FormPageHeaderComponent],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <app-form-page-header
        [title]="isEditing ? 'Editar proveedor' : 'Nuevo proveedor'"
        [subtitle]="isEditing ? 'Datos de contacto y etiquetas del proveedor.' : ''"
        [backLabel]="backLabel"
        backShortLabel="Volver"
        [backAriaLabel]="backLabel"
        (backClick)="goBack()">
      </app-form-page-header>

      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6 max-w-4xl">
        <app-supplier-form-panel
          [supplierId]="supplierId"
          [prefillNombre]="prefillNombre"
          (saved)="onSaved($event)"
          (cancelled)="goBack()"
          (deleted)="goBack()">
        </app-supplier-form-panel>
      </div>
    </div>
  `,
})
export class SupplierFormComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navigationBack = inject(NavigationBackService);

  supplierId: string | null = null;
  prefillNombre = '';
  returnTo: 'suppliers' | 'purchases' = 'suppliers';

  get isEditing(): boolean {
    return !!this.supplierId;
  }

  get backLabel(): string {
    return this.returnTo === 'purchases' ? 'Volver a compra' : 'Volver a proveedores';
  }

  ngOnInit() {
    this.supplierId = this.route.snapshot.paramMap.get('id');
    this.prefillNombre = this.route.snapshot.queryParamMap.get('nombre')?.trim() ?? '';
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (returnTo === 'purchases') this.returnTo = 'purchases';
  }

  onSaved(event: SupplierFormSaveEvent) {
    if (this.returnTo === 'purchases') {
      this.router.navigate(['/purchases/new'], {
        queryParams: { proveedorId: event.id },
      });
      return;
    }

    if (!this.supplierId) {
      this.supplierId = event.id;
      this.router.navigate(['/suppliers', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    if (this.returnTo === 'purchases') {
      this.router.navigate(['/purchases/new']);
      return;
    }
    this.navigationBack.back(['/suppliers']);
  }
}
