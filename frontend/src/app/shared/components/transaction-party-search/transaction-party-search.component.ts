import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { ListSearchFieldComponent } from '../list-search-field/list-search-field.component';
import {
  SearchableSelectOption,
} from '../searchable-select/searchable-select.component';
import {
  FORM_PICKER_OVERLAY_HOST_CLASS,
  FORM_PICKER_OVERLAY_MENU_CLASS,
} from '../form-shell/form-field.constants';

@Component({
  selector: 'app-transaction-party-search',
  standalone: true,
  imports: [CommonModule, ListSearchFieldComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TransactionPartySearchComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="pickerHostClass">
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
        [class]="pickerMenuClass"
        (pointerdown)="onMenuPointerDown($event)"
        (pointermove)="onMenuPointerMove($event)"
        (pointerup)="onMenuPointerUp()"
        (pointercancel)="onMenuPointerUp()">
        <button
          type="button"
          *ngFor="let option of results; let i = index"
          class="product-search-option touch-manipulation flex w-full items-center justify-between gap-2 sm:gap-3 px-2.5 py-1.5 sm:px-3 sm:py-2 text-left transition-colors product-search-option--interactive hover:bg-teal-50 cursor-pointer"
          [class.product-search-option--active]="activeIndex === i"
          [attr.data-party-search-active]="activeIndex === i ? 'true' : null"
          (pointerdown)="onOptionPointerDown(option, $event)">
          <p class="min-w-0 flex-1 text-xs sm:text-sm font-medium text-gray-900 truncate">{{ option.label }}</p>
        </button>
        <button
          type="button"
          *ngIf="showCreateOption"
          class="product-search-option flex w-full items-center px-2.5 py-1.5 sm:px-3 sm:py-2 text-left text-xs sm:text-sm font-medium text-teal-700 hover:bg-teal-50"
          (pointerdown)="onCreatePointerDown($event)">
          {{ createLabelPrefix }} «{{ query.trim() }}»
        </button>
        <p
          *ngIf="!results.length && !showCreateOption"
          class="px-2.5 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm text-gray-400 text-center">
          {{ emptyListMessage }}
        </p>
      </div>

      <p *ngIf="listHint" class="mt-1 text-xs text-gray-400">{{ listHint }}</p>
    </div>
  `,
})
export class TransactionPartySearchComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  readonly pickerHostClass = FORM_PICKER_OVERLAY_HOST_CLASS;
  readonly pickerMenuClass = FORM_PICKER_OVERLAY_MENU_CLASS;

  @ViewChild('searchField') searchField?: ListSearchFieldComponent;
  @ViewChild('searchMenu') searchMenu?: ElementRef<HTMLDivElement>;

  @Input() placeholder = 'Buscar...';
  @Input() inputName = 'transactionPartySearch';
  @Input() minChars = 2;
  @Input() disabled = false;
  @Input() labeledOptions: SearchableSelectOption[] = [];
  @Input() fallbackLabel = '';
  @Input() creatable = false;
  @Input() createLabelPrefix = 'Crear';
  @Input() emptyMessage = 'Sin coincidencias';
  @Input() emptyOptionsMessage = 'No hay opciones disponibles';
  @Input() listHint = '';
  /** Al cambiar (p. ej. medio de pago), reinicia el menú y el texto si no está enfocado. */
  @Input() scopeKey = '';

  @Output() createRequested = new EventEmitter<string>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() partySelected = new EventEmitter<SearchableSelectOption>();

  value = '';
  query = '';
  results: SearchableSelectOption[] = [];
  menuOpen = false;
  activeIndex = -1;

  private static readonly FILTER_LIMIT = 100;

  private suppressBlur = false;
  private blurTimeout?: ReturnType<typeof setTimeout>;
  private inputFocused = false;
  private menuPointerStartY: number | null = null;
  private menuPointerMoved = false;
  private readonly menuScrollSlopPx = 8;
  private optionsSnapshot = '';
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnChanges(changes: SimpleChanges) {
    const scopeChanged = changes['scopeKey'] && !changes['scopeKey'].firstChange;
    if (changes['labeledOptions'] || changes['fallbackLabel'] || scopeChanged) {
      this.syncOptionsSnapshot();
      if (scopeChanged) {
        this.menuOpen = false;
        this.activeIndex = -1;
        this.menuPointerMoved = false;
        this.menuPointerStartY = null;
      }
      if (!this.inputFocused) {
        this.syncQueryFromValue();
      }
      if (this.menuOpen && this.query.trim().length >= this.minChars) {
        this.refreshResults();
      }
    }
  }

  ngOnDestroy() {
    window.clearTimeout(this.blurTimeout);
  }

  get showCreateOption(): boolean {
    if (!this.creatable || this.disabled) return false;
    const trimmed = this.query.trim();
    if (trimmed.length < this.minChars) return false;
    return !this.findExactOption(trimmed);
  }

  get emptyListMessage(): string {
    if (this.query.trim()) return this.emptyMessage;
    return this.emptyOptionsMessage;
  }

  writeValue(value: string | null): void {
    const next = value ?? '';
    if (next === this.value && !this.inputFocused) return;
    this.value = next;
    if (!this.inputFocused) {
      this.syncQueryFromValue();
      this.refreshResults();
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onFocus() {
    this.inputFocused = true;
    this.menuOpen = true;
    this.syncQueryFromValue();
    this.onTouched();
    queueMicrotask(() => {
      const input = this.searchField?.inputEl?.nativeElement;
      if (!input || document.activeElement !== input) return;
      input.select();
    });
  }

  onSearchQueryChange(value: string) {
    this.query = value;
    this.searchChange.emit(value);
    if (this.value) {
      const selected = (this.labeledOptions ?? []).find((option) => option.value === this.value);
      const selectedLabel = selected?.label?.trim() ?? '';
      if (selectedLabel && value.trim() !== selectedLabel) {
        this.value = '';
        this.onChange('');
      }
    }
    this.onQueryChange();
  }

  onQueryChange() {
    this.menuOpen = true;
    this.activeIndex = -1;
    const trimmed = this.query.trim();
    if (trimmed.length < this.minChars) {
      this.results = [];
      return;
    }
    this.refreshResults();
    this.activeIndex = this.results.length > 0 ? 0 : -1;
  }

  onBlur() {
    window.clearTimeout(this.blurTimeout);
    this.blurTimeout = window.setTimeout(() => {
      if (this.suppressBlur) return;
      if (this.searchField?.isFocused()) return;
      this.finishEditing(true);
    }, 250);
  }

  onKeydown(event: KeyboardEvent) {
    if (!this.menuOpen || this.query.trim().length < this.minChars) return;

    switch (event.key) {
      case 'ArrowDown': {
        const items = this.keyboardItems;
        if (!items.length) return;
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex < 0 ? 0 : this.activeIndex + 1, items.length - 1);
        this.scrollActiveIntoView();
        break;
      }
      case 'ArrowUp': {
        const items = this.keyboardItems;
        if (!items.length) return;
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex < 0 ? 0 : this.activeIndex - 1, 0);
        this.scrollActiveIntoView();
        break;
      }
      case 'Enter':
        event.preventDefault();
        this.commitKeyboardSelection();
        break;
      case 'Escape':
        event.preventDefault();
        this.menuOpen = false;
        this.activeIndex = -1;
        this.syncQueryFromValue();
        break;
    }
  }

  onOptionPointerDown(option: SearchableSelectOption, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.commitOptionSelection(option);
  }

  onCreatePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    if (this.menuPointerMoved) {
      this.menuPointerMoved = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.commitCreateRequest();
  }

  onMenuPointerDown(event: PointerEvent) {
    this.menuPointerStartY = event.clientY;
    this.menuPointerMoved = false;
    this.suppressBlur = true;
    window.clearTimeout(this.blurTimeout);
    if (event.pointerType === 'mouse') {
      event.preventDefault();
    }
  }

  onMenuPointerMove(event: PointerEvent) {
    if (this.menuPointerStartY === null) return;
    if (Math.abs(event.clientY - this.menuPointerStartY) > this.menuScrollSlopPx) {
      this.menuPointerMoved = true;
    }
  }

  onMenuPointerUp() {
    this.menuPointerStartY = null;
    window.setTimeout(() => {
      if (!this.searchField?.isFocused()) {
        this.suppressBlur = false;
      }
    }, 300);
  }

  private get keyboardItems(): Array<SearchableSelectOption | 'create'> {
    const items: Array<SearchableSelectOption | 'create'> = [...this.results];
    if (this.showCreateOption) items.push('create');
    return items;
  }

  private commitKeyboardSelection() {
    const items = this.keyboardItems;
    if (this.activeIndex >= 0 && this.activeIndex < items.length) {
      const item = items[this.activeIndex];
      if (item === 'create') {
        this.createRequested.emit(this.query.trim());
        this.menuOpen = false;
        this.inputFocused = false;
        this.onTouched();
        return;
      }
      this.applySelection(item);
      return;
    }
    if (this.results.length === 1) {
      this.applySelection(this.results[0]);
      return;
    }
    if (this.showCreateOption && this.query.trim()) {
      this.createRequested.emit(this.query.trim());
      this.menuOpen = false;
      this.inputFocused = false;
      this.onTouched();
    }
  }

  private commitOptionSelection(option: SearchableSelectOption) {
    window.clearTimeout(this.blurTimeout);
    this.applySelection(option);
  }

  private commitCreateRequest() {
    const trimmed = this.query.trim();
    if (!trimmed) return;
    window.clearTimeout(this.blurTimeout);
    this.suppressBlur = true;
    this.menuOpen = false;
    this.inputFocused = false;
    this.createRequested.emit(trimmed);
    this.onTouched();
    window.setTimeout(() => {
      this.suppressBlur = false;
    }, 300);
  }

  private applySelection(option: SearchableSelectOption) {
    this.suppressBlur = true;
    window.clearTimeout(this.blurTimeout);
    this.value = option.value;
    this.query = option.label;
    this.menuOpen = false;
    this.inputFocused = false;
    this.activeIndex = -1;
    this.menuPointerMoved = false;
    this.menuPointerStartY = null;
    this.refreshResults();
    this.onChange(option.value);
    this.partySelected.emit(option);
    this.onTouched();
    window.setTimeout(() => {
      this.suppressBlur = false;
    }, 300);
  }

  private finishEditing(commit: boolean) {
    this.menuOpen = false;
    this.inputFocused = false;
    this.activeIndex = -1;
    if (commit) {
      this.commitSearchOrRevert();
    } else {
      this.syncQueryFromValue();
      this.refreshResults();
    }
    this.onTouched();
  }

  private commitSearchOrRevert() {
    const trimmed = this.query.trim();
    const committedValue = String(this.value ?? '').trim();

    if (committedValue) {
      const option = (this.labeledOptions ?? []).find((item) => item.value === committedValue);
      const label = option?.label?.trim() ?? String(this.fallbackLabel ?? '').trim();
      if (label) {
        const queryNorm = this.normalizeForSearch(trimmed);
        const labelNorm = this.normalizeForSearch(label);
        if (!trimmed || queryNorm === labelNorm) {
          this.query = label;
          this.onChange(committedValue);
          this.refreshResults();
          return;
        }
      }
    }

    if (!trimmed) {
      if (this.value) {
        this.syncQueryFromValue();
      } else {
        this.query = '';
        this.onChange('');
      }
      this.refreshResults();
      return;
    }

    if (trimmed.length < this.minChars) {
      this.syncQueryFromValue();
      this.refreshResults();
      return;
    }

    const exact = this.findExactOption(trimmed);
    if (exact) {
      this.value = exact.value;
      this.query = exact.label;
      this.onChange(exact.value);
      this.refreshResults();
      return;
    }

    const matches = this.filterOptions(trimmed);
    if (matches.length === 1) {
      this.value = matches[0].value;
      this.query = matches[0].label;
      this.onChange(matches[0].value);
      this.refreshResults();
      return;
    }

    this.syncQueryFromValue();
    this.refreshResults();
  }

  private refreshResults() {
    const trimmed = this.query.trim();
    if (trimmed.length < this.minChars) {
      this.results = [];
      return;
    }
    this.results = this.filterOptions(trimmed).slice(0, TransactionPartySearchComponent.FILTER_LIMIT);
  }

  private filterOptions(query: string): SearchableSelectOption[] {
    const normalized = this.normalizeForSearch(query);
    const source = this.labeledOptions ?? [];
    if (!normalized) return source;

    const matches = source.filter((option) => {
      const label = this.normalizeForSearch(option.label);
      const value = this.normalizeForSearch(option.value);
      return label.includes(normalized) || value.includes(normalized);
    });

    return matches.sort((a, b) => {
      const aLabel = this.normalizeForSearch(a.label);
      const bLabel = this.normalizeForSearch(b.label);
      const aStarts = aLabel.startsWith(normalized) ? 0 : 1;
      const bStarts = bLabel.startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
    });
  }

  private findExactOption(text: string): SearchableSelectOption | undefined {
    const query = this.normalizeForSearch(text);
    if (!query) return undefined;
    return (this.labeledOptions ?? []).find((option) => {
      const label = this.normalizeForSearch(option.label);
      const value = this.normalizeForSearch(option.value);
      return value === query || label === query;
    });
  }

  private normalizeForSearch(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private syncQueryFromValue() {
    if (!this.value) {
      this.query = '';
      return;
    }
    const label = (this.labeledOptions ?? []).find((option) => option.value === this.value)?.label;
    if (label) {
      this.query = label;
      return;
    }
    const fallback = String(this.fallbackLabel ?? '').trim();
    this.query = fallback;
  }

  private syncOptionsSnapshot() {
    const key = (this.labeledOptions ?? [])
      .map((option) => `${option.value}\u0001${option.label}`)
      .join('\u0002');
    if (key === this.optionsSnapshot) return;
    this.optionsSnapshot = key;
  }

  private scrollActiveIntoView() {
    window.setTimeout(() => {
      const menu = this.searchMenu?.nativeElement;
      if (!menu) return;
      const active = menu.querySelector('[data-party-search-active="true"]') as HTMLElement | null;
      active?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }
}
