import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CreatePayableObligationPayload,
  PayableDisplayEstado,
  PayableInstallment,
  PayableObligation,
  PayableTipo,
  PayablesService,
} from '../../core/services/payables.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  AppConfig,
  CatalogConfigService,
  CajaAmbitoConfig,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getCashAmbitoLabel,
  getDefaultCashAmbitoId,
  resolveCashAmbito,
  usesCashAmbitoSeparation,
} from '../../core/services/catalog-config.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import {
  IconActionComponent,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

type EstadoFilter = 'all' | PayableDisplayEstado;

@Component({
  selector: 'app-payables',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TransactionModalComponent,
    IconActionComponent,
    ConfigSettingsLinkComponent,
    ActivityLogTriggerComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Cuentas a pagar</h1>
          <p class="text-sm sm:text-base text-gray-500">
            Controlá vencimientos, pagos únicos en cuotas y obligaciones mensuales recurrentes.
          </p>
          <app-config-settings-link
            settingsTab="caja"
            message="¿Querés separar empresa y casa (u otros)?"
            linkLabel="Configurá las etiquetas acá">
          </app-config-settings-link>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="payables"></app-activity-log-trigger>
          <app-icon-action label="Nueva obligación" (clicked)="openCreateModal()">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

      <div *ngIf="usesAmbitoSeparation" class="mb-6 sm:mb-8">
        <div class="flex gap-2 border-b border-gray-200 overflow-x-auto">
          <button
            *ngFor="let ambito of cajaAmbitos"
            type="button"
            (click)="activeAmbitoTab = ambito.id"
            class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap"
            [class.border-teal-600]="activeAmbitoTab === ambito.id"
            [class.text-teal-700]="activeAmbitoTab === ambito.id"
            [class.border-transparent]="activeAmbitoTab !== ambito.id"
            [class.text-gray-500]="activeAmbitoTab !== ambito.id">
            {{ ambito.label }}
          </button>
        </div>
      </div>

      <div class="module-summary-kpis grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ usesAmbitoSeparation ? activeAmbitoLabel + ' · ' : '' }}Pendientes
          </p>
          <p class="text-xl sm:text-2xl font-bold text-amber-600 tabular-nums">{{ countPendientes }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-red-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ usesAmbitoSeparation ? activeAmbitoLabel + ' · ' : '' }}Vencidas
          </p>
          <p class="text-xl sm:text-2xl font-bold text-red-600 tabular-nums">{{ countVencidas }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ usesAmbitoSeparation ? activeAmbitoLabel + ' · ' : '' }}Pagadas
          </p>
          <p class="text-xl sm:text-2xl font-bold text-teal-600 tabular-nums">{{ countPagadas }}</p>
        </div>
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm col-span-2 lg:col-span-1">
          <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">
            {{ usesAmbitoSeparation ? activeAmbitoLabel + ' · ' : '' }}Total pendiente
          </p>
          <p class="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{{ '$' + totalPendiente }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            [(ngModel)]="searchQuery"
            name="searchQuery"
            placeholder="Buscar por beneficiario..."
            class="w-full sm:max-w-xs px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          <select
            [(ngModel)]="estadoFilter"
            name="estadoFilter"
            class="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
            <option value="all">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="vencida">Vencidas</option>
            <option value="pagada">Pagadas</option>
          </select>
        </div>

        <div [class]="tableScrollClass">
          <table class="w-full text-left border-collapse sm:min-w-[720px]">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-12">Pagado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Vencimiento</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Beneficiario</th>
                <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cuota</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Monto</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let row of filteredInstallments"
                class="transition-colors"
                [class.bg-red-50]="row.displayEstado === 'vencida'"
                [class.bg-teal-50/40]="row.displayEstado === 'pagada'"
                [class.hover:bg-gray-50]="row.displayEstado === 'pendiente'">
                <td class="px-4 sm:px-6 py-3">
                  <button
                    type="button"
                    (click)="togglePaid(row)"
                    [disabled]="savingCuotaId === row.id"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors disabled:opacity-50"
                    [class.border-teal-500]="row.displayEstado === 'pagada'"
                    [class.bg-teal-500]="row.displayEstado === 'pagada'"
                    [class.text-white]="row.displayEstado === 'pagada'"
                    [class.border-gray-300]="row.displayEstado !== 'pagada'"
                    [class.hover:border-teal-500]="row.displayEstado !== 'pagada'"
                    [attr.aria-label]="row.displayEstado === 'pagada' ? 'Marcar pendiente' : 'Marcar pagado'">
                    <i-lucide *ngIf="row.displayEstado === 'pagada'" name="check" class="w-4 h-4"></i-lucide>
                  </button>
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm whitespace-nowrap tabular-nums"
                    [class.text-red-700]="row.displayEstado === 'vencida'"
                    [class.font-semibold]="row.displayEstado === 'vencida'">
                  {{ formatDate(row.fechaVencimiento) }}
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-900">
                  <div class="font-medium truncate">{{ row.beneficiario }}</div>
                  <div class="text-xs text-gray-400 sm:hidden">{{ tipoLabel(row.tipo) }} · Cuota {{ row.numeroCuota }}</div>
                </td>
                <td class="hidden sm:table-cell px-6 py-3 text-sm text-gray-600">{{ tipoLabel(row.tipo) }}</td>
                <td class="hidden sm:table-cell px-6 py-3 text-sm text-gray-600 tabular-nums">{{ row.numeroCuota }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm font-semibold text-right tabular-nums text-gray-900">
                  {{ '$' + row.monto }}
                </td>
                <td class="px-4 sm:px-6 py-3">
                  <span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="estadoBadgeClass(row.displayEstado)">
                    {{ estadoLabel(row.displayEstado) }}
                  </span>
                </td>
              </tr>
              <tr *ngIf="loading">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando vencimientos...</td>
              </tr>
              <tr *ngIf="!loading && filteredInstallments.length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                  No hay vencimientos con esos filtros. Usá <span class="font-semibold">Nueva obligación</span> para empezar.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div *ngIf="mensualObligations.length > 0" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-900">Obligaciones mensuales</h2>
          <p class="text-xs text-gray-500 mt-1">Se generan cuotas mes a mes hasta que las desactives.</p>
        </div>
        <div [class]="tableScrollClass">
          <table class="w-full text-left border-collapse sm:min-w-[560px]">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Beneficiario</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Monto</th>
                <th class="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Primer venc.</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Estado</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr *ngFor="let item of mensualObligations" class="hover:bg-gray-50">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900">{{ item.beneficiario }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-right tabular-nums">{{ '$' + item.monto }}</td>
                <td class="hidden sm:table-cell px-6 py-3 text-sm text-gray-600">{{ formatDate(item.fechaPrimerVencimiento) }}</td>
                <td class="px-4 sm:px-6 py-3">
                  <span
                    class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold"
                    [class.bg-teal-100]="item.activo"
                    [class.text-teal-800]="item.activo"
                    [class.bg-gray-100]="!item.activo"
                    [class.text-gray-600]="!item.activo">
                    {{ item.activo ? 'Activa' : 'Inactiva' }}
                  </span>
                </td>
                <td class="px-4 sm:px-6 py-3 text-right">
                  <div class="inline-flex gap-2">
                    <button
                      type="button"
                      (click)="toggleObligationActive(item)"
                      [disabled]="savingObligationId === item.id"
                      class="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50">
                      {{ item.activo ? 'Desactivar' : 'Reactivar' }}
                    </button>
                    <button
                      type="button"
                      (click)="confirmDeleteObligation(item)"
                      class="text-xs font-semibold text-red-600 hover:underline">
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <app-transaction-modal
      [open]="createModalOpen"
      title="Nueva cuenta a pagar"
      subtitle="Cargá a quién pagás, el monto y cómo se repite el vencimiento."
      (closed)="closeCreateModal()">
      <form class="space-y-4" (ngSubmit)="submitCreate()">
        <div *ngIf="usesAmbitoSeparation">
          <label class="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
          <div class="flex flex-wrap gap-2">
            <button
              *ngFor="let ambito of cajaAmbitos"
              type="button"
              (click)="formAmbito = ambito.id"
              class="px-3 py-2 rounded-lg border text-sm font-semibold transition-colors"
              [class.border-teal-500]="formAmbito === ambito.id"
              [class.bg-teal-50]="formAmbito === ambito.id"
              [class.text-teal-700]="formAmbito === ambito.id"
              [class.border-gray-200]="formAmbito !== ambito.id"
              [class.text-gray-700]="formAmbito !== ambito.id">
              {{ ambito.label }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">A quién pagás</label>
          <input
            [(ngModel)]="form.beneficiario"
            name="beneficiario"
            required
            placeholder="Ej: Alquiler, Proveedor X, Servicio..."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Monto</label>
            <input
              [(ngModel)]="form.monto"
              name="monto"
              type="number"
              min="0"
              step="0.01"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Primer vencimiento</label>
            <input
              [(ngModel)]="form.fechaPrimerVencimiento"
              name="fechaPrimerVencimiento"
              type="date"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Tipo de pago</label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
              [class.border-teal-500]="form.tipo === 'unico'"
              [class.bg-teal-50]="form.tipo === 'unico'"
              [class.border-gray-200]="form.tipo !== 'unico'">
              <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="unico" class="mt-1">
              <span>
                <span class="block text-sm font-semibold text-gray-900">Pago único / en cuotas</span>
                <span class="block text-xs text-gray-500 mt-0.5">Una vez o N cuotas mensuales (ej. 12 pagos).</span>
              </span>
            </label>
            <label
              class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
              [class.border-teal-500]="form.tipo === 'mensual'"
              [class.bg-teal-50]="form.tipo === 'mensual'"
              [class.border-gray-200]="form.tipo !== 'mensual'">
              <input type="radio" [(ngModel)]="form.tipo" name="tipo" value="mensual" class="mt-1">
              <span>
                <span class="block text-sm font-semibold text-gray-900">Mensual recurrente</span>
                <span class="block text-xs text-gray-500 mt-0.5">Se repite cada mes hasta que lo desactives.</span>
              </span>
            </label>
          </div>
        </div>

        <div *ngIf="form.tipo === 'unico'">
          <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad de pagos</label>
          <input
            [(ngModel)]="form.cantidadCuotas"
            name="cantidadCuotas"
            type="number"
            min="1"
            max="120"
            required
            class="w-full sm:max-w-xs px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          <p class="text-xs text-gray-500 mt-1">1 = un solo pago. 12 = doce cuotas mensuales desde la fecha indicada.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            [(ngModel)]="form.notas"
            name="notas"
            placeholder="Referencia, CBU, etc."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>

        <div class="form-actions flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
          <button
            type="button"
            (click)="closeCreateModal()"
            class="form-btn-secondary rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            [disabled]="creating"
            class="form-btn-primary rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">
            {{ creating ? 'Guardando...' : 'Crear' }}
          </button>
        </div>
      </form>
    </app-transaction-modal>
  `,
})
export class PayablesComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private payables = inject(PayablesService);
  private dialog = inject(DialogService);
  private configService = inject(CatalogConfigService);
  private configSub?: Subscription;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;

  appConfig: AppConfig = DEFAULT_APP_CONFIG;
  activeAmbitoTab = '';
  formAmbito = '';

  installments: PayableInstallment[] = [];
  obligations: PayableObligation[] = [];
  loading = true;
  createModalOpen = false;
  creating = false;
  savingCuotaId: string | null = null;
  savingObligationId: string | null = null;

  searchQuery = '';
  estadoFilter: EstadoFilter = 'all';

  form = this.emptyForm();

  ngOnInit(): void {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.syncActiveAmbitoTab();
    });
    this.configService.getAppConfig().subscribe();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
  }

  get cajaAmbitos(): CajaAmbitoConfig[] {
    return getCajaAmbitos(this.appConfig);
  }

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get activeAmbitoLabel(): string {
    return getCashAmbitoLabel(this.activeAmbitoTab, this.appConfig);
  }

  get scopedInstallments(): PayableInstallment[] {
    if (!this.usesAmbitoSeparation) return this.installments;
    return this.installments.filter(
      (row) => resolveCashAmbito(row, this.appConfig) === this.activeAmbitoTab
    );
  }

  get filteredInstallments(): PayableInstallment[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.scopedInstallments.filter((row) => {
      if (this.estadoFilter !== 'all' && row.displayEstado !== this.estadoFilter) return false;
      if (query && !row.beneficiario.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  get mensualObligations(): PayableObligation[] {
    let list = this.obligations.filter((item) => item.tipo === 'mensual');
    if (this.usesAmbitoSeparation) {
      list = list.filter(
        (item) => resolveCashAmbito(item, this.appConfig) === this.activeAmbitoTab
      );
    }
    return list;
  }

  get countPendientes(): number {
    return this.scopedInstallments.filter((row) => row.displayEstado === 'pendiente').length;
  }

  get countVencidas(): number {
    return this.scopedInstallments.filter((row) => row.displayEstado === 'vencida').length;
  }

  get countPagadas(): number {
    return this.scopedInstallments.filter((row) => row.displayEstado === 'pagada').length;
  }

  get totalPendiente(): number {
    return this.scopedInstallments
      .filter((row) => row.displayEstado === 'pendiente' || row.displayEstado === 'vencida')
      .reduce((sum, row) => sum + row.monto, 0);
  }

  openCreateModal(): void {
    this.form = this.emptyForm();
    this.formAmbito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);
    this.createModalOpen = true;
  }

  closeCreateModal(): void {
    this.createModalOpen = false;
  }

  submitCreate(): void {
    const payload = this.buildPayload();
    if (!payload) {
      this.dialog.alert({ message: 'Completá beneficiario, monto y fecha de vencimiento.' });
      return;
    }

    this.creating = true;
    this.payables.createObligation(payload).subscribe({
      next: () => {
        this.creating = false;
        this.closeCreateModal();
        this.loadData();
      },
      error: () => {
        this.creating = false;
        this.dialog.alert({ message: 'No se pudo crear la obligación.' });
      },
    });
  }

  togglePaid(row: PayableInstallment): void {
    const paid = row.displayEstado !== 'pagada';
    this.savingCuotaId = row.id;
    this.payables.setInstallmentPaid(row.id, paid).subscribe({
      next: (updated) => {
        this.installments = this.installments.map((item) =>
          item.id === updated.id ? updated : item
        );
        this.savingCuotaId = null;
      },
      error: () => {
        this.savingCuotaId = null;
        this.dialog.alert({ message: 'No se pudo actualizar el pago.' });
      },
    });
  }

  toggleObligationActive(item: PayableObligation): void {
    this.savingObligationId = item.id;
    this.payables.setObligationActive(item.id, !item.activo).subscribe({
      next: (updated) => {
        this.obligations = this.obligations.map((row) =>
          row.id === updated.id ? updated : row
        );
        this.savingObligationId = null;
        this.loadInstallments();
      },
      error: () => {
        this.savingObligationId = null;
        this.dialog.alert({ message: 'No se pudo actualizar la obligación.' });
      },
    });
  }

  confirmDeleteObligation(item: PayableObligation): void {
    this.dialog
      .confirm({
        title: 'Eliminar obligación',
        message: `¿Eliminar "${item.beneficiario}" y todos sus vencimientos? Esta acción no se puede deshacer.`,
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.payables.deleteObligation(item.id).subscribe({
          next: () => this.loadData(),
          error: () => this.dialog.alert({ message: 'No se pudo eliminar la obligación.' }),
        });
      });
  }

  formatDate(value: string): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    if (!year || !month || !day) return value;
    return `${day}/${month}/${year}`;
  }

  tipoLabel(tipo: PayableTipo): string {
    return tipo === 'mensual' ? 'Mensual' : 'Cuotas fijas';
  }

  estadoLabel(estado: PayableDisplayEstado): string {
    if (estado === 'pagada') return 'Pagada';
    if (estado === 'vencida') return 'Vencida';
    return 'Pendiente';
  }

  estadoBadgeClass(estado: PayableDisplayEstado): string {
    if (estado === 'pagada') return 'bg-teal-100 text-teal-800';
    if (estado === 'vencida') return 'bg-red-100 text-red-800';
    return 'bg-amber-100 text-amber-800';
  }

  private syncActiveAmbitoTab(): void {
    const ambitos = this.cajaAmbitos;
    if (ambitos.length === 0) {
      this.activeAmbitoTab = getDefaultCashAmbitoId(this.appConfig);
      return;
    }
    if (!ambitos.some((ambito) => ambito.id === this.activeAmbitoTab)) {
      this.activeAmbitoTab = ambitos[0].id;
    }
  }

  private loadData(): void {
    this.loading = true;
    this.payables.getObligations().subscribe({
      next: (obligations) => {
        this.obligations = obligations;
      },
      error: () => {
        this.obligations = [];
      },
    });
    this.loadInstallments();
  }

  private loadInstallments(): void {
    this.payables.getInstallments().subscribe({
      next: (installments) => {
        this.installments = installments;
        this.loading = false;
      },
      error: () => {
        this.installments = [];
        this.loading = false;
        this.dialog.alert({ message: 'No se pudieron cargar los vencimientos.' });
      },
    });
  }

  private emptyForm() {
    return {
      beneficiario: '',
      monto: null as number | null,
      tipo: 'unico' as PayableTipo,
      cantidadCuotas: 1,
      fechaPrimerVencimiento: new Date().toISOString().slice(0, 10),
      notas: '',
    };
  }

  private buildPayload(): CreatePayableObligationPayload | null {
    const beneficiario = this.form.beneficiario.trim();
    const monto = Number(this.form.monto);
    const fechaPrimerVencimiento = this.form.fechaPrimerVencimiento?.trim();
    if (!beneficiario || !fechaPrimerVencimiento || !Number.isFinite(monto) || monto <= 0) {
      return null;
    }

    const payload: CreatePayableObligationPayload = {
      beneficiario,
      monto,
      tipo: this.form.tipo,
      cantidadCuotas:
        this.form.tipo === 'unico'
          ? Math.min(Math.max(1, Math.round(Number(this.form.cantidadCuotas) || 1)), 120)
          : 1,
      fechaPrimerVencimiento,
      notas: this.form.notas.trim() || undefined,
    };

    if (this.usesAmbitoSeparation) {
      payload.ambito = this.formAmbito;
    }

    return payload;
  }
}
