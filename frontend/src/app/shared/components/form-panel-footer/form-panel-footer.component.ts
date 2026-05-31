import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormFooterComponent } from '../form-shell/form-footer.component';

/** @deprecated Usar `app-form-footer` con `mode="inline"`. */
@Component({
  selector: 'app-form-panel-footer',
  standalone: true,
  imports: [FormFooterComponent],
  template: `
    <app-form-footer
      mode="inline"
      [saveLabel]="saveLabel"
      [cancelLabel]="cancelLabel"
      [deleteLabel]="deleteLabel"
      [saving]="saving"
      [saveDisabled]="saveDisabled"
      [showSave]="showSave"
      (cancelClick)="cancelClick.emit()"
      (deleteClick)="deleteClick.emit()">
    </app-form-footer>
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
}
