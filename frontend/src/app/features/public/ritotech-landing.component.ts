import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import { RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  TRIAL_PRODUCT_TAGLINES,
} from '../../../../../shared/platform-access.ts';
import { SHOW_ARGENTINA_BILLING, type BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import { DEFAULT_COMMERCIAL_CATALOG, commercialFunnelSteps, stayFreePitch as buildStayFreePitch, trialCtaForProduct, trialCtaLabel, trialMicrocopy, completeVsSeparate, formatCatalogPriceLabel } from '../../../../../shared/commercial-catalog.ts';
import {
  RILOTECH_CHAT_DEMO,
  RILOTECH_CTA_FINAL,
  RILOTECH_HERO,
  RILOTECH_HOW_IT_WORKS,
  RILOTECH_USE_CASES,
  faqFromCatalog,
  priceLabelFromCatalog,
  pricingTiersFromCatalog,
  quotaLinesForProduct,
  usagePackCardsFromCatalog,
} from '../../../../../shared/ritotech-marketing.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service.ts';
import { AuthService } from '../../core/services/auth.service';
import { whatsappCopyForRubro } from '../../../../../shared/whatsapp-copy.ts';

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
    RitotechProductCtaComponent,
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
        <p
          *ngIf="heroEyebrow"
          class="text-teal-400 text-xs sm:text-sm font-semibold uppercase tracking-wide mb-2">
          {{ heroEyebrow }}
        </p>
        <h1 class="text-3xl sm:text-5xl lg:text-6xl font-bold leading-tight max-w-4xl mx-auto text-white">
          {{ heroTitle }}
        </h1>
        <p class="mt-4 text-white/90 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
          {{ heroSubtitle }}
        </p>
        <p *ngIf="heroTagline" class="mt-3 text-sm text-white/60 max-w-xl mx-auto">{{ heroTagline }}</p>

        <div
          *ngIf="isSessionCustomer"
          class="mt-5 mx-auto max-w-xl rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-teal-400 mb-2">Cómo se usa</p>
          <ul class="space-y-1.5 text-sm text-gray-200">
            <li *ngIf="hasBotContracted">• WhatsApp: “{{ botCopy.exampleSale }}”</li>
            <li *ngIf="hasBotContracted">• Pedido: “{{ botCopy.exampleOrder }}”</li>
            <li *ngIf="hasErpContracted">• Panel: clientes, stock, caja, compras y reportes.</li>
            <li *ngIf="hasBotContracted">• El bot resume; lo corregís con un mensaje y SÍ guarda.</li>
            <li *ngIf="!hasBotContracted && !hasErpContracted">• Lo contratado y el alta están en Mi plan.</li>
          </ul>
        </div>

        <div class="mt-5 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3 max-w-xl mx-auto px-1">
          <ng-container *ngIf="isSessionCustomer; else landingGuestCtas">
            <a
              [routerLink]="auth.homeRoute"
              class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white hover:bg-teal-500 text-center">
              {{ auth.canAccessErpWeb ? 'Ir al panel' : 'Ir a Mi cuenta' }}
            </a>
            <a
              *ngIf="auth.isSupervisor"
              [routerLink]="auth.planRoute"
              class="w-full sm:w-auto rounded-xl border border-teal-700 px-6 py-3 font-semibold text-teal-200 hover:bg-teal-950/50 text-center">
              Lo que tenés contratado
            </a>
          </ng-container>
          <ng-template #landingGuestCtas>
            <app-ritotech-product-cta
              class="w-full sm:w-auto"
              product="completo"
              [guestLabel]="hero.ctaPrimary">
            </app-ritotech-product-cta>
          </ng-template>
          <button
            *ngIf="!isSessionCustomer || hasBotContracted"
            type="button"
            (click)="scrollToDemo()"
            class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900">
            {{ isSessionCustomer ? 'Cómo se usa en WhatsApp' : hero.ctaSecondary }}
          </button>
          <app-ritotech-visual-guide
            *ngIf="!isSessionCustomer"
            #guide
            class="w-full sm:w-auto"
            triggerLabel="Mirá cómo te ordena el día"
            defaultTab="whatsapp">
          </app-ritotech-visual-guide>
        </div>
        <p *ngIf="!isSessionCustomer" class="mt-3 text-xs text-gray-500 max-w-lg mx-auto leading-relaxed">{{ hero.microcopy }}</p>
        <p *ngIf="!isSessionCustomer" class="mt-2">
          <a routerLink="/planes" fragment="precios" class="text-sm text-teal-400 hover:underline">¿Y si crezco? Ver planes</a>
        </p>
      </section>

      <!-- Demo WhatsApp -->
      <section *ngIf="!isSessionCustomer || hasBotContracted" id="demo" class="max-w-6xl mx-auto px-4 pb-12 scroll-mt-20">
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
              <h2 class="text-xl sm:text-2xl font-bold">
                {{ hasBotContracted ? 'Así lo usás en WhatsApp' : 'Así se ve RILO Bot en WhatsApp' }}
              </h2>
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
            <app-ritotech-product-cta
              *ngIf="!isSessionCustomer"
              class="mt-6"
              product="whatsapp"
              [guestLabel]="'Probar RILO Bot ' + trialDays + ' días gratis'">
            </app-ritotech-product-cta>
          </div>
          <app-ritotech-chat-demo
            [messages]="chatDemo"
            [caption]="hasBotContracted ? 'El bot resume y solo guarda si confirmás con SÍ.' : 'Ejemplo ilustrativo. En la prueba usás el número que registrás.'">
          </app-ritotech-chat-demo>
        </div>
      </section>

      <!-- Beneficios -->
      <section *ngIf="!isSessionCustomer" class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5">
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
      <section
        *ngIf="!isSessionCustomer"
        id="planes"
        class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-2">Planes simples</h2>
        <p class="text-center text-sm text-teal-300 font-medium mb-2 max-w-2xl mx-auto leading-relaxed">
          {{ stayFreePitch }}
        </p>
        <p class="text-center text-sm text-gray-500 mb-4 max-w-lg mx-auto">
          Empezá por RILO Bot. Sumá RILO Gestión cuando necesites caja avanzada, stock o compras.
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
            <p class="mt-0.5 text-xs text-teal-400/90">{{ card.tagline }}</p>
            <p class="mt-1 text-lg font-semibold text-teal-300">{{ card.price }}</p>
            <p class="mt-0.5 text-[11px] text-gray-400">{{ trialDays }} días gratis, sin tarjeta</p>
            <p *ngIf="card.id === 'completo' && completeSavingLabel" class="mt-0.5 text-[11px] text-teal-400/90">
              {{ completeSavingLabel }}
            </p>
            <p class="mt-2 text-sm text-gray-400 flex-1 leading-relaxed">{{ card.description }}</p>
            <ul *ngIf="card.quotaLines.length" class="mt-3 space-y-1 text-[11px] text-gray-300">
              <li *ngFor="let line of card.quotaLines" class="flex gap-2">
                <span class="text-teal-400 shrink-0">✓</span>
                <span>{{ line }}</span>
              </li>
            </ul>
            <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
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
            <div class="mt-auto pt-5 flex flex-col">
              <app-ritotech-product-cta
                [product]="card.id"
                [guestLabel]="ctaLabel(card.id)"
                [variant]="card.featured ? 'primary' : 'secondary'">
              </app-ritotech-product-cta>
              <div class="mt-2 h-6 flex items-center justify-center">
                <button
                  *ngIf="card.id === 'whatsapp' || card.id === 'completo'"
                  type="button"
                  (click)="guide.open('whatsapp')"
                  class="text-xs text-teal-400/90 hover:text-teal-300 hover:underline text-center">
                  Ver cómo funciona
                </button>
                <button
                  *ngIf="card.id === 'erp'"
                  type="button"
                  (click)="guide.open('erp')"
                  class="text-xs text-gray-500 hover:text-gray-300 hover:underline text-center">
                  Ver cómo funciona
                </button>
              </div>
            </div>
          </article>
        </div>
        <p class="mt-4 text-center text-xs text-gray-500 max-w-lg mx-auto leading-relaxed">
          {{ trialDays }} días gratis en los tres planes. Al vencer, tus datos siguen y contratás para seguir operando.
        </p>
        <section *ngIf="usagePacks.length" class="mt-10 max-w-3xl mx-auto rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
          <h3 class="text-sm font-bold text-white">¿Te quedás corto este mes?</h3>
          <p class="mt-1 text-xs text-gray-400 leading-relaxed">
            El plan incluye un cupo. Si operás más, comprás un pack para ese mes — mismos números que en Planes y en Mi plan.
            SÍ, NO y elegir un número también cuentan.
          </p>
          <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <article
              *ngFor="let pack of usagePacks"
              class="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
              <p class="text-sm font-semibold text-white">{{ pack.title }}</p>
              <p class="mt-1 text-sm font-bold text-teal-300">{{ pack.priceLabel }}</p>
              <p class="mt-1 text-[11px] text-gray-500 leading-relaxed">{{ pack.hint }}</p>
            </article>
          </div>
          <p class="mt-3 text-[11px] text-gray-500 leading-relaxed">
            Se compra desde
            <a routerLink="/login" class="text-teal-400 hover:underline">Mi plan</a>
            con la cuenta ya creada. No es una segunda suscripción: vale el mes calendario.
          </p>
        </section>
        <p class="mt-2 text-center">
          <a routerLink="/planes" fragment="precios" class="text-sm text-teal-400 hover:underline">Ver planes y precios pagos →</a>
        </p>
        <p class="mt-2 text-center text-xs text-gray-500 max-w-lg mx-auto leading-relaxed">
          ¿Ya tenés RILO Bot o RILO Gestión? No te registres otra vez:
          <a routerLink="/login" class="text-teal-400 hover:underline">ingresá</a>
          y sumá el otro en <a routerLink="/planes" class="text-teal-400 hover:underline">Planes</a>.
          La baja se hace en Plan (solo el administrador) y no borra los datos.
        </p>
      </section>

      <!-- Cómo funciona -->
      <section id="como-funciona" class="max-w-4xl mx-auto px-4 py-12 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-8">Cómo funciona</h2>
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
        *ngIf="!isSessionCustomer"
        title="Preguntas frecuentes"
        subtitle="IA, seguridad, facturación, límites y cancelación"
        [items]="faqItems"
        headingId="landing-faq">
      </app-ritotech-faq>

      <!-- CTA final -->
      <section class="max-w-6xl mx-auto px-4 pb-16">
        <div class="rounded-2xl border border-teal-900/50 bg-teal-950/30 p-6 sm:p-8 text-center">
          <h2 class="text-xl font-bold">{{ closingTitle }}</h2>
          <p class="mt-2 text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
            {{ closingBody }}
          </p>
          <div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <app-ritotech-product-cta
              *ngIf="!isSessionCustomer"
              product="completo"
              [guestLabel]="hero.ctaPrimary">
            </app-ritotech-product-cta>
            <a
              *ngIf="!auth.currentUser"
              routerLink="/login"
              class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-300 hover:bg-gray-900 text-center">
              Ya tengo cuenta
            </a>
            <a
              *ngIf="isSessionCustomer"
              [routerLink]="auth.homeRoute"
              class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white hover:bg-teal-500 text-center">
              {{ auth.canAccessErpWeb ? 'Ir al panel' : 'Ir a Mi cuenta' }}
            </a>
            <a
              *ngIf="isSessionCustomer && auth.isSupervisor"
              [routerLink]="auth.planRoute"
              class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-300 hover:bg-gray-900 text-center">
              Lo que tenés contratado
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
  readonly auth = inject(AuthService);

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
      ctaPrimary: `Probar ${trialCtaLabel(this.catalog.trialDays)}`,
      microcopy: trialMicrocopy(this.catalog),
    };
  }

  get isSessionCustomer(): boolean {
    return Boolean(this.auth.currentUser && !this.auth.isPlatformAdmin);
  }

  get hasBotContracted(): boolean {
    return this.auth.canAccessWhatsapp || this.auth.hasWhatsappEntitlement;
  }

  get hasErpContracted(): boolean {
    return this.auth.canAccessErpWeb || this.auth.hasErpEntitlement;
  }

  get botCopy() {
    return whatsappCopyForRubro(this.auth.currentBusiness?.lifecycle?.rubro);
  }

  get heroEyebrow(): string {
    return this.isSessionCustomer ? '' : 'Para microemprendimientos';
  }

  get heroTitle(): string {
    if (!this.isSessionCustomer) return this.hero.title;
    if (this.hasBotContracted && this.hasErpContracted) return 'Ya tenés RILO Bot y RILO Gestión';
    if (this.hasBotContracted) return 'Ya tenés RILO Bot';
    if (this.hasErpContracted) return 'Ya tenés RILO Gestión';
    return 'Hola';
  }

  get heroSubtitle(): string {
    if (!this.isSessionCustomer) return this.hero.subtitle;
    if (this.hasBotContracted && this.hasErpContracted) {
      return 'Cargás por WhatsApp o en el panel. Es la misma información.';
    }
    if (this.hasBotContracted) {
      return 'Operás por WhatsApp. El bot resume, lo corregís con mensajes y SÍ guarda.';
    }
    if (this.hasErpContracted) {
      return 'Pedidos, ventas, caja y stock están en el panel.';
    }
    return 'Entrá a Mi cuenta o a Mi plan para ver lo contratado.';
  }

  get heroTagline(): string {
    return this.isSessionCustomer ? '' : this.hero.tagline;
  }

  get closingTitle(): string {
    return this.isSessionCustomer ? 'Listo para usar' : this.ctaFinal.title;
  }

  get closingBody(): string {
    if (!this.isSessionCustomer) return this.ctaFinal.body;
    if (this.hasBotContracted && this.hasErpContracted) {
      return 'RILO Bot en WhatsApp y RILO Gestión en el panel. El detalle de lo contratado está en Mi plan.';
    }
    if (this.hasBotContracted) {
      return 'Escribí el pedido o la venta por WhatsApp. El bot confirma con SÍ. Lo contratado está en Mi plan.';
    }
    if (this.hasErpContracted) {
      return 'En el panel ves clientes, stock, caja y compras. Lo contratado está en Mi plan.';
    }
    return 'Lo contratado, altas y bajas están en Mi plan.';
  }

  get howItWorks() {
    if (this.isSessionCustomer) {
      const steps: { step: string; title: string; description: string }[] = [];
      if (this.hasBotContracted) {
        steps.push({
          step: String(steps.length + 1),
          title: 'RILO Bot',
          description: 'Escribí el pedido o la venta por WhatsApp. Te resume y guarda si confirmás SÍ.',
        });
      }
      if (this.hasErpContracted) {
        steps.push({
          step: String(steps.length + 1),
          title: 'RILO Gestión',
          description: 'En el panel ves clientes, stock, caja y compras. Misma información que WhatsApp.',
        });
      }
      steps.push({
        step: String(steps.length + 1),
        title: 'Tu plan',
        description: 'Lo contratado, altas y bajas están en Mi plan.',
      });
      return steps;
    }
    return RILOTECH_HOW_IT_WORKS.map((step) =>
      step.step === '2'
        ? {
            ...step,
            title: `Probá ${this.trialDays} días gratis`,
            description: this.stayFreePitch,
          }
        : step
    );
  }

  get completeSavingLabel(): string {
    const vs = completeVsSeparate(this.catalog, this.country);
    if (vs.saving <= 0) return '';
    return `Por separado ${formatCatalogPriceLabel(this.country, vs.separate)} · ahorrás ${formatCatalogPriceLabel(this.country, vs.saving)}`;
  }

  ctaLabel(productId: 'whatsapp' | 'erp' | 'completo'): string {
    return trialCtaForProduct(productId);
  }

  get pricingTiers() {
    return pricingTiersFromCatalog(this.catalog);
  }

  get faqItems() {
    return faqFromCatalog(this.catalog, this.country);
  }

  get usagePacks() {
    return usagePackCardsFromCatalog(this.catalog, this.country);
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
    const rank: Record<string, number> = { whatsapp: 0, completo: 1, erp: 2 };
    return [...this.pricingTiers]
      .sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9))
      .map((tier) => ({
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
        quotaLines: quotaLinesForProduct(this.catalog, tier.id),
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
