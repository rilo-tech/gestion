import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CONFIG_EDITABLE_LIST_ADD_BUTTON_CLASS,
  CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS,
  CONFIG_EDITABLE_LIST_BADGE_CLASS,
  CONFIG_EDITABLE_LIST_EMPTY_CLASS,
  CONFIG_EDITABLE_LIST_FOOTER_CLASS,
  CONFIG_EDITABLE_LIST_HINT_CLASS,
  CONFIG_EDITABLE_LIST_INDEX_CLASS,
  CONFIG_EDITABLE_LIST_ITEM_COMPACT_CLASS,
  CONFIG_EDITABLE_LIST_ITEM_COMPACT_INPUT_CLASS,
  CONFIG_EDITABLE_LIST_ITEM_EXTENDED_CLASS,
  CONFIG_EDITABLE_LIST_LABEL_EMPHASIS_CLASS,
  CONFIG_EDITABLE_LIST_LABEL_TEXT_CLASS,
  CONFIG_EDITABLE_LIST_ROW_BODY_CLASS,
  CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS,
  CONFIG_EDITABLE_LIST_ROW_FIELD_CLASS,
  CONFIG_EDITABLE_LIST_ROW_INPUT_CLASS,
  CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS,
  CONFIG_EDITABLE_LIST_SELECT_CLASS,
  CONFIG_EDITABLE_LIST_SELECT_ROW_CLASS,
} from './config-editable-list.constants';
import { ConfigListRemoveButtonComponent } from './config-list-remove-button.component';

export interface ConfigEditableListSelectOption {
  value: string;
  label: string;
}

export interface ConfigEditableListItem {
  id: string;
  label: string;
  removable?: boolean;
  hint?: string;
  badge?: string;
  /** Select secundario bajo el nombre (ej. ámbito de tarjeta). */
  selectValue?: string;
  selectOptions?: ConfigEditableListSelectOption[];
  selectLabel?: string;
  /** Tercer select opcional (ej. medio de pago de la cuenta). */
  select2Value?: string;
  select2Options?: ConfigEditableListSelectOption[];
  select2Label?: string;
}

@Component({
  selector: 'app-config-editable-list',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfigListRemoveButtonComponent],
  template: `
    <div class="space-y-2">
      <ng-content select="[configListAdd]"></ng-content>

      <div *ngIf="showAdd && !useCustomAdd" class="flex flex-col sm:flex-row gap-1.5">
        <input
          [(ngModel)]="draft"
          [name]="inputName"
          [placeholder]="addPlaceholder"
          [disabled]="disabled"
          (keydown.enter)="submitAdd($event)"
          [class]="addInputClass + ' flex-1'" />
        <button
          type="button"
          (click)="submitAdd()"
          [disabled]="disabled || !draft.trim()"
          [class]="addButtonClass">
          Agregar
        </button>
      </div>

      <ul
        *ngIf="showList"
        class="space-y-1 m-0 p-0 list-none"
        [class.overflow-y-auto]="!!listMaxHeightClass"
        [ngClass]="listMaxHeightClass">
        <li
          *ngFor="let item of items; let i = index; trackBy: trackItem"
          [class]="rowClass(item)">
          <!-- Fila compacta: una línea -->
          <ng-container *ngIf="!isExtendedItem(item); else extendedRow">
            <span
              *ngIf="showIndex"
              [class]="indexClass"
              aria-hidden="true">
              {{ i + 1 }}
            </span>
            <ng-container *ngIf="labelMode === 'input'; else compactLabelText">
              <input
                [ngModel]="item.label"
                (ngModelChange)="onLabelChange(item, $event)"
                (blur)="onLabelBlur(item)"
                [name]="inputNamePrefix + '_' + item.id"
                [disabled]="disabled"
                [class]="addInputClass + ' flex-1 min-w-0 font-medium'" />
            </ng-container>
            <ng-template #compactLabelText>
              <span [class]="(labelEmphasis ? labelEmphasisClass : labelTextClass) + ' flex-1 min-w-0'">
                {{ item.label }}
              </span>
            </ng-template>
            <app-config-list-remove-button
              *ngIf="item.removable !== false"
              position="inline"
              [compact]="labelMode === 'input'"
              [disabled]="disabled || (!!busyRemoveId && busyRemoveId !== item.id)"
              [loading]="busyRemoveId === item.id"
              (clicked)="remove.emit(item.id)">
            </app-config-list-remove-button>
          </ng-container>

          <!-- Fila extendida: badge/índice + campo + selects -->
          <ng-template #extendedRow>
            <div [class]="rowShellClass">
              <span
                *ngIf="showIndex"
                [class]="indexClass"
                aria-hidden="true">
                {{ i + 1 }}
              </span>
              <div [class]="rowBodyClass">
                <span *ngIf="item.badge" [class]="rowChipsClass">
                  <span [class]="badgeClass">{{ item.badge }}</span>
                </span>
                <div [class]="rowFieldClass">
                  <ng-container *ngIf="labelMode === 'input'; else extendedLabelText">
                    <input
                      [ngModel]="item.label"
                      (ngModelChange)="onLabelChange(item, $event)"
                      (blur)="onLabelBlur(item)"
                      [name]="inputNamePrefix + '_' + item.id"
                      [disabled]="disabled"
                      [class]="rowInputClass" />
                  </ng-container>
                  <ng-template #extendedLabelText>
                    <span [class]="labelEmphasis ? labelEmphasisClass : labelTextClass">
                      {{ item.label }}
                    </span>
                  </ng-template>
                  <p *ngIf="item.hint" [class]="hintClass">{{ item.hint }}</p>
                </div>
              </div>
              <app-config-list-remove-button
                *ngIf="item.removable !== false"
                position="inline"
                [disabled]="disabled || (!!busyRemoveId && busyRemoveId !== item.id)"
                [loading]="busyRemoveId === item.id"
                (clicked)="remove.emit(item.id)">
              </app-config-list-remove-button>
            </div>

            <div *ngIf="item.selectOptions?.length" [class]="selectRowClass">
              <label
                *ngIf="item.selectLabel"
                class="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                {{ item.selectLabel }}
              </label>
              <select
                [ngModel]="item.selectValue"
                (ngModelChange)="onSelectChange(item, $event)"
                [name]="inputNamePrefix + '_sel_' + item.id"
                [disabled]="disabled"
                [class]="selectClass">
                <option *ngFor="let opt of item.selectOptions" [ngValue]="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div *ngIf="item.select2Options?.length" [class]="selectRowClass">
              <label
                *ngIf="item.select2Label"
                class="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                {{ item.select2Label }}
              </label>
              <select
                [ngModel]="item.select2Value"
                (ngModelChange)="onSelect2Change(item, $event)"
                [name]="inputNamePrefix + '_sel2_' + item.id"
                [disabled]="disabled"
                [class]="selectClass">
                <option *ngFor="let opt of item.select2Options" [ngValue]="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </ng-template>
        </li>

        <li *ngIf="items.length === 0" [class]="emptyClass">
          {{ emptyMessage }}
        </li>
      </ul>

      <p *ngIf="footer" [class]="footerClass">{{ footer }}</p>
    </div>
  `,
})
export class ConfigEditableListComponent {
  @Input() items: ConfigEditableListItem[] = [];
  /** text = solo lectura en fila; input = campo editable. */
  @Input() labelMode: 'text' | 'input' = 'text';
  @Input() labelEmphasis = false;
  @Input() showIndex = false;
  @Input() showAdd = true;
  @Input() showList = true;
  @Input() addPlaceholder = 'Nueva opción';
  @Input() emptyMessage = 'Todavía no hay opciones cargadas.';
  @Input() footer: string | null = null;
  @Input() disabled = false;
  /** ID del ítem cuya eliminación se está comprobando o guardando. */
  @Input() busyRemoveId: string | null = null;
  @Input() inputName = 'configListDraft';
  @Input() inputNamePrefix = 'configList';
  @Input() listMaxHeightClass = '';
  /** Si hay contenido proyectado en [configListAdd], el padre debe poner useCustomAdd en true. */
  @Input() useCustomAdd = false;

  @Output() add = new EventEmitter<string>();
  @Output() remove = new EventEmitter<string>();
  @Output() labelChange = new EventEmitter<{ id: string; label: string }>();
  @Output() labelBlur = new EventEmitter<{ id: string; label: string }>();
  @Output() selectChange = new EventEmitter<{ id: string; value: string }>();
  @Output() select2Change = new EventEmitter<{ id: string; value: string }>();

  readonly addInputClass = CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS;
  readonly addButtonClass = CONFIG_EDITABLE_LIST_ADD_BUTTON_CLASS;
  readonly itemCompactClass = CONFIG_EDITABLE_LIST_ITEM_COMPACT_CLASS;
  readonly itemCompactInputClass = CONFIG_EDITABLE_LIST_ITEM_COMPACT_INPUT_CLASS;
  readonly itemExtendedClass = CONFIG_EDITABLE_LIST_ITEM_EXTENDED_CLASS;
  readonly rowInputClass = CONFIG_EDITABLE_LIST_ROW_INPUT_CLASS;
  readonly indexClass = CONFIG_EDITABLE_LIST_INDEX_CLASS;
  readonly rowShellClass = CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS;
  readonly rowBodyClass = CONFIG_EDITABLE_LIST_ROW_BODY_CLASS;
  readonly rowChipsClass = CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS;
  readonly rowFieldClass = CONFIG_EDITABLE_LIST_ROW_FIELD_CLASS;
  readonly emptyClass = CONFIG_EDITABLE_LIST_EMPTY_CLASS;
  readonly hintClass = CONFIG_EDITABLE_LIST_HINT_CLASS;
  readonly footerClass = CONFIG_EDITABLE_LIST_FOOTER_CLASS;
  readonly badgeClass = CONFIG_EDITABLE_LIST_BADGE_CLASS;
  readonly labelTextClass = CONFIG_EDITABLE_LIST_LABEL_TEXT_CLASS;
  readonly labelEmphasisClass = CONFIG_EDITABLE_LIST_LABEL_EMPHASIS_CLASS;
  readonly selectRowClass = CONFIG_EDITABLE_LIST_SELECT_ROW_CLASS;
  readonly selectClass = CONFIG_EDITABLE_LIST_SELECT_CLASS;

  draft = '';

  isExtendedItem(item: ConfigEditableListItem): boolean {
    return (
      this.showIndex ||
      !!item.badge ||
      !!item.hint ||
      !!(item.selectOptions?.length) ||
      !!(item.select2Options?.length)
    );
  }

  rowClass(item: ConfigEditableListItem): string {
    if (this.isExtendedItem(item)) return this.itemExtendedClass;
    if (this.labelMode === 'input') return this.itemCompactInputClass;
    return this.itemCompactClass;
  }

  trackItem(_index: number, item: ConfigEditableListItem): string {
    return item.id;
  }

  submitAdd(event?: Event) {
    event?.preventDefault();
    const value = this.draft.trim();
    if (!value || this.disabled) return;
    this.add.emit(value);
    this.draft = '';
  }

  onLabelChange(item: ConfigEditableListItem, label: string) {
    this.labelChange.emit({ id: item.id, label });
  }

  onLabelBlur(item: ConfigEditableListItem) {
    this.labelBlur.emit({ id: item.id, label: item.label.trim() });
  }

  onSelectChange(item: ConfigEditableListItem, value: string) {
    if (value === item.selectValue) return;
    this.selectChange.emit({ id: item.id, value });
  }

  onSelect2Change(item: ConfigEditableListItem, value: string) {
    if (value === item.select2Value) return;
    this.select2Change.emit({ id: item.id, value });
  }
}
