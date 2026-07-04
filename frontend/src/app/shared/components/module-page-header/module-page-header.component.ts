import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { IconActionComponent, PAGE_DESC_CLASS } from '../icon-action/icon-action.component';
import {
  ActivityLogTriggerComponent,
} from '../activity-log-trigger/activity-log-trigger.component';
import type { ActivityModule } from '../../../core/services/activity.service';
import {
  ListSearchFieldComponent,
  LIST_TOOLBAR_ROW_CLASS,
} from '../list-search-field/list-search-field.component';

@Component({
  selector: 'app-module-page-header',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, IconActionComponent, ActivityLogTriggerComponent, ListSearchFieldComponent],
  template: `
    <div class="mb-6 sm:mb-8 flex flex-col gap-4 sm:block">
      <div class="flex items-center sm:items-start justify-between gap-3 sm:gap-4 min-w-0">
        <div class="min-w-0 flex-1">
          <h1 [class]="titleClass">{{ title }}</h1>
          <p *ngIf="description" [class]="descriptionClass">{{ description }}</p>
          <ng-content select="[headerExtra]"></ng-content>
        </div>
        <div [class]="toolbarRowClass + ' shrink-0'">
          <app-icon-action
            *ngIf="showRefresh"
            label="Actualizar"
            [iconOnly]="true"
            variant="outline"
            [disabled]="refreshing"
            (clicked)="refreshClick.emit()">
            <i-lucide
              name="refresh-cw"
              class="w-4 h-4"
              [class.animate-spin]="refreshing"></i-lucide>
          </app-icon-action>
          <app-activity-log-trigger
            *ngIf="activityModule"
            [module]="activityModule"
            [limit]="10">
          </app-activity-log-trigger>
          <ng-content select="[headerActions]"></ng-content>
        </div>
      </div>
      <app-list-search-field
        *ngIf="showMobileSearch"
        mode="filter"
        [query]="searchQuery"
        (queryChange)="onSearchChange($event)"
        [name]="searchFieldName"
        [placeholder]="searchPlaceholder"
        [constrainWidth]="false"
        class="sm:hidden w-full">
      </app-list-search-field>
    </div>
  `,
})
export class ModulePageHeaderComponent {
  readonly toolbarRowClass = LIST_TOOLBAR_ROW_CLASS;

  @Input() title = '';
  @Input() description = '';
  @Input() showMobileSearch = false;
  @Input() searchQuery = '';
  @Input() searchPlaceholder = 'Buscar...';
  @Input() searchFieldName = 'moduleSearchMobile';
  @Input() activityModule: ActivityModule | null = null;
  @Input() hideDescriptionOnMobile = true;
  @Input() compactMobile = false;
  @Input() showRefresh = false;
  @Input() refreshing = false;

  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() refreshClick = new EventEmitter<void>();

  get descriptionClass(): string {
    return this.hideDescriptionOnMobile ? PAGE_DESC_CLASS : PAGE_DESC_CLASS.replace('desc-lg-only', '');
  }

  get titleClass(): string {
    const base = 'font-bold text-gray-900 dark:text-gray-100 sm:text-2xl sm:truncate-none';
    if (this.compactMobile) {
      return `${base} text-sm leading-snug`;
    }
    return `${base} text-xl truncate`;
  }

  onSearchChange(value: string) {
    this.searchQuery = value;
    this.searchQueryChange.emit(value);
  }
}
