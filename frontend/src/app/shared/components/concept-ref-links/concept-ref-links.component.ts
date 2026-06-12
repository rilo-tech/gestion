import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { buildConceptSegments } from '../../utils/concept-ref-links';

@Component({
  selector: 'app-concept-ref-links',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <ng-container *ngFor="let segment of segments">
      <ng-container [ngSwitch]="segment.kind">
        <span *ngSwitchCase="'text'">{{ segment.value }}</span>
        <a
          *ngSwitchCase="'pedido'"
          [routerLink]="['/orders', segment.pedidoId, 'edit']"
          [queryParams]="pedidoQueryParams"
          (click)="$event.stopPropagation()"
          class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
          {{ segment.ref }}
        </a>
        <a
          *ngSwitchCase="'venta'"
          [routerLink]="['/sales']"
          [queryParams]="{ ventaId: segment.ventaId }"
          (click)="$event.stopPropagation()"
          class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
          {{ segment.ref }}
        </a>
      </ng-container>
    </ng-container>
  `,
})
export class ConceptRefLinksComponent {
  @Input({ required: true }) text!: string;
  @Input() pedidoId?: string | null;
  @Input() ventaId?: string | null;
  @Input() numeroPedidoLabel?: string | null;
  @Input() ventaLabel?: string | null;
  @Input() pedidoQueryParams: Record<string, string> | null = null;

  get segments() {
    return buildConceptSegments(this.text, {
      pedidoId: this.pedidoId,
      ventaId: this.ventaId,
      numeroPedidoLabel: this.numeroPedidoLabel,
      ventaLabel: this.ventaLabel,
    });
  }
}
