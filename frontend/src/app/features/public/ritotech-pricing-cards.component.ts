import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import type { TrialProductId } from '../../../../../shared/platform-access.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  TRIAL_PRODUCT_TAGLINES,
} from '../../../../../shared/platform-access.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import {
  completeVsSeparate,
  formatCatalogPriceLabel,
  amountMonthlyFor,
  trialCtaForProduct,
} from '../../../../../shared/commercial-catalog.ts';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import {
  priceLabelFromCatalog,
  pricingTiersFromCatalog,
} from '../../../../../shared/ritotech-marketing.ts';

export type RitotechPricingCard = {
  id: TrialProductId;
  label: string;
  tagline: string;
  description: string;
  price: string;
  whatsapp: boolean;
  panel: boolean;
  featured: boolean;
  badgeLabel?: string;
  trialDays: number;
  quotaLines: string[];
  highlight?: 'recommended' | 'value' | null;
};

@Component({
  selector: 'app-ritotech-pricing-cards',
  standalone: true,
  imports: [CommonModule, RitotechProductCtaComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
      <article
        *ngFor="let card of cards"
        class="rounded-2xl border p-5 flex flex-col h-full relative"
        [class.border-teal-600]="card.featured"
        [class.bg-teal-950/30]="card.featured"
        [class.border-amber-700/70]="!card.featured && card.highlight === 'value'"
        [class.bg-amber-950/15]="!card.featured && card.highlight === 'value'"
        [class.border-gray-800]="!card.featured && card.highlight !== 'value'"
        [class.bg-gray-900/60]="!card.featured && card.highlight !== 'value'">
        <span
          *ngIf="card.badgeLabel"
          class="absolute -top-2.5 left-4 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
          [class.text-white]="card.featured"
          [class.bg-teal-800]="card.featured"
          [class.text-amber-100]="!card.featured && card.highlight === 'value'"
          [class.bg-amber-800]="!card.featured && card.highlight === 'value'"
          [class.text-gray-200]="!card.featured && card.highlight !== 'value'"
          [class.bg-gray-700]="!card.featured && card.highlight !== 'value'">
          {{ card.badgeLabel }}
        </span>
        <h3 class="text-lg font-bold text-white flex items-center gap-2">
          <img
            *ngIf="card.whatsapp"
            src="/brand/rilobot-mark.png"
            alt=""
            width="28"
            height="28"
            class="h-7 w-7 object-contain"
            decoding="async" />
          {{ card.label }}
        </h3>
        <p class="mt-0.5 text-xs text-teal-400/90">{{ card.tagline }}</p>
        <p class="mt-1 text-lg font-semibold text-teal-300">{{ card.price }}</p>
        <p class="mt-0.5 text-xs text-gray-400">{{ trialDays }} días gratis, sin tarjeta</p>
        <p *ngIf="card.id === 'completo' && completeSavingLabel" class="mt-0.5 text-xs text-teal-400/90">
          {{ completeSavingLabel }}
        </p>
        <p class="mt-2 text-sm text-gray-400 leading-relaxed">{{ card.description }}</p>
        <ul *ngIf="card.quotaLines.length" class="mt-3 space-y-1 text-xs text-gray-300 flex-1">
          <li *ngFor="let line of card.quotaLines" class="flex gap-2">
            <span class="text-teal-400 shrink-0">✓</span>
            <span>{{ line }}</span>
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap gap-2 text-xs">
          <span
            class="rounded-full px-2 py-0.5 border"
            [class.border-teal-700]="card.whatsapp"
            [class.text-teal-300]="card.whatsapp"
            [class.border-gray-700]="!card.whatsapp"
            [class.text-gray-500]="!card.whatsapp">
            RILO Bot {{ card.whatsapp ? '✓' : '—' }}
          </span>
          <span
            class="rounded-full px-2 py-0.5 border"
            [class.border-teal-700]="card.panel"
            [class.text-teal-300]="card.panel"
            [class.border-gray-700]="!card.panel"
            [class.text-gray-500]="!card.panel">
            RILO Gestión {{ card.panel ? '✓' : '—' }}
          </span>
        </div>
        <div class="mt-auto pt-5 flex flex-col gap-2">
          <app-ritotech-product-cta
            [product]="card.id"
            [guestLabel]="ctaLabel(card.id)"
            [variant]="card.featured ? 'primary' : 'secondary'">
          </app-ritotech-product-cta>
          <button
            type="button"
            (click)="guideRequested.emit(card.id === 'erp' ? 'erp' : 'whatsapp')"
            class="text-xs text-teal-400/90 hover:text-teal-300 hover:underline text-center min-h-[24px]">
            Ver cómo funciona
          </button>
        </div>
      </article>
    </div>
  `,
})
export class RitotechPricingCardsComponent {
  @Input({ required: true }) catalog!: CommercialCatalog;
  @Input() country: BillingCountryCode = 'UY';
  @Output() guideRequested = new EventEmitter<'whatsapp' | 'erp'>();

  get trialDays(): number {
    return this.catalog.trialDays;
  }

  get completeSavingLabel(): string {
    const vs = completeVsSeparate(this.catalog, this.country);
    if (vs.saving <= 0) return '';
    const bot = amountMonthlyFor(this.catalog, 'whatsapp', this.country);
    const delta = Math.max(0, vs.completo - bot);
    if (delta > 0) {
      return `RILO Bot + RILO Gestión · por solo ${formatCatalogPriceLabel(this.country, delta)} más que RILO Bot · ahorrás ${formatCatalogPriceLabel(this.country, vs.saving)} vs por separado`;
    }
    return `Por separado ${formatCatalogPriceLabel(this.country, vs.separate)} · ahorrás ${formatCatalogPriceLabel(this.country, vs.saving)}`;
  }

  get cards(): RitotechPricingCard[] {
    return pricingTiersFromCatalog(this.catalog, this.country).map((tier) => ({
      id: tier.id,
      label: tier.label,
      tagline: TRIAL_PRODUCT_TAGLINES[tier.id],
      description: TRIAL_PRODUCT_DESCRIPTIONS[tier.id],
      price: priceLabelFromCatalog(tier.id, this.country, this.catalog),
      whatsapp: tier.whatsapp,
      panel: tier.panelWeb,
      featured: Boolean(tier.featured),
      badgeLabel: tier.badgeLabel,
      trialDays: tier.trialDays,
      quotaLines: tier.includes,
      highlight: tier.featured ? 'recommended' : tier.badgeLabel?.toLowerCase().includes('valor') ? 'value' : null,
    }));
  }

  ctaLabel(productId: TrialProductId): string {
    return trialCtaForProduct(productId);
  }
}
