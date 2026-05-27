import {
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
          type="text"
          [ngModel]="searchText"
          (ngModelChange)="onSearchModelChange($event)"
          [ngModelOptions]="{ standalone: true }"
          (focus)="onInputFocus($event)"
          (blur)="onInputBlur()"
          (keydown)="onInputKeydown($event)"
          [disabled]="disabled"
          [placeholder]="placeholder"
          [class]="embedded
            ? 'w-full min-w-[9rem] border-0 bg-transparent px-1 py-1 text-sm text-gray-900 outline-none focus:ring-0 disabled:text-gray-400'
            : 'form-control searchable-select-input w-full text-gray-900 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50'">

        <div
          *ngIf="open && (dropdownItems.length || showCreateOption)"
          class="searchable-select-menu absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg">
          <button
            type="button"
            *ngFor="let option of dropdownItems"
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
          *ngIf="open && !dropdownItems.length && !showCreateOption"
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

  @Input() options: string[] = [];
  @Input() labeledOptions?: SearchableSelectOption[];
  @Input() placeholder = 'Buscar...';
  @Input() plainPlaceholder = '';
  @Input() plainHint = '';
  @Input() listHint = '';
  @Input() emptyMessage = 'Sin coincidencias';
  @Input() emptyOptionsMessage = 'No hay opciones disponibles';
  @Input() creatable = false;
  @Input() createLabelPrefix = 'Crear';
  @Input() embedded = false;

  @Output() createRequested = new EventEmitter<string>();
  @Output() searchChange = new EventEmitter<string>();

  value = '';
  searchText = '';
  open = false;
  disabled = false;
  private filterQueryActive = false;

  private suppressBlurCommit = false;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

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

  get dropdownItems(): SearchableSelectOption[] {
    const query = this.filterQueryActive ? this.searchText.trim().toLowerCase() : '';
    const source = this.useEntityMode ? (this.labeledOptions ?? []) : this.toLabeledOptions(this.options);

    const filtered = query
      ? source.filter((option) => option.label.toLowerCase().includes(query))
      : source;

    return filtered.slice(0, 20);
  }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['labeledOptions'] || changes['options']) && this.value) {
      this.syncDisplayTextFromValue();
    }
  }

  writeValue(value: string | null): void {
    this.value = value ?? '';
    this.syncDisplayTextFromValue();
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

  openDropdown() {
    this.open = true;
    this.onTouched();
  }

  onInputFocus(event: FocusEvent) {
    this.filterQueryActive = false;
    this.openDropdown();
    this.selectInputText(event.target as HTMLInputElement);
  }

  onPlainFocus(event: FocusEvent) {
    this.selectInputText(event.target as HTMLInputElement);
  }

  private selectInputText(input: HTMLInputElement | null) {
    if (!input || input.disabled || input.readOnly) return;
    setTimeout(() => input.select(), 0);
  }

  onSearchModelChange(nextValue: string) {
    this.searchText = nextValue;
    this.filterQueryActive = true;
    this.searchChange.emit(this.searchText);
    this.open = true;
  }

  onInputBlur() {
    window.setTimeout(() => {
      if (this.suppressBlurCommit || this.open) return;
      this.commitSearchOrRevert();
      this.onTouched();
    }, 150);
  }

  onInputKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    const exact = this.findExactOption(this.searchText);
    if (exact) {
      this.selectOption(exact);
      return;
    }
    if (this.creatable && this.searchText.trim()) {
      this.emitCreateFromSearch();
      return;
    }
    if (this.dropdownItems.length === 1) {
      this.selectOption(this.dropdownItems[0]);
    }
  }

  pickOption(option: SearchableSelectOption, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.selectOption(option);
  }

  selectOption(option: SearchableSelectOption) {
    this.suppressBlurCommit = true;
    this.value = option.value;
    this.searchText = option.label;
    this.filterQueryActive = false;
    this.open = false;
    this.onChange(option.value);
    this.onTouched();
    window.setTimeout(() => {
      this.suppressBlurCommit = false;
    }, 200);
  }

  createFromSearch(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.emitCreateFromSearch();
  }

  private emitCreateFromSearch() {
    const query = this.searchText.trim();
    if (!query) return;
    this.open = false;
    this.createRequested.emit(query);
    this.onTouched();
  }

  private findExactOption(text: string): SearchableSelectOption | undefined {
    const query = text.trim().toLowerCase();
    if (!query) return undefined;

    const source = this.useEntityMode ? (this.labeledOptions ?? []) : this.toLabeledOptions(this.options);
    return source.find(
      (option) =>
        option.value.toLowerCase() === query || option.label.toLowerCase() === query
    );
  }

  private commitSearchOrRevert() {
    const exact = this.findExactOption(this.searchText);
    if (exact) {
      this.selectOption(exact);
      return;
    }

    this.syncDisplayTextFromValue();
  }

  private syncDisplayTextFromValue() {
    if (!this.value) {
      return;
    }

    const next = this.getDisplayTextForValue();
    if (next) {
      this.searchText = next;
    }
  }

  private getDisplayTextForValue(): string {
    if (!this.value) return '';

    if (this.useEntityMode) {
      return (this.labeledOptions ?? []).find((option) => option.value === this.value)?.label ?? '';
    }

    return this.value;
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
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      if (this.open) {
        this.open = false;
        this.commitSearchOrRevert();
      }
    }
  }
}
