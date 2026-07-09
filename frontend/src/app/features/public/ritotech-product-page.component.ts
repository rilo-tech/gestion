import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RitotechPublicShellComponent } from './ritotech-public-shell.component';
import { RitotechChatDemoComponent } from './ritotech-chat-demo.component';
import {
  TRIAL_PRODUCT_DESCRIPTIONS,
  TRIAL_PRODUCT_LABELS,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import { RILOTECH_CHAT_DEMO } from '../../../../../shared/ritotech-marketing.ts';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';

@Component({
  selector: 'app-ritotech-product-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RitotechPublicShellComponent, RitotechChatDemoComponent],
  template: `
    <app-ritotech-public-shell>
      <section class="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <p class="text-teal-400 text-sm font-semibold uppercase tracking-wide">{{ eyebrow }}</p>
        <h1 class="mt-2 text-2xl sm:text-4xl font-bold">{{ title }}</h1>
        <p class="mt-4 text-gray-400 leading-relaxed">{{ description }}</p>

        <ul class="mt-6 space-y-2 text-sm text-gray-300">
          <li *ngFor="let bullet of bullets">✓ {{ bullet }}</li>
        </ul>

        <div *ngIf="productId === 'whatsapp'" class="mt-10">
          <h2 class="text-lg font-bold mb-4">Ejemplo de conversación</h2>
          <app-ritotech-chat-demo
            [messages]="chatDemo"
            caption="Siempre te pide confirmación antes de guardar.">
          </app-ritotech-chat-demo>
        </div>

        <div *ngIf="productId === 'erp'" class="mt-10 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 class="text-lg font-bold mb-2">¿Y si después quiero WhatsApp?</h2>
          <p class="text-sm text-gray-400 leading-relaxed">
            Podés activar RiloBot más adelante sin migrar datos. Todo lo que cargues en el panel queda en el mismo
            negocio y el bot podrá consultarlo cuando lo sumes.
          </p>
        </div>

        <div *ngIf="productId === 'whatsapp'" class="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 class="text-lg font-bold mb-2">¿Y si después quiero el panel web?</h2>
          <p class="text-sm text-gray-400 leading-relaxed">
            Activás ERP Web cuando quieras. Los pedidos y ventas que cargaste por WhatsApp aparecen en el historial del
            panel — no empezás de cero.
          </p>
        </div>

        <div class="mt-8 flex flex-col sm:flex-row gap-3">
          <a
            [routerLink]="['/registro']"
            [queryParams]="{ producto: productId }"
            class="inline-flex justify-center rounded-xl bg-teal-600 px-6 py-3 font-semibold hover:bg-teal-500">
            Probar {{ trialDays }} días gratis
          </a>
          <a
            routerLink="/planes"
            class="inline-flex justify-center rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-900">
            Comparar planes
          </a>
        </div>
      </section>
    </app-ritotech-public-shell>
  `,
})
export class RitotechProductPageComponent {
  private route = inject(ActivatedRoute);

  readonly productId = (this.route.snapshot.data['product'] ?? 'erp') as TrialProductId;
  readonly trialDays = DEFAULT_TRIAL_DAYS;
  readonly chatDemo = RILOTECH_CHAT_DEMO;

  get eyebrow(): string {
    return this.productId === 'whatsapp' ? 'RiloBot' : 'RILO Gestión';
  }

  get title(): string {
    return this.productId === 'whatsapp' ? 'Cargá por WhatsApp con IA' : 'Panel web para tu negocio';
  }

  get description(): string {
    return TRIAL_PRODUCT_DESCRIPTIONS[this.productId] ?? TRIAL_PRODUCT_DESCRIPTIONS.erp;
  }

  get bullets(): string[] {
    if (this.productId === 'whatsapp') {
      return [
        'Pedidos y ventas escribiendo mensajes naturales',
        'Confirmación SÍ/NO antes de guardar cada operación',
        'Mismos datos que el ERP Web si lo activás después',
        'Ideal para quienes viven en el celular',
      ];
    }
    return [
      'Clientes, stock, caja y reportes en un solo lugar',
      'Multiusuario con permisos por rol',
      'Historial completo de operaciones',
      'Se integra con RiloBot si activás WhatsApp',
    ];
  }
}
