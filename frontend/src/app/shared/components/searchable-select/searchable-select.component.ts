import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  forwardRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SearchableSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div [ngClass]="embedded ? 'min-w-[9rem] flex-1' : ''" *ngIf="hasConfiguredOptions; else plainInput">
      <div class="relative">
        <input
          #searchInput
          type="text"
          [value]="searchText"
          (input)="onSearchInput($event)"
          (focus)="onInputFocus($event)"
          (blur)="onInputBlur()"
          (keydown)="onInputKeydown($event)"
          [disabled]="disabled"
          [placeholder]="placeholder"
          [class]="embedded
            ? 'w-full min-w-[9rem] border-0 bg-transparent px-1 py-1 text-sm text-gray-900 outline-none focus:ring-0 disabled:text-gray-400'
            : 'form-control searchable-select-input w-full text-gray-900 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50'">

        <div
          *ngIf="open && (visibleDropdownItems.length || showCreateOption)"
          class="searchable-select-menu absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg">
          <button
            type="button"
            *ngFor="let option of visibleDropdownItems; trackBy: trackByValue"
            (mousedown)="pickOption(option, $event)"
            class="searchable-select-option w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-teal-50">
            {{ option.label }}
          </button>
          <button
            type="button"
            *ngIf="showCreateOption"
            (mousedown)="createFromSearch($event)"
            class="searchable-select-option w-full border-t border-gray-100 px-4 py-2 text-left text-sm font-medium text-teal-700 hover:bg-teal-50">
            {{ createLabelPrefix }} «{{ searchText.trim() }}»
          </button>
        </div>

        <div
          *ngIf="open && !visibleDropdownItems.length && !showCreateOption"
          class="searchable-select-menu absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-500 shadow-lg">
          {{ emptyListMessage }}
        </div>
      </div>

      <p *ngIf="listHint" class="mt-1 text-xs text-gray-400">{{ listHint }}</p>
    </div>

    <ng-template #plainInput>
      <input
        type="text"
        [ngModel]="value"
        (ngModelChange)="onPlainChange($event)"
        [disabled]="disabled"
        [placeholder]="plainPlaceholder"
        (focus)="onPlainFocus($event)"
        class="form-control searchable-select-input w-full text-gray-900 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50">
      <p *ngIf="plainHint" class="mt-1 text-xs text-gray-400">{{ plainHint }}</p>
    </ng-template>
  `,
})
export class SearchableSelectComponent implements ControlValueAccessor, OnChanges {
  private elementRef = inject(ElementRef<HTMLElement>);
  private cdr = inject(ChangeDetectorRef);

  private static readonly BROWSE_LIMIT = 50;
  private static readonly FILTER_LIMIT = 100;

  @Input() options: string[] = [];
  @Input() labeledOptions?: SearchableSelectOption[];
  /** Etiqueta a mostrar si el valor aún no está en las opciones (p. ej. cliente del pedido). */
  @Input() fallbackLabel?: string;
  @Input() placeholder = 'Buscar...';
  @Input() plainPlaceholder = '';
  @Input() plainHint = '';
  @Input() listHint = '';
  @Input() emptyMessage = 'Sin coincidencias';
  @Input() emptyOptionsMessage = 'No hay opciones disponibles';
  @Input() creatable = false;
  /** En modo lista de strings: conserva texto libre al salir del campo si no hay coincidencia exacta. */
  @Input() allowCustomValue = false;
  @Input() createLabelPrefix = 'Crear';
  @Input() embedded = false;

  @Output() createRequested = new EventEmitter<string>();
  @Output() searchChange = new EventEmitter<string>();

  value = '';
  searchText = '';
  visibleDropdownItems: SearchableSelectOption[] = [];
  open = false;
  disabled = false;

  /** Al abrir el menú: lista completa hasta que el usuario escriba. */
  private browseAllOnOpen = false;
  private inputFocused = false;
  private suppressBlurCommit = false;
  private optionsSnapshot = '';
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  readonly trackByValue = (_index: number, option: SearchableSelectOption) => option.value;

  get useEntityMode(): boolean {
    return this.labeledOptions !== undefined;
  }

  get hasConfiguredOptions(): boolean {
    return this.useEntityMode || this.options.length > 0;
  }

  get emptyListMessage(): string {
    if (this.searchText.trim()) return this.emptyMessage;
    return this.emptyOptionsMessage;
  }

  get showCreateOption(): boolean {
    if (!this.creatable) return false;
    const query = this.searchText.trim();
    if (!query) return false;
    return !this.findExactOption(query);
  }

  ngOnChanges(changes: SimpleChanges) {
    const optionsChanged = changes['options'] || changes['labeledOptions'] || changes['fallbackLabel'];
    if (!optionsChanged) return;

    const nextKey = this.serializeOptionsKey();
    if (nextKey === this.optionsSnapshot && !changes['fallbackLabel']) return;

    this.optionsSnapshot = nextKey;
    this.refreshDropdownItems();
    if (!this.inputFocused) {
      this.syncDisplayTextFromValue();
    }
  }

  writeValue(value: string | null): void {
    const next = value ?? '';
    if (next === this.value && !this.inputFocused) {
      return;
    }
    this.value = next;
    if (!this.inputFocused) {
      this.syncDisplayTextFromValue();
      this.refreshDropdownItems();
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

  onInputFocus(event: FocusEvent) {
    this.inputFocused = true;
    this.browseAllOnOpen = true;
    this.syncDisplayTextFromValue();
    this.open = true;
    this.refreshDropdownItems();
    this.onTouched();

    const input = event.target as HTMLInputElement;
    queueMicrotask(() => {
      if (document.activeElement !== input) return;
      input.select();
    });
  }

  onPlainFocus(event: FocusEvent) {
    const input = event.target as HTMLInputElement;
    queueMicrotask(() => input.select());
  }

  onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.browseAllOnOpen = false;
    this.searchText = input.value;
    this.searchChange.emit(this.searchText);
    this.open = true;
    this.refreshDropdownItems();
    this.cdr.markForCheck();
  }

  onInputBlur() {
    window.setTimeout(() => {
      if (this.suppressBlurCommit) return;
      this.finishEditing(true);
    }, 150);
  }

  onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finishEditing(true);
      return;
    }

    if (event.key !== 'Enter') return;

    event.preventDefault();
    const exact = this.findExactOption(this.searchText);
    if (exact) {
      this.applySelection(exact);
      return;
    }
    if (this.creatable && this.searchText.trim()) {
      this.emitCreateFromSearch();
      return;
    }
    if (this.allowCustomValue && !this.useEntityMode && this.searchText.trim()) {
      this.commitCustomValue(this.searchText.trim());
      return;
    }
    const matches = this.filterOptions(this.searchText.trim());
    if (matches.length === 1) {
      this.applySelection(matches[0]);
    }
  }

  pickOption(option: SearchableSelectOption, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.applySelection(option);
  }

  createFromSearch(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.emitCreateFromSearch();
  }

  private applySelection(option: SearchableSelectOption) {
    this.suppressBlurCommit = true;
    this.value = option.value;
    this.searchText = option.label;
    this.browseAllOnOpen = false;
    this.open = false;
    this.inputFocused = false;
    this.refreshDropdownItems();
    this.onChange(option.value);
    this.onTouched();
    window.setTimeout(() => {
      this.suppressBlurCommit = false;
    }, 200);
  }

  private emitCreateFromSearch() {
    const query = this.searchText.trim();
    if (!query) return;
    this.open = false;
    this.inputFocused = false;
    this.browseAllOnOpen = false;
    this.createRequested.emit(query);
    this.onTouched();
  }

  private finishEditing(commit: boolean) {
    this.open = false;
    this.inputFocused = false;
    this.browseAllOnOpen = false;
    if (commit) {
      this.commitSearchOrRevert();
    } else {
      this.syncDisplayTextFromValue();
      this.refreshDropdownItems();
    }
    this.onTouched();
  }

  private refreshDropdownItems() {
    const typed = this.searchText.trim();
    const query = this.browseAllOnOpen && this.open ? '' : typed;
    const filtered = this.filterOptions(query);
    const limit = query ? SearchableSelectComponent.FILTER_LIMIT : SearchableSelectComponent.BROWSE_LIMIT;
    this.visibleDropdownItems = filtered.slice(0, limit);
  }

  private getSourceOptions(): SearchableSelectOption[] {
    return this.useEntityMode ? (this.labeledOptions ?? []) : this.toLabeledOptions(this.options);
  }

  private normalizeForSearch(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private filterOptions(query: string): SearchableSelectOption[] {
    const normalized = this.normalizeForSearch(query);
    const source = this.getSourceOptions();
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

    return this.getSourceOptions().find((option) => {
      const label = this.normalizeForSearch(option.label);
      const value = this.normalizeForSearch(option.value);
      return value === query || label === query;
    });
  }

  private commitSearchOrRevert() {
    const trimmed = this.searchText.trim();

    if (!trimmed) {
      if (this.value) {
        this.syncDisplayTextFromValue();
      } else {
        this.searchText = '';
        this.onChange('');
      }
      this.refreshDropdownItems();
      return;
    }

    const exact = this.findExactOption(trimmed);
    if (exact) {
      this.value = exact.value;
      this.searchText = exact.label;
      this.onChange(exact.value);
      this.refreshDropdownItems();
      return;
    }

    const matches = this.filterOptions(trimmed);
    if (matches.length === 1) {
      this.value = matches[0].value;
      this.searchText = matches[0].label;
      this.onChange(matches[0].value);
      this.refreshDropdownItems();
      return;
    }

    if (this.allowCustomValue && !this.useEntityMode && trimmed) {
      this.commitCustomValue(trimmed);
      return;
    }

    this.syncDisplayTextFromValue();
    this.refreshDropdownItems();
  }

  private commitCustomValue(text: string) {
    this.value = text;
    this.searchText = text;
    this.onChange(text);
    this.refreshDropdownItems();
  }

  private syncDisplayTextFromValue() {
    if (!this.value) {
      this.searchText = '';
      return;
    }
    this.searchText = this.getDisplayTextForValue();
  }

  private getDisplayTextForValue(): string {
    if (!this.value) return '';

    if (this.useEntityMode) {
      const label = (this.labeledOptions ?? []).find((option) => option.value === this.value)?.label;
      if (label) return label;
      const fallback = String(this.fallbackLabel ?? '').trim();
      if (fallback) return fallback;
      return '';
    }

    return this.value;
  }

  private serializeOptionsKey(): string {
    const source = this.useEntityMode
      ? (this.labeledOptions ?? []).map((option) => `${option.value}\u0001${option.label}`)
      : this.options;
    return JSON.stringify(source);
  }

  private toLabeledOptions(options: string[]): SearchableSelectOption[] {
    return options.map((option) => ({ value: option, label: option }));
  }

  onPlainChange(nextValue: string) {
    this.value = nextValue;
    this.onChange(nextValue);
    this.onTouched();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target as Node) && this.open) {
      this.finishEditing(true);
    }
  }
}
