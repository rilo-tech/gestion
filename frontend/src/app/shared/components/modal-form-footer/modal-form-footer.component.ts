import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
} from '../icon-action/icon-action.component';

@Component({
  selector: 'app-modal-form-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="form-actions flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-6 pt-2">
      <button type="button" (click)="cancelClick.emit()" [class]="formCancelClass">
        {{ cancelLabel }}
      </button>
      <button
        type="button"
        [disabled]="primaryDisabled || saving"
        [class]="primaryButtonClass || formSubmitClass"
        (click)="primaryClick.emit()">
        {{ saving ? 'Guardando...' : primaryLabel }}
      </button>
    </div>
  `,
})
export class ModalFormFooterComponent {
  @Input() cancelLabel = 'Cancelar';
  @Input() primaryLabel = 'Guardar';
  @Input() saving = false;
  @Input() primaryDisabled = false;
  /** Optional override (e.g. caja ingreso/egreso). */
  @Input() primaryButtonClass = '';
  @Output() cancelClick = new EventEmitter<void>();
  @Output() primaryClick = new EventEmitter<void>();

  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly formSubmitClass = FORM_SUBMIT_CLASS;
}
