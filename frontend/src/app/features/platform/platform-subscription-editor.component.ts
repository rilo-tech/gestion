import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PLATFORM_OVERRIDE_MODULE_CATALOG,
  SUBSCRIPTION_MODULE_CATALOG,
  calculateMonthlyFee,
  isModuleBillableAddon,
  normalizeModulesMap,
  resolveEffectiveModules,
  type ModuleOverrideState,
  type MonthlyFeeBreakdown,
  type SubscriptionModuleId,
  type SubscriptionModuleMeta,
} from '../../../../../shared/subscription-modules.ts';
import type { PublicPlanInfo } from '../../core/services/business.service';

export type BusinessSubscriptionDraft = {
  limiteAdministradores: number | null;
  limiteOperadores: number | null;
  limiteUsuariosTotal: number | null;
  maxAmbitosCaja: number | null;
  precioBaseOverride: number | null;
  precioPorAdministradorOverride: number | null;
  precioPorOperadorOverride: number | null;
  descuentoMensual: number;
  notasComerciales: string;
  modulosOverride: Partial<Record<SubscriptionModuleId, ModuleOverrideState>>;
  preciosAddonModuloOverride: Partial<Record<SubscriptionModuleId, number>>;
};

@Component({
  selector: 'app-platform-subscription-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-5">
      <p class="text-sm text-gray-600 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
        Estos valores aplican <strong>solo a esta empresa</strong>. Editar un plan en la pestaña Planes
        no modifica empresas ya creadas salvo que marques explícitamente «aplicar a existentes».
      </p>

      <div>
        <h4 class="text-sm font-semibold text-gray-900 mb-1">Cupos de usuarios</h4>
        <p class="text-xs text-gray-500 mb-3">
          Definí cuántos operadores y administradores puede tener esta empresa.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Admins permitidos</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="limitsDraft.limiteAdministradores"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'limiteAdministradores'"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          <p class="text-[11px] text-gray-400 mt-1">Plantilla del plan: {{ plan.limiteAdministradores }}</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Operadores permitidos</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="limitsDraft.limiteOperadores"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'limiteOperadores'"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          <p class="text-[11px] text-gray-400 mt-1">Plantilla del plan: {{ plan.limiteOperadores }}</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Total usuarios</label>
          <input
            type="number"
            min="1"
            [(ngModel)]="limitsDraft.limiteUsuariosTotal"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'limiteUsuariosTotal'"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Cajas / ámbitos</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="limitsDraft.maxAmbitosCaja"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'maxAmbitosCaja'"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          <p class="text-[11px] text-gray-400 mt-1">Plantilla del plan: {{ plan.maxAmbitosCaja ?? 0 }}</p>
        </div>
        </div>
      </div>

      <div>
        <h4 class="text-sm font-semibold text-gray-900 mb-1">Precio comercial de esta empresa</h4>
        <p class="text-xs text-gray-500 mb-3">
          Dejá vacío o en blanco para usar el valor de la plantilla del plan.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Precio base ($/mes)</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="pricingDraft.precioBaseOverride"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'precioBase'"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          <p class="text-[11px] text-gray-400 mt-1">Plantilla: {{ formatMoney(plan.precioBaseMensual) }}</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">$/admin/mes</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="pricingDraft.precioPorAdministradorOverride"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'precioAdmin'"
            placeholder="{{ plan.precioPorAdministrador }}"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">$/operador/mes</label>
          <input
            type="number"
            min="0"
            [(ngModel)]="pricingDraft.precioPorOperadorOverride"
            (ngModelChange)="emitChange()"
            [name]="namePrefix + 'precioOp'"
            placeholder="{{ plan.precioPorOperador }}"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
        </div>
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1">Descuento mensual ($)</label>
        <input
          type="number"
          min="0"
          [(ngModel)]="pricingDraft.descuentoMensual"
          (ngModelChange)="emitChange()"
          [name]="namePrefix + 'descuento'"
          class="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
      </div>

      <div>
        <h4 class="text-sm font-semibold text-gray-900 mb-2">Módulos y funciones</h4>
        <p class="text-xs text-gray-500 mb-3">
          Activá o desactivá módulos para este cliente (pedidos, caja, fotos en pedidos, etc.).
          «Como el plan» usa la plantilla; «Desactivar» en Fotos en pedidos oculta el adjunto de imágenes.
        </p>
        <div class="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          <div
            *ngFor="let module of moduleCatalog"
            class="px-3 py-3 sm:px-4 bg-white flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900">{{ module.label }}</p>
              <p class="text-xs text-gray-500">{{ module.description }}</p>
              <p class="text-[11px] text-gray-400 mt-0.5">
                Plantilla: {{ planIncludes(module.id) ? 'incluido' : 'no incluido' }}
                · Esta empresa:
                <span [class.text-teal-700]="isEffectiveOn(module.id)" [class.text-gray-400]="!isEffectiveOn(module.id)">
                  {{ isEffectiveOn(module.id) ? 'activo' : 'inactivo' }}
                </span>
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <select
                [ngModel]="getModuleOverride(module.id)"
                (ngModelChange)="setModuleOverride(module.id, $event)"
                [disabled]="module.alwaysOn"
                [name]="namePrefix + 'mod' + module.id"
                class="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-xs">
                <option value="inherit">Como el plan</option>
                <option value="on">Activar</option>
                <option value="off">Desactivar</option>
              </select>
              <input
                *ngIf="showAddonPrice(module)"
                type="number"
                min="0"
                [ngModel]="getAddonPrice(module.id)"
                (ngModelChange)="setAddonPrice(module.id, $event)"
                [name]="namePrefix + 'addon' + module.id"
                title="Precio mensual del módulo para este cliente"
                class="w-24 px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-right tabular-nums"
                placeholder="Addon $">
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-teal-100 bg-teal-50/60 p-4">
        <h4 class="text-sm font-semibold text-teal-900 mb-2">Cuota mensual estimada</h4>
        <ul class="space-y-1 text-sm text-teal-900/90">
          <li *ngFor="let line of feePreview.lineas" class="flex justify-between gap-3">
            <span>{{ line.concepto }}</span>
            <span class="tabular-nums font-medium">{{ formatMoney(line.monto) }}</span>
          </li>
        </ul>
        <div
          *ngIf="feePreview.descuento > 0"
          class="flex justify-between gap-3 text-sm text-teal-800 mt-2 pt-2 border-t border-teal-100">
          <span>Descuento</span>
          <span class="tabular-nums">-{{ formatMoney(feePreview.descuento) }}</span>
        </div>
        <div class="flex justify-between gap-3 text-base font-bold text-teal-900 mt-2 pt-2 border-t border-teal-200">
          <span>Total</span>
          <span class="tabular-nums">{{ formatMoney(feePreview.total) }}</span>
        </div>
      </div>
    </div>
  `,
})
export class PlatformSubscriptionEditorComponent implements OnInit, OnChanges {
  readonly moduleCatalog = PLATFORM_OVERRIDE_MODULE_CATALOG;

  @Input({ required: true }) plan!: PublicPlanInfo;
  @Input() namePrefix = 'sub';
  @Input() draft: BusinessSubscriptionDraft = emptyBusinessSubscriptionDraft();
  @Output() draftChange = new EventEmitter<BusinessSubscriptionDraft>();

  limitsDraft = {
    limiteAdministradores: null as number | null,
    limiteOperadores: null as number | null,
    limiteUsuariosTotal: null as number | null,
    maxAmbitosCaja: null as number | null,
  };

  pricingDraft = {
    precioBaseOverride: null as number | null,
    precioPorAdministradorOverride: null as number | null,
    precioPorOperadorOverride: null as number | null,
    descuentoMensual: 0,
    notasComerciales: '',
  };

  private moduleOverrideState: Partial<Record<SubscriptionModuleId, ModuleOverrideState>> = {};
  private addonOverrides: Partial<Record<SubscriptionModuleId, number>> = {};

  ngOnChanges() {
    this.syncFromDraft();
  }

  ngOnInit() {
    this.syncFromDraft();
  }

  get feePreview(): MonthlyFeeBreakdown {
    return this.computeFee();
  }

  planIncludes(moduleId: SubscriptionModuleId): boolean {
    return normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id)[moduleId] === true;
  }

  isEffectiveOn(moduleId: SubscriptionModuleId): boolean {
    const planModules = normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id);
    return resolveEffectiveModules(planModules, this.moduleOverrideState)[moduleId] === true;
  }

  getModuleOverride(moduleId: SubscriptionModuleId): ModuleOverrideState {
    return this.moduleOverrideState[moduleId] ?? 'inherit';
  }

  setModuleOverride(moduleId: SubscriptionModuleId, value: ModuleOverrideState) {
    if (value === 'inherit') {
      delete this.moduleOverrideState[moduleId];
    } else {
      this.moduleOverrideState[moduleId] = value;
    }
    this.emitChange();
  }

  showAddonPrice(module: SubscriptionModuleMeta): boolean {
    const planModules = normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id);
    const effective = resolveEffectiveModules(planModules, this.moduleOverrideState);
    return isModuleBillableAddon(module.id, planModules, effective);
  }

  getAddonPrice(moduleId: SubscriptionModuleId): number {
    if (this.addonOverrides[moduleId] !== undefined) return this.addonOverrides[moduleId]!;
    const meta = SUBSCRIPTION_MODULE_CATALOG.find((item) => item.id === moduleId);
    return this.plan.preciosAddonModulo?.[moduleId] ?? meta?.defaultAddonPrice ?? 0;
  }

  setAddonPrice(moduleId: SubscriptionModuleId, value: number) {
    this.addonOverrides[moduleId] = Math.max(0, Number(value) || 0);
    this.emitChange();
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  emitChange() {
    this.draftChange.emit({
      limiteAdministradores: this.limitsDraft.limiteAdministradores,
      limiteOperadores: this.limitsDraft.limiteOperadores,
      limiteUsuariosTotal: this.limitsDraft.limiteUsuariosTotal,
      maxAmbitosCaja: this.limitsDraft.maxAmbitosCaja,
      precioBaseOverride: this.pricingDraft.precioBaseOverride,
      precioPorAdministradorOverride: this.pricingDraft.precioPorAdministradorOverride,
      precioPorOperadorOverride: this.pricingDraft.precioPorOperadorOverride,
      descuentoMensual: this.pricingDraft.descuentoMensual,
      notasComerciales: this.pricingDraft.notasComerciales,
      modulosOverride: { ...this.moduleOverrideState },
      preciosAddonModuloOverride: { ...this.addonOverrides },
    });
  }

  private syncFromDraft() {
    const d = this.draft ?? emptyBusinessSubscriptionDraft();
    this.limitsDraft = {
      limiteAdministradores: d.limiteAdministradores,
      limiteOperadores: d.limiteOperadores,
      limiteUsuariosTotal: d.limiteUsuariosTotal,
      maxAmbitosCaja: d.maxAmbitosCaja,
    };
    this.pricingDraft = {
      precioBaseOverride: d.precioBaseOverride,
      precioPorAdministradorOverride: d.precioPorAdministradorOverride,
      precioPorOperadorOverride: d.precioPorOperadorOverride,
      descuentoMensual: d.descuentoMensual ?? 0,
      notasComerciales: d.notasComerciales ?? '',
    };
    this.moduleOverrideState = { ...(d.modulosOverride ?? {}) };
    this.addonOverrides = { ...(d.preciosAddonModuloOverride ?? {}) };
  }

  private computeFee(): MonthlyFeeBreakdown {
    const planModules = normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id);
    const effective = resolveEffectiveModules(planModules, this.moduleOverrideState);
    const addonPrices = { ...this.plan.preciosAddonModulo, ...this.addonOverrides };
    for (const meta of SUBSCRIPTION_MODULE_CATALOG) {
      if (addonPrices[meta.id] === undefined) addonPrices[meta.id] = meta.defaultAddonPrice;
    }

    return calculateMonthlyFee({
      precioBase: this.pricingDraft.precioBaseOverride ?? this.plan.precioBaseMensual,
      precioPorAdministrador:
        this.pricingDraft.precioPorAdministradorOverride ?? this.plan.precioPorAdministrador,
      precioPorOperador:
        this.pricingDraft.precioPorOperadorOverride ?? this.plan.precioPorOperador,
      limiteAdministradores:
        this.limitsDraft.limiteAdministradores ?? this.plan.limiteAdministradores,
      limiteOperadores: this.limitsDraft.limiteOperadores ?? this.plan.limiteOperadores,
      planModules,
      effectiveModules: effective,
      addonPrices,
      descuentoMensual: this.pricingDraft.descuentoMensual,
    });
  }
}

export function emptyBusinessSubscriptionDraft(): BusinessSubscriptionDraft {
  return {
    limiteAdministradores: null,
    limiteOperadores: null,
    limiteUsuariosTotal: null,
    maxAmbitosCaja: null,
    precioBaseOverride: null,
    precioPorAdministradorOverride: null,
    precioPorOperadorOverride: null,
    descuentoMensual: 0,
    notasComerciales: '',
    modulosOverride: {},
    preciosAddonModuloOverride: {},
  };
}

export function businessSubscriptionDraftFromPublic(business: {
  suscripcion?: Partial<BusinessSubscriptionDraft>;
  limitesEfectivos?: {
    limiteAdministradores: number;
    limiteOperadores: number;
    limiteUsuariosTotal: number;
    maxAmbitosCaja: number;
  };
  modulosOverride?: Partial<Record<SubscriptionModuleId, ModuleOverrideState>>;
  plan: PublicPlanInfo;
}): BusinessSubscriptionDraft {
  const sub = business.suscripcion ?? {};
  const effective = business.limitesEfectivos;
  const plan = business.plan;
  return {
    limiteAdministradores:
      sub.limiteAdministradores ?? effective?.limiteAdministradores ?? plan.limiteAdministradores,
    limiteOperadores:
      sub.limiteOperadores ?? effective?.limiteOperadores ?? plan.limiteOperadores,
    limiteUsuariosTotal:
      sub.limiteUsuariosTotal ?? effective?.limiteUsuariosTotal ?? plan.limiteUsuariosTotal,
    maxAmbitosCaja:
      sub.maxAmbitosCaja ?? effective?.maxAmbitosCaja ?? plan.maxAmbitosCaja ?? 0,
    precioBaseOverride: sub.precioBaseOverride ?? null,
    precioPorAdministradorOverride: sub.precioPorAdministradorOverride ?? null,
    precioPorOperadorOverride: sub.precioPorOperadorOverride ?? null,
    descuentoMensual: sub.descuentoMensual ?? 0,
    notasComerciales: sub.notasComerciales ?? '',
    modulosOverride: business.modulosOverride ?? sub.modulosOverride ?? {},
    preciosAddonModuloOverride: sub.preciosAddonModuloOverride ?? {},
  };
}

export function subscriptionDraftToPayload(draft: BusinessSubscriptionDraft) {
  return {
    suscripcion: {
      limiteAdministradores: draft.limiteAdministradores,
      limiteOperadores: draft.limiteOperadores,
      limiteUsuariosTotal: draft.limiteUsuariosTotal,
      maxAmbitosCaja: draft.maxAmbitosCaja,
      precioBaseOverride: draft.precioBaseOverride,
      precioPorAdministradorOverride: draft.precioPorAdministradorOverride,
      precioPorOperadorOverride: draft.precioPorOperadorOverride,
      descuentoMensual: draft.descuentoMensual,
      notasComerciales: draft.notasComerciales,
      modulosOverride: draft.modulosOverride,
      preciosAddonModuloOverride: draft.preciosAddonModuloOverride,
    },
  };
}
