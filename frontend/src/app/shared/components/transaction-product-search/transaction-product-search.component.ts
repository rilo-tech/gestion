import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { StockItem, StockService } from '../../../core/services/stock.service';
import { ListSearchFieldComponent } from '../list-search-field/list-search-field.component';

@Component({
  selector: 'app-transaction-product-search',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ListSearchFieldComponent],
  template: `
    <div class="relative">
      <app-list-search-field
        #searchField
        mode="picker"
        [query]="query"
        [name]="inputName"
        [placeholder]="placeholder"
        [disabled]="disabled"
        (queryChange)="onSearchQueryChange($event)"
        (focused)="onFocus()"
        (blurred)="onBlur()"
        (keydown)="onKeydown($event)">
      </app-list-search-field>
      <div
        #searchMenu
        *ngIf="menuOpen && query.trim().length >= minChars"
        class="product-search-menu absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg divide-y divide-gray-100"
        (mousedown)="onMenuPointerDown($event)">
        <p *ngIf="searching" class="px-2.5 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm text-gray-400 text-center">Buscando...</p>
        <div
          *ngFor="let item of results; let i = index"
          class="product-search-option flex items-center justify-between gap-2 sm:gap-3 px-2.5 py-1.5 sm:px-3 sm:py-2 transition-colors"
          [class.product-search-option--added]="isAdded(item.id)"
          [class.product-search-option--active]="activeIndex === i && !isAdded(item.id)"
          [class.product-search-option--interactive]="!isAdded(item.id) && selectOnRowClick"
          [class.hover:bg-teal-50]="!isAdded(item.id) && selectOnRowClick"
          [class.cursor-pointer]="!isAdded(item.id) && selectOnRowClick"
          [attr.data-product-search-active]="activeIndex === i ? 'true' : null"
          (pointerdown)="onRowPointerDown(item, $event)">
          <div class="min-w-0 flex-1">
            <p class="text-xs sm:text-sm font-medium text-gray-900 truncate">{{ item.nombre }}</p>
            <p class="text-[10px] sm:text-xs text-gray-500">
              <ng-container *ngIf="itemMeta; else defaultMeta">
                {{ itemMeta(item) }}
                <span *ngIf="isAdded(item.id)" class="text-teal-600 font-medium"> · {{ addedLabel }}</span>
              </ng-container>
              <ng-template #defaultMeta>
                <ng-container *ngIf="showBaseCost">Costo base: {{ '$' + (item.costo || 0) }}</ng-container>
                <span *ngIf="showBaseCost && isAdded(item.id)" class="text-teal-600 font-medium">
                  · {{ addedLabel }}
                </span>
                <span *ngIf="!showBaseCost && isAdded(item.id)" class="text-teal-600 font-medium">
                  {{ addedLabel }}
                </span>
              </ng-template>
            </p>
          </div>
          <button
            *ngIf="showAddButton"
            type="button"
            (pointerdown)="onAddPointerDown(item, $event)"
            [disabled]="isAdded(item.id)"
            [title]="isAdded(item.id) ? 'Ya está en la lista' : 'Agregar'"
            [attr.aria-label]="isAdded(item.id) ? 'Ya está en la lista' : 'Agregar ' + item.nombre"
            class="product-search-add-btn shrink-0 inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg border transition-colors"
            [class.product-search-add-btn--added]="isAdded(item.id)">
            <i-lucide [name]="isAdded(item.id) ? 'check' : 'plus'" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i-lucide>
          </button>
          <span
            *ngIf="isAdded(item.id) && !showAddButton"
            class="shrink-0 inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gray-100 text-gray-400"
            aria-hidden="true">
            <i-lucide name="check" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i-lucide>
          </span>
        </div>
        <p
          *ngIf="!searching && results.length === 0"
          class="px-2.5 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm text-gray-400 text-center">
          No se encontraron productos.
        </p>
      </div>
    </div>
  `,
})
export class TransactionProductSearchComponent implements OnChanges, OnDestroy, OnInit {
  private stockService = inject(StockService);

  @ViewChild('searchField') searchField?: ListSearchFieldComponent;
  @ViewChild('searchMenu') searchMenu?: ElementRef<HTMLDivElement>;

  @Input() placeholder = 'Buscar producto por nombre...';
  @Input() inputName = 'transactionProductSearch';
  @Input() minChars = 2;
  @Input() debounceMs = 300;
  @Input() disabled = false;
  @Input() addedProductIds: string[] = [];
  @Input() addedLabel = 'En la lista';
  @Input() showAddButton = false;
  @Input() showBaseCost = true;
  @Input() selectOnRowClick = true;
  @Input() itemMeta?: (item: StockItem) => string | null;

  @Output() productSelected = new EventEmitter<StockItem>();
  @Output() focused = new EventEmitter<void>();

  query = '';
  results: StockItem[] = [];
  searching = false;
  menuOpen = false;
  activeIndex = -1;

  private suppressBlur = false;
  private blurTimeout?: ReturnType<typeof setTimeout>;
  private searchTimeout?: ReturnType<typeof setTimeout>;
  private addedProductIdSet = new Set<string>();
  private addedProductIdsKey = '';

  ngOnChanges(changes: SimpleChanges) {
    if (changes['addedProductIds']) {
      this.syncAddedProductIds();
    }
  }

  ngOnInit() {
    this.syncAddedProductIds();
  }

  ngOnDestroy() {
    window.clearTimeout(this.searchTimeout);
    window.clearTimeout(this.blurTimeout);
  }

  isAdded(productId?: string): boolean {
    if (!productId) return false;
    return this.addedProductIdSet.has(productId);
  }

  private syncAddedProductIds() {
    const key = this.addedProductIds.join('\u0001');
    if (key === this.addedProductIdsKey) return;
    this.addedProductIdsKey = key;
    this.addedProductIdSet = new Set(this.addedProductIds);
  }

  onMenuPointerDown(event: Event) {
    event.preventDefault();
    this.suppressBlur = true;
  }

  onFocus() {
    this.menuOpen = true;
    this.focused.emit();
  }

  onSearchQueryChange(value: string) {
    this.query = value;
    this.onQueryChange();
  }

  onQueryChange() {
    this.activeIndex = -1;
    window.clearTimeout(this.searchTimeout);

    const trimmed = this.query.trim();
    if (trimmed.length < this.minChars) {
      this.results = [];
      this.searching = false;
      return;
    }

    this.searching = true;
    this.searchTimeout = window.setTimeout(() => {
      this.stockService.searchStock(trimmed).subscribe({
        next: (items) => {
          this.results = items;
          this.searching = false;
          this.activeIndex = items.length > 0 ? 0 : -1;
        },
        error: () => {
          this.results = [];
          this.searching = false;
          this.activeIndex = -1;
        },
      });
    }, this.debounceMs);
  }

  onBlur() {
    window.clearTimeout(this.blurTimeout);
    this.blurTimeout = window.setTimeout(() => {
      if (this.suppressBlur) {
        this.suppressBlur = false;
        return;
      }
      this.menuOpen = false;
      this.activeIndex = -1;
    }, 150);
  }

  onKeydown(event: KeyboardEvent) {
    if (!this.menuOpen || this.query.trim().length < this.minChars) return;

    switch (event.key) {
      case 'ArrowDown':
        if (!this.results.length || this.searching) return;
        event.preventDefault();
        this.activeIndex = Math.min(
          this.activeIndex < 0 ? 0 : this.activeIndex + 1,
          this.results.length - 1
        );
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        if (!this.results.length || this.searching) return;
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex < 0 ? 0 : this.activeIndex - 1, 0);
        this.scrollActiveIntoView();
        break;
      case 'Enter':
        if (this.searching) return;
        event.preventDefault();
        if (this.activeIndex >= 0 && this.activeIndex < this.results.length) {
          this.selectProduct(this.results[this.activeIndex]);
        } else if (this.results.length === 1) {
          this.selectProduct(this.results[0]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.menuOpen = false;
        this.activeIndex = -1;
        break;
    }
  }

  onAddPointerDown(item: StockItem, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.selectProduct(item);
  }

  onRowPointerDown(item: StockItem, event: Event) {
    if (!this.selectOnRowClick || this.isAdded(item.id)) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectProduct(item);
  }

  selectProduct(item: StockItem) {
    if (!item.id || this.isAdded(item.id) || this.disabled) {
      this.prepareNextSearch();
      return;
    }
    this.suppressBlur = true;
    this.productSelected.emit(item);
    this.prepareNextSearch();
  }

  prepareNextSearch() {
    this.suppressBlur = true;
    this.query = '';
    this.results = [];
    this.activeIndex = -1;
    this.searching = false;
    this.menuOpen = false;
    window.clearTimeout(this.searchTimeout);
    window.clearTimeout(this.blurTimeout);
    window.setTimeout(() => {
      this.suppressBlur = false;
      this.searchField?.focus();
    }, 0);
  }

  reset() {
    this.query = '';
    this.results = [];
    this.menuOpen = false;
    this.activeIndex = -1;
    this.searching = false;
    window.clearTimeout(this.searchTimeout);
  }

  focus() {
    this.searchField?.focus();
  }

  private scrollActiveIntoView() {
    window.setTimeout(() => {
      const menu = this.searchMenu?.nativeElement;
      if (!menu) return;
      const active = menu.querySelector('[data-product-search-active="true"]') as HTMLElement | null;
      active?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }
}
