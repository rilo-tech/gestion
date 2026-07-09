import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  TRIAL_PRODUCT_LABELS,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import {
  RILOTECH_CHAT_DEMO,
  RILOTECH_FAQ,
  RILOTECH_HOW_IT_WORKS,
  RILOTECH_PRICING_FOOTNOTE,
  RILOTECH_PRICING_TIERS,
  RILOTECH_USE_CASES,
} from '../../../../../shared/ritotech-marketing.ts';

@Component({
  selector: 'app-ritotech-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RitotechPublicShellComponent,
    RitotechFaqComponent,
    RitotechChatDemoComponent,
  ],
  template: `
    <app-ritotech-public-shell>
      <!-- Hero -->
      <section class="max-w-6xl mx-auto px-4 py-12 sm:py-16 text-center">
        <p class="text-teal-400 text-sm font-semibold uppercase tracking-wide mb-3">RiloTech</p>
        <h1 class="text-3xl sm:text-5xl font-bold leading-tight max-w-3xl mx-auto">
          Controlá tu negocio desde WhatsApp y desde un panel web
        </h1>
        <p class="mt-4 text-gray-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
          Registrá pedidos, ventas, pagos y stock sin planillas. Escribí por WhatsApp como si chatearas con un
          asistente, o usá el panel web cuando necesités más detalle.
        </p>
        <div class="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            routerLink="/registro"
            class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold hover:bg-teal-500">
            Probar gratis {{ trialDays }} días
          </a>
          <a
            routerLink="/planes"
            class="w-full sm:w-auto rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900">
            Ver planes y precios
          </a>
        </div>
        <p class="mt-4 text-xs text-gray-500">{{ pricingFootnote }}</p>
      </section>

      <!-- Productos -->
      <section class="max-w-6xl mx-auto px-4 pb-12">
        <h2 class="text-center text-xl font-bold mb-2">Elegí cómo querés empezar</h2>
        <p class="text-center text-sm text-gray-500 mb-6 max-w-lg mx-auto">
          No estás obligado a contratar todo. Podés probar solo WhatsApp, solo el ERP Web, o ambos.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <article
            *ngFor="let card of productCards"
            class="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 flex flex-col">
            <h3 class="text-lg font-bold text-white">{{ card.label }}</h3>
            <p class="mt-2 text-sm text-gray-400 flex-1 leading-relaxed">{{ card.description }}</p>
            <p class="mt-3 text-xs text-gray-500">{{ card.hint }}</p>
            <a
              [routerLink]="['/registro']"
              [queryParams]="{ producto: card.id }"
              class="mt-5 inline-flex justify-center rounded-lg bg-violet-700/80 px-4 py-2.5 text-sm font-semibold hover:bg-violet-600">
              {{ card.cta }}
            </a>
          </article>
        </div>
      </section>

      <!-- Casos de uso -->
      <section class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-2">Para qué sirve</h2>
        <p class="text-center text-sm text-gray-500 mb-8 max-w-xl mx-auto">
          Negocios chicos y emprendedores que quieren orden sin complicarse.
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

      <!-- Demo WhatsApp -->
      <section class="max-w-6xl mx-auto px-4 py-12 border-t border-white/5">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 class="text-xl sm:text-2xl font-bold">Así se ve RiloBot en WhatsApp</h2>
            <p class="mt-3 text-sm text-gray-400 leading-relaxed">
              Escribís en lenguaje natural. El bot entiende, te resume la operación y
              <span class="text-teal-400 font-medium">solo guarda si confirmás con SÍ</span>.
              No hace falta aprender menús ni códigos.
            </p>
            <ul class="mt-4 space-y-2 text-sm text-gray-300">
              <li>✓ "Nuevo pedido para Juan con 3 productos"</li>
              <li>✓ "Venta a María, $2.500 en efectivo"</li>
              <li>✓ "¿Cuánto debe Pedro?"</li>
            </ul>
            <a
              routerLink="/registro"
              [queryParams]="{ producto: 'whatsapp' }"
              class="mt-6 inline-flex rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold hover:bg-teal-500">
              Probar solo WhatsApp
            </a>
          </div>
          <app-ritotech-chat-demo
            [messages]="chatDemo"
            caption="Ejemplo ilustrativo. En la prueba usás el número que registrás.">
          </app-ritotech-chat-demo>
        </div>
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

      <!-- Precios -->
      <section class="max-w-4xl mx-auto px-4 py-12 border-t border-white/5">
        <h2 class="text-center text-xl font-bold mb-2">Prueba gratis, precios claros al activar</h2>
        <p class="text-center text-sm text-gray-500 mb-8 max-w-lg mx-auto">
          Durante los {{ trialDays }} días probás el producto real que elijas. La cuota mensual se define al pasar a plan pago.
        </p>
        <div class="space-y-3">
          <article
            *ngFor="let tier of pricingTiers"
            class="rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h3 class="font-bold text-white">{{ tier.label }}</h3>
                <p class="mt-1 text-xs text-teal-400/90">En la prueba: {{ tier.trialIncludes }}</p>
                <p class="mt-2 text-xs text-gray-500">Después: {{ tier.afterTrial }}</p>
              </div>
              <a
                [routerLink]="['/registro']"
                [queryParams]="{ producto: tier.id }"
                class="shrink-0 inline-flex justify-center rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800">
                Probar este plan
              </a>
            </div>
          </article>
        </div>
        <p class="mt-6 text-center text-xs text-gray-500">{{ pricingFootnote }}</p>
        <p class="mt-2 text-center">
          <a routerLink="/planes" class="text-sm text-teal-400 hover:underline">Ver comparación detallada de planes →</a>
        </p>
      </section>

      <!-- FAQ -->
      <app-ritotech-faq
        title="Preguntas frecuentes"
        subtitle="Todo lo que suelen preguntar antes de registrarse"
        [items]="faqItems"
        headingId="landing-faq">
      </app-ritotech-faq>

      <!-- CTA final -->
      <section class="max-w-6xl mx-auto px-4 pb-16">
        <div class="rounded-2xl border border-teal-900/50 bg-teal-950/30 p-6 sm:p-8 text-center">
          <h2 class="text-xl font-bold">¿Listo para probar?</h2>
          <p class="mt-2 text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
            Creá tu cuenta en minutos. Elegí WhatsApp, ERP Web o el plan completo.
            Tus datos quedan guardados aunque empieces solo por un canal y sumes el otro después.
          </p>
          <div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              routerLink="/registro"
              class="w-full sm:w-auto rounded-xl bg-teal-600 px-6 py-3 font-semibold hover:bg-teal-500">
              Empezar prueba gratis
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
export class RitotechLandingComponent {
  readonly trialDays = DEFAULT_TRIAL_DAYS;
  readonly useCases = RILOTECH_USE_CASES;
  readonly chatDemo = RILOTECH_CHAT_DEMO;
  readonly howItWorks = RILOTECH_HOW_IT_WORKS;
  readonly pricingTiers = RILOTECH_PRICING_TIERS;
  readonly pricingFootnote = RILOTECH_PRICING_FOOTNOTE;
  readonly faqItems = RILOTECH_FAQ;

  readonly useCaseEmoji: Record<string, string> = {
    phone: '📱',
    store: '🏪',
    chart: '📊',
    team: '👥',
  };

  readonly productCards: Array<{
    id: TrialProductId;
    label: string;
    description: string;
    hint: string;
    cta: string;
  }> = [
    {
      id: 'whatsapp',
      label: 'RiloBot WhatsApp',
      description: TRIAL_PRODUCT_DESCRIPTIONS.whatsapp,
      hint: 'Sin panel web completo · Ideal para cargar desde el celular',
      cta: 'Probar WhatsApp',
    },
    {
      id: 'erp',
      label: 'RILO Gestión ERP',
      description: TRIAL_PRODUCT_DESCRIPTIONS.erp,
      hint: 'Panel web completo · Sin bot de WhatsApp en la prueba base',
      cta: 'Probar ERP',
    },
    {
      id: 'completo',
      label: 'Plan completo',
      description: TRIAL_PRODUCT_DESCRIPTIONS.completo,
      hint: 'WhatsApp + panel · Historial unificado',
      cta: 'Probar completo',
    },
  ];
}
