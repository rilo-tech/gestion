import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CashMovement, CashService } from '../../core/services/cash.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCashConceptOptions,
  getCashOrigenes,
  getCashOrigenNombre,
  getCajaAmbitos,
  getDefaultCashAmbitoId,
  usesCashConceptList,
  usesCashAmbitoSeparation,
  resolveCashAmbito,
  getCashAmbitoLabel,
  CashAmbito,
  CajaAmbitoConfig,
  CajaOrigen,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { isDeletableCashMovement } from '../../core/utils/deletion-rules';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  TABLE_SEARCH_INPUT_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    ConfigSettingsLinkComponent,
    TransactionModalComponent,
    IconActionComponent,
    ConceptRefLinksComponent,
    ActivityLogTriggerComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    ModalFormFooterComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Caja</h1>
          <p class="text-sm text-gray-500 desc-lg-only">Movimientos de pedidos y registros manuales de ingreso y egreso.</p>
          <app-config-settings-link
            settingsTab="caja"
            message="¿Falta un concepto u origen?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="cash"></app-activity-log-trigger>
          <app-icon-action label="Ingreso" (clicked)="openMovementModal('ingreso')">
            <i-lucide name="arrow-up" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Egreso" variant="danger" (clicked)="openMovementModal('egreso')">
            <i-lucide name="arrow-down" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

      <div *ngIf="usesAmbitoSeparation" class="mb-4 space-y-2">
        <div
          *ngIf="cajaAmbitos.length > 1"
          class="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm text-sm">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">Total neto</span>
          <span class="text-base font-bold tabular-nums text-gray-900">{{ '$' + totalNetoSaldo }}</span>
          <span class="text-[11px] text-gray-500 tabular-nums w-full sm:w-auto sm:ml-auto">
            <ng-container *ngFor="let ambito of cajaAmbitos; let last = last">
              {{ ambito.label }} {{ '$' + getAmbitoSaldo(ambito.id) }}<span *ngIf="!last" class="text-gray-300 mx-1">·</span>
            </ng-container>
          </span>
        </div>

        <div class="rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div class="flex flex-col sm:flex-row sm:items-stretch">
            <div class="flex gap-0 border-b sm:border-b-0 sm:border-r border-gray-100 overflow-x-auto shrink-0">
              <button
                *ngFor="let ambito of cajaAmbitos"
                type="button"
                (click)="activeAmbitoTab = ambito.id"
                class="px-3 py-2 text-xs font-semibold border-b-2 sm:border-b-0 transition-colors whitespace-nowrap"
                [class.border-teal-600]="activeAmbitoTab === ambito.id"
                [class.text-teal-700]="activeAmbitoTab === ambito.id"
                [class.bg-teal-50]="activeAmbitoTab === ambito.id"
                [class.border-transparent]="activeAmbitoTab !== ambito.id"
                [class.text-gray-500]="activeAmbitoTab !== ambito.id">
                {{ ambito.label }}
              </button>
            </div>
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs sm:ml-auto">
              <span class="tabular-nums">
                <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Ing.</span>
                <span class="font-bold text-teal-600">{{ '$' + activeAmbitoIngresos }}</span>
              </span>
              <span class="tabular-nums">
                <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Egr.</span>
                <span class="font-bold text-red-500">{{ '$' + activeAmbitoEgresos }}</span>
              </span>
              <span class="tabular-nums">
                <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Saldo</span>
                <span class="font-bold text-gray-900">{{ '$' + activeAmbitoSaldo }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        *ngIf="!usesAmbitoSeparation"
        class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm text-xs">
        <span class="tabular-nums">
          <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Ing.</span>
          <span class="font-bold text-teal-600">{{ '$' + totalIngresos }}</span>
        </span>
        <span class="tabular-nums">
          <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Egr.</span>
          <span class="font-bold text-red-500">{{ '$' + totalEgresos }}</span>
        </span>
        <span class="tabular-nums sm:ml-auto">
          <span class="text-[10px] font-semibold uppercase text-gray-400 mr-1">Saldo</span>
          <span class="font-bold text-gray-900">{{ '$' + saldoCaja }}</span>
        </span>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100">
        <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              [(ngModel)]="searchQuery"
              (ngModelChange)="movementsPage = 1"
              name="searchQuery"
              placeholder="Buscar por concepto, origen o pedido..."
              [class]="tableSearchInputClass">
            <select
              [(ngModel)]="origenFilter"
              (ngModelChange)="movementsPage = 1"
              name="origenFilter"
              class="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <option value="all">Todos los orígenes</option>
              <option *ngFor="let origen of cashOrigenes" [value]="origen.grupo">
                {{ origen.nombre }}
              </option>
            </select>
          </div>
          <p *ngIf="!loading && movements.length > 0" class="text-xs text-gray-500">
            Ingresos por origen:
            <ng-container *ngFor="let origen of cashOrigenes; let last = last">
              <span class="font-medium" [ngClass]="getOrigenSummaryTextClass(origen.grupo)">
                {{ origen.nombre }} {{ '$' + sumIngresosByOrigen(origen.grupo) }}
              </span><span *ngIf="!last"> · </span>
            </ng-container>
          </p>
        </div>
        <div [class]="tableScrollClass">
        <table class="w-full text-left border-collapse sm:min-w-[820px]">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Concepto</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Medio</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Monto</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let movement of paginatedFilteredMovements"
              (click)="onMovementRowClick(movement)"
              [class]="listTableRowClass">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(movement.fecha) }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="font-medium text-gray-900 text-sm">
                  <app-concept-ref-links
                    [text]="movement.concepto"
                    [pedidoId]="movement.pedidoId"
                    [ventaId]="movement.ventaId"
                    [numeroPedidoLabel]="getOrderNumberLabel(movement)"
                    [ventaLabel]="movement.ventaLabel">
                  </app-concept-ref-links>
                </div>
                <div class="text-xs text-gray-400 mt-0.5 sm:hidden">
                  {{ formatDate(movement.fecha) }} · {{ getOrigenLabel(movement) }}
                </div>
                <div class="flex items-center gap-1 mt-2 sm:hidden" (click)="$event.stopPropagation()">
                  <app-list-row-actions
                    [showEdit]="auth.canEditRecords"
                    [showDelete]="auth.canDeleteRecords && isDeletableCashMovement(movement)"
                    (editClick)="openEditMovement(movement)"
                    (deleteClick)="confirmDeleteMovement(movement)">
                  </app-list-row-actions>
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  [ngClass]="getOrigenBadgeClass(movement)">
                  {{ getOrigenLabel(movement) }}
                </span>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-500 capitalize">
                {{ movement.medio || '—' }}
              </td>
              <td
                class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-right tabular-nums"
                [class.text-teal-600]="movement.tipo === 'ingreso'"
                [class.text-red-500]="movement.tipo === 'egreso'">
                {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ '$' + (movement.monto || 0) }}
                <div class="text-xs font-normal text-gray-400 sm:hidden capitalize">{{ movement.medio || '—' }}</div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium whitespace-nowrap" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [showEdit]="auth.canEditRecords"
                  [showDelete]="auth.canDeleteRecords && isDeletableCashMovement(movement)"
                  (editClick)="openEditMovement(movement)"
                  (deleteClick)="confirmDeleteMovement(movement)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">Cargando movimientos...</td>
            </tr>
            <tr *ngIf="loading" class="hidden sm:table-row">
              <td [attr.colspan]="6" class="px-6 py-12 text-center text-gray-400">Cargando movimientos...</td>
            </tr>
            <tr *ngIf="!loading && movements.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
              </td>
            </tr>
            <tr *ngIf="!loading && movements.length === 0" class="hidden sm:table-row">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
              </td>
            </tr>
            <tr *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                No se encontraron movimientos con los filtros actuales.
              </td>
            </tr>
            <tr *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0" class="hidden sm:table-row">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron movimientos con los filtros actuales.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          [page]="movementsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredMovements.length"
          (pageChange)="movementsPage = $event">
        </app-list-pagination>
      </div>
    </div>

    <app-transaction-modal
      [open]="movementModalOpen"
      [title]="movementModalTitle"
      [subtitle]="movementModalSubtitle"
      maxWidthClass="max-w-md"
      (closed)="closeMovementModal()">

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                (click)="setMovementTipo('ingreso')"
                class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                [class.border-teal-500]="movementTipo === 'ingreso'"
                [class.bg-teal-50]="movementTipo === 'ingreso'"
                [class.text-teal-700]="movementTipo === 'ingreso'"
                [class.border-gray-200]="movementTipo !== 'ingreso'"
                [class.text-gray-700]="movementTipo !== 'ingreso'"
                [class.hover:bg-gray-50]="movementTipo !== 'ingreso'">
                Suma
              </button>
              <button
                type="button"
                (click)="setMovementTipo('egreso')"
                class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                [class.border-red-500]="movementTipo === 'egreso'"
                [class.bg-red-50]="movementTipo === 'egreso'"
                [class.text-red-700]="movementTipo === 'egreso'"
                [class.border-gray-200]="movementTipo !== 'egreso'"
                [class.text-gray-700]="movementTipo !== 'egreso'"
                [class.hover:bg-gray-50]="movementTipo !== 'egreso'">
                Resta
              </button>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Concepto</label>
            <app-searchable-select
              *ngIf="usesConceptList"
              [(ngModel)]="movementConcepto"
              name="movementConcepto"
              [options]="conceptOptions"
              placeholder="Buscar concepto..."
              plainPlaceholder="Ej. Venta mostrador">
            </app-searchable-select>
            <input
              *ngIf="!usesConceptList"
              [(ngModel)]="movementConcepto"
              name="movementConceptoText"
              placeholder="Ej. Venta mostrador"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <app-config-settings-link
              *ngIf="!usesConceptList"
              settingsTab="caja"
              message="¿Falta un concepto?"
              linkLabel="Configuralo acá"
              [compact]="true">
            </app-config-settings-link>
          </div>

          <div *ngIf="usesAmbitoSeparation">
            <label class="block text-sm font-medium text-gray-700 mb-1">Ámbito</label>
            <div class="grid gap-2" [ngClass]="cajaAmbitos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
              <button
                *ngFor="let ambito of cajaAmbitos"
                type="button"
                (click)="movementAmbito = ambito.id"
                class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                [class.border-teal-500]="movementAmbito === ambito.id"
                [class.bg-teal-50]="movementAmbito === ambito.id"
                [class.text-teal-700]="movementAmbito === ambito.id"
                [class.border-gray-200]="movementAmbito !== ambito.id"
                [class.text-gray-700]="movementAmbito !== ambito.id">
                {{ ambito.label }}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Monto</label>
            <input
              type="number"
              [(ngModel)]="movementMonto"
              name="movementMonto"
              min="1"
              placeholder="0"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
            <select
              [(ngModel)]="movementMedio"
              name="movementMedio"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
        </div>

        <app-modal-form-footer
          [saving]="savingMovement"
          [primaryLabel]="movementModalPrimaryLabel"
          [primaryButtonClass]="movementModalPrimaryButtonClass"
          (cancelClick)="closeMovementModal()"
          (primaryClick)="submitMovement()">
        </app-modal-form-footer>
    </app-transaction-modal>
  `,
})
export class CashComponent implements OnInit, OnDestroy {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly tableSearchInputClass = TABLE_SEARCH_INPUT_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  private cashService = inject(CashService);
  private configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  movements: CashMovement[] = [];
  searchQuery = '';
  movementsPage = 1;
  origenFilter: 'all' | string = 'all';
  activeAmbitoTab = '';
  loading = true;

  movementModalOpen = false;
  editingMovementId: string | null = null;
  movementTipo: 'ingreso' | 'egreso' = 'ingreso';
  movementConcepto = '';
  movementMonto: number | null = null;
  movementMedio = 'efectivo';
  movementAmbito = '';
  savingMovement = false;

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.syncActiveAmbitoTab();
    });
    this.configService.getAppConfig().subscribe();
    this.loadMovements();
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  get cashOrigenes(): CajaOrigen[] {
    return getCashOrigenes(this.appConfig.caja.origenes);
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

  get activeAmbitoIngresos(): number {
    return this.sumByTipo('ingreso', this.activeAmbitoTab);
  }

  get activeAmbitoEgresos(): number {
    return this.sumByTipo('egreso', this.activeAmbitoTab);
  }

  get activeAmbitoSaldo(): number {
    return this.activeAmbitoIngresos - this.activeAmbitoEgresos;
  }

  get totalNetoSaldo(): number {
    return this.totalIngresos - this.totalEgresos;
  }

  getAmbitoSaldo(ambitoId: string): number {
    return this.sumByTipo('ingreso', ambitoId) - this.sumByTipo('egreso', ambitoId);
  }

  get filteredMovements(): CashMovement[] {
    let list = this.movements;

    if (this.origenFilter !== 'all') {
      list = list.filter((movement) => this.resolveOrigenGrupo(movement) === this.origenFilter);
    }

    if (this.usesAmbitoSeparation) {
      list = list.filter(
        (movement) => resolveCashAmbito(movement, this.appConfig) === this.activeAmbitoTab
      );
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((movement) => {
      const haystack = [
        movement.concepto,
        movement.origenLabel,
        movement.numeroPedidoLabel,
        movement.ventaLabel,
        movement.medio,
        this.usesAmbitoSeparation
          ? getCashAmbitoLabel(resolveCashAmbito(movement, this.appConfig), this.appConfig)
          : '',
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  get paginatedFilteredMovements(): CashMovement[] {
    return paginateSlice(this.filteredMovements, this.movementsPage, this.listPageSize);
  }

  get movementModalPrimaryLabel(): string {
    return this.editingMovementId ? 'Guardar' : 'Registrar';
  }

  get movementModalPrimaryButtonClass(): string {
    const base =
      'form-btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60';
    return this.movementTipo === 'egreso'
      ? `${base} bg-red-500 hover:bg-red-600`
      : `${base} bg-teal-600 hover:bg-teal-700`;
  }

  get totalIngresos(): number {
    return this.sumByTipo('ingreso');
  }

  get totalEgresos(): number {
    return this.sumByTipo('egreso');
  }

  get saldoCaja(): number {
    return this.totalIngresos - this.totalEgresos;
  }

  get usesConceptList(): boolean {
    return usesCashConceptList(this.appConfig);
  }

  get conceptOptions(): string[] {
    return getCashConceptOptions(this.appConfig, this.movementTipo);
  }

  setMovementTipo(tipo: 'ingreso' | 'egreso') {
    this.movementTipo = tipo;
    if (
      this.usesConceptList &&
      this.movementConcepto &&
      !this.conceptOptions.some(
        (option) => option.toLowerCase() === this.movementConcepto.trim().toLowerCase()
      )
    ) {
      this.movementConcepto = '';
    }
  }

  get movementModalTitle(): string {
    const action = this.editingMovementId ? 'Editar' : 'Registrar';
    return `${action} movimiento`;
  }

  get movementModalSubtitle(): string {
    if (this.editingMovementId) {
      return 'Modificá los datos del movimiento manual.';
    }
    return 'Acción rápida desde caja. Se guarda con la fecha de hoy.';
  }

  isManualMovement(movement: CashMovement): boolean {
    if (movement.pedidoId || movement.ventaId) return false;

    const tipo = String(movement.origenTipo ?? '');
    if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
    if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;
    if (movement.origenGrupo === 'manual') return true;
    if (tipo.startsWith('caja_manual')) return true;

    return !tipo;
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  getOrigenLabel(movement: CashMovement): string {
    if (movement.origenLabel) return movement.origenLabel;
    const grupo = this.resolveOrigenGrupo(movement);
    const base = getCashOrigenNombre(this.appConfig.caja.origenes, grupo);
    if (grupo === 'manual') {
      return movement.tipo === 'egreso' ? `${base} · egreso` : `${base} · ingreso`;
    }
    return base;
  }

  getOrigenBadgeClass(movement: CashMovement): Record<string, boolean> {
    const grupo = this.resolveOrigenGrupo(movement);
    return this.getOrigenBadgeClassByGrupo(grupo);
  }

  getAmbitoLabel(movement: CashMovement): string {
    return getCashAmbitoLabel(resolveCashAmbito(movement, this.appConfig), this.appConfig);
  }

  getAmbitoBadgeClass(_movement: CashMovement): Record<string, boolean> {
    return { 'bg-gray-100 text-gray-700': true };
  }

  getOrigenSummaryTextClass(grupo: string): Record<string, boolean> {
    return {
      'text-teal-700': grupo === 'pedido',
      'text-purple-700': grupo === 'venta',
      'text-amber-700': grupo === 'compra',
      'text-gray-700': grupo === 'manual',
      'text-slate-700':
        grupo !== 'pedido' && grupo !== 'venta' && grupo !== 'compra' && grupo !== 'manual',
    };
  }

  private getOrigenBadgeClassByGrupo(grupo: string): Record<string, boolean> {
    return {
      'bg-teal-50 text-teal-700': grupo === 'pedido',
      'bg-purple-50 text-purple-700': grupo === 'venta',
      'bg-amber-50 text-amber-700': grupo === 'compra',
      'bg-gray-100 text-gray-700': grupo === 'manual',
      'bg-slate-100 text-slate-700':
        grupo !== 'pedido' && grupo !== 'venta' && grupo !== 'compra' && grupo !== 'manual',
    };
  }

  getOrderNumberLabel(movement: CashMovement): string {
    if (movement.numeroPedidoLabel) return movement.numeroPedidoLabel;
    if (movement.numeroPedido) {
      return String(movement.numeroPedido).padStart(5, '0');
    }
    return '—';
  }

  private resolveOrigenGrupo(movement: CashMovement): string {
    if (movement.origenGrupo) return movement.origenGrupo;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo.startsWith('pedido') || movement.pedidoId) return 'pedido';
    if (tipo === 'compra' || tipo.startsWith('compra')) return 'compra';
    if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
    if (tipo.startsWith('caja_manual')) return 'manual';
    if (!movement.pedidoId && !tipo.startsWith('pedido') && tipo !== 'venta' && !tipo.startsWith('venta')) {
      return 'manual';
    }
    return 'otro';
  }

  private sumIngresosByOrigen(grupo: string): number {
    return this.movements
      .filter(
        (movement) =>
          movement.tipo === 'ingreso' && this.resolveOrigenGrupo(movement) === grupo
      )
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
  }

  private syncActiveAmbitoTab() {
    const ambitos = this.cajaAmbitos;
    if (!ambitos.length) {
      this.activeAmbitoTab = getDefaultCashAmbitoId(this.appConfig);
      return;
    }
    if (!ambitos.some((ambito) => ambito.id === this.activeAmbitoTab)) {
      this.activeAmbitoTab = ambitos[0].id;
    }
  }

  private sumByTipo(tipo: 'ingreso' | 'egreso', ambito?: string): number {
    return this.movements
      .filter((movement) => {
        if (movement.tipo !== tipo) return false;
        if (!ambito) return true;
        return resolveCashAmbito(movement, this.appConfig) === ambito;
      })
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
  }

  isDeletableCashMovement = isDeletableCashMovement;

  openMovementModal(tipo: 'ingreso' | 'egreso') {
    this.editingMovementId = null;
    this.movementTipo = tipo;
    this.movementConcepto = '';
    this.movementMonto = null;
    this.movementMedio = 'efectivo';
    this.movementAmbito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);
    this.movementModalOpen = true;
  }

  onMovementRowClick(movement: CashMovement) {
    if (!this.auth.canEditRecords) return;
    this.openEditMovement(movement);
  }

  openEditMovement(movement: CashMovement) {
    if (!movement.id) return;

    if (!this.isManualMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento automático',
        message: 'Este movimiento se generó desde un pedido o venta. Para modificarlo, usá el enlace del pedido en el concepto.',
      });
      return;
    }

    this.editingMovementId = movement.id;
    this.movementTipo = movement.tipo;
    this.movementConcepto = movement.concepto ?? '';
    this.movementMonto = Number(movement.monto) || null;
    this.movementMedio = movement.medio || 'efectivo';
    this.movementAmbito = resolveCashAmbito(movement, this.appConfig);
    this.movementModalOpen = true;
  }

  closeMovementModal() {
    this.movementModalOpen = false;
    this.editingMovementId = null;
  }

  confirmDeleteMovement(movement: CashMovement) {
    if (!movement.id) return;

    if (!isDeletableCashMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento vinculado',
        message:
          'Este movimiento está vinculado a otro documento y no se puede eliminar. Registrá un documento con signo contrario desde el pedido, la venta o la compra que lo generó.',
      });
      return;
    }

    if (!this.isManualMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento automático',
        message: 'Este movimiento se generó desde un pedido o venta y no se puede eliminar desde caja.',
      });
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar movimiento',
        message: `¿Eliminar "${movement.concepto}" por ${this.formatMoney(movement.monto)}?`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !movement.id) return;

        this.cashService.deleteMovement(movement.id).subscribe({
          next: () => this.loadMovements(),
          error: (err) =>
            this.dialogService.alert({
              title: 'No se puede eliminar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar el movimiento.',
            }),
        });
      });
  }

  private formatMoney(value?: number): string {
    return `$${Number(value) || 0}`;
  }

  submitMovement() {
    const monto = Number(this.movementMonto);
    const concepto = this.movementConcepto.trim();

    if (!concepto) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un concepto.',
      });
      return;
    }

    if (!monto || monto <= 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    const payload = {
      tipo: this.movementTipo,
      monto,
      concepto,
      medio: this.movementMedio,
      ...(this.usesAmbitoSeparation ? { ambito: this.movementAmbito } : {}),
    };

    this.savingMovement = true;
    const request = this.editingMovementId
      ? this.cashService.updateMovement(this.editingMovementId, payload)
      : this.cashService.createMovement(payload);

    request.subscribe({
      next: () => {
        this.savingMovement = false;
        this.closeMovementModal();
        this.loadMovements();
      },
      error: (err) => {
        this.savingMovement = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : this.editingMovementId
                ? 'No se pudo actualizar el movimiento.'
                : 'No se pudo registrar el movimiento.',
        });
      },
    });
  }

  private loadMovements() {
    this.loading = true;
    this.cashService.getMovements().subscribe({
      next: (movements) => {
        this.movements = movements;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los movimientos de caja desde el servidor.',
        });
      },
    });
  }
}
