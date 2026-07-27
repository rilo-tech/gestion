import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
} from '../../../../../shared/platform-access.ts';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import {
  RILOTECH_AUDIENCE_PITCH,
  RILOTECH_CHAT_DEMO,
  RILOTECH_CTA_FINAL,
  RILOTECH_FAQ,
  RILOTECH_HERO,
  RILOTECH_HOW_IT_WORKS,
  RILOTECH_PRICING_TIERS,
  RILOTECH_USE_CASES,
  priceLabelForTier,
  pricingFootnoteForCountry,
} from '../../../../../shared/ritotech-marketing.ts';

const COUNTRY_STORAGE_KEY = 'rilo_billing_country';

@Component({
  selector: 'app-ritotech-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RitotechPublicShellComponent,
    RitotechFaqComponent,
    RitotechChatDemoComponent,
    RitotechVisualGuideComponent,
  ],
  template: `
    <app-ritotech-public-shell>
      <!-- Hero -->
      <section class="max-w-6xl mx-auto px-4 pt-4 sm:pt-6 pb-8 sm:pb-10 text-center">
        <div class="flex justify-center mb-3 sm:mb-4">
          <img
            src="/brand/rilotech-lockup-on-dark.png"
            alt="RiloTech"
            width="140"
            height="140"
            class="h-16 sm:h-20 w-auto object-contain"
            decoding="async" />
        </div>
        <p class="text-teal-400 text-xs sm:text-sm font-semibold uppercase tracking-wide mb-2">Para microemprendimientos</p>
        <h1 class="text-2xl sm:text-4xl lg:text-5xl font-bold leading-tight max-w-3xl mx-auto">
          {{ hero.title }}
        </h1>
        <p class="mt-3 text-gray-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
          {{ hero.subtitle }}
        </p>
        <p class="mt-2 text-sm text-gray-500 max-w-xl mx-auto leading-relaxed">{{ audiencePitch }}</p>
        <div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            routerLink="/registro"
            [queryParams]="{ producto: 'whatsapp' }"
            class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold hover:bg-teal-500">
            {{ hero.ctaPrimary }}
          </a>
          <button
            type="button"
            (click)="scrollToDemo()"
            class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900">
            {{ hero.ctaSecondary }}
          </button>
        </div>
        <p class="mt-3 text-xs text-gray-500">{{ hero.microcopy }}</p>
        <div class="mt-3 flex justify-center">
          <app-ritotech-visual-guide
            #guide
            triggerLabel="Ver mini guía"
            defaultTab="whatsapp">
          </app-ritotech-visual-guide>
        </div>
      </section>

      <!-- Demo WhatsApp (prueba visual central) -->
      <section id="demo" class="max-w-6xl mx-auto px-4 pb-12 scroll-mt-20">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <div class="flex items-center gap-3 mb-3">
              <img
                src="/brand/rilobot-mark.png"
                alt=""
                width="48"
                height="48"
                class="h-12 w-12 object-contain"
                decoding="async" />
              <h2 class="text-xl sm:text-2xl font-bold">Así se ve RiloBot en WhatsApp</h2>
            </div>
            <p class="mt-3 text-sm text-gray-400 leading-relaxed">
              Escribís en lenguaje natural. El bot entiende, te resume la operación y
              <span class="text-teal-400 font-medium">solo guarda si confirmás con SÍ</span>.
              No hace falta aprender menús ni códigos.
            </p>
            <ul class="mt-4 space-y-2 text-sm text-gray-300">
              <li>✓ "Venta a María, 2 remeras, cobró 800"</li>
              <li>✓ "Pedido para Juan con 3 productos"</li>
              <li>✓ "¿Cuánto debe Pedro?" / "¿Cuánto vendí hoy?"</li>
            </ul>
            <a
              routerLink="/registro"
              [queryParams]="{ producto: 'whatsapp' }"
              class="mt-6 inline-flex rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold hover:bg-teal-500">
              Probar RiloBot {{ rilobotTrialDays }} días gratis
            </a>
          </div>
          <app-ritotech-chat-demo
            [messages]="chatDemo"
            caption="Ejemplo ilustrativo. En la prueba usás el número que registrás.">
          </app-ritotech-chat-demo>
        </div>
      </section>

      <!-- Beneficios -->
      <section class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-2">Beneficios concretos</h2>
        <p class="text-center text-sm text-gray-500 mb-8 max-w-xl mx-auto">
          Menos olvidos, cobros al día y datos al instante — sin promesas mágicas de ganancia.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <article
            *ngFor="let useCase of useCases"
            class="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <span class="text-2xl" aria-hidden="true">{{ useCaseEmoji[useCase.icon] }}</span>
            <h3 class="mt-2 text-sm font-bold text-white">{{ useCase.title }}</h3>
            <p class="mt-1.5 text-xs text-gray-400 leading-relaxed">{{ useCase.description }}</p>
          </article>
        </div>
      </section>

      <!-- Productos -->
      <section class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-2">Planes simples</h2>
        <p class="text-center text-sm text-gray-500 mb-4 max-w-lg mx-auto">
          Empezá por RiloBot. Sumá el panel web cuando necesites caja avanzada, stock o compras.
        </p>
        <div class="flex justify-center gap-2 mb-6">
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
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <article
            *ngFor="let card of productCards"
            class="rounded-2xl border p-5 flex flex-col relative"
            [class.border-teal-600]="card.featured"
            [class.bg-teal-950/30]="card.featured"
            [class.border-gray-800]="!card.featured"
            [class.bg-gray-900/60]="!card.featured">
            <span
              *ngIf="card.featured && card.badgeLabel"
              class="absolute -top-2.5 left-4 text-[10px] uppercase tracking-wide font-bold text-teal-200 bg-teal-700 px-2 py-0.5 rounded-full">
              {{ card.badgeLabel }}
            </span>
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <img
                *ngIf="card.id === 'whatsapp' || card.id === 'completo'"
                src="/brand/rilobot-mark.png"
                alt=""
                width="28"
                height="28"
                class="h-7 w-7 object-contain"
                decoding="async" />
              {{ card.label }}
            </h3>
            <p class="mt-1 text-sm font-semibold text-teal-300">{{ card.price }}</p>
            <p class="mt-2 text-sm text-gray-400 flex-1 leading-relaxed">{{ card.description }}</p>
            <p class="mt-2 text-[11px] text-gray-500">Prueba {{ card.trialDays }} días · Sin tarjeta</p>
            <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span
                class="rounded-full px-2 py-0.5 border"
                [class.border-teal-700]="card.whatsapp"
                [class.text-teal-300]="card.whatsapp"
                [class.border-gray-700]="!card.whatsapp"
                [class.text-gray-500]="!card.whatsapp">
                WhatsApp {{ card.whatsapp ? '✓' : '—' }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 border"
                [class.border-teal-700]="card.panel"
                [class.text-teal-300]="card.panel"
                [class.border-gray-700]="!card.panel"
                [class.text-gray-500]="!card.panel">
                Panel web {{ card.panel ? '✓' : '—' }}
              </span>
            </div>
            <a
              [routerLink]="['/registro']"
              [queryParams]="{ producto: card.id }"
              class="mt-5 inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
              [class.bg-teal-600]="card.featured"
              [class.hover:bg-teal-500]="card.featured"
              [class.bg-violet-700/80]="!card.featured"
              [class.hover:bg-violet-600]="!card.featured">
              Probar {{ card.trialDays }} días
            </a>
            <button
              *ngIf="card.featured"
              type="button"
              (click)="guide.open('whatsapp')"
              class="mt-2 text-xs text-teal-400/90 hover:text-teal-300 hover:underline text-center">
              ¿Cómo funciona? Ver guía visual
            </button>
            <button
              *ngIf="card.id === 'erp'"
              type="button"
              (click)="guide.open('erp')"
              class="mt-2 text-xs text-gray-500 hover:text-gray-300 hover:underline text-center">
              Ver guía del panel web
            </button>
          </article>
        </div>
        <p class="mt-4 text-center text-xs text-gray-500">{{ pricingFootnote }}</p>
      </section>

      <!-- Cómo funciona -->
      <section class="max-w-4xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-8">Cómo empezar en 3 pasos</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div *ngFor="let step of howItWorks" class="text-center sm:text-left">
            <span
              class="inline-flex w-9 h-9 items-center justify-center rounded-full bg-teal-900/60 text-teal-300 text-sm font-bold border border-teal-800">
              {{ step.step }}
            </span>
            <h3 class="mt-3 text-sm font-bold text-white">{{ step.title }}</h3>
            <p class="mt-1.5 text-xs text-gray-400 leading-relaxed">{{ step.description }}</p>
          </div>
        </div>
      </section>

      <!-- Precios detalle -->
      <section class="max-w-4xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-2">Precios claros · prueba sin tarjeta</h2>
        <p class="text-center text-sm text-gray-500 mb-6 max-w-lg mx-auto">
          RiloBot {{ rilobotTrialDays }} días · Panel y Completo 20 días. Recién pagás cuando activás el plan.
        </p>
        <div class="space-y-3">
          <article
            *ngFor="let tier of pricingTiers"
            class="rounded-xl border p-4 sm:p-5"
            [class.border-teal-700]="tier.featured"
            [class.bg-teal-950/20]="tier.featured"
            [class.border-gray-800]="!tier.featured"
            [class.bg-gray-900/50]="!tier.featured">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-bold text-white">{{ tier.label }}</h3>
                  <span *ngIf="tier.featured" class="text-[10px] font-bold uppercase text-teal-300">
                    {{ tier.badgeLabel || 'Recomendado' }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-teal-300 font-semibold">{{ priceFor(tier.id) }}</p>
                <p class="mt-1 text-xs text-gray-400">{{ tier.headline }}</p>
                <p class="mt-2 text-xs text-gray-500">Prueba: {{ tier.trialIncludes }}</p>
              </div>
              <a
                [routerLink]="['/registro']"
                [queryParams]="{ producto: tier.id }"
                class="shrink-0 inline-flex justify-center rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800">
                Probar {{ tier.trialDays }} días
              </a>
            </div>
          </article>
        </div>
        <p class="mt-6 text-center text-xs text-gray-500">{{ pricingFootnote }}</p>
        <p class="mt-2 text-center">
          <a routerLink="/planes" class="text-sm text-teal-400 hover:underline">Ver comparación detallada →</a>
        </p>
      </section>

      <!-- FAQ -->
      <app-ritotech-faq
        title="Preguntas frecuentes"
        subtitle="IA, seguridad, facturación, límites y cancelación"
        [items]="faqItems"
        headingId="landing-faq">
      </app-ritotech-faq>

      <!-- CTA final -->
      <section class="max-w-6xl mx-auto px-4 pb-16">
        <div class="rounded-2xl border border-teal-900/50 bg-teal-950/30 p-6 sm:p-8 text-center">
          <h2 class="text-xl font-bold">{{ ctaFinal.title }}</h2>
          <p class="mt-2 text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
            {{ ctaFinal.body }}
          </p>
          <div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              routerLink="/registro"
              [queryParams]="{ producto: 'whatsapp' }"
              class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold hover:bg-teal-500">
              {{ hero.ctaPrimary }}
            </a>
            <a
              routerLink="/login"
              class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-300 hover:bg-gray-900">
              Ya tengo cuenta
            </a>
          </div>
        </div>
      </section>
    </app-ritotech-public-shell>
  `,
})
export class RitotechLandingComponent implements OnInit {
  readonly hero = RILOTECH_HERO;
  readonly rilobotTrialDays = RILOBOT_TRIAL_DAYS;
  readonly audiencePitch = RILOTECH_AUDIENCE_PITCH;
  readonly useCases = RILOTECH_USE_CASES;
  readonly chatDemo = RILOTECH_CHAT_DEMO;
  readonly howItWorks = RILOTECH_HOW_IT_WORKS;
  readonly pricingTiers = RILOTECH_PRICING_TIERS;
  readonly faqItems = RILOTECH_FAQ;
  readonly ctaFinal = RILOTECH_CTA_FINAL;

  country: BillingCountryCode = 'UY';

  readonly useCaseEmoji: Record<string, string> = {
    phone: '📱',
    store: '🏪',
    chart: '📊',
    team: '👥',
  };

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

  get productCards() {
    return RILOTECH_PRICING_TIERS.map((tier) => ({
      id: tier.id,
      label: tier.label,
      description: TRIAL_PRODUCT_DESCRIPTIONS[tier.id],
      price: priceLabelForTier(tier.id, this.country),
      whatsapp: tier.whatsapp,
      panel: tier.panelWeb,
      featured: Boolean(tier.featured),
      badgeLabel: tier.badgeLabel,
      trialDays: tier.trialDays,
    }));
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

  scrollToDemo() {
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
