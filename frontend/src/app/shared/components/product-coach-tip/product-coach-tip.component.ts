import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RILOTECH_COACH_TIPS, type ProductCoachTip } from '../../../../../../shared/ritotech-marketing.ts';

const STORAGE_PREFIX = 'rilo-coach-dismissed:';
const AUTO_DISMISS_MS = 8000;

@Component({
  selector: 'app-product-coach-tip',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div
      *ngIf="tip"
      role="status"
      aria-live="polite"
      data-coach-tip
      class="fixed z-[55] max-w-sm w-[calc(100%-2rem)] rounded-2xl border border-teal-800/70 bg-gray-950/95 shadow-xl shadow-black/40 p-3.5 text-sm text-gray-100 bottom-[max(6rem,env(safe-area-inset-bottom))] left-4 right-4 mx-auto sm:left-auto sm:right-4 sm:mx-0 sm:bottom-4 pointer-events-auto">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-teal-400/90">
            {{ tipEyebrow }}
          </p>
          <p class="mt-0.5 font-semibold text-teal-200">{{ tip.title }}</p>
          <p class="mt-1.5 text-xs text-gray-400 leading-relaxed">{{ tip.body }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <a
              *ngIf="tip.ctaRoute && tip.ctaLabel"
              [routerLink]="tip.ctaRoute"
              (click)="dismiss()"
              class="inline-flex rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold hover:bg-teal-500 min-h-9 items-center">
              {{ tip.ctaLabel }}
            </a>
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-300 min-h-9 px-1"
              (click)="dismiss()">
              Entendido
            </button>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 -mt-1 -mr-1 text-gray-500 hover:text-white"
          aria-label="Cerrar tip"
          (click)="dismiss()">
          ×
        </button>
      </div>
    </div>
  `,
})
export class ProductCoachTipComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  tip: ProductCoachTip | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  get tipEyebrow(): string {
    if (!this.tip) return '';
    if (this.tip.audience === 'whatsapp' || /RILO Bot/i.test(this.tip.title)) {
      return '🤖 Consejo de RILO Bot';
    }
    if (this.tip.audience === 'erp') return 'Sugerencia';
    return 'Tip';
  }

  ngOnInit() {
    if (!this.auth.isAuthenticated) return;
    const audience = this.resolveAudience();
    // Gestión (solo ERP): sin tips de Bot ni upsell toast repetitivo — solo tip de campanita.
    const candidates = RILOTECH_COACH_TIPS.filter((t) => {
      if (this.isDismissed(t.id)) return false;
      if (audience === 'erp') {
        return t.id === 'tip-avisos';
      }
      if (audience === 'whatsapp') {
        return t.audience === 'whatsapp' || t.audience === 'all';
      }
      // Completo: tips Bot + avisos (no upsell-bot toast)
      return t.audience === 'whatsapp' || t.id === 'tip-avisos';
    });
    const next = candidates[0] ?? null;
    if (!next) return;
    this.showTimer = setTimeout(() => {
      this.tip = next;
      this.dismissTimer = setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);
    }, 1800);
  }

  dismiss() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.tip) {
      sessionStorage.setItem(STORAGE_PREFIX + this.tip.id, '1');
    }
    this.tip = null;
  }

  ngOnDestroy() {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
  }

  private isDismissed(id: string): boolean {
    return sessionStorage.getItem(STORAGE_PREFIX + id) === '1';
  }

  private resolveAudience(): 'whatsapp' | 'erp' | 'all' {
    if (this.auth.canAccessWhatsapp && !this.auth.canAccessErpWeb) return 'whatsapp';
    if (this.auth.canAccessErpWeb && !this.auth.canAccessWhatsapp) return 'erp';
    return 'all';
  }
}
