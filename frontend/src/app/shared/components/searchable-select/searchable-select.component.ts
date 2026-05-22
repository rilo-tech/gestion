import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
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
    <div class="relative" *ngIf="hasConfiguredOptions; else plainInput">
      <input
        type="text"
        [value]="searchText"
        (input)="onSearchInput($event)"
        (focus)="openDropdown()"
        (blur)="onInputBlur()"
        (keydown)="onInputKeydown($event)"
        [disabled]="disabled"
        [placeholder]="placeholder"
        class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50">

      <p *ngIf="listHint" class="mt-1 text-xs text-gray-400">{{ listHint }}</p>

      <div
        *ngIf="open && dropdownItems.length"
        class="absolute z-30 mt-1 w-full max-h-48 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
        <button
          type="button"
          *ngFor="let option of dropdownItems"
          (mousedown)="selectOption(option); $event.preventDefault()"
          class="w-full text-left px-4 py-2 text-sm hover:bg-teal-50">
          {{ option.label }}
        </button>
      </div>

      <div
        *ngIf="open && !dropdownItems.length"
        class="absolute z-30 mt-1 w-full px-4 py-2 text-sm text-gray-400 bg-white border border-gray-200 rounded-lg shadow-lg">
        {{ emptyListMessage }}
      </div>
    </div>

    <ng-template #plainInput>
      <input
        type="text"
        [ngModel]="value"
        (ngModelChange)="onPlainChange($event)"
        [disabled]="disabled"
        [placeholder]="plainPlaceholder"
        class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50">
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

  value = '';
  searchText = '';
  open = false;
  disabled = false;

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

  get dropdownItems(): SearchableSelectOption[] {
    const query = this.searchText.trim().toLowerCase();
    const source = this.useEntityMode ? (this.labeledOptions ?? []) : this.toLabeledOptions(this.options);

    const filtered = query
      ? source.filter((option) => option.label.toLowerCase().includes(query))
      : source;

    return filtered.slice(0, 20);
  }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['labeledOptions'] || changes['options']) && this.value) {
      this.searchText = this.getDisplayTextForValue();
    }
  }

  writeValue(value: string | null): void {
    this.value = value ?? '';
    this.searchText = this.getDisplayTextForValue();
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

  onSearchInput(event: Event) {
    this.searchText = (event.target as HTMLInputElement).value;
    this.open = true;
  }

  onInputBlur() {
    window.setTimeout(() => {
      if (this.open) return;
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
    if (this.dropdownItems.length === 1) {
      this.selectOption(this.dropdownItems[0]);
    }
  }

  selectOption(option: SearchableSelectOption) {
    this.value = option.value;
    this.searchText = option.label;
    this.open = false;
    this.onChange(option.value);
    this.onTouched();
  }

  private findExactOption(text: string): SearchableSelectOption | undefined {
    const query = text.trim().toLowerCase();
    if (!query) return undefined;

    const source = this.useEntityMode ? (this.labeledOptions ?? []) : this.toLabeledOptions(this.options);
    return source.find((option) => option.label.toLowerCase() === query);
  }

  private commitSearchOrRevert() {
    const exact = this.findExactOption(this.searchText);
    if (exact) {
      this.value = exact.value;
      this.searchText = exact.label;
      this.onChange(exact.value);
      return;
    }

    this.searchText = this.getDisplayTextForValue();
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
