import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PayableObligationFormPanelComponent } from './payable-obligation-form-panel.component';
import {
  PayableObligation,
  PayablesService,
} from '../../core/services/payables.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  TransactionFormPageComponent,
  TRANSACTION_FORM_CARD_CLASS,
  TransactionFormSaveEvent,
  buildTransactionSaveHeaderState,
} from '../../shared/components/transaction-form';
import { NavigationBackService } from '../../core/services/navigation-back.service';

@Component({
  selector: 'app-new-payable-obligation',
  standalone: true,
  imports: [
    CommonModule,
    TransactionFormPageComponent,
    PayableObligationFormPanelComponent,
    RecordActionToolbarComponent,
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      backLabel="Volver a cuentas a pagar"
      backShortLabel="Volver"
      backAriaLabel="Volver a cuentas a pagar"
      [hasHeaderActions]="hasHeaderActions"
      (backClick)="goBack()">
      <div headerActions *ngIf="hasHeaderActions" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
          [showSave]="auth.canEditRecords"
          [saveLabel]="obligationHeaderSave.label"
          [saveDisabled]="obligationHeaderSave.disabled"
          [saveLoading]="obligationHeaderSave.loading"
          (saveClick)="obligationForm?.submitForm()"
          [showDuplicate]="canDuplicateCurrent"
          duplicateLabel="Duplicar gasto"
          (duplicateClick)="duplicateCurrentObligation()"
          [showDelete]="canDeleteCurrent"
          deleteLabel="Eliminar gasto"
          [deleteDisabled]="obligationSaving || deletingObligation"
          (deleteClick)="confirmDeleteCurrentObligation()">
        </app-record-action-toolbar>
      </div>
      <section main [class]="formCardClass">
        <app-payable-obligation-form-panel
          #obligationForm
          [initialAmbito]="initialAmbito"
          [editingObligationId]="editingObligationId"
          [initialObligation]="loadedObligation"
          (saved)="onSaved($event)"
          (savingChange)="onObligationSavingChange($event)"
          (cancelled)="goBack()">
        </app-payable-obligation-form-panel>
      </section>
    </app-transaction-form-page>
  `,
})
export class NewPayableObligationComponent implements OnInit {
  @ViewChild('obligationForm') obligationForm!: PayableObligationFormPanelComponent;

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private payables = inject(PayablesService);
  readonly auth = inject(AuthService);
  private dialog = inject(DialogService);
  private navigationBack = inject(NavigationBackService);

  readonly formCardClass = TRANSACTION_FORM_CARD_CLASS;
  initialAmbito = '';
  editingObligationId: string | null = null;
  loadedObligation: PayableObligation | null = null;
  obligationSaving = false;
  deletingObligation = false;
  private obligationRouteId: string | null = null;

  get pageTitle(): string {
    return this.editingObligationId ? 'Editar gasto o servicio' : 'Nuevo gasto o servicio';
  }

  get obligationHeaderSave() {
    return buildTransactionSaveHeaderState({
      saving: this.obligationSaving,
      successMessage: this.obligationForm?.saveSuccessMessage ?? '',
      idleLabel: this.editingObligationId ? 'Guardar cambios' : 'Crear gasto',
      savingLabel: 'Guardando...',
    });
  }

  get hasHeaderActions(): boolean {
    return (
      !!this.editingObligationId &&
      (this.auth.canEditRecords || this.canDuplicateCurrent || this.canDeleteCurrent)
    );
  }

  get canDuplicateCurrent(): boolean {
    return this.auth.canEditRecords && !!this.editingObligationId;
  }

  get canDeleteCurrent(): boolean {
    return this.auth.canDeleteRecords && !!this.editingObligationId;
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const routeId = params.get('id')?.trim() || null;
      this.obligationRouteId = routeId;
      if (routeId) {
        this.loadObligationFromRoute(routeId);
        return;
      }
      this.editingObligationId = null;
      this.loadedObligation = null;
      this.syncNewObligationQuery(this.route.snapshot.queryParamMap);
    });

    this.route.queryParamMap.subscribe((params) => {
      if (this.obligationRouteId) return;
      this.syncNewObligationQuery(params);
    });
  }

  private syncNewObligationQuery(params: { get: (name: string) => string | null }) {
    this.initialAmbito = String(params.get('ambito') ?? '').trim();
    const duplicateId = params.get('duplicate')?.trim() ?? '';
    if (duplicateId) {
      this.loadObligationForDuplicate(duplicateId);
    }
  }

  private loadObligationFromRoute(obligacionId: string) {
    if (this.editingObligationId === obligacionId && this.loadedObligation?.id === obligacionId) {
      return;
    }

    this.payables.getObligation(obligacionId).subscribe({
      next: (obligation) => {
        this.loadedObligation = obligation;
        this.editingObligationId = obligacionId;
      },
      error: () => {
        this.dialog.alert({
          title: 'Error',
          message: 'No se pudo cargar el gasto o servicio.',
        });
        this.goBack();
      },
    });
  }

  private loadObligationForDuplicate(sourceId: string) {
    this.editingObligationId = null;
    this.payables.getObligation(sourceId).subscribe({
      next: (obligation) => {
        this.loadedObligation = {
          ...obligation,
          id: '',
          createdAt: undefined,
        };
      },
      error: () => {
        this.loadedObligation = null;
        this.dialog.alert({
          title: 'Error',
          message: 'No se pudo cargar el gasto a duplicar.',
        });
      },
    });
  }

  onObligationSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.obligationSaving = saving;
    });
  }

  onSaved(event: TransactionFormSaveEvent) {
    this.obligationSaving = false;
    const id = event?.id?.trim();
    if (!id) return;

    if (this.editingObligationId !== id) {
      this.editingObligationId = id;
      this.router.navigate(['/payables/obligations', id, 'edit'], { replaceUrl: true });
    }

    this.payables.getObligation(id).subscribe({
      next: (obligation) => {
        this.loadedObligation = obligation;
      },
    });
  }

  duplicateCurrentObligation() {
    const id = this.editingObligationId;
    if (!id || !this.canDuplicateCurrent) return;
    this.router.navigate(['/payables/new'], { queryParams: { duplicate: id } });
  }

  confirmDeleteCurrentObligation() {
    const id = this.editingObligationId;
    if (!id || !this.canDeleteCurrent) return;

    const label = this.loadedObligation?.beneficiario?.trim() || 'este gasto';

    this.dialog
      .confirm({
        title: 'Eliminar gasto',
        message: `¿Eliminar ${label}? Se quitarán los vencimientos pendientes vinculados.`,
        confirmLabel: 'Eliminar',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.deletingObligation = true;
        this.payables.deleteObligation(id).subscribe({
          next: () => {
            this.deletingObligation = false;
            this.goBack();
          },
          error: (err) => {
            this.deletingObligation = false;
            this.dialog.alert({
              title: 'No se pudo eliminar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar el gasto.',
            });
          },
        });
      });
  }

  goBack(): void {
    this.navigationBack.back(['/payables'], { queryParams: { tab: 'obligation' } });
  }
}
