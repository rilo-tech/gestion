import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
} from '../../../../../shared/platform-access.ts';
import { SHOW_ARGENTINA_BILLING, type BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import { DEFAULT_COMMERCIAL_CATALOG, commercialFunnelSteps, stayFreePitch as buildStayFreePitch, trialMicrocopy } from '../../../../../shared/commercial-catalog.ts';
import {
  RILOTECH_AUDIENCE_PITCH,
  RILOTECH_CHAT_DEMO,
  RILOTECH_CTA_FINAL,
  RILOTECH_HERO,
  RILOTECH_HOW_IT_WORKS,
  RILOTECH_USE_CASES,
  faqFromCatalog,
  priceLabelFromCatalog,
  pricingTiersFromCatalog,
} from '../../../../../shared/ritotech-marketing.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service.ts';

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
        <p class="text-teal-400 text-xs sm:text-sm font-semibold uppercase tracking-wide mb-2">Registrate. Es gratis.</p>
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
        <p class="mt-3 text-xs text-gray-500 max-w-lg mx-auto leading-relaxed">{{ hero.microcopy }}</p>
        <p class="mt-1 text-xs text-gray-600">Sin tarjeta. A los 30 días no te cobramos: seguís gratis si no te pasás.</p>
        <p class="mt-2">
          <a routerLink="/planes" fragment="precios" class="text-sm text-teal-400 hover:underline">¿Y si crezco? Ver planes</a>
        </p>
        <div class="mt-3 flex justify-center">
          <app-ritotech-visual-guide
            #guide
            triggerLabel="Mirá cómo te ordena el día"
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
              Probar RiloBot {{ trialDays }} días gratis
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
      <section id="planes" class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-2">Planes simples</h2>
        <p class="text-center text-sm text-teal-300 font-medium mb-2 max-w-2xl mx-auto leading-relaxed">
          {{ stayFreePitch }}
        </p>
        <p class="text-center text-sm text-gray-500 mb-4 max-w-lg mx-auto">
          Empezá por RiloBot. Sumá el panel web cuando necesites caja avanzada, stock o compras.
        </p>
        <div class="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
          <div
            *ngFor="let step of funnelSteps"
            class="rounded-xl border border-gray-800 bg-gray-900/50 p-3 text-left">
            <p class="text-[10px] font-bold uppercase tracking-wide text-teal-400">
              {{ step.step }} · {{ step.title }}
            </p>
            <p class="mt-1 text-[11px] text-gray-400 leading-relaxed">{{ step.body }}</p>
          </div>
        </div>
        <div *ngIf="showArgentinaBilling" class="flex justify-center gap-2 mb-6">
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
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <article
            *ngFor="let card of productCards"
            class="rounded-2xl border p-5 flex flex-col h-full relative"
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
            <p class="mt-1 text-lg font-semibold text-teal-300">Gratis</p>
            <p class="mt-0.5 text-[11px] text-gray-400">{{ trialDays }} días a full, sin tarjeta</p>
            <p class="mt-0.5 text-[11px] text-gray-400">Después seguís gratis si no te pasás</p>
            <p class="mt-2 text-sm text-gray-400 flex-1 leading-relaxed">{{ card.description }}</p>
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
            <div class="mt-auto pt-5 flex flex-col">
              <a
                [routerLink]="['/registro']"
                [queryParams]="{ producto: card.id }"
                class="inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-semibold whitespace-nowrap"
                [class.bg-teal-600]="card.featured"
                [class.hover:bg-teal-500]="card.featured"
                [class.bg-violet-700/80]="!card.featured"
                [class.hover:bg-violet-600]="!card.featured">
                Empezar gratis
              </a>
              <div class="mt-2 h-6 flex items-center justify-center">
                <button
                  *ngIf="card.featured"
                  type="button"
                  (click)="guide.open('whatsapp')"
                  class="text-xs text-teal-400/90 hover:text-teal-300 hover:underline text-center">
                  ¿Cómo te simplifica el día? Ver historieta
                </button>
                <button
                  *ngIf="card.id === 'erp'"
                  type="button"
                  (click)="guide.open('erp')"
                  class="text-xs text-gray-500 hover:text-gray-300 hover:underline text-center">
                  Ver historieta del panel
                </button>
              </div>
            </div>
          </article>
        </div>
        <p class="mt-4 text-center text-xs text-gray-500">
          Hasta {{ catalog.lite.maxOperacionesMes }} cargas/mes · {{ catalog.lite.maxClientes }} clientes ·
          {{ catalog.lite.maxProductos }} productos · {{ catalog.lite.maxAccionesIaMes }} IA/mes en el plan gratis.
        </p>
        <p class="mt-2 text-center">
          <a routerLink="/planes" fragment="precios" class="text-sm text-teal-400 hover:underline">Ver planes y precios pagos →</a>
        </p>
        <p class="mt-2 text-center text-xs text-gray-500 max-w-lg mx-auto leading-relaxed">
          ¿Ya tenés RiloBot o el panel? No te registres otra vez:
          <a routerLink="/login" class="text-teal-400 hover:underline">ingresá</a>
          y sumá el otro módulo en tu cuenta. El mismo email o WhatsApp no crea una segunda empresa.
        </p>
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
  private route = inject(ActivatedRoute);
  private commercial = inject(CommercialCatalogService);

  readonly audiencePitch = RILOTECH_AUDIENCE_PITCH;
  readonly useCases = RILOTECH_USE_CASES;
  readonly chatDemo = RILOTECH_CHAT_DEMO;
  readonly ctaFinal = RILOTECH_CTA_FINAL;
  catalog: CommercialCatalog = DEFAULT_COMMERCIAL_CATALOG;

  country: BillingCountryCode = 'UY';
  readonly showArgentinaBilling = SHOW_ARGENTINA_BILLING;

  readonly useCaseEmoji: Record<string, string> = {
    phone: '📱',
    store: '🏪',
    chart: '📊',
    team: '👥',
  };

  get trialDays(): number {
    return this.catalog.trialDays || RILOBOT_TRIAL_DAYS;
  }

  get stayFreePitch(): string {
    return buildStayFreePitch(this.catalog);
  }

  get funnelSteps() {
    return commercialFunnelSteps(this.catalog);
  }

  get hero() {
    return {
      ...RILOTECH_HERO,
      ctaPrimary: RILOTECH_HERO.ctaPrimary,
      microcopy: trialMicrocopy(this.catalog),
    };
  }

  get howItWorks() {
    return RILOTECH_HOW_IT_WORKS.map((step) =>
      step.step === '2'
        ? {
            ...step,
            title: `${this.trialDays} días a full, sin tarjeta`,
            description: this.stayFreePitch,
          }
        : step
    );
  }

  get pricingTiers() {
    return pricingTiersFromCatalog(this.catalog);
  }

  get faqItems() {
    return faqFromCatalog(this.catalog);
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

    this.route.fragment.subscribe((fragment) => {
      if (fragment !== 'landing-faq' && fragment !== 'planes') return;
      setTimeout(() => {
        document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  get productCards() {
    return this.pricingTiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      description: TRIAL_PRODUCT_DESCRIPTIONS[tier.id],
      price: priceLabelFromCatalog(tier.id, this.country, this.catalog),
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
    this.loadCatalog();
  }

  scrollToDemo() {
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
