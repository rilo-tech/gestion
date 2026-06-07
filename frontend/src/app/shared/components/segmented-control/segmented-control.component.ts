import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SegmentedOption {
  id: string;
  label: string;
}

type SegmentedSize = 'sm' | 'md';

/**
 * Control segmentado reutilizable con indicador deslizante (thumb animado).
 * Pensado para selecciones excluyentes cortas como el ámbito de caja (Rilo / Personal),
 * filtros por tipo, etc. El thumb se mueve con una transición suave entre opciones.
 */
@Component({
  selector: 'app-segmented-control',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="tablist" [attr.aria-label]="ariaLabel" [class]="trackClass">
      <span
        *ngIf="selectedIndex >= 0 && options.length > 1"
        aria-hidden="true"
        class="absolute top-1 bottom-1 left-1 rounded-lg bg-teal-600 shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none"
        [style.width]="thumbWidth"
        [style.transform]="thumbTransform">
      </span>
      <button
        *ngFor="let option of options; let i = index; trackBy: trackById"
        type="button"
        role="tab"
        [attr.aria-selected]="option.id === value"
        [disabled]="disabled"
        (click)="select(option.id)"
        [class]="buttonClass"
        [ngClass]="
          option.id === value
            ? 'text-white font-semibold'
            : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
        ">
        {{ option.label }}
      </button>
    </div>
  `,
})
export class SegmentedControlComponent {
  @Input() options: SegmentedOption[] = [];
  @Input() value = '';
  @Input() ariaLabel = '';
  @Input() size: SegmentedSize = 'md';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  get selectedIndex(): number {
    return this.options.findIndex((option) => option.id === this.value);
  }

  get thumbWidth(): string {
    const count = this.options.length || 1;
    return `calc((100% - 0.5rem) / ${count})`;
  }

  get thumbTransform(): string {
    const index = Math.max(0, this.selectedIndex);
    return `translateX(${index * 100}%)`;
  }

  get trackClass(): string {
    return (
      'relative isolate grid w-full rounded-xl bg-gray-100 p-1 dark:bg-gray-800 ' +
      this.gridColsClass +
      (this.disabled ? ' opacity-60' : '')
    );
  }

  get buttonClass(): string {
    const sizing =
      this.size === 'sm'
        ? 'px-2 py-1.5 text-xs min-h-[34px]'
        : 'px-3 py-2 text-sm min-h-[40px]';
    return (
      'relative z-10 inline-flex items-center justify-center rounded-lg font-medium ' +
      'transition-colors duration-200 touch-manipulation select-none truncate ' +
      'disabled:cursor-not-allowed ' +
      sizing
    );
  }

  private get gridColsClass(): string {
    const count = this.options.length || 1;
    const map: Record<number, string> = {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      5: 'grid-cols-5',
    };
    return map[count] ?? 'grid-flow-col auto-cols-fr';
  }

  trackById = (_index: number, option: SegmentedOption) => option.id;

  select(id: string): void {
    if (this.disabled || id === this.value) {
      return;
    }
    this.value = id;
    this.valueChange.emit(id);
  }
}
