import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormScreenHeaderComponent } from './form-screen-header.component';

/**
 * Encabezado estándar de formularios: título, subtítulo opcional y botón volver.
 */
@Component({
  selector: 'app-form-page-header',
  standalone: true,
  imports: [CommonModule, FormScreenHeaderComponent],
  template: `
    <app-form-screen-header
      [title]="title"
      [subtitle]="subtitle"
      [backLabel]="backLabel"
      [backShortLabel]="backShortLabel"
      [backAriaLabel]="backAriaLabel"
      [backRouterLink]="backRouterLink"
      [hideSubtitleOnMobile]="hideSubtitleOnMobile"
      [hasHeaderActions]="hasHeaderActions"
      [hasHeaderExtra]="hasHeaderExtra"
      (backClick)="backClick.emit()">
      <ng-content select="[headerExtra]" headerExtra></ng-content>
      <ng-content select="[headerActions]" headerActions></ng-content>
    </app-form-screen-header>
  `,
})
export class FormPageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() backLabel = 'Volver';
  @Input() backShortLabel = 'Volver';
  @Input() backAriaLabel = '';
  @Input() backRouterLink: string | readonly unknown[] | null = null;
  @Input() hideSubtitleOnMobile = true;
  @Input() hasHeaderActions = false;
  @Input() hasHeaderExtra = false;

  @Output() backClick = new EventEmitter<void>();
}
