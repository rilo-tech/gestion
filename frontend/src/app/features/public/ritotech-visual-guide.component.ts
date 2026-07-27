import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

type GuideTab = 'whatsapp' | 'erp';

interface GuideStep {
  title: string;
  text: string;
  visual: 'phone' | 'message' | 'check' | 'panel' | 'cash' | 'box';
}

@Component({
  selector: 'app-ritotech-visual-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <!-- Trigger (opcional: el padre puede ocultarlo y abrir con open()) -->
    <button
      *ngIf="showTrigger"
      type="button"
      (click)="open(defaultTab)"
      class="inline-flex items-center gap-2 rounded-xl border border-teal-700/70 bg-teal-950/40 px-4 py-2.5 text-sm font-semibold text-teal-200 hover:bg-teal-900/50 hover:text-white transition">
      <span aria-hidden="true" class="text-base">📖</span>
      {{ triggerLabel }}
    </button>

    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="visual-guide-title">
      <button
        type="button"
        class="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-label="Cerrar guía"
        (click)="close()">
      </button>

      <div
        class="relative z-10 w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
        <div class="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="visual-guide-title" class="text-lg font-bold text-white">Mini guía visual</h2>
            <p class="text-xs text-gray-500 mt-0.5">Opcional · cerrá cuando quieras</p>
          </div>
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-800 text-lg leading-none"
            aria-label="Cerrar"
            (click)="close()">
            ×
          </button>
        </div>

        <div class="px-4 pt-3 flex gap-2">
          <button
            type="button"
            (click)="tab = 'whatsapp'"
            class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition"
            [class.bg-teal-700]="tab === 'whatsapp'"
            [class.border-teal-600]="tab === 'whatsapp'"
            [class.text-white]="tab === 'whatsapp'"
            [class.bg-gray-900]="tab !== 'whatsapp'"
            [class.border-gray-800]="tab !== 'whatsapp'"
            [class.text-gray-400]="tab !== 'whatsapp'">
            RiloBot (WhatsApp)
          </button>
          <button
            type="button"
            (click)="tab = 'erp'"
            class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition"
            [class.bg-teal-700]="tab === 'erp'"
            [class.border-teal-600]="tab === 'erp'"
            [class.text-white]="tab === 'erp'"
            [class.bg-gray-900]="tab !== 'erp'"
            [class.border-gray-800]="tab !== 'erp'"
            [class.text-gray-400]="tab !== 'erp'">
            Panel web
          </button>
        </div>

        <div class="p-4 sm:p-5 space-y-0">
          <ng-container *ngFor="let step of currentSteps; let i = index; let last = last">
            <div class="flex gap-3 sm:gap-4 items-start">
              <div class="flex flex-col items-center shrink-0 w-14">
                <div
                  class="w-14 h-14 rounded-2xl border border-teal-800/80 bg-teal-950/50 flex items-center justify-center text-2xl"
                  aria-hidden="true">
                  {{ visualEmoji[step.visual] }}
                </div>
                <div *ngIf="!last" class="flex flex-col items-center py-1 text-teal-600" aria-hidden="true">
                  <span class="w-0.5 h-4 bg-teal-700/80 rounded-full"></span>
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" class="text-teal-500">
                    <path d="M8 0v8M8 8l-4-4M8 8l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
              <div class="min-w-0 flex-1 pb-5" [class.pb-1]="last">
                <p class="text-[11px] font-bold uppercase tracking-wide text-teal-500/90">Paso {{ i + 1 }}</p>
                <h3 class="text-base font-bold text-white mt-0.5">{{ step.title }}</h3>
                <p class="mt-1.5 text-sm text-gray-400 leading-relaxed">{{ step.text }}</p>
              </div>
            </div>
          </ng-container>

          <!-- Mini comic strip for WhatsApp -->
          <div
            *ngIf="tab === 'whatsapp'"
            class="mt-2 rounded-xl border border-gray-800 bg-gray-900/60 p-3 sm:p-4">
            <p class="text-xs font-semibold text-gray-300 mb-3">Así se ve en 3 viñetas</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
              <div class="rounded-lg bg-gray-950 border border-gray-800 p-3 text-center relative">
                <p class="text-2xl mb-1" aria-hidden="true">💬</p>
                <p class="text-[11px] text-gray-400 leading-snug">Escribís el pedido por WhatsApp</p>
                <span class="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 text-teal-500 text-lg" aria-hidden="true">→</span>
              </div>
              <div class="rounded-lg bg-gray-950 border border-gray-800 p-3 text-center relative">
                <p class="text-2xl mb-1" aria-hidden="true">📋</p>
                <p class="text-[11px] text-gray-400 leading-snug">El bot te muestra un resumen</p>
                <span class="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 text-teal-500 text-lg" aria-hidden="true">→</span>
              </div>
              <div class="rounded-lg bg-gray-950 border border-gray-800 p-3 text-center">
                <p class="text-2xl mb-1" aria-hidden="true">✅</p>
                <p class="text-[11px] text-gray-400 leading-snug">Respondés SÍ y queda en el ERP</p>
              </div>
            </div>
          </div>

          <div
            *ngIf="tab === 'erp'"
            class="mt-2 rounded-xl border border-gray-800 bg-gray-900/60 p-3 sm:p-4">
            <p class="text-xs font-semibold text-gray-300 mb-3">Mapa rápido del panel</p>
            <div class="flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <span class="rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-gray-300">Clientes</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-gray-300">Pedidos / Ventas</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-gray-300">Caja</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-lg border border-teal-800 bg-teal-950/40 px-2.5 py-1.5 text-teal-200">Reportes</span>
            </div>
            <p class="mt-3 text-[11px] text-gray-500 text-center leading-relaxed">
              Compras y proveedores entran cuando comprás mercadería; el stock se actualiza solo.
            </p>
          </div>
        </div>

        <div class="sticky bottom-0 border-t border-gray-800 bg-gray-950/95 px-4 py-3 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <button type="button" class="text-xs text-gray-500 hover:text-gray-300 order-2 sm:order-1" (click)="close()">
            Ahora no, gracias
          </button>
          <a
            [routerLink]="['/registro']"
            [queryParams]="{ producto: tab === 'whatsapp' ? 'whatsapp' : 'erp' }"
            (click)="close()"
            class="order-1 sm:order-2 inline-flex justify-center rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold hover:bg-teal-500">
            Probar {{ tab === 'whatsapp' ? 'RiloBot' : 'Panel web' }} gratis
          </a>
        </div>
      </div>
    </div>
  `,
})
export class RitotechVisualGuideComponent {
  @Input() showTrigger = true;
  @Input() triggerLabel = 'Ver guía visual (opcional)';
  @Input() defaultTab: GuideTab = 'whatsapp';

  isOpen = false;
  tab: GuideTab = 'whatsapp';

  readonly visualEmoji: Record<GuideStep['visual'], string> = {
    phone: '📱',
    message: '💬',
    check: '✅',
    panel: '🖥️',
    cash: '💵',
    box: '📦',
  };

  readonly whatsappSteps: GuideStep[] = [
    {
      title: 'Escribí como hablás',
      text: 'Ejemplo: “Venta a María, 2 remeras, cobró 800”. Sin menús ni códigos.',
      visual: 'message',
    },
    {
      title: 'Rilo entiende',
      text: 'Extrae cliente, productos, monto y tipo de operación con IA (Gemini).',
      visual: 'phone',
    },
    {
      title: 'Confirmá',
      text: 'Te muestra un resumen claro. Respondés SÍ, NO o pedís corregir.',
      visual: 'check',
    },
    {
      title: 'Queda guardado',
      text: 'Venta, cobro, saldo e historial quedan en el mismo negocio que el panel.',
      visual: 'cash',
    },
    {
      title: 'Preguntá y obtené respuesta',
      text: '“¿Cuánto me debe María?” o “¿Cuánto vendí hoy?” — consultas al instante.',
      visual: 'box',
    },
  ];

  readonly erpSteps: GuideStep[] = [
    {
      title: 'Entras al panel web',
      text: 'Desde la computadora o el celular ves clientes, pedidos, ventas y más.',
      visual: 'panel',
    },
    {
      title: 'Caja y movimientos',
      text: 'Registrás entradas y salidas. Sabés qué entró hoy y qué falta cobrar.',
      visual: 'cash',
    },
    {
      title: 'Compras, stock y proveedores',
      text: 'Cuando comprás mercadería, el stock se ordena y ves a quién le debés.',
      visual: 'box',
    },
  ];

  get currentSteps(): GuideStep[] {
    return this.tab === 'whatsapp' ? this.whatsappSteps : this.erpSteps;
  }

  open(tab: GuideTab = this.defaultTab) {
    this.tab = tab;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.isOpen) this.close();
  }
}
