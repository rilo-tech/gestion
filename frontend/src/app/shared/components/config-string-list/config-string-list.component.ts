import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ConfigEditableListComponent,
  type ConfigEditableListItem,
} from '../config-editable-list/config-editable-list.component';

/** @deprecated Usar app-config-editable-list directamente. */
@Component({
  selector: 'app-config-string-list',
  standalone: true,
  imports: [CommonModule, ConfigEditableListComponent],
  template: `
    <app-config-editable-list
      [items]="editableItems"
      [addPlaceholder]="placeholder"
      [emptyMessage]="emptyMessage"
      [disabled]="disabled"
      [inputName]="inputName"
      [showAdd]="showAdd"
      [showList]="showList"
      labelMode="text"
      (add)="addItem.emit($event)"
      (remove)="onRemove($event)">
    </app-config-editable-list>
  `,
})
export class ConfigStringListComponent {
  @Input() items: string[] = [];
  @Input() placeholder = 'Nueva opción';
  @Input() emptyMessage = 'Todavía no hay opciones cargadas.';
  @Input() disabled = false;
  @Input() inputName = 'configListDraft';
  @Input() showAdd = true;
  @Input() showList = true;

  @Output() addItem = new EventEmitter<string>();
  @Output() removeItem = new EventEmitter<string>();

  get editableItems(): ConfigEditableListItem[] {
    return this.items.map((item) => ({ id: item, label: item, removable: true }));
  }

  onRemove(id: string) {
    this.removeItem.emit(id);
  }
}
