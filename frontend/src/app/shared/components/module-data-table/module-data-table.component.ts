import { Component, Input, OnChanges } from '@angular/core';
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
export class ModuleDataTableComponent implements OnChanges {
  @Input() minWidthClass = 'w-full max-w-full';

  tableClass = `${NATIVE_COMPACT_TABLE_CLASS} module-data-table-layout w-full max-w-full`;

  ngOnChanges(): void {
    this.tableClass = `${NATIVE_COMPACT_TABLE_CLASS} module-data-table-layout w-full ${this.minWidthClass}`;
  }
}
