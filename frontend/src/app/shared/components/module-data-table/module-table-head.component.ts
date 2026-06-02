import { Component, Input, OnChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MODULE_TABLE_HEAD_CELL_CLASS } from '../compact-list/compact-list.constants';

@Component({
  selector: 'thead[app-module-table-head]',
  standalone: true,
  imports: [CommonModule],
  template: `
    <tr class="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800">
      <ng-content></ng-content>
    </tr>
  `,
})
export class ModuleTableHeadComponent {}

@Component({
  selector: 'th[app-module-table-head-cell]',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
  },
})
export class ModuleTableHeadCellComponent implements OnInit, OnChanges {
  @Input() desktopOnly = false;
  @Input() align: 'left' | 'right' | 'center' = 'left';
  @Input() nowrap = false;

  hostClass = MODULE_TABLE_HEAD_CELL_CLASS;

  ngOnInit(): void {
    this.rebuildHostClass();
  }

  ngOnChanges(): void {
    this.rebuildHostClass();
  }

  private rebuildHostClass(): void {
    const parts = [MODULE_TABLE_HEAD_CELL_CLASS];
    if (this.desktopOnly) parts.unshift('hidden sm:table-cell');
    if (this.align === 'right') parts.push('text-right');
    if (this.align === 'center') parts.push('text-center');
    if (this.nowrap) parts.push('whitespace-nowrap');
    this.hostClass = parts.join(' ');
  }
}

@Component({
  selector: 'tbody[app-module-table-body]',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-content></ng-content>`,
  host: {
    class: 'divide-y divide-gray-50 dark:divide-gray-800',
  },
})
export class ModuleTableBodyComponent {}
