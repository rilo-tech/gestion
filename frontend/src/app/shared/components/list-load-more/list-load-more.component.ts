import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-list-load-more',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="hasMore" class="px-4 sm:px-6 pb-4">
      <button
        type="button"
        (click)="loadMoreClick.emit()"
        [disabled]="loading"
        class="w-full sm:w-auto rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60">
        {{ loading ? loadingLabel : label }}
      </button>
    </div>
  `,
})
export class ListLoadMoreComponent {
  @Input() hasMore = false;
  @Input() loading = false;
  @Input() label = 'Cargar más';
  @Input() loadingLabel = 'Cargando...';

  @Output() loadMoreClick = new EventEmitter<void>();
}
