import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { PANEL_TRIAL_DAYS, RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import {
  RILOTECH_AUDIENCE_PITCH,
  RILOTECH_FAQ,
  RILOTECH_PRICING_TIERS,
  priceLabelForTier,
  pricingFootnoteForCountry,
} from '../../../../../shared/ritotech-marketing.ts';

const COUNTRY_STORAGE_KEY = 'rilo_billing_country';

@Component({
  selector: 'app-ritotech-plans',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RitotechPublicShellComponent,
    RitotechFaqComponent,
    RitotechVisualGuideComponent,
  ],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-4xl mx-auto px-4 py-10 sm:py-14">
        <h1 class="text-2xl sm:text-3xl font-bold text-center">Planes simples para microemprendimientos</h1>
        <p class="text-center text-gray-400 mt-2 text-sm sm:text-base max-w-xl mx-auto">
          {{ audiencePitch }}
        </p>
        <p class="text-center text-xs text-teal-400/90 mt-3 font-medium">
          RiloBot {{ rilobotDays }} días · Panel/Completo {{ panelDays }} días · Sin tarjeta
        </p>
        <div class="mt-4 flex justify-center gap-2">
          <button
            type="button"
            (click)="setCountry('UY')"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold border transition"
            [class.bg-teal-700]="country === 'UY'"
            [class.border-teal-600]="country === 'UY'"
            [class.text-white]="country === 'UY'"
            [class.bg-gray-900]="country !== 'UY'"
            [class.border-gray-700]="country !== 'UY'"
            [class.text-gray-400]="country !== 'UY'">
            Uruguay (UYU)
          </button>
          <button
            type="button"
            (click)="setCountry('AR')"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold border transition"
            [class.bg-teal-700]="country === 'AR'"
            [class.border-teal-600]="country === 'AR'"
            [class.text-white]="country === 'AR'"
            [class.bg-gray-900]="country !== 'AR'"
            [class.border-gray-700]="country !== 'AR'"
            [class.text-gray-400]="country !== 'AR'">
            Argentina (ARS)
          </button>
        </div>
        <div class="mt-5 flex flex-wrap justify-center gap-3">
          <app-ritotech-visual-guide
            #guide
            triggerLabel="Ver guía RiloBot (opcional)"
            defaultTab="whatsapp">
          </app-ritotech-visual-guide>
          <button
            type="button"
            (click)="guide.open('erp')"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/50 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-white transition">
            Guía del panel web
          </button>
        </div>

        <div class="mt-8 overflow-x-auto rounded-xl border border-gray-800">
          <table class="w-full text-left text-sm min-w-[480px]">
            <thead class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
              <tr>
                <th class="px-4 py-3 font-medium">Qué incluye</th>
                <th class="px-4 py-3 font-medium text-center">RiloBot</th>
                <th class="px-4 py-3 font-medium text-center">Panel</th>
                <th class="px-4 py-3 font-medium text-center">Ambos</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800 text-gray-300">
              <tr *ngFor="let row of matrix" class="bg-gray-950/40">
                <td class="px-4 py-2.5">{{ row.label }}</td>
                <td class="px-4 py-2.5 text-center">{{ row.bot }}</td>
                <td class="px-4 py-2.5 text-center">{{ row.panel }}</td>
                <td class="px-4 py-2.5 text-center">{{ row.both }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-8 space-y-4">
          <article
            *ngFor="let plan of plans"
            class="rounded-2xl border p-5 sm:p-6"
            [class.border-teal-600]="plan.featured"
            [class.ring-1]="plan.featured"
            [class.ring-teal-800/60]="plan.featured"
            [class.bg-teal-950/20]="plan.featured"
            [class.border-gray-800]="!plan.featured"
            [class.bg-gray-900/70]="!plan.featured">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-lg font-bold">{{ plan.label }}</h2>
                  <span
                    *ngIf="plan.featured && plan.badgeLabel"
                    class="text-[10px] uppercase tracking-wide font-bold text-teal-200 bg-teal-800/80 px-2 py-0.5 rounded-full">
                    {{ plan.badgeLabel }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-teal-300 font-semibold">{{ priceFor(plan.id) }}</p>
                <p class="mt-1 text-sm text-gray-400 leading-relaxed">{{ plan.headline }}</p>
                <div class="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span class="rounded-full border px-2 py-0.5"
                    [class.border-teal-700]="plan.whatsapp"
                    [class.text-teal-300]="plan.whatsapp"
                    [class.border-gray-700]="!plan.whatsapp"
                    [class.text-gray-500]="!plan.whatsapp">
                    WhatsApp {{ plan.whatsapp ? '✓' : '—' }}
                  </span>
                  <span class="rounded-full border px-2 py-0.5"
                    [class.border-teal-700]="plan.panelWeb"
                    [class.text-teal-300]="plan.panelWeb"
                    [class.border-gray-700]="!plan.panelWeb"
                    [class.text-gray-500]="!plan.panelWeb">
                    Panel web {{ plan.panelWeb ? '✓' : '—' }}
                  </span>
                </div>
                <ul class="mt-3 text-xs text-gray-300 space-y-1">
                  <li *ngFor="let item of plan.includes">✓ {{ item }}</li>
                </ul>
                <button
                  type="button"
                  class="mt-3 text-xs text-teal-400 hover:underline"
                  (click)="guide.open(plan.id === 'erp' ? 'erp' : 'whatsapp')">
                  Ver guía visual de este plan
                </button>
              </div>
              <a
                [routerLink]="['/registro']"
                [queryParams]="{ producto: plan.id }"
                class="shrink-0 inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
                [class.bg-teal-600]="plan.featured"
                [class.hover:bg-teal-500]="plan.featured"
                [class.bg-gray-800]="!plan.featured"
                [class.hover:bg-gray-700]="!plan.featured">
                Probar {{ plan.trialDays }} días gratis
              </a>
            </div>
          </article>
        </div>

        <div class="mt-10 rounded-xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-400 leading-relaxed">
          <h2 class="text-base font-bold text-white mb-2">Pago con tarjeta</h2>
          <p>
            La prueba <span class="text-white">no pide tarjeta</span>. Cuando quieras seguir,
            vas a poder pagar con Mercado Pago desde Activar o administrar plan.
          </p>
          <p class="mt-3 text-xs text-gray-500">{{ pricingFootnote }}</p>
        </div>
      </section>

      <app-ritotech-faq
        title="Preguntas sobre planes"
        [items]="faqItems"
        headingId="plans-faq">
      </app-ritotech-faq>

      <section class="max-w-4xl mx-auto px-4 pb-16 text-center">
        <a routerLink="/" class="text-sm text-gray-500 hover:text-gray-300">← Volver al inicio</a>
      </section>
    </app-ritotech-public-shell>
  `,
})
export class RitotechPlansComponent implements OnInit {
  readonly rilobotDays = RILOBOT_TRIAL_DAYS;
  readonly panelDays = PANEL_TRIAL_DAYS;
  readonly audiencePitch = RILOTECH_AUDIENCE_PITCH;
  readonly faqItems = RILOTECH_FAQ;
  readonly plans = RILOTECH_PRICING_TIERS;
  country: BillingCountryCode = 'UY';

  readonly matrix = [
    { label: 'Pedidos y ventas', bot: '✓', panel: '✓', both: '✓' },
    { label: 'Cobros y saldos', bot: '✓', panel: '✓', both: '✓' },
    { label: 'Cargar desde el celular', bot: '✓', panel: '—', both: '✓' },
    { label: 'Consultas rápidas (caja/saldo)', bot: '✓', panel: '✓', both: '✓' },
    { label: 'Caja completa / entradas-salidas', bot: '—', panel: '✓', both: '✓' },
    { label: 'Compras y proveedores', bot: '—', panel: '✓', both: '✓' },
    { label: 'Stock', bot: '—', panel: '✓', both: '✓' },
    { label: 'Reportes', bot: '—', panel: '✓', both: '✓' },
    { label: 'Acciones IA incluidas (plan pago)', bot: '1.000', panel: '—', both: '2.000' },
  ];

  ngOnInit() {
    try {
      const saved = localStorage.getItem(COUNTRY_STORAGE_KEY);
      if (saved === 'AR' || saved === 'UY') this.country = saved;
    } catch {
      /* ignore */
    }
  }

  get pricingFootnote(): string {
    return pricingFootnoteForCountry(this.country);
  }

  setCountry(country: BillingCountryCode) {
    this.country = country;
    try {
      localStorage.setItem(COUNTRY_STORAGE_KEY, country);
    } catch {
      /* ignore */
    }
  }

  priceFor(productId: (typeof RILOTECH_PRICING_TIERS)[number]['id']): string {
    return priceLabelForTier(productId, this.country);
  }
}
