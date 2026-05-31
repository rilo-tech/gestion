import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { COMPACT_LIST_ROW_CLASS } from './compact-list.constants';

@Component({
  selector: 'app-compact-list-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      type="button"
      [class]="rowClass"
      [disabled]="disabled"
      (click)="activate.emit($event)">
      <div class="min-w-0 flex-1 overflow-hidden text-left">
        <ng-content select="[compactTitle]"></ng-content>
        <ng-content select="[compactSubtitle]"></ng-content>
      </div>
      <div class="shrink-0 pl-2 self-center">
        <ng-content select="[compactTrailing]"></ng-content>
      </div>
    </button>
  `,
})
export class CompactListRowComponent {
  @Input() disabled = false;
  @Input() rowClass = COMPACT_LIST_ROW_CLASS;
  @Output() activate = new EventEmitter<Event>();
}
