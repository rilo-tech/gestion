import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormFooterComponent } from '../form-shell/form-footer.component';

/** @deprecated Usar `app-form-footer` con `mode="sidebar"`. */
@Component({
  selector: 'app-form-save-footer',
  standalone: true,
  imports: [FormFooterComponent],
  template: `
    <app-form-footer
      mode="sidebar"
      [saveLabel]="label"
      [saving]="saving"
      [saveDisabled]="disabled"
      [successMessage]="successMessage"
      [fullWidth]="fullWidth"
      [centerOnLarge]="centerOnLarge"
      [theme]="theme"
      [showCancel]="false"
      (saveClick)="saveClick.emit()">
    </app-form-footer>
  `,
})
export class FormSaveFooterComponent {
  @Input() label = 'Guardar';
  @Input() saving = false;
  @Input() disabled = false;
  @Input() successMessage = '';
  @Input() fullWidth = true;
  @Input() centerOnLarge = false;
  @Input() theme: 'light' | 'dark' = 'light';
  @Output() saveClick = new EventEmitter<void>();
}
