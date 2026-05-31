import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-config-setting-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <article [class]="cardClass">
      <header class="mb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{{ title }}</h3>
              <span
                *ngIf="listCount !== null && listCount > 0"
                class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 text-[10px] font-bold tabular-nums shrink-0">
                {{ listCount }}
              </span>
            </div>
            <p *ngIf="description" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug desc-lg-only">
              {{ description }}
            </p>
          </div>
          <button
            *ngIf="collapsibleList"
            type="button"
            (click)="toggleList()"
            [attr.aria-expanded]="listExpanded"
            [attr.aria-label]="listExpanded ? 'Ocultar lista' : 'Ver lista'"
            class="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors shrink-0">
            <i-lucide [name]="listExpanded ? 'chevron-up' : 'chevron-down'" class="w-4 h-4"></i-lucide>
          </button>
        </div>
      </header>

      <ng-content select="[configAdd]"></ng-content>

      <div *ngIf="!collapsibleList || listExpanded" class="mt-2 min-h-0">
        <ng-content select="[configList]"></ng-content>
      </div>
    </article>
  `,
})
export class ConfigSettingCardComponent {
  @Input() title = '';
  @Input() description = '';
  @Input() listCount: number | null = null;
  @Input() collapsibleList = true;
  @Input() listExpanded = false;
  @Input() cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex flex-col min-w-0';

  @Output() listExpandedChange = new EventEmitter<boolean>();

  toggleList() {
    this.listExpanded = !this.listExpanded;
    this.listExpandedChange.emit(this.listExpanded);
  }
}
