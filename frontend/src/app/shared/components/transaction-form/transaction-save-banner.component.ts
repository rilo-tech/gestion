import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

/** Banner verde de confirmación tras guardar (ventas, compras, pedidos, etc.). */
@Component({
  selector: 'app-transaction-save-banner',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      *ngIf="message?.trim()"
      class="mb-4 rounded-xl border border-teal-200 bg-teal-50 dark:bg-teal-950/40 dark:border-teal-800 px-4 py-3 text-sm font-medium text-teal-900 dark:text-teal-100 flex items-start gap-2.5"
      role="status"
      aria-live="polite">
      <i-lucide name="circle-check" class="w-5 h-5 shrink-0 text-teal-600 dark:text-teal-400 mt-0.5"></i-lucide>
      <span>{{ message }}</span>
    </div>
  `,
})
export class TransactionSaveBannerComponent {
  @Input() message = '';
}
