import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-module-table-head',
  standalone: true,
  imports: [CommonModule],
  template: `
    <thead>
      <tr class="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800">
        <ng-content></ng-content>
      </tr>
    </thead>
  `,
})
export class ModuleTableHeadComponent {}

@Component({
  selector: 'app-module-table-head-cell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <th
      [class]="cellClass"
      [class.text-right]="align === 'right'"
      [class.text-center]="align === 'center'"
      [class.whitespace-nowrap]="nowrap">
      <ng-content></ng-content>
    </th>
  `,
})
export class ModuleTableHeadCellComponent {
  @Input() desktopOnly = false;
  @Input() align: 'left' | 'right' | 'center' = 'left';
  @Input() nowrap = false;

  get cellClass(): string {
    const base = 'text-xs font-semibold text-gray-400 uppercase tracking-wider';
    if (this.desktopOnly) {
      return `hidden sm:table-cell px-6 py-4 ${base}`;
    }
    return `px-4 sm:px-6 py-3 sm:py-4 ${base}`;
  }
}

@Component({
  selector: 'app-module-table-body',
  standalone: true,
  imports: [CommonModule],
  template: `
    <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
      <ng-content></ng-content>
    </tbody>
  `,
})
export class ModuleTableBodyComponent {}
