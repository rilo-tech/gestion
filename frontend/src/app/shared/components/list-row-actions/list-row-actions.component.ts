import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { IconToolbarButtonComponent } from '../icon-toolbar/icon-toolbar-button.component';

@Component({
  selector: 'app-list-row-actions',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, IconToolbarButtonComponent],
  template: `
    <div class="flex items-center justify-end gap-1">
      <ng-content select="[rowActionStart]"></ng-content>

      <app-icon-toolbar-button
        *ngIf="showDuplicate"
        icon="copy"
        [label]="duplicateLabel"
        variant="ghost-gray"
        size="row"
        [disabled]="duplicateDisabled"
        (clicked)="onDuplicate($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showEdit"
        [icon]="editIcon"
        [label]="editLabel"
        variant="ghost-teal"
        size="row"
        [disabled]="editDisabled"
        (clicked)="onEdit($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showPrint"
        icon="printer"
        [label]="printLabel"
        variant="ghost-gray"
        size="row"
        [loading]="printLoading"
        [disabled]="printDisabled"
        (clicked)="onPrint($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showDelete"
        icon="trash-2"
        [label]="deleteLabel"
        variant="ghost-red"
        size="row"
        [loading]="deleteLoading"
        [disabled]="deleteDisabled"
        (clicked)="onDelete($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showRegisterSale"
        icon="truck"
        [label]="registerSaleLabel"
        variant="ghost-teal"
        size="row"
        [disabled]="registerSaleDisabled"
        (clicked)="onRegisterSale($event)">
      </app-icon-toolbar-button>

      <ng-content></ng-content>
    </div>
  `,
})
export class ListRowActionsComponent {
  @Input() showEdit = true;
  @Input() showDelete = false;
  @Input() showDuplicate = false;
  @Input() showPrint = false;
  @Input() showRegisterSale = false;
  @Input() editLabel = 'Editar';
  @Input() editIcon = 'pencil';
  @Input() deleteLabel = 'Eliminar';
  @Input() duplicateLabel = 'Duplicar';
  @Input() printLabel = 'Imprimir';
  @Input() registerSaleLabel = 'Registrar venta / entrega';
  @Input() editDisabled = false;
  @Input() deleteDisabled = false;
  @Input() deleteLoading = false;
  @Input() duplicateDisabled = false;
  @Input() printDisabled = false;
  @Input() printLoading = false;
  @Input() registerSaleDisabled = false;

  @Output() editClick = new EventEmitter<Event>();
  @Output() deleteClick = new EventEmitter<Event>();
  @Output() duplicateClick = new EventEmitter<Event>();
  @Output() printClick = new EventEmitter<Event>();
  @Output() registerSaleClick = new EventEmitter<Event>();

  onEdit(event: Event) {
    event.stopPropagation();
    this.editClick.emit(event);
  }

  onDelete(event: Event) {
    event.stopPropagation();
    this.deleteClick.emit(event);
  }

  onDuplicate(event: Event) {
    event.stopPropagation();
    this.duplicateClick.emit(event);
  }

  onPrint(event: Event) {
    event.stopPropagation();
    this.printClick.emit(event);
  }

  onRegisterSale(event: Event) {
    event.stopPropagation();
    this.registerSaleClick.emit(event);
  }
}
