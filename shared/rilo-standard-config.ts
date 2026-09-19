/**
 * Defaults genéricos para tenants `standard_v1`.
 * NO pisa empresas legacy (RILO Personalizados, etc.).
 */
import type { CategoriaGastoConfig, MedioPagoConfig } from './finance-config.ts';
import { DEFAULT_MEDIOS_PAGO } from './finance-config.ts';
import { RILO_STANDARD_CONFIG_VERSION } from './product-capability-contract.ts';

export { RILO_STANDARD_CONFIG_VERSION };

/** Categorías de gasto genéricas (sin DTF/Sublimación/VPS). */
export const STANDARD_CATEGORIAS_GASTO: CategoriaGastoConfig[] = [
  { id: 'mercaderia', label: 'Mercadería / insumos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'servicios', label: 'Servicios', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'alquiler', label: 'Alquiler', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'impuestos', label: 'Impuestos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'sueldos', label: 'Sueldos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'transporte', label: 'Transporte', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'marketing', label: 'Marketing', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'mantenimiento', label: 'Mantenimiento', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'otros', label: 'Otros', ambitoDefault: 'negocio', afectaReporteNegocio: true },
];

export const STANDARD_MEDIOS_PAGO: MedioPagoConfig[] = DEFAULT_MEDIOS_PAGO.filter((m) =>
  ['efectivo', 'transferencia', 'mercado_pago', 'debito', 'tarjeta_credito'].includes(m.id)
);

export const STANDARD_ORDER_STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  pendiente: 'Pendiente',
  en_produccion: 'En proceso',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export type StandardOnboardingAnswers = {
  sells: 'products' | 'services' | 'both';
  managesStock?: boolean;
  defaultPaymentMethod?: string;
  enableRecommendedAlerts?: boolean;
};

export function profileModeFromOnboarding(
  answers: StandardOnboardingAnswers
): 'products' | 'services' | 'mixed' {
  if (answers.sells === 'products') return 'products';
  if (answers.sells === 'services') return 'services';
  return 'mixed';
}

export function buildStandardAppConfigSeed(answers?: Partial<StandardOnboardingAnswers>): {
  standardConfigVersion: typeof RILO_STANDARD_CONFIG_VERSION;
  finanzas: {
    categoriasGasto: CategoriaGastoConfig[];
    mediosPago: MedioPagoConfig[];
  };
  defaults: {
    defaultPaymentMethod: string;
  };
} {
  const payment = String(answers?.defaultPaymentMethod ?? 'efectivo').trim() || 'efectivo';
  return {
    standardConfigVersion: RILO_STANDARD_CONFIG_VERSION,
    finanzas: {
      categoriasGasto: STANDARD_CATEGORIAS_GASTO,
      mediosPago: STANDARD_MEDIOS_PAGO,
    },
    defaults: {
      defaultPaymentMethod: payment,
    },
  };
}
