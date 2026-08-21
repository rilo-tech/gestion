import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ERP_FEATURE_PACKS,
  INCLUDED_ADMIN_SEATS,
  INCLUDED_WHATSAPP_SEATS,
  SUBSCRIPTION_MODULE_CATALOG,
  applyFeaturePackOverride,
  calculateMonthlyFee,
  isFeaturePackEnabled,
  normalizeModulesMap,
  resolveEffectiveModules,
  type ErpFeaturePack,
  type ModuleOverrideState,
  type MonthlyFeeBreakdown,
  type SubscriptionModuleId,
} from '../../../../../shared/subscription-modules.ts';
import type { PublicPlanInfo } from '../../core/services/business.service';

export type BusinessSubscriptionDraft = {
  limiteAdministradores: number | null;
  limiteOperadores: number | null;
  limiteUsuariosTotal: number | null;
  maxAmbitosCaja: number | null;
  limiteWhatsapp: number | null;
  precioBaseOverride: number | null;
  precioPorAdministradorOverride: number | null;
  precioPorOperadorOverride: number | null;
  precioPorWhatsappOverride: number | null;
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
    <div class="space-y-6">
      <section class="space-y-3">
        <div>
          <h4 class="text-sm font-semibold text-gray-900">Usuarios</h4>
          <p class="text-xs text-gray-500 mt-0.5">
            Siempre incluye <strong>1 administrador</strong>. Sumá operadores o admins extras a demanda
            (no depende del plan de la landing).
          </p>
        </div>
        <div class="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2.5 text-sm text-teal-900">
          1 administrador incluido en el precio base
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Admins extras</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="extraAdmins"
              (ngModelChange)="onExtraAdminsChange()"
              [name]="namePrefix + 'extraAdmins'"
              class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <p class="text-[11px] text-gray-400 mt-1">Total admins: {{ totalAdmins }}</p>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Operadores</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="limitsDraft.limiteOperadores"
              (ngModelChange)="syncTotalsAndEmit()"
              [name]="namePrefix + 'limiteOperadores'"
              class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">$/admin extra / mes</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="pricingDraft.precioPorAdministradorOverride"
              (ngModelChange)="emitChange()"
              [name]="namePrefix + 'precioAdmin'"
              [placeholder]="String(plan.precioPorOperador || 490)"
              class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">$/operador / mes</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="pricingDraft.precioPorOperadorOverride"
              (ngModelChange)="emitChange()"
              [name]="namePrefix + 'precioOp'"
              [placeholder]="String(plan.precioPorOperador || 490)"
              class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs font-medium text-gray-500 mb-1">$/WhatsApp extra / mes</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="pricingDraft.precioPorWhatsappOverride"
              (ngModelChange)="emitChange()"
              [name]="namePrefix + 'precioWa'"
              [placeholder]="String(plan.precioPorOperador || 490)"
              class="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
            <p class="text-[11px] text-gray-400 mt-1">
              1 WhatsApp incluido; las líneas extra (números autorizados) se cobran con este monto.
            </p>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <div>
          <h4 class="text-sm font-semibold text-gray-900">Precio del producto</h4>
          <p class="text-xs text-gray-500 mt-0.5">
            Debe coincidir con la landing (RILO Bot / Panel / Completo).
          </p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <label class="block text-xs font-medium text-gray-500 mb-1">Descuento ($)</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="pricingDraft.descuentoMensual"
              (ngModelChange)="emitChange()"
              [name]="namePrefix + 'descuento'"
              class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 class="text-sm font-semibold text-teal-950">Detalle de cuota (para factura)</h4>
            <p class="text-xs text-teal-800 mt-0.5">
              Se cobra por cupos habilitados, no solo por usuarios activos.
            </p>
          </div>
          <p class="text-lg font-bold text-teal-950 tabular-nums">{{ formatMoney(feePreview.total) }}</p>
        </div>
        <div class="overflow-x-auto rounded-lg border border-teal-100 bg-white">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-teal-100 text-[11px] uppercase tracking-wide text-teal-800/70">
                <th class="px-3 py-2 font-semibold">Concepto</th>
                <th class="px-3 py-2 font-semibold text-right">Cant.</th>
                <th class="px-3 py-2 font-semibold text-right">P. unit.</th>
                <th class="px-3 py-2 font-semibold text-right">Importe</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-teal-50">
              <tr *ngFor="let line of feePreview.lineas">
                <td class="px-3 py-2 text-gray-800">
                  {{ line.concepto }}
                  <span *ngIf="line.codigo" class="block text-[10px] font-mono text-gray-400">{{ line.codigo }}</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-gray-700">{{ line.cantidad ?? 1 }}</td>
                <td class="px-3 py-2 text-right tabular-nums text-gray-700">
                  {{ formatMoney(line.precioUnitario ?? line.monto) }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                  {{ formatMoney(line.monto) }}
                </td>
              </tr>
              <tr *ngIf="!feePreview.lineas.length">
                <td colspan="4" class="px-3 py-4 text-center text-gray-500 text-sm">
                  Sin cargos todavía. Definí el <strong>precio base</strong> arriba
                  (o elegí un producto) para ver la cuota.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div *ngIf="feePreview.descuento > 0" class="flex justify-between text-sm text-teal-900 px-1">
          <span>Descuento</span>
          <span class="tabular-nums">-{{ formatMoney(feePreview.descuento) }}</span>
        </div>
        <div class="flex justify-between text-sm font-semibold text-teal-950 px-1">
          <span>Subtotal</span>
          <span class="tabular-nums">{{ formatMoney(feePreview.subtotal) }}</span>
        </div>
      </section>

      <section *ngIf="showErpPacks" class="rounded-xl border border-sky-200 bg-sky-50/60 p-4 space-y-4">
        <div>
          <h4 class="text-sm font-semibold text-sky-950">Qué ve este cliente en el Panel</h4>
          <p class="text-xs text-sky-900/80 mt-0.5">
            Solo afecta a <strong>esta empresa</strong>, no al plan plantilla.
            Lo incluido en el plan viene de base; acá podés sumar un módulo extra (p. ej. Reportes solo para este cliente)
            u ocultar uno. Colaboradores y Reportes arrancan apagados y se cobran aparte al habilitarlos.
          </p>
        </div>

        <div class="rounded-xl border border-sky-100 bg-white overflow-hidden divide-y divide-sky-50">
          <label
            *ngFor="let mod of clientVisibleModules"
            class="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-sky-50/50"
            [class.opacity-60]="mod.alwaysOn"
            [class.cursor-default]="mod.alwaysOn">
            <input
              type="checkbox"
              class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600"
              [checked]="isModuleVisible(mod.id)"
              [disabled]="!!mod.alwaysOn"
              (change)="toggleModule(mod.id, $any($event.target).checked)"
              [name]="namePrefix + 'mod' + mod.id">
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold text-gray-900">{{ mod.label }}</span>
                <span
                  *ngIf="mod.alwaysOn || isModuleIncludedInPlan(mod.id)"
                  class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">
                  Incluido
                </span>
                <span
                  *ngIf="!mod.alwaysOn && !isModuleIncludedInPlan(mod.id)"
                  class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                  Extra
                </span>
                <span
                  class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                  [class.bg-green-100]="isModuleVisible(mod.id)"
                  [class.text-green-800]="isModuleVisible(mod.id)"
                  [class.bg-gray-100]="!isModuleVisible(mod.id)"
                  [class.text-gray-600]="!isModuleVisible(mod.id)">
                  {{ isModuleVisible(mod.id) ? 'Visible' : 'Oculto' }}
                </span>
              </span>
              <span class="block text-xs text-gray-500 mt-0.5">{{ mod.description }}</span>
            </span>
          </label>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            (click)="enableExtraModules()"
            class="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100">
            Activar Colaboradores + Reportes
          </button>
          <button
            type="button"
            (click)="disableExtraModules()"
            class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            Solo funciones incluidas
          </button>
        </div>
      </section>

      <section class="rounded-xl border border-teal-100 bg-teal-50/40 px-4 py-3">
        <div class="flex justify-between gap-3 text-sm font-bold text-teal-950">
          <span>Total mensual estimado</span>
          <span class="tabular-nums">{{ formatMoney(feePreview.total) }}</span>
        </div>
        <p class="text-[11px] text-teal-800/80 mt-1">
          Guardá los cambios para que este total quede fijo en la empresa y disponible al emitir factura.
        </p>
      </section>
    </div>
  `,
})
export class PlatformSubscriptionEditorComponent implements OnInit, OnChanges {
  readonly featurePacks = ERP_FEATURE_PACKS;
  readonly includedAdmins = INCLUDED_ADMIN_SEATS;
  readonly clientVisibleModules = SUBSCRIPTION_MODULE_CATALOG.filter(
    (mod) => mod.sellable !== false
  );

  @Input({ required: true }) plan!: PublicPlanInfo;
  @Input() namePrefix = 'sub';
  @Input() showErpPacks = true;
  @Input() draft: BusinessSubscriptionDraft = emptyBusinessSubscriptionDraft();
  @Output() draftChange = new EventEmitter<BusinessSubscriptionDraft>();

  extraAdmins = 0;

  limitsDraft = {
    limiteAdministradores: INCLUDED_ADMIN_SEATS as number | null,
    limiteOperadores: 0 as number | null,
    limiteUsuariosTotal: INCLUDED_ADMIN_SEATS as number | null,
    maxAmbitosCaja: null as number | null,
  };

  pricingDraft = {
    precioBaseOverride: null as number | null,
    precioPorAdministradorOverride: null as number | null,
    precioPorOperadorOverride: null as number | null,
    precioPorWhatsappOverride: null as number | null,
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

  get totalAdmins(): number {
    return this.includedAdmins + Math.max(0, this.extraAdmins || 0);
  }

  get feePreview(): MonthlyFeeBreakdown {
    return this.computeFee();
  }

  private planModules(): ReturnType<typeof normalizeModulesMap> {
    return normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id);
  }

  private effectiveModules() {
    return resolveEffectiveModules(this.planModules(), this.moduleOverrideState);
  }

  isModuleIncludedInPlan(moduleId: SubscriptionModuleId): boolean {
    return this.planModules()[moduleId] === true;
  }

  isModuleVisible(moduleId: SubscriptionModuleId): boolean {
    return this.effectiveModules()[moduleId] === true;
  }

  enableExtraModules() {
    this.applyModuleEnabled('collaborators', true);
    this.applyModuleEnabled('reports', true);
    this.emitChange();
  }

  disableExtraModules() {
    this.applyModuleEnabled('collaborators', false);
    this.applyModuleEnabled('reports', false);
    this.emitChange();
  }

  toggleModule(moduleId: SubscriptionModuleId, enabled: boolean) {
    this.applyModuleEnabled(moduleId, enabled);
    this.emitChange();
  }

  private applyModuleEnabled(moduleId: SubscriptionModuleId, enabled: boolean) {
    const meta = SUBSCRIPTION_MODULE_CATALOG.find((item) => item.id === moduleId);
    if (!meta || meta.alwaysOn) return;

    const planModules = this.planModules();
    const inPlan = planModules[moduleId] === true;
    const next = { ...this.moduleOverrideState };
    if (enabled === inPlan) {
      delete next[moduleId];
    } else {
      next[moduleId] = enabled ? 'on' : 'off';
    }
    this.moduleOverrideState = next;

    if (enabled && !inPlan && meta.defaultAddonPrice > 0) {
      if (this.addonOverrides[moduleId] === undefined) {
        this.addonOverrides = {
          ...this.addonOverrides,
          [moduleId]: meta.defaultAddonPrice,
        };
      }
    }
  }

  isPackOn(pack: ErpFeaturePack): boolean {
    return isFeaturePackEnabled(pack, this.effectiveModules());
  }

  togglePack(pack: ErpFeaturePack, enabled: boolean) {
    if (pack.includedByDefault && pack.id === 'negocio' && !enabled) {
      return;
    }
    const planModules = this.planModules();
    this.moduleOverrideState = applyFeaturePackOverride(
      pack,
      enabled,
      planModules,
      this.moduleOverrideState
    );
    if (enabled && !pack.includedByDefault && pack.suggestedAddonMonthly > 0) {
      for (const id of pack.modules) {
        if (this.addonOverrides[id] === undefined) {
          this.addonOverrides[id] = pack.suggestedAddonMonthly;
        }
      }
    }
    this.emitChange();
  }

  onExtraAdminsChange() {
    this.extraAdmins = Math.max(0, Math.floor(Number(this.extraAdmins) || 0));
    this.syncTotalsAndEmit();
  }

  syncTotalsAndEmit() {
    const ops = Math.max(0, Math.floor(Number(this.limitsDraft.limiteOperadores) || 0));
    this.limitsDraft.limiteOperadores = ops;
    this.limitsDraft.limiteAdministradores = this.totalAdmins;
    this.limitsDraft.limiteUsuariosTotal = this.totalAdmins + ops;
    this.emitChange();
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency: 'UYU',
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  }

  emitChange() {
    this.draftChange.emit({
      limiteAdministradores: this.limitsDraft.limiteAdministradores,
      limiteOperadores: this.limitsDraft.limiteOperadores,
      limiteUsuariosTotal: this.limitsDraft.limiteUsuariosTotal,
      maxAmbitosCaja: this.limitsDraft.maxAmbitosCaja,
      limiteWhatsapp: this.draft.limiteWhatsapp ?? null,
      precioBaseOverride: this.pricingDraft.precioBaseOverride,
      precioPorAdministradorOverride: this.pricingDraft.precioPorAdministradorOverride,
      precioPorOperadorOverride: this.pricingDraft.precioPorOperadorOverride,
      precioPorWhatsappOverride: this.pricingDraft.precioPorWhatsappOverride,
      descuentoMensual: this.pricingDraft.descuentoMensual,
      notasComerciales: this.pricingDraft.notasComerciales,
      modulosOverride: { ...this.moduleOverrideState },
      preciosAddonModuloOverride: { ...this.addonOverrides },
    });
  }

  private syncFromDraft() {
    const d = this.draft ?? emptyBusinessSubscriptionDraft();
    const admins = Math.max(
      this.includedAdmins,
      Number(d.limiteAdministradores ?? this.plan?.limiteAdministradores ?? this.includedAdmins) ||
        this.includedAdmins
    );
    this.extraAdmins = Math.max(0, admins - this.includedAdmins);
    this.limitsDraft = {
      limiteAdministradores: admins,
      limiteOperadores: Math.max(0, Number(d.limiteOperadores) || 0),
      limiteUsuariosTotal:
        d.limiteUsuariosTotal ??
        admins + Math.max(0, Number(d.limiteOperadores) || 0),
      maxAmbitosCaja: d.maxAmbitosCaja,
    };
    const planBase = this.planBasePrice();
    const savedBase = this.positiveAmount(d.precioBaseOverride);
    this.pricingDraft = {
      // Si no hay override válido, prellenar con la plantilla para que el detalle no quede en blanco.
      precioBaseOverride: savedBase ?? (planBase > 0 ? planBase : null),
      precioPorAdministradorOverride: this.optionalAmount(d.precioPorAdministradorOverride),
      precioPorOperadorOverride: this.optionalAmount(d.precioPorOperadorOverride),
      precioPorWhatsappOverride: this.optionalAmount(d.precioPorWhatsappOverride),
      descuentoMensual: Math.max(0, Number(d.descuentoMensual) || 0),
      notasComerciales: d.notasComerciales ?? '',
    };
    this.moduleOverrideState = { ...(d.modulosOverride ?? {}) };
    this.addonOverrides = { ...(d.preciosAddonModuloOverride ?? {}) };
  }

  private optionalAmount(value: number | null | undefined): number | null {
    if (value === null || value === undefined || value === ('' as unknown)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private positiveAmount(value: number | null | undefined): number | null {
    const n = this.optionalAmount(value);
    return n !== null && n > 0 ? n : null;
  }

  private planBasePrice(): number {
    const n = Number(this.plan?.precioBaseMensual ?? this.plan?.precioMensual);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Precio base efectivo para la vista previa (nunca usa 0/vacío si el plan tiene precio). */
  private effectivePrecioBase(): number {
    return this.positiveAmount(this.pricingDraft.precioBaseOverride) ?? this.planBasePrice();
  }

  private suggestedUserPrice(): number {
    return (
      this.positiveAmount(this.pricingDraft.precioPorOperadorOverride) ??
      this.positiveAmount(this.pricingDraft.precioPorAdministradorOverride) ??
      this.positiveAmount(this.plan?.precioPorOperador) ??
      this.positiveAmount(this.plan?.precioPorAdministrador) ??
      490
    );
  }

  private computeFee(): MonthlyFeeBreakdown {
    const planModules = normalizeModulesMap(this.plan.modulosIncluidos, this.plan.id);
    const effective = resolveEffectiveModules(planModules, this.moduleOverrideState);
    const addonPrices = { ...this.plan.preciosAddonModulo, ...this.addonOverrides };
    for (const meta of SUBSCRIPTION_MODULE_CATALOG) {
      if (addonPrices[meta.id] === undefined) addonPrices[meta.id] = meta.defaultAddonPrice;
    }

    const suggestedUser = this.suggestedUserPrice();

    return calculateMonthlyFee({
      precioBase: this.effectivePrecioBase(),
      precioPorAdministrador:
        this.positiveAmount(this.pricingDraft.precioPorAdministradorOverride) ?? suggestedUser,
      precioPorOperador:
        this.positiveAmount(this.pricingDraft.precioPorOperadorOverride) ?? suggestedUser,
      limiteAdministradores: this.totalAdmins,
      limiteOperadores: this.limitsDraft.limiteOperadores ?? 0,
      includedAdministradores: this.includedAdmins,
      whatsappLines: this.draft.limiteWhatsapp ?? 0,
      includedWhatsapp: INCLUDED_WHATSAPP_SEATS,
      precioPorWhatsapp:
        this.positiveAmount(this.pricingDraft.precioPorWhatsappOverride) ?? suggestedUser,
      planModules,
      effectiveModules: effective,
      addonPrices,
      descuentoMensual: this.pricingDraft.descuentoMensual,
    });
  }
}

export function emptyBusinessSubscriptionDraft(): BusinessSubscriptionDraft {
  return {
    limiteAdministradores: INCLUDED_ADMIN_SEATS,
    limiteOperadores: 0,
    limiteUsuariosTotal: INCLUDED_ADMIN_SEATS,
    maxAmbitosCaja: null,
    limiteWhatsapp: null,
    precioBaseOverride: null,
    precioPorAdministradorOverride: null,
    precioPorOperadorOverride: null,
    precioPorWhatsappOverride: null,
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
  const admins =
    sub.limiteAdministradores ??
    effective?.limiteAdministradores ??
    plan.limiteAdministradores ??
    INCLUDED_ADMIN_SEATS;
  const ops = sub.limiteOperadores ?? effective?.limiteOperadores ?? plan.limiteOperadores ?? 0;
  return {
    limiteAdministradores: Math.max(INCLUDED_ADMIN_SEATS, admins),
    limiteOperadores: Math.max(0, ops),
    limiteUsuariosTotal:
      sub.limiteUsuariosTotal ??
      effective?.limiteUsuariosTotal ??
      Math.max(INCLUDED_ADMIN_SEATS, admins) + Math.max(0, ops),
    maxAmbitosCaja:
      sub.maxAmbitosCaja ?? effective?.maxAmbitosCaja ?? plan.maxAmbitosCaja ?? 0,
    limiteWhatsapp: sub.limiteWhatsapp ?? null,
    precioBaseOverride: sub.precioBaseOverride ?? null,
    precioPorAdministradorOverride: sub.precioPorAdministradorOverride ?? null,
    precioPorOperadorOverride: sub.precioPorOperadorOverride ?? null,
    precioPorWhatsappOverride: sub.precioPorWhatsappOverride ?? null,
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
      limiteWhatsapp: draft.limiteWhatsapp,
      precioBaseOverride: draft.precioBaseOverride,
      precioPorAdministradorOverride: draft.precioPorAdministradorOverride,
      precioPorOperadorOverride: draft.precioPorOperadorOverride,
      precioPorWhatsappOverride: draft.precioPorWhatsappOverride,
      descuentoMensual: draft.descuentoMensual,
      notasComerciales: draft.notasComerciales,
      modulosOverride: draft.modulosOverride,
      preciosAddonModuloOverride: draft.preciosAddonModuloOverride,
    },
  };
}
