import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

export const DEFAULT_LIST_PAGE_SIZE = 20;

export function totalListPages(totalItems: number, pageSize: number): number {
  if (totalItems <= 0) return 1;
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function paginateSlice<T>(items: T[], page: number, pageSize: number): T[] {
  if (items.length === 0) return [];
  const totalPages = totalListPages(items.length, pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

@Component({
  selector: 'app-list-pagination',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      *ngIf="showPagination"
      class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 border-t border-gray-100 bg-gray-50 text-sm">
      <span class="text-gray-500 tabular-nums">{{ rangeLabel }}</span>
      <div class="flex items-center justify-end gap-1">
        <button
          type="button"
          (click)="goPrevious()"
          [disabled]="!canGoPrevious"
          class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Página anterior">
          <i-lucide name="chevron-left" class="w-4 h-4 shrink-0"></i-lucide>
        </button>
        <span class="min-w-[4.5rem] text-center text-gray-600 tabular-nums">{{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          (click)="goNext()"
          [disabled]="!canGoNext"
          class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          [attr.aria-label]="canFetchMore && page >= totalPages ? 'Cargar más' : 'Página siguiente'">
          <i-lucide
            *ngIf="!loadingMore"
            name="chevron-right"
            class="w-4 h-4 shrink-0"></i-lucide>
          <span
            *ngIf="loadingMore"
            class="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin"
            aria-hidden="true"></span>
        </button>
      </div>
    </div>
  `,
})
export class ListPaginationComponent {
  @Input() page = 1;
  @Input() pageSize = DEFAULT_LIST_PAGE_SIZE;
  @Input() totalItems = 0;
  /** Hay más datos en el servidor (cursor); la flecha derecha en la última página los trae. */
  @Input() canFetchMore = false;
  @Input() loadingMore = false;
  @Output() pageChange = new EventEmitter<number>();
  @Output() fetchMore = new EventEmitter<void>();

  get totalPages(): number {
    return totalListPages(this.totalItems, this.pageSize);
  }

  get showPagination(): boolean {
    return this.totalItems > this.pageSize || this.canFetchMore;
  }

  get canGoPrevious(): boolean {
    return this.page > 1 && !this.loadingMore;
  }

  get canGoNext(): boolean {
    if (this.loadingMore) return false;
    if (this.page < this.totalPages) return true;
    return this.canFetchMore;
  }

  get rangeLabel(): string {
    if (this.totalItems <= 0) return 'Sin resultados';
    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(this.page * this.pageSize, this.totalItems);
    const suffix = this.canFetchMore ? '+' : '';
    return `${start}–${end} de ${this.totalItems}${suffix}`;
  }

  goPrevious() {
    if (!this.canGoPrevious) return;
    this.pageChange.emit(this.page - 1);
  }

  goNext() {
    if (this.loadingMore) return;
    if (this.page < this.totalPages) {
      this.pageChange.emit(this.page + 1);
      return;
    }
    if (this.canFetchMore) {
      this.fetchMore.emit();
    }
  }
}
