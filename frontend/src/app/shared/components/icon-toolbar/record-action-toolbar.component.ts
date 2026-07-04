import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DuplicateActionButtonComponent } from '../duplicate-action-button/duplicate-action-button.component';
import { IconToolbarButtonComponent } from './icon-toolbar-button.component';
import { ActivityLogTriggerComponent } from '../activity-log-trigger/activity-log-trigger.component';
import type { ActivityModule } from '../../../core/services/activity.service';

@Component({
  selector: 'app-record-action-toolbar',
  standalone: true,
  host: { class: 'inline-flex shrink-0' },
  imports: [CommonModule, DuplicateActionButtonComponent, IconToolbarButtonComponent, ActivityLogTriggerComponent],
  template: `
    <div class="inline-flex items-center gap-2.5 sm:gap-3 flex-wrap">
      <app-activity-log-trigger
        *ngIf="activityModule && activityEntityId"
        [module]="activityModule"
        [entityId]="activityEntityId"
        [entityLabel]="activityEntityLabel">
      </app-activity-log-trigger>

      <app-duplicate-action-button
        *ngIf="showDuplicate"
        [label]="duplicateLabel"
        [disabled]="duplicateDisabled"
        variant="outline"
        (duplicateClick)="duplicateClick.emit($event)">
      </app-duplicate-action-button>

      <app-icon-toolbar-button
        *ngIf="showSave"
        icon="save"
        [label]="saveLabel"
        variant="primary"
        [loading]="saveLoading"
        [disabled]="saveDisabled"
        (clicked)="saveClick.emit($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showPrint"
        icon="printer"
        [label]="printLabel"
        variant="outline"
        [loading]="printLoading"
        [disabled]="printDisabled"
        (clicked)="printClick.emit($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showDelete"
        icon="trash-2"
        [label]="deleteLabel"
        variant="danger"
        [disabled]="deleteDisabled"
        (clicked)="deleteClick.emit($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showCollect"
        icon="wallet"
        [label]="collectLabel"
        variant="orange-outline"
        [disabled]="collectDisabled"
        (clicked)="collectClick.emit($event)">
      </app-icon-toolbar-button>

      <app-icon-toolbar-button
        *ngIf="showEdit"
        icon="pencil"
        [label]="editLabel"
        variant="primary"
        [disabled]="editDisabled"
        (clicked)="editClick.emit($event)">
      </app-icon-toolbar-button>

      <ng-content></ng-content>
    </div>
  `,
})
export class RecordActionToolbarComponent {
  @Input() activityModule: ActivityModule | null = null;
  @Input() activityEntityId: string | null = null;
  @Input() activityEntityLabel = '';

  @Input() showDuplicate = false;
  @Input() duplicateLabel = 'Duplicar';
  @Input() duplicateDisabled = false;

  @Input() showSave = false;
  @Input() saveLabel = 'Guardar';
  @Input() saveDisabled = false;
  @Input() saveLoading = false;
  /** @deprecated El éxito se muestra en el banner del formulario, no en el botón. */
  @Input() saveSuccess = false;

  @Input() showPrint = false;
  @Input() printLabel = 'Imprimir';
  @Input() printLoading = false;
  @Input() printDisabled = false;

  @Input() showDelete = false;
  @Input() deleteLabel = 'Eliminar';
  @Input() deleteDisabled = false;

  @Input() showCollect = false;
  @Input() collectLabel = 'Cobrar saldo';
  @Input() collectDisabled = false;

  @Input() showEdit = false;
  @Input() editLabel = 'Editar';
  @Input() editDisabled = false;

  @Output() duplicateClick = new EventEmitter<Event>();
  @Output() saveClick = new EventEmitter<Event>();
  @Output() printClick = new EventEmitter<Event>();
  @Output() deleteClick = new EventEmitter<Event>();
  @Output() collectClick = new EventEmitter<Event>();
  @Output() editClick = new EventEmitter<Event>();
}
