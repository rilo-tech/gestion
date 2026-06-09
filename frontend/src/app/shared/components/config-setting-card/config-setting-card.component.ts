import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { CONFIG_SETTING_DESC_CLASS } from '../config-editable-list/config-editable-list.constants';

@Component({
  selector: 'app-config-setting-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <article [class]="cardClass">
      <button
        *ngIf="sectionCollapse; else staticHeader"
        type="button"
        (click)="toggleList()"
        [attr.aria-expanded]="listExpanded"
        [attr.aria-label]="listExpanded ? 'Ocultar ' + title : 'Ver ' + title"
        class="w-full flex items-start justify-between gap-2 text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
        <ng-container *ngTemplateOutlet="headerBody"></ng-container>
        <i-lucide
          [name]="listExpanded ? 'chevron-up' : 'chevron-down'"
          class="w-4 h-4 shrink-0 text-gray-500 dark:text-gray-400 mt-0.5">
        </i-lucide>
      </button>

      <ng-template #staticHeader>
        <header class="mb-2">
          <div class="flex items-start justify-between gap-2">
            <ng-container *ngTemplateOutlet="headerBody"></ng-container>
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
      </ng-template>

      <ng-template #headerBody>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 min-w-0">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">{{ title }}</h3>
            <span
              *ngIf="listCount !== null && listCount > 0"
              class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 text-[10px] font-bold tabular-nums shrink-0">
              {{ listCount }}
            </span>
          </div>
          <p *ngIf="description" [class]="descClass">
            {{ description }}
          </p>
        </div>
      </ng-template>

      <div *ngIf="!sectionCollapse || listExpanded" class="min-h-0" [class.mt-3]="sectionCollapse" [class.mt-2]="!sectionCollapse">
        <ng-content select="[configAdd]"></ng-content>
        <div *ngIf="!collapsibleList || listExpanded || sectionCollapse" [class.mt-2]="hasConfigAdd">
          <ng-content select="[configList]"></ng-content>
        </div>
      </div>
    </article>
  `,
})
export class ConfigSettingCardComponent {
  @Input() title = '';
  @Input() description = '';
  readonly descClass = CONFIG_SETTING_DESC_CLASS;
  @Input() listCount: number | null = null;
  /** Colapsa solo la lista interna (legacy). */
  @Input() collapsibleList = false;
  /** Colapsa toda la sección (título + contenido). Recomendado en listas de configuración. */
  @Input() sectionCollapse = false;
  @Input() listExpanded = false;
  @Input() hasConfigAdd = false;
  @Input() cardClass =
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 sm:p-4 flex flex-col min-w-0';

  @Output() listExpandedChange = new EventEmitter<boolean>();

  toggleList() {
    this.listExpanded = !this.listExpanded;
    this.listExpandedChange.emit(this.listExpanded);
  }
}
