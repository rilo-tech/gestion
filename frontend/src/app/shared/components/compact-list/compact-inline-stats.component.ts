import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CompactInlineStatTone = 'default' | 'muted' | 'warning' | 'success' | 'danger' | 'accent';

export interface CompactInlineStat {
  label: string;
  value: string;
  tone?: CompactInlineStatTone;
}

@Component({
  selector: 'app-compact-inline-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="text-[11px] leading-tight tabular-nums text-right" role="list" aria-label="Indicadores">
      <ng-container *ngFor="let stat of items; let last = last">
        <span class="inline-flex items-baseline gap-0.5" role="listitem">
          <span class="text-gray-500">{{ stat.label }}</span>
          <span class="font-semibold" [class]="valueClass(stat)">{{ stat.value }}</span>
        </span>
        <span *ngIf="!last" class="text-gray-300 px-1" aria-hidden="true">·</span>
      </ng-container>
    </div>
  `,
})
export class CompactInlineStatsComponent {
  @Input() items: CompactInlineStat[] = [];

  valueClass(stat: CompactInlineStat): string {
    switch (stat.tone) {
      case 'muted':
        return 'text-gray-400';
      case 'warning':
        return 'text-amber-600';
      case 'success':
        return 'text-teal-600';
      case 'danger':
        return 'text-red-600';
      case 'accent':
        return 'text-teal-700';
      default:
        return 'text-gray-900';
    }
  }
}
