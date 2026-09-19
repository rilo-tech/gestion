import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import { AnalyticsService } from '../../core/services/analytics.service';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  trialCtaLabel,
  trialMicrocopy,
} from '../../../../../shared/commercial-catalog.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import type { TrialProductId } from '../../../../../shared/platform-access.ts';

type CampaignConfig = {
  path: string;
  title: string;
  subtitle: string;
  example: string;
  product: TrialProductId;
  campaignSource: string;
};

const CAMPAIGNS: Record<string, CampaignConfig> = {
  'ventas-whatsapp': {
    path: '/ventas-whatsapp',
    title: '¿Vendés por WhatsApp y después tenés que pasar todo a una planilla?',
    subtitle: 'Decíselo a RILO y queda registrado.',
    example: 'Vendí 2 remeras a Ana por $1.600.',
    product: 'whatsapp',
    campaignSource: 'ventas-whatsapp',
  },
  'pedidos-whatsapp': {
    path: '/pedidos-whatsapp',
    title: '¿Anotás pedidos en el chat y después se te pierden?',
    subtitle: 'Pedile a RILO que lo registre mientras hablás con el cliente.',
    example: 'Pedido para Martín: 3 buzos para el viernes.',
    product: 'whatsapp',
    campaignSource: 'pedidos-whatsapp',
  },
  'saldos-clientes': {
    path: '/saldos-clientes',
    title: '¿Cuánto te deben y no querés abrir Excel?',
    subtitle: 'Preguntale a RILO el saldo de un cliente.',
    example: '¿Cuánto debe Pedro?',
    product: 'whatsapp',
    campaignSource: 'saldos-clientes',
  },
};

@Component({
  selector: 'app-ritotech-campaign-landing',
  standalone: true,
  imports: [CommonModule, RouterLink, RitotechPublicShellComponent, RitotechProductCtaComponent],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-3xl mx-auto px-4 pt-8 pb-16 text-center" *ngIf="config">
        <p class="text-teal-400 text-xs font-semibold uppercase tracking-wide mb-2">RILO Bot</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-white leading-tight">{{ config.title }}</h1>
        <p class="mt-4 text-white/85 text-base sm:text-lg leading-relaxed">{{ config.subtitle }}</p>

        <div class="mt-6 mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left">
          <p class="text-[11px] uppercase tracking-wide text-teal-400/90 font-semibold mb-2">Ejemplo</p>
          <p class="text-sm text-white font-medium">“{{ config.example }}”</p>
        </div>

        <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
          <app-ritotech-product-cta
            class="w-full sm:w-auto"
            [product]="config.product"
            [guestLabel]="ctaLabel">
          </app-ritotech-product-cta>
          <a
            routerLink="/planes"
            class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900 text-center min-h-[44px]">
            Ver planes
          </a>
        </div>
        <p class="mt-3 text-xs text-white/50">{{ microcopy }}</p>
        <p class="mt-6 text-sm text-white/60">Cargás hablando. Controlás en pantalla.</p>
      </section>
    </app-ritotech-public-shell>
  `,
})
export class RitotechCampaignLandingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private analytics = inject(AnalyticsService);
  private commercial = inject(CommercialCatalogService);

  catalog: CommercialCatalog = DEFAULT_COMMERCIAL_CATALOG;
  config: CampaignConfig | null = null;

  get ctaLabel(): string {
    return trialCtaLabel(this.catalog.trialDays);
  }

  get microcopy(): string {
    return trialMicrocopy(this.catalog);
  }

  ngOnInit(): void {
    this.analytics.captureAttributionFromUrl();
    const slug = this.route.snapshot.routeConfig?.path || '';
    this.config = CAMPAIGNS[slug] ?? null;
    if (this.config) {
      this.analytics.mergeAttribution({
        campaignSource: this.config.campaignSource,
        landingPath: this.config.path,
      });
      this.analytics.track('campaign_landing_view', {
        campaign: this.config.campaignSource,
        path: this.config.path,
      });
    }
    this.commercial.load('UY').subscribe({
      next: (row) => {
        this.catalog = row.catalog;
      },
    });
  }
}
