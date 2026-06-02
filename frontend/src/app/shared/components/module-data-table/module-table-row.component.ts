import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DESKTOP_TABLE_TD_CLASS } from '../compact-list/compact-list.constants';

export type ModuleTableRowTone = 'default' | 'danger' | 'success' | 'group' | 'nested';

/** Fila de tabla nativa (`<tr>`) — no usar wrapper custom que rompe el layout. */
@Component({
  selector: 'tr[app-module-table-row]',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
  },
})
export class ModuleTableRowComponent implements OnChanges {
  @Input() tone: ModuleTableRowTone = 'default';
  @Input() hover = true;
  @Input() clickable = false;

  hostClass = '';

  ngOnChanges(): void {
    this.hostClass = this.buildRowClass();
  }

  private buildRowClass(): string {
    const parts = ['transition-colors'];
    if (this.clickable) {
      parts.push('cursor-pointer');
    }
    if (this.hover && this.tone !== 'nested') {
      parts.push('hover:bg-gray-50 dark:hover:bg-gray-800/40');
    }
    switch (this.tone) {
      case 'danger':
        parts.push('bg-red-50 dark:bg-red-950/25');
        break;
      case 'success':
        parts.push('bg-teal-50/40 dark:bg-teal-950/20');
        break;
      case 'group':
        parts.push('bg-slate-50/90 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800');
        break;
      case 'nested':
        parts.push('bg-white dark:bg-gray-900');
        break;
      default:
        break;
    }
    return parts.join(' ');
  }
}

/** Celda de tabla nativa (`<td>`). */
@Component({
  selector: 'td[app-module-table-cell]',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
  },
})
export class ModuleTableCellComponent implements OnChanges {
  @Input() align: 'left' | 'right' | 'center' = 'left';
  @Input() desktopOnly = false;
  @Input() mdOnly = false;
  @Input() lgOnly = false;
  @Input() nowrap = false;
  @Input() nested = false;
  @Input() extraClass = '';

  hostClass = '';

  ngOnChanges(): void {
    this.hostClass = this.buildCellClass();
  }

  private buildCellClass(): string {
    const parts = [
      'text-sm text-gray-900 dark:text-gray-100 align-middle',
      this.extraClass,
    ];
    if (this.nested) {
      parts.push('px-3 py-2');
    } else {
      parts.push(DESKTOP_TABLE_TD_CLASS);
    }
    if (this.desktopOnly) parts.push('hidden sm:table-cell');
    if (this.mdOnly) parts.push('hidden md:table-cell');
    if (this.lgOnly) parts.push('hidden lg:table-cell');
    if (this.align === 'right') parts.push('text-right');
    if (this.align === 'center') parts.push('text-center');
    if (this.nowrap) parts.push('whitespace-nowrap');
    return parts.filter(Boolean).join(' ');
  }
}

/** Título en una línea; subtítulo opcional truncado (máx. una línea). */
@Component({
  selector: 'app-module-table-cell-text',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-w-0">
      <div class="font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">{{ primary }}</div>
      <div *ngIf="secondary" class="text-xs text-gray-500 dark:text-gray-400 truncate leading-snug mt-0.5">
        {{ secondary }}
      </div>
    </div>
  `,
})
export class ModuleTableCellTextComponent {
  @Input({ required: true }) primary = '';
  @Input() secondary?: string;
}

@Component({
  selector: 'tr[app-module-table-empty-row]',
  standalone: true,
  imports: [CommonModule],
  template: `
    <td [attr.colspan]="colspan" class="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
      <ng-content></ng-content>
    </td>
  `,
})
export class ModuleTableEmptyRowComponent {
  @Input() colspan = 6;
}
