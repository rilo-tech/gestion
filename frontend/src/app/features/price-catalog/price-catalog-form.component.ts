import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  PriceCatalogFormPanelComponent,
  PriceCatalogFormSaveEvent,
} from './price-catalog-form-panel.component';
import {
  TransactionFormPageComponent,
  TRANSACTION_FORM_CARD_CLASS,
  buildTransactionSaveHeaderState,
} from '../../shared/components/transaction-form';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { NavigationBackService } from '../../core/services/navigation-back.service';

@Component({
  selector: 'app-price-catalog-form',
  standalone: true,
  imports: [
    CommonModule,
    PriceCatalogFormPanelComponent,
    TransactionFormPageComponent,
    RecordActionToolbarComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="isEditing ? 'Editar referencia' : 'Nueva referencia'"
      backLabel="Volver al catálogo"
      backShortLabel="Volver"
      backAriaLabel="Volver al catálogo"
      [hasHeaderActions]="auth.canManagePriceCatalog"
      (backClick)="goBack()">
      <div headerActions *ngIf="auth.canManagePriceCatalog" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
          [showSave]="true"
          [saveLabel]="headerSave.label"
          [saveDisabled]="headerSave.disabled"
          [saveLoading]="headerSave.loading"
          (saveClick)="formPanel?.saveEntry()">
        </app-record-action-toolbar>
      </div>
      <section main [class]="formCardClass">
        <app-price-catalog-form-panel
          #formPanel
          [entryId]="entryId"
          (saved)="onSaved($event)"
          (savingChange)="onSavingChange($event)"
          (cancelled)="goBack()">
        </app-price-catalog-form-panel>
      </section>
    </app-transaction-form-page>
  `,
})
export class PriceCatalogFormComponent implements OnInit {
  @ViewChild('formPanel') formPanel?: PriceCatalogFormPanelComponent;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly auth = inject(AuthService);
  private navigationBack = inject(NavigationBackService);

  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;

  entryId: string | null = null;
  saving = false;

  get isEditing(): boolean {
    return !!this.entryId;
  }

  get headerSave() {
    return buildTransactionSaveHeaderState({
      saving: this.saving,
      successMessage: this.formPanel?.saveFeedback.successMessage ?? '',
      idleLabel: this.isEditing ? 'Guardar' : 'Crear referencia',
      savingLabel: 'Guardando...',
    });
  }

  ngOnInit() {
    this.entryId = this.route.snapshot.paramMap.get('id');
    if (!this.entryId && !this.auth.canManagePriceCatalog) {
      this.router.navigate(['/price-catalog']);
    }
  }

  onSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.saving = saving;
    });
  }

  onSaved(event: PriceCatalogFormSaveEvent) {
    this.saving = false;
    if (event.wasNew) {
      this.router.navigate(['/price-catalog'], {
        queryParams: { saved: '1' },
      });
      return;
    }
    if (!this.entryId) {
      this.entryId = event.id;
      this.router.navigate(['/price-catalog', event.id, 'edit'], { replaceUrl: true });
    }
  }

  goBack() {
    this.navigationBack.back(['/price-catalog']);
  }
}
