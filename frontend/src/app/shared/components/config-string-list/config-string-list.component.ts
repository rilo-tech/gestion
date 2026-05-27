import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-config-string-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex flex-col sm:flex-row gap-1.5 mb-2">
      <input
        [(ngModel)]="draft"
        [name]="inputName"
        [placeholder]="placeholder"
        [disabled]="disabled"
        (keydown.enter)="submitAdd($event)"
        class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-gray-50 disabled:text-gray-400" />
      <button
        type="button"
        (click)="submitAdd()"
        [disabled]="disabled || !draft.trim()"
        class="shrink-0 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
        Agregar
      </button>
    </div>

    <ul class="space-y-1 max-h-40 overflow-y-auto">
      <li
        *ngFor="let item of items; trackBy: trackItem"
        class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-gray-100 bg-gray-50">
        <span class="text-sm text-gray-800 truncate min-w-0">{{ item }}</span>
        <button
          type="button"
          (click)="removeItem.emit(item)"
          [disabled]="disabled"
          class="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
          Quitar
        </button>
      </li>
      <li
        *ngIf="items.length === 0"
        class="text-xs text-gray-400 px-1 py-4 text-center border border-dashed border-gray-200 rounded-lg">
        {{ emptyMessage }}
      </li>
    </ul>
  `,
})
export class ConfigStringListComponent {
  @Input() items: string[] = [];
  @Input() placeholder = 'Nueva opción';
  @Input() emptyMessage = 'Todavía no hay opciones cargadas.';
  @Input() disabled = false;
  @Input() inputName = 'configListDraft';
  @Output() addItem = new EventEmitter<string>();
  @Output() removeItem = new EventEmitter<string>();

  draft = '';

  trackItem(_index: number, item: string): string {
    return item;
  }

  submitAdd(event?: Event) {
    event?.preventDefault();
    const value = this.draft.trim();
    if (!value || this.disabled) return;
    this.addItem.emit(value);
    this.draft = '';
  }
}
