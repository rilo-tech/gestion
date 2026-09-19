import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { RitotechVisualGuideComponent } from './ritotech-visual-guide.component';
import { RitotechProductCtaComponent } from './ritotech-product-cta.component';
import { RitotechPricingCardsComponent } from './ritotech-pricing-cards.component';
import { RILOBOT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import { SHOW_ARGENTINA_BILLING, type BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  formatCatalogPriceLabel,
  stayFreePitch as buildStayFreePitch,
  trialCtaLabel,
  trialMicrocopy,
} from '../../../../../shared/commercial-catalog.ts';
import {
  RILOTECH_CHAT_DEMO,
  RILOTECH_CTA_FINAL,
  RILOTECH_HERO,
  RILOTECH_HOW_IT_WORKS,
  RILOTECH_SAY_IT_CASES,
  faqFromCatalog,
  usagePackCardsFromCatalog,
} from '../../../../../shared/ritotech-marketing.ts';
import { CommercialCatalogService } from '../../core/services/commercial-catalog.service.ts';
import { AuthService } from '../../core/services/auth.service';
import { AnalyticsService } from '../../core/services/analytics.service';
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
    RitotechPricingCardsComponent,
  ],
  host: { style: 'display: contents' },
  template: `
    <app-ritotech-public-shell>
      <!-- Hero -->
      <section class="max-w-6xl mx-auto px-4 pt-4 sm:pt-6 pb-8 sm:pb-10">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-center">
          <div [class.text-center]="true" [class.lg:text-left]="!isSessionCustomer">
            <div class="flex mb-3 sm:mb-4" [class.justify-center]="true" [class.lg:justify-start]="!isSessionCustomer">
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
            <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight text-white">
              {{ heroTitle }}
            </h1>
            <p class="mt-4 text-white/90 text-base sm:text-lg leading-relaxed max-w-xl" [class.mx-auto]="true" [class.lg:mx-0]="!isSessionCustomer">
              {{ heroSubtitle }}
            </p>
            <p *ngIf="heroTagline" class="mt-3 text-sm text-teal-300/90 font-medium">{{ heroTagline }}</p>

            <div
              *ngIf="isSessionCustomer"
              class="mt-5 mx-auto max-w-xl rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left">
              <p class="text-xs font-semibold uppercase tracking-wide text-teal-400 mb-2">Cómo se usa</p>
              <ul class="space-y-1.5 text-sm text-gray-200">
                <li *ngIf="hasBotContracted">• WhatsApp: “{{ botCopy.exampleSale }}”</li>
                <li *ngIf="hasBotContracted">• Pedido: “{{ botCopy.exampleOrder }}”</li>
                <li *ngIf="hasErpContracted">• Panel: clientes, stock, caja, compras y reportes.</li>
                <li *ngIf="hasBotContracted">• Si está claro, RILO actúa; si falta info, pregunta.</li>
                <li *ngIf="!hasBotContracted && !hasErpContracted">• Lo contratado está en Mi plan.</li>
              </ul>
            </div>

            <div class="mt-5 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 max-w-xl" [class.mx-auto]="true" [class.lg:mx-0]="!isSessionCustomer" [class.sm:justify-center]="true" [class.lg:justify-start]="!isSessionCustomer">
              <ng-container *ngIf="isSessionCustomer; else landingGuestCtas">
                <a
                  [routerLink]="auth.homeRoute"
                  class="w-full sm:w-auto rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-600 text-center min-h-[44px]">
                  {{ auth.canAccessWhatsapp ? 'Ir a Inicio' : 'Ir al panel' }}
                </a>
                <a
                  *ngIf="auth.isSupervisor"
                  [routerLink]="auth.planRoute"
                  class="w-full sm:w-auto rounded-xl border border-teal-700 px-6 py-3 font-semibold text-teal-200 hover:bg-teal-950/50 text-center min-h-[44px]">
                  Lo que tenés contratado
                </a>
              </ng-container>
              <ng-template #landingGuestCtas>
                <app-ritotech-product-cta
                  class="w-full sm:w-auto"
                  product="whatsapp"
                  [guestLabel]="hero.ctaPrimary">
                </app-ritotech-product-cta>
              </ng-template>
              <button
                *ngIf="!isSessionCustomer || hasBotContracted"
                type="button"
                (click)="scrollToDemo()"
                class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900 min-h-[44px]">
                {{ isSessionCustomer ? 'Cómo se usa en WhatsApp' : hero.ctaSecondary }}
              </button>
            </div>
            <p *ngIf="!isSessionCustomer" class="mt-3 text-xs text-gray-400 leading-relaxed">
              {{ hero.microcopy }}
            </p>
            <p *ngIf="!isSessionCustomer" class="mt-2">
              <a routerLink="/" fragment="planes" class="text-sm text-teal-400 hover:underline">Ver precios</a>
            </p>
          </div>

          <div *ngIf="!isSessionCustomer" class="hidden lg:block" id="demo-desktop">
            <div class="mx-auto max-w-sm rounded-[1.75rem] border border-white/15 bg-gray-950 shadow-2xl shadow-teal-950/40 p-3">
              <div class="rounded-[1.25rem] border border-white/10 bg-[#0b141a] px-3 py-3">
                <p class="text-[11px] text-center text-white/50 mb-3">RILO · WhatsApp</p>
                <app-ritotech-chat-demo [messages]="chatDemo" class="block"></app-ritotech-chat-demo>
                <p class="mt-3 text-[11px] text-center text-teal-400/80">Después lo ves ordenado en RILO Gestión</p>
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="!isSessionCustomer" class="lg:hidden mt-8" id="demo">
          <div class="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
            <app-ritotech-chat-demo [messages]="chatDemo"></app-ritotech-chat-demo>
          </div>
        </div>
      </section>

      <!-- Decíselo a RILO -->
      <section *ngIf="!isSessionCustomer" class="max-w-6xl mx-auto px-4 py-8 border-t border-white/5">
        <h2 class="text-center text-xl font-bold text-white mb-2">Decíselo a RILO.</h2>
        <p class="text-center text-sm text-gray-400 mb-6">Ejemplos reales de lo que podés registrar o consultar por WhatsApp.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <article
            *ngFor="let item of visibleSayItCases"
            class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
            <p class="text-[10px] font-bold uppercase tracking-wide text-teal-400">{{ item.label }}</p>
            <p class="mt-1 text-sm text-white/90 leading-snug">“{{ item.example }}”</p>
          </article>
        </div>
        <div *ngIf="sayItCases.length > sayItPreviewCount" class="mt-4 flex justify-center">
          <button
            type="button"
            (click)="showAllSayIt = !showAllSayIt"
            class="text-sm font-semibold text-teal-300 hover:text-teal-200 hover:underline min-h-[44px] px-3">
            {{ showAllSayIt ? 'Ver menos ejemplos' : 'Ver más ejemplos' }}
          </button>
        </div>
      </section>

      <!-- Cómo funciona -->
      <section id="como-funciona" class="max-w-4xl mx-auto px-4 py-10 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-2">Cómo funciona</h2>
        <p class="text-center text-sm text-gray-400 mb-8 max-w-xl mx-auto leading-relaxed">
          Tres pasos. Sin menús eternos.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div *ngFor="let step of howItWorks" class="text-center sm:text-left">
            <span
              class="inline-flex w-9 h-9 items-center justify-center rounded-full bg-teal-900/60 text-teal-300 text-sm font-bold border border-teal-800">
              {{ step.step }}
            </span>
            <h3 class="mt-3 text-sm font-bold text-white">{{ step.title }}</h3>
            <p class="mt-1.5 text-sm text-gray-400 leading-relaxed">{{ step.description }}</p>
          </div>
        </div>
        <div *ngIf="!isSessionCustomer" class="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            (click)="scrollToDemo()"
            class="inline-flex w-full sm:w-auto justify-center rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 hover:bg-gray-900 min-h-[44px]">
            Ver el chat de ejemplo
          </button>
          <button
            type="button"
            (click)="openGuide('erp')"
            class="inline-flex w-full sm:w-auto justify-center rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 hover:bg-gray-900 min-h-[44px]">
            Guía de RILO Gestión
          </button>
        </div>
      </section>

      <!-- Acompañamiento proactivo -->
      <section *ngIf="!isSessionCustomer" id="avisos" class="max-w-4xl mx-auto px-4 py-10 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-2">RILO también puede avisarte</h2>
        <p class="text-center text-sm text-gray-400 mb-6 max-w-xl mx-auto leading-relaxed">
          Recibí resúmenes, pedidos pendientes, saldos o alertas de stock aunque no te acuerdes de entrar.
          Solo con datos reales de tu negocio.
        </p>
        <div class="flex justify-center">
          <button
            type="button"
            (click)="openGuide('whatsapp')"
            class="inline-flex justify-center rounded-xl border border-teal-700/70 bg-teal-950/40 px-5 py-2.5 text-sm font-semibold text-teal-100 hover:bg-teal-900/50 min-h-[44px]">
            Ver cómo RILO te ayuda
          </button>
        </div>
      </section>

      <!-- Demo WhatsApp -->
      <section *ngIf="!isSessionCustomer || hasBotContracted" id="demo" class="max-w-6xl mx-auto px-4 py-10 scroll-mt-20">
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
                {{ hasBotContracted ? 'Así lo usás en WhatsApp' : 'Así se ve RILO Bot' }}
              </h2>
            </div>
            <p class="mt-3 text-sm text-gray-400 leading-relaxed">
              Escribile como hablás.
              <span class="text-teal-300">Si está claro, RILO actúa</span>.
              Si falta información, pregunta. Las acciones sensibles te piden confirmación.
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
            [caption]="hasBotContracted ? 'Escribís. RILO entiende y deja todo registrado.' : 'Ejemplo ilustrativo. En la prueba usás el número que registrás.'">
          </app-ritotech-chat-demo>
        </div>
      </section>

      <!-- Precios -->
      <section
        *ngIf="!isSessionCustomer"
        id="planes"
        class="max-w-6xl mx-auto px-4 py-10 border-t border-white/5 scroll-mt-20">
        <h2 class="text-center text-xl font-bold mb-2">Precios</h2>
        <p class="text-center text-sm text-teal-300 font-medium mb-2 max-w-2xl mx-auto leading-relaxed">
          {{ stayFreePitch }}
        </p>
        <p class="text-center text-sm text-gray-400 mb-6 max-w-lg mx-auto">
          Empezá por RILO Bot. Sumá RILO Gestión cuando quieras ver todo en pantalla.
        </p>
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

        <app-ritotech-pricing-cards
          [catalog]="catalog"
          [country]="country"
          (guideRequested)="openGuide($event)">
        </app-ritotech-pricing-cards>

        <p class="mt-4 text-center text-xs text-gray-400 max-w-lg mx-auto leading-relaxed">
          {{ trialDays }} días gratis. Al vencer, tus datos siguen y contratás para seguir operando.
        </p>

        <!-- RILO Caja: opción secundaria (no compite con los 3 planes principales) -->
        <aside
          class="mt-10 max-w-2xl mx-auto rounded-2xl border border-gray-800/80 bg-gray-950/40 px-5 py-6 sm:px-6">
          <h3 class="text-base font-semibold text-gray-100 text-center">
            ¿Solo querés controlar ingresos y gastos?
          </h3>
          <p class="mt-2 text-sm text-gray-400 text-center leading-relaxed">
            RILO Caja usa IA para ayudarte a registrar movimientos hablando como hablás. Anotá ingresos,
            gastos y cobros por WhatsApp, consultá tu saldo y recibí resúmenes claros sin tener que cargar
            todo a mano.
          </p>
          <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-gray-300 max-w-md mx-auto">
            <li>✓ Con IA</li>
            <li>✓ Registro por WhatsApp</li>
            <li>✓ Ingresos y egresos</li>
            <li>✓ Saldo y movimientos</li>
            <li>✓ Resúmenes por categoría</li>
            <li>✓ Automatizaciones y avisos</li>
          </ul>
          <p class="mt-3 text-center text-sm font-semibold text-teal-300/90">{{ cashPriceLabel }}</p>
          <div class="mt-4 flex justify-center">
            <a
              routerLink="/registro"
              [queryParams]="{ producto: 'caja' }"
              class="inline-flex justify-center rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-200 hover:bg-gray-800">
              Probar RILO Caja
            </a>
          </div>
          <p class="mt-3 text-center text-[11px] text-gray-400 leading-relaxed">
            ¿Necesitás también clientes, productos, pedidos o stock?
            Conocé RILO Gestión o RILO Completo arriba.
          </p>
        </aside>

        <section *ngIf="usagePacks.length" class="mt-8 max-w-3xl mx-auto rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
          <h3 class="text-sm font-bold text-white">¿Te quedás corto este mes?</h3>
          <p class="mt-1 text-xs text-gray-400 leading-relaxed">
            Comprás un pack extra desde Mi plan, con la cuenta ya creada. No es una segunda suscripción.
          </p>
          <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <article
              *ngFor="let pack of usagePacks"
              class="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
              <p class="text-sm font-semibold text-white">{{ pack.title }}</p>
              <p class="mt-1 text-sm font-bold text-teal-300">{{ pack.priceLabel }}</p>
              <p class="mt-1 text-xs text-gray-400 leading-relaxed">{{ pack.hint }}</p>
            </article>
          </div>
        </section>

        <p class="mt-4 text-center text-xs text-gray-400 max-w-lg mx-auto leading-relaxed">
          ¿Ya tenés cuenta?
          <a routerLink="/login" [queryParams]="{ manual: '1' }" class="text-teal-400 hover:underline">Ingresá</a>
          y sumá el otro producto en Mi plan. La baja no borra datos.
        </p>
      </section>

      <app-ritotech-faq
        *ngIf="!isSessionCustomer"
        title="Preguntas frecuentes"
        subtitle="Prueba, precios, WhatsApp y cancelación"
        [items]="faqItems"
        headingId="landing-faq">
      </app-ritotech-faq>

      <section class="max-w-6xl mx-auto px-4 pb-16">
        <div class="rounded-2xl border border-teal-900/50 bg-teal-950/30 p-6 sm:p-8 text-center">
          <h2 class="text-xl font-bold">{{ closingTitle }}</h2>
          <p class="mt-2 text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
            {{ closingBody }}
          </p>
          <div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <app-ritotech-product-cta
              *ngIf="!isSessionCustomer"
              product="whatsapp"
              [guestLabel]="hero.ctaPrimary">
            </app-ritotech-product-cta>
            <a
              *ngIf="!auth.currentUser"
              routerLink="/login" [queryParams]="{ manual: '1' }"
              class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-300 hover:bg-gray-900 text-center min-h-[44px]">
              Ya tengo cuenta
            </a>
            <a
              *ngIf="isSessionCustomer"
              [routerLink]="auth.homeRoute"
              class="w-full sm:w-auto rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-600 text-center min-h-[44px]">
              {{ auth.canAccessWhatsapp ? 'Ir a Inicio' : 'Ir al panel' }}
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
  private analytics = inject(AnalyticsService);
  readonly auth = inject(AuthService);

  @ViewChild('guide') guide?: RitotechVisualGuideComponent;

  readonly chatDemo = RILOTECH_CHAT_DEMO;
  readonly sayItCases = RILOTECH_SAY_IT_CASES;
  readonly sayItPreviewCount = 6;
  showAllSayIt = false;
  readonly ctaFinal = RILOTECH_CTA_FINAL;
  catalog: CommercialCatalog = DEFAULT_COMMERCIAL_CATALOG;

  country: BillingCountryCode = 'UY';
  readonly showArgentinaBilling = SHOW_ARGENTINA_BILLING;

  get visibleSayItCases() {
    return this.showAllSayIt
      ? this.sayItCases
      : this.sayItCases.slice(0, this.sayItPreviewCount);
  }

  get trialDays(): number {
    return this.catalog.trialDays || RILOBOT_TRIAL_DAYS;
  }

  get cashPriceLabel(): string {
    const amount =
      this.country === 'AR'
        ? this.catalog.products.cash.amountMonthlyAR
        : this.catalog.products.cash.amountMonthlyUY;
    return `${formatCatalogPriceLabel(this.country, amount)} / mes`;
  }

  get stayFreePitch(): string {
    return buildStayFreePitch(this.catalog);
  }

  get hero() {
    return {
      ...RILOTECH_HERO,
      ctaPrimary: 'Probar RILO gratis',
      microcopy: `${this.catalog.trialDays} días gratis · Sin tarjeta · No tenés que instalar nada`,
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
    return this.isSessionCustomer ? '' : 'Cargás hablando · Controlás en pantalla';
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
      return 'Operás por WhatsApp. Si está claro, RILO actúa; si falta info, pregunta.';
    }
    if (this.hasErpContracted) {
      return 'Pedidos, ventas, caja y stock están en el panel.';
    }
    return 'Entrá a Mi plan para ver lo contratado.';
  }

  get heroTagline(): string {
    return this.isSessionCustomer ? '' : this.hero.tagline;
  }

  get closingTitle(): string {
    return this.isSessionCustomer ? 'Listo para usar' : this.ctaFinal.title;
  }

  get closingBody(): string {
    if (!this.isSessionCustomer) {
      return `${this.trialDays} días gratis, sin tarjeta. Probá RILO Bot y sumá el panel cuando lo necesites.`;
    }
    if (this.hasBotContracted && this.hasErpContracted) {
      return 'RILO Bot en WhatsApp y RILO Gestión en el panel. El detalle está en Mi plan.';
    }
    if (this.hasBotContracted) {
      return 'Escribí por WhatsApp. Lo contratado está en Mi plan.';
    }
    if (this.hasErpContracted) {
      return 'En el panel ves clientes, stock, caja y compras. Lo contratado está en Mi plan.';
    }
    return 'Lo contratado está en Mi plan.';
  }

  get howItWorks() {
    if (this.isSessionCustomer) {
      const steps: { step: string; title: string; description: string }[] = [];
      if (this.hasBotContracted) {
        steps.push({
          step: String(steps.length + 1),
          title: 'Escribile a RILO',
          description: 'Pedidos, ventas y consultas por WhatsApp.',
        });
        steps.push({
          step: String(steps.length + 1),
          title: 'RILO entiende y trabaja',
          description: 'Actúa si está claro; pregunta si falta info.',
        });
      }
      if (this.hasErpContracted) {
        steps.push({
          step: String(steps.length + 1),
          title: 'Todo queda ordenado',
          description: 'En el panel ves clientes, stock, caja y compras.',
        });
      }
      if (!steps.length) {
        return RILOTECH_HOW_IT_WORKS;
      }
      return steps;
    }
    return RILOTECH_HOW_IT_WORKS;
  }

  get faqItems() {
    return faqFromCatalog(this.catalog, this.country);
  }

  get usagePacks() {
    return usagePackCardsFromCatalog(this.catalog, this.country);
  }

  ngOnInit() {
    this.analytics.captureAttributionFromUrl();
    this.analytics.track('landing_view', { path: '/' });
    try {
      const saved = localStorage.getItem(COUNTRY_STORAGE_KEY);
      if (SHOW_ARGENTINA_BILLING && (saved === 'AR' || saved === 'UY')) this.country = saved;
      else this.country = 'UY';
    } catch {
      this.country = 'UY';
    }
    this.loadCatalog();

    this.route.fragment.subscribe((fragment) => {
      if (fragment !== 'landing-faq' && fragment !== 'planes' && fragment !== 'como-funciona' && fragment !== 'demo') {
        return;
      }
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

  setCountry(country: BillingCountryCode) {
    this.country = country;
    try {
      localStorage.setItem(COUNTRY_STORAGE_KEY, country);
    } catch {
      /* ignore */
    }
    this.loadCatalog();
  }

  openGuide(tab: 'whatsapp' | 'erp') {
    this.guide?.open(tab);
  }

  scrollToDemo() {
    this.analytics.track('demo_view', { source: 'landing' });
    const el =
      document.getElementById('demo-desktop') ||
      document.getElementById('demo') ||
      document.getElementById('como-funciona');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  scrollToHowItWorks() {
    document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
