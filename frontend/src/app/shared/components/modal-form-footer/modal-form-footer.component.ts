import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormFooterComponent } from '../form-shell/form-footer.component';

/** @deprecated Usar `app-form-footer` con `mode="modal"`. */
@Component({
  selector: 'app-modal-form-footer',
  standalone: true,
  imports: [FormFooterComponent],
  template: `
    <app-form-footer
      mode="modal"
      [saveLabel]="primaryLabel"
      [cancelLabel]="cancelLabel"
      [saving]="saving"
      [saveDisabled]="primaryDisabled"
      [footerClass]="footerClass"
      [saveButtonClass]="primaryButtonClass"
      (cancelClick)="cancelClick.emit()"
      (saveClick)="primaryClick.emit()">
    </app-form-footer>
  `,
})
export class ModalFormFooterComponent {
  @Input() cancelLabel = 'Cancelar';
  @Input() primaryLabel = 'Guardar';
  @Input() saving = false;
  @Input() primaryDisabled = false;
  @Input() primaryButtonClass = '';
  @Input() footerClass = 'mt-6 pt-2';
  @Output() cancelClick = new EventEmitter<void>();
  @Output() primaryClick = new EventEmitter<void>();
}
