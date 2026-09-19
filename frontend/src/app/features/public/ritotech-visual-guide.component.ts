import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DEFAULT_TRIAL_DAYS } from '../../../../../shared/trial-state.ts';

type GuideTab = 'whatsapp' | 'erp';

type WaStep = {
  n: number;
  title: string;
  tone: string;
  body: string;
  footer: string;
  kind: 'scene' | 'user' | 'bot' | 'done';
};

type ErpStep = {
  n: number;
  title: string;
  emoji: string;
  body: string;
};

@Component({
  selector: 'app-ritotech-visual-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  host: {
    class: 'inline-flex max-w-full',
    '(document:keydown.escape)': 'onEsc()',
    '(document:keydown.arrowleft)': 'onLeft()',
    '(document:keydown.arrowright)': 'onRight()',
  },
  template: `
    <button
      *ngIf="showTrigger"
      type="button"
      (click)="open(defaultTab)"
      class="inline-flex w-full sm:w-auto max-w-full items-center justify-center gap-2 rounded-xl border border-teal-600/80 bg-gradient-to-r from-teal-950/80 to-violet-950/50 px-4 py-2.5 text-sm font-semibold text-teal-100 hover:from-teal-900 hover:to-violet-900 hover:text-white transition shadow-sm">
      <span aria-hidden="true" class="text-lg leading-none">🎬</span>
      {{ triggerLabel }}
    </button>

    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4"
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
        class="relative z-10 flex flex-col w-full max-w-xl max-h-[min(92dvh,720px)] overflow-hidden rounded-2xl sm:rounded-3xl border border-teal-900/60 bg-gray-950 shadow-2xl">
        <div
          class="shrink-0 border-b border-teal-900/40 bg-gradient-to-r from-teal-950 via-gray-950 to-violet-950 px-4 sm:px-6 py-3 sm:py-4 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-wider text-teal-400">Tu día, ordenado</p>
            <h2 id="visual-guide-title" class="text-xl sm:text-2xl font-black text-white leading-tight mt-0.5">
              Dejá el cuaderno. Rilo se acuerda por vos.
            </h2>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-gray-400 hover:text-white hover:bg-white/10 text-2xl leading-none"
            aria-label="Cerrar"
            (click)="close()">
            &times;
          </button>
        </div>

        <div class="shrink-0 px-4 sm:px-6 pt-3 flex gap-2">
          <button
            type="button"
            (click)="setTab('whatsapp')"
            class="flex-1 rounded-xl px-3 py-2 text-sm font-bold border transition"
            [class.bg-teal-600]="tab === 'whatsapp'"
            [class.border-teal-500]="tab === 'whatsapp'"
            [class.text-white]="tab === 'whatsapp'"
            [class.bg-gray-900]="tab !== 'whatsapp'"
            [class.border-gray-800]="tab !== 'whatsapp'"
            [class.text-gray-400]="tab !== 'whatsapp'">
            Cargá por WhatsApp
          </button>
          <button
            type="button"
            (click)="setTab('erp')"
            class="flex-1 rounded-xl px-3 py-2 text-sm font-bold border transition"
            [class.bg-teal-600]="tab === 'erp'"
            [class.border-teal-500]="tab === 'erp'"
            [class.text-white]="tab === 'erp'"
            [class.bg-gray-900]="tab !== 'erp'"
            [class.border-gray-800]="tab !== 'erp'"
            [class.text-gray-400]="tab !== 'erp'">
            Controlá en el panel
          </button>
        </div>

        <div
          class="relative min-h-0 flex-1 overflow-hidden px-4 sm:px-6 py-4"
          (touchstart)="onTouchStart($event)"
          (touchend)="onTouchEnd($event)">
          <div *ngIf="tab === 'whatsapp'" class="h-full flex flex-col">
            <p class="text-center text-xs text-gray-400 mb-3">
              {{ waStepIndex + 1 }} / {{ waSteps.length }}
            </p>
            <div class="flex-1 flex items-stretch gap-2">
              <button
                type="button"
                class="shrink-0 self-center rounded-full h-10 w-10 border border-gray-700 text-gray-300 hover:bg-white/5"
                aria-label="Anterior"
                (click)="prevWa()"
                [disabled]="waStepIndex === 0"
                [class.opacity-30]="waStepIndex === 0">
                &lsaquo;
              </button>
              <article
                class="flex-1 rounded-2xl border p-5 flex flex-col transition-opacity duration-200"
                [ngClass]="
                  currentWa.kind === 'done'
                    ? 'border-teal-800 bg-teal-950/40'
                    : 'border-gray-800 bg-gray-900/70'
                ">
                <p class="text-[10px] font-black uppercase tracking-wide" [ngClass]="currentWa.tone">
                  {{ currentWa.n }} · {{ currentWa.title }}
                </p>
                <div class="mt-4 flex-1 flex flex-col justify-center">
                  <ng-container [ngSwitch]="currentWa.kind">
                    <div *ngSwitchCase="'scene'" class="flex items-end gap-2">
                      <span class="text-5xl leading-none shrink-0" aria-hidden="true">👩‍🎨</span>
                      <div class="rounded-2xl rounded-bl-md bg-gray-800 px-3 py-2 text-sm text-gray-100 leading-snug">
                        {{ currentWa.body }}
                      </div>
                    </div>
                    <div *ngSwitchCase="'user'" class="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-teal-800/80 px-3 py-2 text-sm text-white leading-snug">
                      {{ currentWa.body }}
                    </div>
                    <div *ngSwitchCase="'bot'" class="flex items-start gap-2">
                      <span class="text-4xl leading-none shrink-0" aria-hidden="true">🤖</span>
                      <div class="rounded-2xl rounded-tl-md bg-gray-800 px-3 py-2 text-sm text-gray-200 leading-relaxed whitespace-pre-line">
                        {{ currentWa.body }}
                      </div>
                    </div>
                    <div *ngSwitchCase="'done'" class="flex items-center justify-between gap-2">
                      <span class="text-5xl leading-none" aria-hidden="true">✅</span>
                      <div class="text-right">
                        <p class="text-sm font-bold text-white">{{ currentWa.body }}</p>
                      </div>
                    </div>
                  </ng-container>
                </div>
                <p class="mt-4 text-xs" [class.text-teal-300]="currentWa.kind === 'done'" [class.text-gray-500]="currentWa.kind !== 'done'">
                  {{ currentWa.footer }}
                </p>
              </article>
              <button
                type="button"
                class="shrink-0 self-center rounded-full h-10 w-10 border border-gray-700 text-gray-300 hover:bg-white/5"
                aria-label="Siguiente"
                (click)="nextWa()"
                [disabled]="waStepIndex >= waSteps.length - 1"
                [class.opacity-30]="waStepIndex >= waSteps.length - 1">
                &rsaquo;
              </button>
            </div>
            <div class="mt-4 flex justify-center gap-2">
              <button
                *ngFor="let step of waSteps; let i = index"
                type="button"
                class="h-2.5 w-2.5 rounded-full transition"
                [class.bg-teal-400]="i === waStepIndex"
                [class.bg-gray-700]="i !== waStepIndex"
                [attr.aria-label]="'Paso ' + (i + 1)"
                (click)="goWa(i)">
              </button>
            </div>
          </div>

          <div *ngIf="tab === 'erp'" class="h-full flex flex-col">
            <p class="text-center text-xs text-gray-400 mb-3">
              {{ erpStepIndex + 1 }} / {{ erpSteps.length }}
            </p>
            <div class="flex-1 flex items-stretch gap-2">
              <button
                type="button"
                class="shrink-0 self-center rounded-full h-10 w-10 border border-gray-700 text-gray-300 hover:bg-white/5"
                aria-label="Anterior"
                (click)="prevErp()"
                [disabled]="erpStepIndex === 0"
                [class.opacity-30]="erpStepIndex === 0">
                &lsaquo;
              </button>
              <article class="flex-1 rounded-2xl border border-gray-800 bg-gray-900/70 p-5 flex flex-col text-center justify-center">
                <p class="text-5xl leading-none" aria-hidden="true">{{ currentErp.emoji }}</p>
                <h3 class="mt-3 text-base font-bold text-white">{{ currentErp.title }}</h3>
                <p class="mt-2 text-sm text-gray-400 leading-relaxed">{{ currentErp.body }}</p>
              </article>
              <button
                type="button"
                class="shrink-0 self-center rounded-full h-10 w-10 border border-gray-700 text-gray-300 hover:bg-white/5"
                aria-label="Siguiente"
                (click)="nextErp()"
                [disabled]="erpStepIndex >= erpSteps.length - 1"
                [class.opacity-30]="erpStepIndex >= erpSteps.length - 1">
                &rsaquo;
              </button>
            </div>
            <div class="mt-4 flex justify-center gap-2">
              <button
                *ngFor="let step of erpSteps; let i = index"
                type="button"
                class="h-2.5 w-2.5 rounded-full transition"
                [class.bg-teal-400]="i === erpStepIndex"
                [class.bg-gray-700]="i !== erpStepIndex"
                [attr.aria-label]="'Paso ' + (i + 1)"
                (click)="goErp(i)">
              </button>
            </div>
          </div>
        </div>

        <div
          class="shrink-0 border-t border-teal-900/40 bg-gray-950 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p class="text-xs text-gray-500 order-2 sm:order-1 text-center sm:text-left leading-snug">
            Prueba {{ trialDays }} días gratis. Sin tarjeta.
          </p>
          <div class="order-1 sm:order-2 flex flex-col sm:flex-row gap-2">
            <button type="button" class="text-xs text-gray-500 hover:text-gray-300 py-2 sm:px-2" (click)="close()">
              Ahora no
            </button>
            <a
              *ngIf="showSignupCta"
              [routerLink]="['/registro']"
              [queryParams]="{ producto: tab === 'erp' ? 'erp' : 'whatsapp' }"
              (click)="close()"
              class="inline-flex justify-center rounded-xl px-5 py-3 text-sm font-black text-gray-950 transition"
              [ngClass]="
                highlightCta
                  ? 'bg-teal-400 ring-2 ring-teal-200 scale-[1.02]'
                  : 'bg-teal-500'
              ">
              {{ tab === 'erp' ? 'Probar el panel →' : 'Probar RILO Bot →' }}
            </a>
            <button
              *ngIf="!showSignupCta"
              type="button"
              (click)="close()"
              class="inline-flex justify-center rounded-xl bg-teal-500 px-5 py-3 text-sm font-black text-gray-950 hover:bg-teal-400">
              Entendido
            </button>
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
  @Input() showSignupCta = true;
  @Input() trialDays = DEFAULT_TRIAL_DAYS;

  isOpen = false;
  tab: GuideTab = 'whatsapp';
  waStepIndex = 0;
  erpStepIndex = 0;
  private touchStartX: number | null = null;

  readonly waSteps: WaStep[] = [
    {
      n: 1,
      title: 'En la feria o el taller',
      tone: 'text-violet-400',
      body: 'Vendí 2 remeras a María… ¿anoto después?',
      footer: 'Sin planilla. Sin esperar a “cuando llegue a casa”.',
      kind: 'scene',
    },
    {
      n: 2,
      title: 'Lo escribís como hablás',
      tone: 'text-teal-400',
      body: 'Venta a María, 2 remeras, cobró 800',
      footer: 'Tu agente con IA entiende cliente, producto y plata.',
      kind: 'user',
    },
    {
      n: 3,
      title: 'Si hace falta, RILO pregunta',
      tone: 'text-amber-400',
      body: 'Si está claro, lo registra.\nSi falta un dato, pregunta.\nEn acciones sensibles pide confirmación.',
      footer: 'Vos seguís al mando. Sin sorpresas.',
      kind: 'bot',
    },
    {
      n: 4,
      title: 'Ya está en tu negocio',
      tone: 'text-teal-300',
      body: 'Pedido, cobro y saldo quedan anotados.',
      footer: 'Vos seguís vendiendo. Rilo lleva la cuenta.',
      kind: 'done',
    },
  ];

  readonly erpSteps: ErpStep[] = [
    {
      n: 1,
      title: 'Entras al panel',
      emoji: '🧑‍💻',
      body: 'Celular o compu. Mismos datos que cargaste por WhatsApp.',
    },
    {
      n: 2,
      title: 'Caja, stock, deudas',
      emoji: '📒',
      body: 'Quién te debe, qué compraste, qué hay en el depósito. Sin Excel eterno.',
    },
    {
      n: 3,
      title: 'Cerrás el día en 2 min',
      emoji: '📈',
      body: 'Vendiste, cobraste, te falta cobrar. Todo junto, listo para decidir.',
    },
  ];

  get currentWa(): WaStep {
    return this.waSteps[this.waStepIndex] ?? this.waSteps[0]!;
  }

  get currentErp(): ErpStep {
    return this.erpSteps[this.erpStepIndex] ?? this.erpSteps[0]!;
  }

  get highlightCta(): boolean {
    return this.tab === 'whatsapp'
      ? this.waStepIndex === this.waSteps.length - 1
      : this.erpStepIndex === this.erpSteps.length - 1;
  }

  open(tab: GuideTab = this.defaultTab) {
    this.tab = tab;
    this.waStepIndex = 0;
    this.erpStepIndex = 0;
    this.isOpen = true;
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.isOpen = false;
    document.body.style.overflow = '';
  }

  setTab(tab: GuideTab) {
    this.tab = tab;
  }

  goWa(index: number) {
    this.waStepIndex = index;
  }

  goErp(index: number) {
    this.erpStepIndex = index;
  }

  prevWa() {
    this.waStepIndex = Math.max(0, this.waStepIndex - 1);
  }

  nextWa() {
    this.waStepIndex = Math.min(this.waSteps.length - 1, this.waStepIndex + 1);
  }

  prevErp() {
    this.erpStepIndex = Math.max(0, this.erpStepIndex - 1);
  }

  nextErp() {
    this.erpStepIndex = Math.min(this.erpSteps.length - 1, this.erpStepIndex + 1);
  }

  onTouchStart(event: TouchEvent) {
    this.touchStartX = event.changedTouches[0]?.clientX ?? null;
  }

  onTouchEnd(event: TouchEvent) {
    if (this.touchStartX == null) return;
    const endX = event.changedTouches[0]?.clientX ?? this.touchStartX;
    const delta = endX - this.touchStartX;
    this.touchStartX = null;
    if (Math.abs(delta) < 40) return;
    if (this.tab === 'whatsapp') {
      if (delta < 0) this.nextWa();
      else this.prevWa();
    } else {
      if (delta < 0) this.nextErp();
      else this.prevErp();
    }
  }

  onEsc() {
    if (this.isOpen) this.close();
  }

  onLeft() {
    if (!this.isOpen) return;
    if (this.tab === 'whatsapp') this.prevWa();
    else this.prevErp();
  }

  onRight() {
    if (!this.isOpen) return;
    if (this.tab === 'whatsapp') this.nextWa();
    else this.nextErp();
  }
}
