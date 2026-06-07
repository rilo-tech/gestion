import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CompactInlineStatTone = 'default' | 'muted' | 'warning' | 'success' | 'danger' | 'accent';

export interface CompactInlineStat {
  label: string;
  value: string;
  tone?: CompactInlineStatTone;
  /** En variante strip: empuja el ítem a la derecha desde sm. */
  alignEnd?: boolean;
}

@Component({
  selector: 'app-compact-inline-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      *ngIf="variant === 'strip'; else inlineVariant"
      class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-xs w-full"
      [class.gap-x-2]="isCompact"
      [class.gap-y-0.5]="isCompact"
      [class.text-[10px]]="isCompact"
      role="list"
      [attr.aria-label]="ariaLabel">
      <div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 min-w-0" [class.gap-x-2]="isCompact">
        <span *ngFor="let stat of leadingItems" class="tabular-nums" role="listitem">
          <span
            class="font-semibold uppercase text-gray-400 dark:text-gray-500 mr-1"
            [class.text-[9px]]="isCompact">
            {{ stat.label }}
          </span>
          <span class="font-bold" [class]="valueClass(stat)" [class.text-sm]="isCompact">{{ stat.value }}</span>
        </span>
      </div>
      <span
        *ngIf="centerCaption"
        class="w-full sm:w-auto sm:flex-1 sm:min-w-[5rem] text-center font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize px-1 order-last sm:order-none"
        [class.text-[9px]]="isCompact"
        role="note">
        {{ centerCaption }}
      </span>
      <div
        class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 sm:ml-auto"
        [class.gap-x-2]="isCompact"
        [class.w-full]="!centerCaption && trailingItems.length > 0">
        <span
          *ngFor="let stat of trailingItems"
          class="tabular-nums"
          role="listitem"
          [class.sm:ml-auto]="!centerCaption && trailingItems.length === 1">
          <span
            class="font-semibold uppercase text-gray-400 dark:text-gray-500 mr-1"
            [class.text-[9px]]="isCompact">
            {{ stat.label }}
          </span>
          <span class="font-bold" [class]="valueClass(stat)" [class.text-sm]="isCompact">{{ stat.value }}</span>
        </span>
      </div>
    </div>

    <ng-template #inlineVariant>
      <div class="text-[11px] leading-tight tabular-nums text-right" role="list" [attr.aria-label]="ariaLabel">
        <ng-container *ngFor="let stat of items; let last = last">
          <span class="inline-flex items-baseline gap-0.5" role="listitem">
            <span class="text-gray-500">{{ stat.label }}</span>
            <span class="font-semibold" [class]="valueClass(stat)">{{ stat.value }}</span>
          </span>
          <span *ngIf="!last" class="text-gray-300 px-1" aria-hidden="true">·</span>
        </ng-container>
      </div>
    </ng-template>
  `,
})
export class CompactInlineStatsComponent {
  @Input() items: CompactInlineStat[] = [];
  @Input() variant: 'inline' | 'strip' = 'inline';
  @Input() ariaLabel = 'Indicadores';
  /** Mes u otro texto entre Ing./Egr. y Saldo (variante strip). */
  @Input() centerCaption = '';
  /** `compact` reduce tipografía en celular (p. ej. resumen de Caja). */
  @Input() density: 'default' | 'compact' = 'default';

  get isCompact(): boolean {
    return this.density === 'compact';
  }

  get leadingItems(): CompactInlineStat[] {
    return this.items.filter((stat) => !stat.alignEnd);
  }

  get trailingItems(): CompactInlineStat[] {
    return this.items.filter((stat) => stat.alignEnd);
  }

  valueClass(stat: CompactInlineStat): string {
    switch (stat.tone) {
      case 'muted':
        return 'text-gray-400';
      case 'warning':
        return 'text-amber-600';
      case 'success':
        return 'text-teal-600 dark:text-teal-400';
      case 'danger':
        return this.variant === 'strip' ? 'text-red-500 dark:text-red-400' : 'text-red-600 dark:text-red-400';
      case 'accent':
        return 'text-teal-700 dark:text-teal-300';
      default:
        return 'text-gray-900 dark:text-gray-100';
    }
  }
}
