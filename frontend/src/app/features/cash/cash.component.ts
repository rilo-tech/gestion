import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CashMovement, CashOrigenGrupo, CashService } from '../../core/services/cash.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCashConceptOptions,
  usesCashConceptList,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { IconActionComponent, PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SearchableSelectComponent, ConfigSettingsLinkComponent, TransactionModalComponent, IconActionComponent, ConceptRefLinksComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Caja</h1>
          <p class="text-sm sm:text-base text-gray-500">Movimientos de pedidos y registros manuales de ingreso y egreso.</p>
          <app-config-settings-link
            settingsTab="caja"
            message="¿Falta un concepto?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-icon-action label="Ingreso" (clicked)="openMovementModal('ingreso')">
            <i-lucide name="arrow-up" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Egreso" variant="danger" (clicked)="openMovementModal('egreso')">
            <i-lucide name="arrow-down" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Ingresos</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalIngresos }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Egresos</p>
          <p class="text-2xl font-bold text-red-500">{{ '$' + totalEgresos }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Saldo</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + saldoCaja }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100">
        <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              [(ngModel)]="searchQuery"
              name="searchQuery"
              placeholder="Buscar por concepto, origen o pedido..."
              class="w-full max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <select
              [(ngModel)]="origenFilter"
              name="origenFilter"
              class="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
              <option value="all">Todos los orígenes</option>
              <option value="pedido">Pedidos</option>
              <option value="venta">Ventas</option>
              <option value="manual">Manuales</option>
            </select>
          </div>
          <p *ngIf="!loading && movements.length > 0" class="text-xs text-gray-500">
            Ingresos por origen:
            <span class="font-medium text-teal-700">Pedidos {{ '$' + ingresosPedidos }}</span>
            ·
            <span class="font-medium text-purple-700">Ventas {{ '$' + ingresosVentas }}</span>
            ·
            <span class="font-medium text-gray-700">Manuales {{ '$' + ingresosManuales }}</span>
          </p>
        </div>
        <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Concepto</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Medio</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Monto</th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr *ngFor="let movement of filteredMovements" class="transition-colors">
              <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(movement.fecha) }}
              </td>
              <td class="px-6 py-4">
                <div class="font-medium text-gray-900">
                  <app-concept-ref-links
                    [text]="movement.concepto"
                    [pedidoId]="movement.pedidoId"
                    [ventaId]="movement.ventaId"
                    [numeroPedidoLabel]="getOrderNumberLabel(movement)"
                    [ventaLabel]="movement.ventaLabel">
                  </app-concept-ref-links>
                </div>
              </td>
              <td class="px-6 py-4">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  [ngClass]="getOrigenBadgeClass(movement)">
                  {{ getOrigenLabel(movement) }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-500 capitalize">
                {{ movement.medio || '—' }}
              </td>
              <td
                class="px-6 py-4 text-sm font-semibold text-right tabular-nums"
                [class.text-teal-600]="movement.tipo === 'ingreso'"
                [class.text-red-500]="movement.tipo === 'egreso'">
                {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ '$' + (movement.monto || 0) }}
              </td>
              <td class="px-6 py-4 text-sm font-medium whitespace-nowrap">
                <div class="flex items-center justify-end gap-1">
                  <button
                    *ngIf="auth.canEditRecords"
                    type="button"
                    (click)="openEditMovement(movement)"
                    title="Editar movimiento"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="auth.canDeleteRecords"
                    type="button"
                    (click)="confirmDeleteMovement(movement)"
                    title="Eliminar movimiento"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando movimientos...</td>
            </tr>
            <tr *ngIf="!loading && movements.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
              </td>
            </tr>
            <tr *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron movimientos con los filtros actuales.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
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

        <div class="flex justify-end gap-3 mt-6">
          <button
            type="button"
            (click)="closeMovementModal()"
            class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="submitMovement()"
            [disabled]="savingMovement"
            class="rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            [class.bg-teal-600]="movementTipo === 'ingreso'"
            [class.hover:bg-teal-700]="movementTipo === 'ingreso'"
            [class.bg-red-500]="movementTipo === 'egreso'"
            [class.hover:bg-red-600]="movementTipo === 'egreso'">
            {{ savingMovement ? 'Guardando...' : (editingMovementId ? 'Guardar' : 'Registrar') }}
          </button>
        </div>
    </app-transaction-modal>
  `,
})
export class CashComponent implements OnInit, OnDestroy {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly auth = inject(AuthService);

  private cashService = inject(CashService);
  private configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  movements: CashMovement[] = [];
  searchQuery = '';
  origenFilter: 'all' | CashOrigenGrupo = 'all';
  loading = true;

  movementModalOpen = false;
  editingMovementId: string | null = null;
  movementTipo: 'ingreso' | 'egreso' = 'ingreso';
  movementConcepto = '';
  movementMonto: number | null = null;
  movementMedio = 'efectivo';
  savingMovement = false;

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.configService.getAppConfig().subscribe();
    this.loadMovements();
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  get filteredMovements(): CashMovement[] {
    let list = this.movements;

    if (this.origenFilter !== 'all') {
      list = list.filter((movement) => this.resolveOrigenGrupo(movement) === this.origenFilter);
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
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  get ingresosPedidos(): number {
    return this.sumIngresosByOrigen('pedido');
  }

  get ingresosVentas(): number {
    return this.sumIngresosByOrigen('venta');
  }

  get ingresosManuales(): number {
    return this.sumIngresosByOrigen('manual');
  }

  get totalIngresos(): number {
    return this.movements
      .filter((movement) => movement.tipo === 'ingreso')
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
  }

  get totalEgresos(): number {
    return this.movements
      .filter((movement) => movement.tipo === 'egreso')
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
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
    if (grupo === 'pedido') return 'Pedido';
    if (grupo === 'venta') return 'Venta';
    if (grupo === 'manual') {
      return movement.tipo === 'egreso' ? 'Manual · egreso' : 'Manual · ingreso';
    }
    return 'Otro';
  }

  getOrigenBadgeClass(movement: CashMovement): Record<string, boolean> {
    const grupo = this.resolveOrigenGrupo(movement);
    return {
      'bg-teal-50 text-teal-700': grupo === 'pedido',
      'bg-purple-50 text-purple-700': grupo === 'venta',
      'bg-gray-100 text-gray-700': grupo === 'manual',
      'bg-amber-50 text-amber-700': grupo === 'otro',
    };
  }

  getOrderNumberLabel(movement: CashMovement): string {
    if (movement.numeroPedidoLabel) return movement.numeroPedidoLabel;
    if (movement.numeroPedido) {
      return String(movement.numeroPedido).padStart(5, '0');
    }
    return '—';
  }

  private resolveOrigenGrupo(movement: CashMovement): CashOrigenGrupo {
    if (movement.origenGrupo) return movement.origenGrupo;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo.startsWith('pedido') || movement.pedidoId) return 'pedido';
    if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
    if (tipo.startsWith('caja_manual')) return 'manual';
    if (!movement.pedidoId && !tipo.startsWith('pedido') && tipo !== 'venta' && !tipo.startsWith('venta')) {
      return 'manual';
    }
    return 'otro';
  }

  private sumIngresosByOrigen(grupo: CashOrigenGrupo): number {
    return this.movements
      .filter(
        (movement) =>
          movement.tipo === 'ingreso' && this.resolveOrigenGrupo(movement) === grupo
      )
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
  }

  openMovementModal(tipo: 'ingreso' | 'egreso') {
    this.editingMovementId = null;
    this.movementTipo = tipo;
    this.movementConcepto = '';
    this.movementMonto = null;
    this.movementMedio = 'efectivo';
    this.movementModalOpen = true;
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
    this.movementModalOpen = true;
  }

  closeMovementModal() {
    this.movementModalOpen = false;
    this.editingMovementId = null;
  }

  confirmDeleteMovement(movement: CashMovement) {
    if (!movement.id) return;

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
              title: 'Error',
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
