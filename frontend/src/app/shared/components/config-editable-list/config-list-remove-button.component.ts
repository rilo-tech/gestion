import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { CONFIG_EDITABLE_LIST_REMOVE_BUTTON_CLASS } from './config-editable-list.constants';

@Component({
  selector: 'app-config-list-remove-button',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <button
      type="button"
      [class]="buttonClass + ' ' + positionClass"
      [disabled]="disabled || loading"
      [attr.aria-busy]="loading"
      [attr.aria-label]="loading ? 'Comprobando...' : ariaLabel"
      (click)="onClick($event)">
      <i-lucide
        *ngIf="loading"
        name="loader-circle"
        class="w-4 h-4 animate-spin"
        aria-hidden="true"></i-lucide>
      <i-lucide *ngIf="!loading" name="x" class="w-4 h-4" aria-hidden="true"></i-lucide>
    </button>
  `,
})
export class ConfigListRemoveButtonComponent {
  @Input() disabled = false;
  @Input() loading = false;
  @Input() ariaLabel = 'Quitar';
  /** absolute = esquina superior derecha en móvil; static = al lado del campo en pantallas grandes. */
  @Input() position: 'corner' | 'inline' = 'corner';

  @Output() clicked = new EventEmitter<Event>();

  readonly buttonClass = CONFIG_EDITABLE_LIST_REMOVE_BUTTON_CLASS;

  get positionClass(): string {
    if (this.position === 'inline') {
      return 'shrink-0';
    }
    return 'absolute top-1.5 right-1.5 z-[1] sm:static sm:top-auto sm:right-auto sm:shrink-0';
  }

  onClick(event: Event) {
    event.stopPropagation();
    if (this.loading || this.disabled) return;
    this.clicked.emit(event);
  }
}
