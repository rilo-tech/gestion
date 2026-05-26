import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import {
  PriceCatalogFormPanelComponent,
  PriceCatalogFormSaveEvent,
} from './price-catalog-form-panel.component';

@Component({
  selector: 'app-price-catalog-form',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, PriceCatalogFormPanelComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-20">
      <div class="mb-4 sm:mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 class="text-xl sm:text-2xl font-bold text-gray-900">
          {{ isEditing ? 'Editar referencia' : 'Nueva referencia' }}
        </h1>
        <a
          routerLink="/price-catalog"
          class="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 whitespace-nowrap">
          <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
          Volver
        </a>
      </div>

      <div class="max-w-6xl">
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 lg:p-6">
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
    if (!this.entryId) {
      this.entryId = event.id;
      this.router.navigate(['/price-catalog', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.router.navigate(['/price-catalog']);
  }
}
