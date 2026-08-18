import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

type GuideTab = 'whatsapp' | 'erp';

@Component({
  selector: 'app-ritotech-visual-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <button
      *ngIf="showTrigger"
      type="button"
      (click)="open(defaultTab)"
      class="inline-flex items-center gap-2 rounded-xl border border-teal-600/80 bg-gradient-to-r from-teal-950/80 to-violet-950/50 px-4 py-2.5 text-sm font-semibold text-teal-100 hover:from-teal-900 hover:to-violet-900 hover:text-white transition shadow-sm">
      <span aria-hidden="true" class="text-lg leading-none">🎬</span>
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
        class="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        aria-label="Cerrar guía"
        (click)="close()">
      </button>

      <div
        class="relative z-10 w-full sm:max-w-3xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-teal-900/60 bg-gray-950 shadow-2xl">
        <div
          class="sticky top-0 z-10 border-b border-teal-900/40 bg-gradient-to-r from-teal-950 via-gray-950 to-violet-950 px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-wider text-teal-400">Tu día, ordenado</p>
            <h2 id="visual-guide-title" class="text-xl sm:text-2xl font-black text-white leading-tight mt-0.5">
              Dejá el cuaderno. Rilo se acuerda por vos.
            </h2>
            <p class="text-sm text-gray-400 mt-1.5 leading-snug">
              Para quien vende, entrega y cobra… y no tiene tiempo de “cargar el sistema”.
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-gray-400 hover:text-white hover:bg-white/10 text-2xl leading-none"
            aria-label="Cerrar"
            (click)="close()">
            ×
          </button>
        </div>

        <!-- Dolor → alivio -->
        <div class="px-4 sm:px-6 pt-4">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-2xl border border-red-900/40 bg-red-950/20 px-2 py-3">
              <p class="text-3xl sm:text-4xl leading-none" aria-hidden="true">😵‍💫</p>
              <p class="mt-2 text-[11px] sm:text-xs text-red-200/90 leading-snug font-medium">
                “¿Quién me debía?”
              </p>
            </div>
            <div class="rounded-2xl border border-amber-900/40 bg-amber-950/20 px-2 py-3">
              <p class="text-3xl sm:text-4xl leading-none" aria-hidden="true">📓</p>
              <p class="mt-2 text-[11px] sm:text-xs text-amber-100/90 leading-snug font-medium">
                Anotás y se pierde
              </p>
            </div>
            <div class="rounded-2xl border border-teal-800/50 bg-teal-950/40 px-2 py-3">
              <p class="text-3xl sm:text-4xl leading-none" aria-hidden="true">🥳</p>
              <p class="mt-2 text-[11px] sm:text-xs text-teal-200 leading-snug font-medium">
                WhatsApp y listo
              </p>
            </div>
          </div>
        </div>

        <div class="px-4 sm:px-6 pt-4 flex gap-2">
          <button
            type="button"
            (click)="tab = 'whatsapp'"
            class="flex-1 rounded-xl px-3 py-2.5 text-sm font-bold border transition"
            [class.bg-teal-600]="tab === 'whatsapp'"
            [class.border-teal-500]="tab === 'whatsapp'"
            [class.text-white]="tab === 'whatsapp'"
            [class.bg-gray-900]="tab !== 'whatsapp'"
            [class.border-gray-800]="tab !== 'whatsapp'"
            [class.text-gray-400]="tab !== 'whatsapp'">
            💬 Cargá por WhatsApp
          </button>
          <button
            type="button"
            (click)="tab = 'erp'"
            class="flex-1 rounded-xl px-3 py-2.5 text-sm font-bold border transition"
            [class.bg-teal-600]="tab === 'erp'"
            [class.border-teal-500]="tab === 'erp'"
            [class.text-white]="tab === 'erp'"
            [class.bg-gray-900]="tab !== 'erp'"
            [class.border-gray-800]="tab !== 'erp'"
            [class.text-gray-400]="tab !== 'erp'">
            🖥️ Controlá en el panel
          </button>
        </div>

        <!-- WhatsApp comic -->
        <div *ngIf="tab === 'whatsapp'" class="p-4 sm:p-6 space-y-4">
          <p class="text-center text-sm text-gray-300 font-semibold">
            Así te simplifica el día, en 4 viñetas
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <article class="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 min-h-[9.5rem] flex flex-col">
              <p class="text-[10px] font-black uppercase tracking-wide text-violet-400">1 · En la feria o el taller</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="text-5xl leading-none shrink-0" aria-hidden="true">👩‍🎨</span>
                <div class="rounded-2xl rounded-bl-md bg-gray-800 px-3 py-2 text-sm text-gray-100 leading-snug">
                  Vendí 2 remeras a María… ¿anoto después?
                </div>
              </div>
              <p class="mt-auto pt-3 text-xs text-gray-500">Sin planilla. Sin esperar a “cuando llegue a casa”.</p>
            </article>

            <article class="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 min-h-[9.5rem] flex flex-col">
              <p class="text-[10px] font-black uppercase tracking-wide text-teal-400">2 · Lo escribís como hablás</p>
              <div class="mt-2 ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-teal-800/80 px-3 py-2 text-sm text-white leading-snug">
                Venta a María, 2 remeras, cobró 800
              </div>
              <p class="mt-auto pt-3 text-xs text-gray-500">RiloBot entiende cliente, producto y plata.</p>
            </article>

            <article class="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 min-h-[9.5rem] flex flex-col">
              <p class="text-[10px] font-black uppercase tracking-wide text-amber-400">3 · Te pide el OK</p>
              <div class="mt-2 flex items-start gap-2">
                <span class="text-4xl leading-none shrink-0" aria-hidden="true">🤖</span>
                <div class="rounded-2xl rounded-tl-md bg-gray-800 px-3 py-2 text-xs text-gray-200 leading-relaxed font-mono">
                  Resumen VENTA<br />• María · 2 remeras · $800<br />¿Confirmás? <strong class="text-teal-300">SÍ</strong> o NO
                </div>
              </div>
              <p class="mt-auto pt-3 text-xs text-gray-500">Nada se guarda si no decís que sí. Cero sustos.</p>
            </article>

            <article class="rounded-2xl border border-teal-800/70 bg-teal-950/40 p-4 min-h-[9.5rem] flex flex-col">
              <p class="text-[10px] font-black uppercase tracking-wide text-teal-300">4 · Ya está en tu negocio</p>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-5xl leading-none" aria-hidden="true">✅</span>
                <div class="text-right">
                  <p class="text-sm font-bold text-white">Pedido, cobro y saldo</p>
                  <p class="text-xs text-teal-200/80">quedan anotados. Preguntá “¿cuánto debe María?” cuando quieras.</p>
                </div>
              </div>
              <p class="mt-auto pt-3 text-xs text-teal-300/90 font-medium">Vos seguís vendiendo. Rilo lleva la cuenta.</p>
            </article>
          </div>

          <div class="rounded-2xl border border-violet-900/50 bg-violet-950/20 px-4 py-3 flex items-start gap-3">
            <span class="text-3xl leading-none" aria-hidden="true">🧠</span>
            <p class="text-sm text-gray-300 leading-relaxed">
              <span class="font-bold text-white">La magia:</span>
              también podés mandar la foto de una factura de compra. Rilo arma el resumen y, si confirmás, entra stock.
            </p>
          </div>
        </div>

        <!-- Panel comic -->
        <div *ngIf="tab === 'erp'" class="p-4 sm:p-6 space-y-4">
          <p class="text-center text-sm text-gray-300 font-semibold">
            Cuando querés ver el negocio entero, no un chat
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <article class="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 text-center">
              <p class="text-5xl leading-none" aria-hidden="true">🧑‍💻</p>
              <h3 class="mt-2 text-sm font-bold text-white">Entras al panel</h3>
              <p class="mt-1 text-xs text-gray-400 leading-relaxed">
                Celular o compu. Mismos datos que cargaste por WhatsApp.
              </p>
            </article>
            <article class="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 text-center">
              <p class="text-5xl leading-none" aria-hidden="true">📒</p>
              <h3 class="mt-2 text-sm font-bold text-white">Caja, stock, deudas</h3>
              <p class="mt-1 text-xs text-gray-400 leading-relaxed">
                Quién te debe, qué compraste, qué hay en el depósito. Sin Excel eterno.
              </p>
            </article>
            <article class="rounded-2xl border border-teal-800/70 bg-teal-950/40 p-4 text-center">
              <p class="text-5xl leading-none" aria-hidden="true">📈</p>
              <h3 class="mt-2 text-sm font-bold text-white">Cerrás el día en 2 min</h3>
              <p class="mt-1 text-xs text-teal-200/80 leading-relaxed">
                Vendiste, cobraste, te falta cobrar. Todo junto, listo para decidir.
              </p>
            </article>
          </div>

          <div class="rounded-2xl border border-gray-800 bg-gray-900/50 px-4 py-3">
            <p class="text-xs font-bold text-gray-300 mb-2 text-center">El recorrido de tu plata</p>
            <div class="flex flex-wrap items-center justify-center gap-1.5 text-[11px] sm:text-xs">
              <span class="rounded-full bg-gray-950 border border-gray-700 px-2.5 py-1">🙋 Cliente</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-full bg-gray-950 border border-gray-700 px-2.5 py-1">📦 Pedido / venta</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-full bg-gray-950 border border-gray-700 px-2.5 py-1">💵 Caja</span>
              <span class="text-teal-500" aria-hidden="true">→</span>
              <span class="rounded-full bg-teal-950 border border-teal-700 px-2.5 py-1 text-teal-200">📊 Reporte</span>
            </div>
          </div>
        </div>

        <div
          class="sticky bottom-0 border-t border-teal-900/40 bg-gray-950/95 px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p class="text-xs text-gray-500 order-2 sm:order-1 text-center sm:text-left leading-snug">
            Prueba 30 días gratis. Sin tarjeta.
          </p>
          <div class="order-1 sm:order-2 flex flex-col sm:flex-row gap-2">
            <button type="button" class="text-xs text-gray-500 hover:text-gray-300 py-2 sm:px-2" (click)="close()">
              Ahora no
            </button>
            <a
              [routerLink]="['/registro']"
              [queryParams]="{ producto: tab === 'whatsapp' ? 'whatsapp' : 'erp' }"
              (click)="close()"
              class="inline-flex justify-center rounded-xl bg-teal-500 px-5 py-3 text-sm font-black text-gray-950 hover:bg-teal-400">
              Quiero ordenar mi negocio →
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class RitotechVisualGuideComponent {
  @Input() showTrigger = true;
  @Input() triggerLabel = 'Mirá cómo te ordena el día';
  @Input() defaultTab: GuideTab = 'whatsapp';

  isOpen = false;
  tab: GuideTab = 'whatsapp';

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
