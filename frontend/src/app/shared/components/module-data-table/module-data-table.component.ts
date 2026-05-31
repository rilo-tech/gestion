import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NATIVE_COMPACT_TABLE_CLASS } from '../compact-list/compact-list.constants';

@Component({
  selector: 'app-module-data-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <table [class]="tableClass">
      <ng-content></ng-content>
    </table>
  `,
})
export class ModuleDataTableComponent {
  @Input() minWidthClass = 'sm:min-w-[640px]';

  get tableClass(): string {
    return `${NATIVE_COMPACT_TABLE_CLASS} ${this.minWidthClass}`;
  }
}
