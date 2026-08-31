import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import { RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import { SHOW_ARGENTINA_BILLING, type BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import { DEFAULT_COMMERCIAL_CATALOG, commercialFunnelSteps, completeVsSeparate, extraErpUserPriceFor, extraWhatsappNumberPriceFor, formatCatalogPriceLabel, parseUsageMode, stayFreePitch as buildStayFreePitch, trialCtaForProduct, type CommercialProductQuote } from '../../../../../shared/commercial-catalog.ts';
import {
  RILOTECH_AUDIENCE_PITCH,
  faqFromCatalog,
  priceLabelFromCatalog,
  pricingFootnoteFromCatalog,
  pricingTiersFromCatalog,
  usagePackCardsFromCatalog,
} from '../../../../../shared/ritotech-marketing.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service.ts';
import { AuthService } from '../../core/services/auth.service';
import type { TrialProductId } from '../../../../../shared/platform-access.ts';
import { isTrialProductId, TRIAL_PRODUCT_TAGLINES } from '../../../../../shared/platform-access.ts';

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
    RitotechProductCtaComponent,
  ],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-4xl mx-auto px-4 py-10 sm:py-14">
        <h1 class="text-2xl sm:text-3xl font-bold text-center">Planes simples para tu negocio</h1>
        <p class="text-center text-gray-400 mt-2 text-sm sm:text-base max-w-xl mx-auto">
          {{ audiencePitch }}
        </p>
        <p class="text-center text-xs text-teal-400/90 mt-3 font-medium leading-relaxed max-w-2xl mx-auto">
          {{ stayFreePitch }}
        </p>
        <p
          *ngIf="auth.currentUser && !auth.isPlatformAdmin"
          class="mt-5 text-center text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Esta página es el catálogo.
          <a *ngIf="auth.isSupervisor" [routerLink]="auth.planRoute" class="text-teal-300 hover:underline">
            Lo que tenés contratado está en Mi plan</a><span *ngIf="auth.isSupervisor"> · </span>
          <a [routerLink]="auth.homeRoute" class="text-teal-300 hover:underline">
            {{ auth.canAccessErpWeb ? 'Ir al panel' : 'Ir a Mi cuenta' }}</a>.
        </p>
        <div *ngIf="sumarProduct" class="mt-4 max-w-xl mx-auto">
          <app-ritotech-product-cta [product]="sumarProduct" [guestLabel]="'Probar ' + trialDays + ' días'"></app-ritotech-product-cta>
        </div>
        <div class="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div
            *ngFor="let step of funnelSteps"
            class="rounded-xl border border-gray-800 bg-gray-900/50 p-3 text-left">
            <p class="text-[10px] font-bold uppercase tracking-wide text-teal-400">
              {{ step.step }} · {{ step.title }}
            </p>
            <p class="mt-1 text-[11px] text-gray-400 leading-relaxed">{{ step.body }}</p>
          </div>
        </div>
        <div *ngIf="showArgentinaBilling" class="mt-4 flex justify-center gap-2">
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
        <div class="mt-5 flex flex-wrap justify-center gap-3 max-w-full">
          <app-ritotech-visual-guide
            #guide
            class="w-full sm:w-auto max-w-full"
            triggerLabel="Mirá cómo te ordena el día"
            defaultTab="whatsapp">
          </app-ritotech-visual-guide>
          <button
            type="button"
            (click)="guide.open('erp')"
            class="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-800 bg-transparent px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-300 hover:border-gray-700 transition">
            Guía de Gestión
          </button>
        </div>

        <div class="mt-8 overflow-x-auto rounded-xl border border-gray-800">
          <table class="w-full text-left text-sm min-w-[480px]">
            <thead class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
              <tr>
                <th class="px-4 py-3 font-medium">Qué incluye</th>
                <th class="px-4 py-3 font-medium text-center">RILO Bot</th>
                <th class="px-4 py-3 font-medium text-center">RILO Gestión</th>
                <th class="px-4 py-3 font-medium text-center">RILO Completo</th>
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
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-lg font-bold">{{ plan.label }}</h2>
                  <span
                    *ngIf="plan.featured && plan.badgeLabel"
                    class="text-[10px] uppercase tracking-wide font-bold text-teal-200 bg-teal-800/80 px-2 py-0.5 rounded-full">
                    {{ plan.badgeLabel }}
                  </span>
                </div>
                <p class="mt-0.5 text-xs text-teal-400/90">{{ productTagline(plan.id) }}</p>
                <p class="mt-1 text-lg font-semibold text-teal-300">{{ priceFor(plan.id) }}</p>
                <p class="mt-0.5 text-xs text-gray-400">{{ plan.trialDays }} días gratis, sin tarjeta</p>
                <p *ngIf="plan.id === 'completo' && completeSavingLabel" class="mt-0.5 text-xs text-teal-400/90">
                  {{ completeSavingLabel }}
                </p>
                <p class="mt-1 text-sm text-gray-400 leading-relaxed">{{ plan.headline }}</p>
                <div class="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span class="rounded-full border px-2 py-0.5"
                    [class.border-teal-700]="plan.whatsapp"
                    [class.text-teal-300]="plan.whatsapp"
                    [class.border-gray-700]="!plan.whatsapp"
                    [class.text-gray-500]="!plan.whatsapp">
                    RILO Bot {{ plan.whatsapp ? '✓' : '—' }}
                  </span>
                  <span class="rounded-full border px-2 py-0.5"
                    [class.border-teal-700]="plan.panelWeb"
                    [class.text-teal-300]="plan.panelWeb"
                    [class.border-gray-700]="!plan.panelWeb"
                    [class.text-gray-500]="!plan.panelWeb">
                    RILO Gestión {{ plan.panelWeb ? '✓' : '—' }}
                  </span>
                </div>
              </div>
              <app-ritotech-product-cta
                [product]="plan.id"
                [guestLabel]="ctaLabel(plan.id)"
                [variant]="plan.featured ? 'primary' : 'secondary'">
              </app-ritotech-product-cta>
            </div>
            <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-gray-300">
              <li *ngFor="let item of plan.includes" class="flex gap-2 leading-snug">
                <span class="text-teal-400 shrink-0">✓</span>
                <span>{{ item }}</span>
              </li>
            </ul>
            <button
              type="button"
              class="mt-3 text-xs text-teal-400 hover:underline"
              (click)="guide.open(plan.id === 'erp' ? 'erp' : 'whatsapp')">
              Ver cómo te simplifica el día
            </button>
          </article>
        </div>

        <section id="precios" class="mt-10 scroll-mt-20">
          <h2 class="text-xl font-bold text-white">Precios</h2>
          <p class="mt-2 text-sm text-gray-400 leading-relaxed">
            {{ trialDays }} días gratis, sin tarjeta. Al vencer, contratás el plan mensual para seguir operando. Tus datos no se borran.
          </p>
          <div class="mt-5 space-y-3">
            <article
              *ngFor="let plan of plans"
              class="rounded-xl border p-4 sm:p-5"
              [class.border-teal-700]="plan.featured"
              [class.bg-teal-950/20]="plan.featured"
              [class.border-gray-800]="!plan.featured"
              [class.bg-gray-900/50]="!plan.featured">
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-bold text-white">{{ plan.label }}</h3>
                    <span *ngIf="plan.featured" class="text-[10px] font-bold uppercase text-teal-300">
                      {{ plan.badgeLabel || 'Recomendado' }}
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-teal-300 font-semibold">
                    {{ priceFor(plan.id) }}
                  </p>
                  <p class="mt-1 text-xs text-gray-400">{{ plan.headline }}</p>
                  <p class="mt-2 text-xs text-gray-500">{{ plan.trialIncludes }}</p>
                </div>
                <app-ritotech-product-cta
                  [product]="plan.id"
                  [guestLabel]="'Probar ' + trialDays + ' días'"
                  variant="compact">
                </app-ritotech-product-cta>
              </div>
            </article>
          </div>
          <p class="mt-4 text-xs text-gray-500">{{ pricingFootnote }}</p>
          <p class="mt-2 text-xs text-gray-500 leading-relaxed">
            Los precios son de referencia y pueden reajustarse. Si ya pagás un plan, te avisamos antes de cambiar tu cuota.
          </p>
        </section>

        <section *ngIf="usagePacks.length" class="mt-10 rounded-2xl border border-gray-800 bg-gray-900/40 p-5 sm:p-6">
          <h2 class="text-xl font-bold text-white">Packs extra (este mes)</h2>
          <p class="mt-2 text-sm text-gray-400 leading-relaxed">
            El plan incluye un cupo de mensajes e IA. Si operás más, comprás un pack para ese mes.
            SÍ, NO y elegir un número también cuentan. No es una segunda suscripción: se cobra una vez y vale hasta fin de mes.
          </p>
          <div class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <article
              *ngFor="let pack of usagePacks"
              class="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
              <p class="text-sm font-semibold text-white">{{ pack.title }}</p>
              <p class="mt-1 text-lg font-bold text-teal-300">{{ pack.priceLabel }}</p>
              <p class="mt-1 text-xs text-gray-500 leading-relaxed">{{ pack.hint }}</p>
            </article>
          </div>
          <p class="mt-4 text-xs text-gray-500 leading-relaxed">
            Se compra desde Mi plan, con la cuenta ya creada. Los mismos números se publican desde Plataforma.
          </p>
        </section>
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
  private commercial = inject(CommercialCatalogService);
  private route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  readonly audiencePitch = RILOTECH_AUDIENCE_PITCH;
  catalog: CommercialCatalog = DEFAULT_COMMERCIAL_CATALOG;
  country: BillingCountryCode = 'UY';
  readonly showArgentinaBilling = SHOW_ARGENTINA_BILLING;
  sumarProduct: TrialProductId | null = null;

  get trialDays(): number {
    return this.catalog.trialDays || RILOBOT_TRIAL_DAYS;
  }

  get stayFreePitch(): string {
    return buildStayFreePitch(this.catalog);
  }

  get completeSavingLabel(): string {
    const vs = completeVsSeparate(this.catalog, this.country);
    if (vs.saving <= 0) return '';
    return `Por separado ${formatCatalogPriceLabel(this.country, vs.separate)} · ahorrás ${formatCatalogPriceLabel(this.country, vs.saving)}`;
  }

  ctaLabel(productId: TrialProductId): string {
    return trialCtaForProduct(productId);
  }

  productTagline(productId: TrialProductId): string {
    return TRIAL_PRODUCT_TAGLINES[productId];
  }

  get funnelSteps() {
    return commercialFunnelSteps(this.catalog);
  }

  get faqItems() {
    return faqFromCatalog(this.catalog, this.country);
  }

  get usagePacks() {
    return usagePackCardsFromCatalog(this.catalog, this.country);
  }

  get plans() {
    return pricingTiersFromCatalog(this.catalog, this.country);
  }

  formatWhatsappActions(quote: CommercialProductQuote): string {
    if (parseUsageMode(quote.usageMode) === 'unlimited') return 'Libre';
    return quote.includedAi > 0 ? quote.includedAi.toLocaleString('es-UY') : '—';
  }

  extraUserLabel(productId: TrialProductId): string {
    const amount = extraErpUserPriceFor(this.catalog, productId, this.country);
    return amount > 0 ? formatCatalogPriceLabel(this.country, amount) : '—';
  }

  extraNumberLabel(productId: TrialProductId): string {
    const amount = extraWhatsappNumberPriceFor(this.catalog, productId, this.country);
    return amount > 0 ? formatCatalogPriceLabel(this.country, amount) : '—';
  }

  get matrix() {
    const wa = this.catalog.products;
    const fmt = (n: number) => (n > 0 ? n.toLocaleString('es-UY') : '—');
    return [
      { label: 'Pedidos y ventas', bot: '✓', panel: '✓', both: '✓' },
      { label: 'Cobros y saldos', bot: '✓', panel: '✓', both: '✓' },
      { label: 'Compras a proveedor', bot: '✓', panel: '✓', both: '✓' },
      { label: 'Caja del día', bot: '✓', panel: '✓', both: '✓' },
      { label: 'Cargar desde el celular', bot: '✓', panel: '—', both: '✓' },
      { label: 'Listados y ficha en la web', bot: '—', panel: '✓', both: '✓' },
      { label: 'Mensajes WhatsApp / mes', bot: fmt(wa.whatsapp.includedWhatsapp), panel: '—', both: fmt(wa.completo.includedWhatsapp) },
      { label: 'Acciones por WhatsApp / mes', bot: this.formatWhatsappActions(wa.whatsapp), panel: this.formatWhatsappActions(wa.erp), both: this.formatWhatsappActions(wa.completo) },
      { label: 'Números de WhatsApp incluidos', bot: fmt(wa.whatsapp.includedWhatsappNumbers ?? 1), panel: '—', both: fmt(wa.completo.includedWhatsappNumbers ?? 1) },
      { label: 'Usuarios incluidos', bot: fmt(wa.whatsapp.includedErpUsers ?? 1), panel: fmt(wa.erp.includedErpUsers ?? 1), both: fmt(wa.completo.includedErpUsers ?? 1) },
      { label: 'Usuario adicional / mes', bot: this.extraUserLabel('whatsapp'), panel: this.extraUserLabel('erp'), both: this.extraUserLabel('completo') },
      { label: 'Número WhatsApp adicional / mes', bot: this.extraNumberLabel('whatsapp'), panel: '—', both: this.extraNumberLabel('completo') },
    ];
  }

  ngOnInit() {
    try {
      const saved = localStorage.getItem(COUNTRY_STORAGE_KEY);
      if (SHOW_ARGENTINA_BILLING && (saved === 'AR' || saved === 'UY')) this.country = saved;
      else this.country = 'UY';
    } catch {
      this.country = 'UY';
    }
    this.loadCatalog();
    this.route.queryParamMap.subscribe((params) => {
      const sumar = params.get('sumar');
      this.sumarProduct = isTrialProductId(sumar) ? sumar : null;
    });
    this.route.fragment.subscribe((fragment) => {
      if (fragment !== 'precios') return;
      setTimeout(() => {
        document.getElementById('precios')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    });
  }

  private loadCatalog() {
    this.commercial.load(this.country).subscribe({
      next: (row) => {
        this.catalog = row.catalog;
      },
    });
  }

  get pricingFootnote(): string {
    return pricingFootnoteFromCatalog(this.country, this.catalog);
  }

  setCountry(country: BillingCountryCode) {
    this.country = country;
    try {
      localStorage.setItem(COUNTRY_STORAGE_KEY, country);
    } catch {
      /* ignore */
    }
    this.loadCatalog();
  }

  priceFor(productId: TrialProductId): string {
    return priceLabelFromCatalog(productId, this.country, this.catalog);
  }
}
