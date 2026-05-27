import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-list-row-actions',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="flex items-center justify-end gap-1">
      <ng-content select="[rowActionStart]"></ng-content>
      <button
        *ngIf="showEdit"
        type="button"
        (click)="onEdit($event)"
        [disabled]="editDisabled"
        [title]="editLabel"
        [attr.aria-label]="editLabel"
        class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-40 disabled:cursor-not-allowed">
        <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
      </button>
      <button
        *ngIf="showDelete"
        type="button"
        (click)="onDelete($event)"
        [disabled]="deleteDisabled"
        [title]="deleteLabel"
        [attr.aria-label]="deleteLabel"
        class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
        <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
      </button>
      <ng-content></ng-content>
    </div>
  `,
})
export class ListRowActionsComponent {
  @Input() showEdit = true;
  @Input() showDelete = false;
  @Input() editLabel = 'Editar';
  @Input() deleteLabel = 'Eliminar';
  @Input() editDisabled = false;
  @Input() deleteDisabled = false;
  @Output() editClick = new EventEmitter<Event>();
  @Output() deleteClick = new EventEmitter<Event>();

  onEdit(event: Event) {
    event.stopPropagation();
    this.editClick.emit(event);
  }

  onDelete(event: Event) {
    event.stopPropagation();
    this.deleteClick.emit(event);
  }
}
