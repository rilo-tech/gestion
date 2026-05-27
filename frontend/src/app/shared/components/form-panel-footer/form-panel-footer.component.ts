import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
} from '../icon-action/icon-action.component';

@Component({
  selector: 'app-form-panel-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="form-actions flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
      <button
        *ngIf="deleteLabel"
        type="button"
        (click)="deleteClick.emit()"
        class="text-sm font-medium text-red-600 hover:text-red-700 min-h-[44px] sm:min-h-0">
        {{ deleteLabel }}
      </button>
      <div class="flex justify-end gap-3 sm:ml-auto">
        <button type="button" (click)="cancelClick.emit()" [class]="formCancelClass">
          {{ cancelLabel }}
        </button>
        <button
          *ngIf="showSave"
          type="submit"
          [disabled]="saving || saveDisabled"
          [class]="formSubmitClass">
          {{ saving ? 'Guardando...' : saveLabel }}
        </button>
      </div>
    </div>
  `,
})
export class FormPanelFooterComponent {
  @Input() saveLabel = 'Guardar';
  @Input() cancelLabel = 'Cancelar';
  @Input() deleteLabel = '';
  @Input() saving = false;
  @Input() saveDisabled = false;
  @Input() showSave = true;
  @Output() cancelClick = new EventEmitter<void>();
  @Output() deleteClick = new EventEmitter<void>();

  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly formSubmitClass = FORM_SUBMIT_CLASS;
}
