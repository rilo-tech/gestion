import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import { RILOTECH_CHAT_DEMO, pricingTiersFromCatalog } from '../../../../../shared/ritotech-marketing.ts';
import { trialDaysForProduct } from '../../../../../shared/trial-state.ts';
import { DEFAULT_COMMERCIAL_CATALOG, trialCtaForProduct, type CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service.ts';

@Component({
  selector: 'app-ritotech-product-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RitotechPublicShellComponent, RitotechChatDemoComponent, RitotechProductCtaComponent],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <p class="text-teal-400 text-sm font-semibold uppercase tracking-wide">{{ eyebrow }}</p>
        <h1 class="mt-2 text-2xl sm:text-4xl font-bold">{{ title }}</h1>
        <p class="mt-4 text-gray-400 leading-relaxed">{{ description }}</p>

        <ul class="mt-6 space-y-2 text-sm text-gray-300">
          <li *ngFor="let bullet of bullets">✓ {{ bullet }}</li>
        </ul>

        <div *ngIf="productId === 'whatsapp'" class="mt-10">
          <h2 class="text-lg font-bold mb-4">Ejemplo de conversación</h2>
          <app-ritotech-chat-demo
            [messages]="chatDemo"
            caption="Siempre te pide confirmación antes de guardar.">
          </app-ritotech-chat-demo>
        </div>

        <div *ngIf="productId === 'erp'" class="mt-10 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 class="text-lg font-bold mb-2">¿Y si después quiero WhatsApp?</h2>
          <p class="text-sm text-gray-400 leading-relaxed">
            Sumá RILO Bot después desde Planes, con la misma cuenta. No hace falta registrarte de nuevo.
            Todo lo que cargues en el panel queda en el mismo negocio. La baja del panel se hace en Plan, sin borrar datos.
          </p>
        </div>

        <div *ngIf="productId === 'whatsapp'" class="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 class="text-lg font-bold mb-2">¿Y si después quiero RILO Gestión?</h2>
          <p class="text-sm text-gray-400 leading-relaxed">
            Sumá RILO Gestión desde Planes cuando quieras, con la misma cuenta. Lo que cargaste por
            WhatsApp aparece en el historial.
          </p>
        </div>

        <div class="mt-8 flex flex-col sm:flex-row gap-3 items-start">
          <app-ritotech-product-cta
            [product]="productId"
            [guestLabel]="ctaLabel">
          </app-ritotech-product-cta>
          <a
            routerLink="/planes"
            class="inline-flex justify-center rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900">
            Ver planes
          </a>
        </div>
      </section>
    </app-ritotech-public-shell>
  `,
})
export class RitotechProductPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private commercial = inject(CommercialCatalogService);

  readonly productId = (this.route.snapshot.data['product'] ?? 'erp') as TrialProductId;
  catalog: CommercialCatalog = DEFAULT_COMMERCIAL_CATALOG;
  readonly chatDemo = RILOTECH_CHAT_DEMO;

  get trialDays(): number {
    return this.catalog.trialDays || trialDaysForProduct(this.productId);
  }

  ngOnInit() {
    this.commercial.load('UY').subscribe({
      next: (row) => {
        this.catalog = row.catalog;
      },
    });
  }

  get eyebrow(): string {
    return this.productId === 'whatsapp' ? 'RILO Bot' : 'RILO Gestión';
  }

  get title(): string {
    if (this.productId === 'whatsapp') return 'Tu negocio por WhatsApp';
    if (this.productId === 'completo') return 'WhatsApp + web, misma información';
    return 'Tu negocio ordenado en la computadora';
  }

  get ctaLabel(): string {
    return trialCtaForProduct(this.productId);
  }

  get description(): string {
    return TRIAL_PRODUCT_DESCRIPTIONS[this.productId] ?? TRIAL_PRODUCT_DESCRIPTIONS.erp;
  }

  get bullets(): string[] {
    const tier = pricingTiersFromCatalog(this.catalog).find((t) => t.id === this.productId);
    return tier?.includes ?? [];
  }
}
