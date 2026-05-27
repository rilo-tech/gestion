import { Component, Input } from '@angular/core';
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

      <div class="hidden sm:block" [class]="desktopScrollClass">
        <ng-content select="[listDesktop]"></ng-content>
      </div>

      <ng-content select="[listFooter]"></ng-content>
    </div>
  `,
})
export class CompactDataListComponent {
  @Input() showSearch = true;

  readonly searchWrapClass = COMPACT_LIST_SEARCH_WRAP_CLASS;
  readonly mobileListClass = `sm:hidden ${NATIVE_COMPACT_LIST_CLASS}`;
  readonly desktopScrollClass = TABLE_SCROLL_CLASS;
}
