import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import {
  PriceCatalogEntry,
  PriceCatalogService,
  buildPriceSummary,
} from '../../core/services/price-catalog.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';

@Component({
  selector: 'app-price-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, ActivityLogTriggerComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0 flex-1">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Precios de venta</h1>
          <p class="text-sm sm:text-base text-gray-500 mt-1">
            Catálogo por detalle (con/sin estampado) y cantidad. Solo precios de venta, sin costos.
          </p>
        </div>
        <div class="flex gap-2 shrink-0 self-start">
          <app-activity-log-trigger module="price_catalog"></app-activity-log-trigger>
          <a
            *ngIf="auth.canManagePriceCatalog"
            routerLink="/price-catalog/new"
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2.5 hover:bg-opacity-90 transition-colors whitespace-nowrap">
            <i-lucide name="plus" class="w-4 h-4 shrink-0"></i-lucide>
            <span>Nueva referencia</span>
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            name="priceCatalogSearch"
            placeholder="Buscar por producto, detalle o notas..."
            class="w-full max-w-xl px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
        </div>
      </div>

      <div *ngIf="loading" class="py-16 text-center text-gray-400">Cargando referencias...</div>

      <div *ngIf="!loading && filteredEntries.length === 0" class="py-16 text-center text-gray-400">
        <p *ngIf="entries.length === 0">Todavía no hay referencias en el catálogo.</p>
        <p *ngIf="entries.length > 0">No se encontraron referencias para "{{ searchQuery }}".</p>
      </div>

      <div *ngIf="!loading && filteredEntries.length > 0" class="grid grid-cols-1 gap-4 sm:gap-5">
        <article
          *ngFor="let entry of filteredEntries"
          (click)="openEntry(entry)"
          class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 hover:border-teal-200 hover:shadow-md transition-all cursor-pointer">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-gray-900 truncate">{{ entry.nombre }}</h2>
              <span
                *ngIf="entry.activo === false"
                class="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs font-medium">
                Inactiva
              </span>
            </div>
          </div>

          <div *ngIf="getSummary(entry).length; else emptySummary" class="overflow-x-auto rounded-lg border border-gray-100">
            <table class="w-full min-w-[320px] text-sm">
              <thead>
                <tr class="bg-gray-50 border-b border-gray-100">
                  <th class="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Detalle</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Precios</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of getSummary(entry)" class="border-b border-gray-50 last:border-0">
                  <td class="px-3 py-2.5 font-medium text-gray-900 align-top whitespace-nowrap">{{ row.variantNombre }}</td>
                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap gap-1.5">
                      <span
                        *ngFor="let cell of row.cells"
                        class="inline-flex items-center gap-1 rounded-md bg-teal-50 border border-teal-100 px-2 py-0.5 text-xs text-teal-900">
                        <span>{{ cell.label }}</span>
                        <span class="font-bold tabular-nums">{{ '$' + cell.precio }}</span>
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #emptySummary>
            <p class="text-sm text-gray-400">Sin precios cargados.</p>
          </ng-template>

          <p *ngIf="entry.notas" class="text-xs text-gray-500 mt-3 line-clamp-2">{{ entry.notas }}</p>
        </article>
      </div>
    </div>
  `,
})
export class PriceCatalogComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly auth = inject(AuthService);
  readonly getSummary = buildPriceSummary;

  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);
  private router = inject(Router);

  entries: PriceCatalogEntry[] = [];
  loading = true;
  searchQuery = '';

  get filteredEntries(): PriceCatalogEntry[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.entries;

    return this.entries.filter((entry) => {
      const haystack = [
        entry.nombre,
        entry.notas,
        ...(entry.variantes ?? []).flatMap((variant) => [
          variant.nombre,
          ...(variant.rangosCantidad ?? []).map((range) => String(range.precioUnitario)),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }

  ngOnInit() {
    this.loadEntries();
  }

  openEntry(entry: PriceCatalogEntry) {
    if (!entry.id) return;
    this.router.navigate(['/price-catalog', entry.id, 'edit']);
  }

  private loadEntries() {
    this.loading = true;
    this.priceCatalogService.getEntries().subscribe({
      next: (entries) => {
        this.entries = entries;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el catálogo de precios.',
        });
      },
    });
  }
}
