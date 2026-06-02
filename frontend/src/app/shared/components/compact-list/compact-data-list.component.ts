import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TABLE_SCROLL_CLASS } from '../icon-action/icon-action.component';
import {
  COMPACT_LIST_SEARCH_WRAP_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
} from './compact-list.constants';

@Component({
  selector: 'app-compact-data-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div *ngIf="showSearch" [class]="searchWrapClass">
        <ng-content select="[listSearch]"></ng-content>
      </div>

      <div [class]="mobileListClass">
        <ng-content select="[listMobile]"></ng-content>
      </div>

      <div [class]="desktopWrapClass">
        <ng-content select="[listDesktop]"></ng-content>
      </div>

      <ng-content select="[listFooter]"></ng-content>
    </div>
  `,
})
export class CompactDataListComponent implements OnChanges {
  @Input() showSearch = true;
  /** Si false, la grilla desktop también se muestra en celular (con scroll horizontal). */
  @Input() desktopOnly = true;

  readonly searchWrapClass = COMPACT_LIST_SEARCH_WRAP_CLASS;
  readonly mobileListClass = `sm:hidden ${NATIVE_COMPACT_LIST_CLASS}`;
  readonly desktopScrollClass = TABLE_SCROLL_CLASS;

  desktopWrapClass = this.desktopScrollClass;

  ngOnChanges(): void {
    this.desktopWrapClass = this.desktopOnly
      ? `hidden sm:block ${this.desktopScrollClass}`
      : this.desktopScrollClass;
  }
}
