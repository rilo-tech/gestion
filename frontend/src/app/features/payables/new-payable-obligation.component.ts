import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PayableObligationFormPanelComponent } from './payable-obligation-form-panel.component';
import { PayableCuotaPayModalComponent } from './payable-cuota-pay-modal.component';
import {
  PayableInstallment,
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
import {
  FORM_CANCEL_CLASS,
  FORM_SUBMIT_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import {
  RecordActionToolbarComponent,
} from '../../shared/components/icon-toolbar';
import { formatMonthYearLabel } from '../../core/utils/date-format';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-new-payable-obligation',
  standalone: true,
  imports: [
    CommonModule,
    TransactionFormPageComponent,
    PayableObligationFormPanelComponent,
    PayableCuotaPayModalComponent,
    RecordActionToolbarComponent,
    LucideAngularModule,
  ],
  template: `
    <app-transaction-form-page
      [title]="pageTitle"
      backLabel="Volver a cuentas a pagar"
      backShortLabel="Volver"
      backAriaLabel="Volver a cuentas a pagar"
      [hideAside]="!!editingObligationId"
      [hasHeaderActions]="hasHeaderActions"
      (backClick)="goBack()">
      <section main [class]="formCardClass">
        <app-payable-obligation-form-panel
          #obligationForm
          [initialAmbito]="initialAmbito"
          [editingObligationId]="editingObligationId"
          [initialObligation]="loadedObligation"
          [showFooter]="!editingObligationId"
          (saved)="onSaved($event)"
          (savingChange)="onObligationSavingChange($event)"
          (cancelled)="goBack()">
          <div
            *ngIf="editingObligationId"
            formActions
            class="pt-4 mt-1 border-t border-gray-100 dark:border-gray-800 space-y-4">
            <div
              *ngIf="canPayCurrentMensual"
              class="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-teal-200/80 dark:border-teal-800/60 bg-teal-50/70 dark:bg-teal-950/25 px-3.5 py-3 sm:px-4">
              <div class="flex items-start gap-3 min-w-0 flex-1">
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                  <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 m-0">Pagar este mes</p>
                  <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5 mb-0 leading-snug">
                    {{ formatMonthYearLabel(payMes) }} · podés ajustar el monto al confirmar.
                  </p>
                </div>
              </div>
              <button
                type="button"
                (click)="openPayCurrentMensual()"
                [disabled]="payCuotaLoading || obligationSaving || togglingActive"
                class="shrink-0 self-start sm:self-center text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50 whitespace-nowrap">
                {{ payCuotaLoading ? 'Cargando...' : 'Pagar' }}
              </button>
            </div>

            <div class="form-actions flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <div class="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <app-record-action-toolbar
                  [showDuplicate]="canDuplicateCurrent"
                  duplicateLabel="Duplicar"
                  [duplicateDisabled]="obligationSaving || deletingObligation || togglingActive"
                  (duplicateClick)="duplicateCurrentObligation()"
                  [showDelete]="canDeleteCurrent"
                  deleteLabel="Eliminar"
                  [deleteDisabled]="obligationSaving || deletingObligation || togglingActive"
                  (deleteClick)="confirmDeleteCurrentObligation()">
                </app-record-action-toolbar>
                <button
                  *ngIf="canToggleActiveCurrent"
                  type="button"
                  (click)="toggleCurrentObligationActive()"
                  [disabled]="togglingActive || obligationSaving || deletingObligation"
                  class="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:opacity-50 whitespace-nowrap">
                  {{ togglingActive ? 'Guardando...' : (loadedObligation?.activo ? 'Desactivar' : 'Reactivar') }}
                </button>
              </div>

              <div class="flex-1 min-w-0 hidden sm:block"></div>

              <div class="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
                <p
                  *ngIf="obligationForm?.saveSuccessMessage"
                  class="text-sm font-semibold text-teal-800 dark:text-teal-200 text-right m-0"
                  role="status"
                  aria-live="polite">
                  {{ obligationForm.saveSuccessMessage }}
                </p>
                <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
                  <button
                    type="button"
                    (click)="goBack()"
                    [class]="formCancelClass + ' w-full sm:w-auto justify-center'">
                    Volver sin guardar
                  </button>
                  <button
                    type="button"
                    [disabled]="obligationHeaderSave.disabled"
                    [class]="formSubmitClass + ' w-full sm:w-auto justify-center'"
                    (click)="obligationForm?.submitForm()">
                    {{ obligationHeaderSave.loading ? 'Guardando...' : obligationHeaderSave.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </app-payable-obligation-form-panel>
      </section>
    </app-transaction-form-page>

    <app-payable-cuota-pay-modal
      [open]="payCuotaModalOpen"
      [target]="payCuotaTarget"
      (closed)="closePayCuotaModal()"
      (paid)="onCuotaPaid()">
    </app-payable-cuota-pay-modal>
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
  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly formSubmitClass = FORM_SUBMIT_CLASS;
  initialAmbito = '';
  editingObligationId: string | null = null;
  loadedObligation: PayableObligation | null = null;
  obligationSaving = false;
  deletingObligation = false;
  togglingActive = false;
  payCuotaLoading = false;
  payCuotaModalOpen = false;
  payCuotaTarget: PayableInstallment | null = null;
  payMes = new Date().toISOString().slice(0, 7);
  private obligationRouteId: string | null = null;

  get pageTitle(): string {
    if (this.editingObligationId && this.loadedObligation?.tipo === 'mensual') {
      return 'Gasto fijo mensual';
    }
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

  get isEditingMensual(): boolean {
    return !!this.editingObligationId && this.loadedObligation?.tipo === 'mensual';
  }

  get hasHeaderActions(): boolean {
    return false;
  }

  get canDuplicateCurrent(): boolean {
    return this.auth.canEditRecords && !!this.editingObligationId;
  }

  get canDeleteCurrent(): boolean {
    return this.auth.canDeleteRecords && !!this.editingObligationId;
  }

  get canPayCurrentMensual(): boolean {
    return (
      this.auth.canEditRecords &&
      !!this.editingObligationId &&
      this.loadedObligation?.tipo === 'mensual' &&
      !!this.loadedObligation?.activo
    );
  }

  get canToggleActiveCurrent(): boolean {
    return this.auth.canEditRecords && !!this.editingObligationId && this.loadedObligation?.tipo === 'mensual';
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
      const mes = String(params.get('mes') ?? '').trim().slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(mes)) {
        this.payMes = mes;
      }
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
      this.router.navigate(['/payables/obligations', id, 'edit'], {
        replaceUrl: true,
        queryParams: { mes: this.payMes },
      });
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

  toggleCurrentObligationActive() {
    const id = this.editingObligationId;
    if (!id || !this.loadedObligation || !this.canToggleActiveCurrent || this.togglingActive) return;

    const nextActive = !this.loadedObligation.activo;
    const actionLabel = nextActive ? 'reactivar' : 'desactivar';

    this.dialog
      .confirm({
        title: nextActive ? 'Reactivar gasto fijo' : 'Desactivar gasto fijo',
        message: `¿${nextActive ? 'Reactivar' : 'Desactivar'} "${this.loadedObligation.beneficiario}"?`,
        confirmLabel: nextActive ? 'Reactivar' : 'Desactivar',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.togglingActive = true;
        this.payables.setObligationActive(id, nextActive).subscribe({
          next: (updated) => {
            this.loadedObligation = updated;
            this.togglingActive = false;
          },
          error: (err) => {
            this.togglingActive = false;
            this.dialog.alert({
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : `No se pudo ${actionLabel} el gasto fijo.`,
            });
          },
        });
      });
  }

  openPayCurrentMensual() {
    const id = this.editingObligationId;
    if (!id || !this.canPayCurrentMensual || this.payCuotaLoading) return;

    this.payCuotaLoading = true;
    this.payables.getMensualInstallmentForMonth(id, this.payMes).subscribe({
      next: (row) => {
        this.payCuotaLoading = false;
        if (row.displayEstado === 'pagada') {
          this.dialog.alert({
            title: 'Cuota ya pagada',
            message: `La cuota de ${formatMonthYearLabel(this.payMes)} ya está pagada.`,
          });
          return;
        }
        this.payCuotaTarget = row;
        this.payCuotaModalOpen = true;
      },
      error: (err) => {
        this.payCuotaLoading = false;
        this.dialog.alert({
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : `No hay vencimiento en ${formatMonthYearLabel(this.payMes)}.`,
        });
      },
    });
  }

  closePayCuotaModal() {
    this.payCuotaModalOpen = false;
    this.payCuotaTarget = null;
  }

  onCuotaPaid() {
    this.closePayCuotaModal();
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

  formatMonthYearLabel = formatMonthYearLabel;

  goBack(): void {
    this.navigationBack.back(['/payables'], { queryParams: { tab: 'obligation' } });
  }
}
