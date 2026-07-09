import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechFaqComponent } from './ritotech-faq.component';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  TRIAL_PRODUCT_LABELS,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import {
  RILOTECH_FAQ,
  RILOTECH_PRICING_FOOTNOTE,
  RILOTECH_PRICING_TIERS,
} from '../../../../../shared/ritotech-marketing.ts';

@Component({
  selector: 'app-ritotech-plans',
  standalone: true,
  imports: [CommonModule, RouterLink, RitotechPublicShellComponent, RitotechFaqComponent],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-4xl mx-auto px-4 py-10 sm:py-14">
        <h1 class="text-2xl sm:text-3xl font-bold text-center">Planes y prueba gratis</h1>
        <p class="text-center text-gray-400 mt-2 text-sm sm:text-base max-w-xl mx-auto">
          {{ trialDays }} días de prueba sin tarjeta. Elegí el producto que mejor se adapte a tu negocio — podés
          cambiar de canal más adelante sin perder datos.
        </p>
        <p class="text-center text-xs text-gray-500 mt-2">{{ pricingFootnote }}</p>

        <div class="mt-8 space-y-4">
          <article
            *ngFor="let plan of plans"
            class="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 sm:p-6"
            [class.border-teal-800]="plan.id === 'completo'"
            [class.ring-1]="plan.id === 'completo'"
            [class.ring-teal-900/50]="plan.id === 'completo'">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-lg font-bold">{{ plan.label }}</h2>
                  <span
                    *ngIf="plan.id === 'completo'"
                    class="text-[10px] uppercase tracking-wide font-bold text-teal-300 bg-teal-900/50 px-2 py-0.5 rounded-full">
                    Recomendado
                  </span>
                </div>
                <p class="mt-1 text-sm text-gray-400 leading-relaxed">{{ plan.description }}</p>
                <ul class="mt-3 text-xs text-gray-300 space-y-1">
                  <li *ngFor="let item of plan.includes">✓ {{ item }}</li>
                </ul>
                <div class="mt-4 rounded-lg bg-gray-950/60 border border-gray-800 px-3 py-2.5 text-xs space-y-1">
                  <p><span class="text-gray-500">Prueba:</span> <span class="text-gray-300">{{ plan.trialNote }}</span></p>
                  <p><span class="text-gray-500">Al activar:</span> <span class="text-gray-300">{{ plan.afterTrial }}</span></p>
                </div>
              </div>
              <a
                [routerLink]="['/registro']"
                [queryParams]="{ producto: plan.id }"
                class="shrink-0 inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
                [class.bg-teal-600]="plan.id === 'completo'"
                [class.hover:bg-teal-500]="plan.id === 'completo'"
                [class.bg-gray-800]="plan.id !== 'completo'"
                [class.hover:bg-gray-700]="plan.id !== 'completo'">
                Probar {{ trialDays }} días
              </a>
            </div>
          </article>
        </div>

        <div class="mt-10 rounded-xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-400 leading-relaxed">
          <h2 class="text-base font-bold text-white mb-2">Sobre los precios de pago</h2>
          <p>
            No publicamos una tabla fija porque cada negocio usa distintos módulos (caja, reportes, colaboradores, etc.).
            Durante la prueba ves exactamente qué tenés activo. Al activar el plan, acordamos la cuota mensual según el
            producto elegido y el tamaño de tu operación — sin sorpresas respecto a lo que probaste.
          </p>
          <p class="mt-3 text-xs text-gray-500">
            ¿Dudas antes de registrarte? Escribinos por WhatsApp de soporte o probá gratis y decidís después.
          </p>
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
export class RitotechPlansComponent {
  readonly trialDays = DEFAULT_TRIAL_DAYS;
  readonly pricingFootnote = RILOTECH_PRICING_FOOTNOTE;
  readonly faqItems = RILOTECH_FAQ;

  readonly plans: Array<{
    id: TrialProductId;
    label: string;
    description: string;
    includes: string[];
    trialNote: string;
    afterTrial: string;
  }> = [
    {
      id: 'whatsapp',
      label: TRIAL_PRODUCT_LABELS.whatsapp,
      description: TRIAL_PRODUCT_DESCRIPTIONS.whatsapp,
      includes: [
        'RiloBot por WhatsApp con confirmación',
        'IA para entender mensajes naturales',
        'Datos del negocio (motor interno)',
        'Acceso a Mi cuenta (sin panel /dashboard)',
      ],
      trialNote: RILOTECH_PRICING_TIERS.find((t) => t.id === 'whatsapp')!.trialIncludes,
      afterTrial: RILOTECH_PRICING_TIERS.find((t) => t.id === 'whatsapp')!.afterTrial,
    },
    {
      id: 'erp',
      label: TRIAL_PRODUCT_LABELS.erp,
      description: TRIAL_PRODUCT_DESCRIPTIONS.erp,
      includes: [
        'Panel web completo',
        'Clientes, stock, caja, ventas, pedidos',
        'Reportes y multiusuario',
        'Sin WhatsApp IA (activable después)',
      ],
      trialNote: RILOTECH_PRICING_TIERS.find((t) => t.id === 'erp')!.trialIncludes,
      afterTrial: RILOTECH_PRICING_TIERS.find((t) => t.id === 'erp')!.afterTrial,
    },
    {
      id: 'completo',
      label: TRIAL_PRODUCT_LABELS.completo,
      description: TRIAL_PRODUCT_DESCRIPTIONS.completo,
      includes: [
        'Todo lo de WhatsApp + todo lo del ERP Web',
        'Historial unificado entre canales',
        'Plan intermedio durante la prueba',
        'La mejor opción si querés probar todo',
      ],
      trialNote: RILOTECH_PRICING_TIERS.find((t) => t.id === 'completo')!.trialIncludes,
      afterTrial: RILOTECH_PRICING_TIERS.find((t) => t.id === 'completo')!.afterTrial,
    },
  ];
}
