import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { RitotechFaqItem } from '../../../../../shared/ritotech-marketing.ts';

@Component({
  selector: 'app-ritotech-faq',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="max-w-3xl mx-auto px-4 py-12 sm:py-16" [attr.aria-labelledby]="headingId">
      <h2 [id]="headingId" class="text-xl sm:text-2xl font-bold text-center">{{ title }}</h2>
      <p *ngIf="subtitle" class="text-center text-gray-400 text-sm mt-2 max-w-xl mx-auto">{{ subtitle }}</p>

      <div class="mt-8 space-y-2">
        <div
          *ngFor="let item of items"
          class="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <button
            type="button"
            (click)="toggle(item.id)"
            class="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-gray-900/80 transition-colors"
            [attr.aria-expanded]="openId === item.id">
            <span class="text-sm font-semibold text-gray-100">{{ item.question }}</span>
            <span class="text-teal-400 text-lg leading-none shrink-0">{{ openId === item.id ? '−' : '+' }}</span>
          </button>
          <div
            *ngIf="openId === item.id"
            class="px-4 pb-4 text-sm text-gray-400 leading-relaxed border-t border-gray-800/80 pt-3">
            {{ item.answer }}
          </div>
        </div>
      </div>
    </section>
  `,
})
export class RitotechFaqComponent {
  @Input() title = 'Preguntas frecuentes';
  @Input() subtitle = '';
  @Input() items: RitotechFaqItem[] = [];
  @Input() headingId = 'ritotech-faq';

  openId: string | null = null;

  toggle(id: string) {
    this.openId = this.openId === id ? null : id;
  }
}
