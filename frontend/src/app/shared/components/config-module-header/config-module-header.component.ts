import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-config-module-header',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="flex items-start justify-between gap-4 mb-1">
      <div class="min-w-0 flex-1">
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">{{ title }}</h2>
        <p *ngIf="description" class="text-sm text-gray-500 dark:text-gray-400 mt-1 desc-lg-only leading-snug">
          {{ description }}
        </p>
      </div>
      <button
        *ngIf="showSave"
        type="button"
        (click)="saveClick.emit()"
        [disabled]="saveDisabled || saving"
        [title]="saveTitle"
        [attr.aria-label]="saveTitle"
        class="shrink-0 mt-0.5 p-1.5 rounded-lg text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <i-lucide
          [name]="saving ? 'loader-circle' : 'save'"
          class="w-5 h-5"
          [class.animate-spin]="saving">
        </i-lucide>
      </button>
    </div>
  `,
})
export class ConfigModuleHeaderComponent {
  @Input() title = '';
  @Input() description = '';
  @Input() showSave = true;
  @Input() saving = false;
  @Input() saveDisabled = false;
  @Input() saveTitle = 'Guardar configuración';

  @Output() saveClick = new EventEmitter<void>();
}
