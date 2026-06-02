import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  PriceCatalogFormPanelComponent,
  PriceCatalogFormSaveEvent,
} from './price-catalog-form-panel.component';
import { FormPageHeaderComponent } from '../../shared/components/form-shell';

@Component({
  selector: 'app-price-catalog-form',
  standalone: true,
  imports: [CommonModule, PriceCatalogFormPanelComponent, FormPageHeaderComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-20">
      <app-form-page-header
        [title]="isEditing ? 'Editar referencia' : 'Nueva referencia'"
        backLabel="Volver al catálogo"
        backShortLabel="Volver"
        backAriaLabel="Volver al catálogo"
        backRouterLink="/price-catalog">
      </app-form-page-header>

      <div class="max-w-6xl">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-5 lg:p-6">
          <app-price-catalog-form-panel
            [entryId]="entryId"
            (saved)="onSaved($event)"
            (cancelled)="goBack()">
          </app-price-catalog-form-panel>
        </div>
      </div>
    </div>
  `,
})
export class PriceCatalogFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  entryId: string | null = null;

  get isEditing(): boolean {
    return !!this.entryId;
  }

  ngOnInit() {
    this.entryId = this.route.snapshot.paramMap.get('id');
    if (!this.entryId && !this.auth.canManagePriceCatalog) {
      this.router.navigate(['/price-catalog']);
    }
  }

  onSaved(event: PriceCatalogFormSaveEvent) {
    if (event.wasNew) {
      this.router.navigate(['/price-catalog'], {
        queryParams: { saved: '1' },
      });
      return;
    }
    if (!this.entryId) {
      this.entryId = event.id;
      this.router.navigate(['/price-catalog', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.router.navigate(['/price-catalog']);
  }
}
