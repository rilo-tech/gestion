import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PayableLoanFormPanelComponent } from './payable-loan-form-panel.component';
import {
  TransactionFormPageComponent,
  TRANSACTION_FORM_CARD_CLASS,
} from '../../shared/components/transaction-form';
import { NavigationBackService } from '../../core/services/navigation-back.service';

@Component({
  selector: 'app-new-payable-loan',
  standalone: true,
  imports: [CommonModule, TransactionFormPageComponent, PayableLoanFormPanelComponent],
  template: `
    <app-transaction-form-page
      title="Nuevo préstamo"
      subtitle="Cuotas iguales mensuales. Al pagar cada cuota se registra el egreso en caja."
      backLabel="Volver a cuentas a pagar"
      backShortLabel="Volver"
      backAriaLabel="Volver a cuentas a pagar"
      (backClick)="goBack()">
      <section main [class]="formCardClass">
        <app-payable-loan-form-panel
          [initialAmbito]="initialAmbito"
          (saved)="onSaved()"
          (cancelled)="goBack()">
        </app-payable-loan-form-panel>
      </section>
    </app-transaction-form-page>
  `,
})
export class NewPayableLoanComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private navigationBack = inject(NavigationBackService);

  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;
  initialAmbito = '';

  ngOnInit(): void {
    this.initialAmbito = String(this.route.snapshot.queryParamMap.get('ambito') ?? '').trim();
  }

  goBack(): void {
    this.navigationBack.back(['/payables']);
  }

  onSaved(): void {
    this.router.navigate(['/payables'], { queryParams: { tab: 'obligation' } });
  }
}
