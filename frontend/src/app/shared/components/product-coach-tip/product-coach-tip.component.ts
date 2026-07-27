import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RILOTECH_COACH_TIPS, type ProductCoachTip } from '../../../../../../shared/ritotech-marketing.ts';

const STORAGE_PREFIX = 'rilo-coach-dismissed:';

@Component({
  selector: 'app-product-coach-tip',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div
      *ngIf="tip"
      class="fixed bottom-4 right-4 z-[80] max-w-sm w-[calc(100%-2rem)] rounded-2xl border border-teal-800/80 bg-gray-950 shadow-xl shadow-black/40 p-4 text-sm text-gray-100">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-teal-300">{{ tip.title }}</p>
          <p class="mt-1.5 text-xs text-gray-400 leading-relaxed">{{ tip.body }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <a
              *ngIf="tip.ctaRoute && tip.ctaLabel"
              [routerLink]="tip.ctaRoute"
              (click)="dismiss()"
              class="inline-flex rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold hover:bg-teal-500">
              {{ tip.ctaLabel }}
            </a>
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-300"
              (click)="dismiss()">
              Entendido
            </button>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 text-gray-500 hover:text-white"
          aria-label="Cerrar tip"
          (click)="dismiss()">
          ×
        </button>
      </div>
    </div>
  `,
})
export class ProductCoachTipComponent implements OnInit {
  private auth = inject(AuthService);
  tip: ProductCoachTip | null = null;

  ngOnInit() {
    if (!this.auth.isAuthenticated) return;
    const audience = this.resolveAudience();
    const candidates = RILOTECH_COACH_TIPS.filter(
      (t) => t.audience === 'all' || t.audience === audience
    );
    const next = candidates.find((t) => !this.isDismissed(t.id));
    if (next) {
      // Pequeño delay para no tapar el primer paint
      setTimeout(() => {
        this.tip = next;
      }, 1800);
    }
  }

  dismiss() {
    if (this.tip) {
      sessionStorage.setItem(STORAGE_PREFIX + this.tip.id, '1');
    }
    this.tip = null;
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
