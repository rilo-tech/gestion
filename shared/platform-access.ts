/** Producto elegido en registro / trial autoservicio. */
export const TRIAL_PRODUCT_IDS = ['whatsapp', 'erp', 'completo'] as const;

export type TrialProductId = (typeof TRIAL_PRODUCT_IDS)[number];

export const TRIAL_PRODUCT_LABELS: Record<TrialProductId, string> = {
  whatsapp: 'RiloBot (WhatsApp)',
  erp: 'Panel web',
  completo: 'RiloBot + Panel',
};

export const TRIAL_PRODUCT_DESCRIPTIONS: Record<TrialProductId, string> = {
  whatsapp:
    'Recomendado para empezar. Ideal para microemprendimientos que manejan el negocio desde el celular. Incluye 1 WhatsApp, acciones IA, pedidos, ventas, cobros, saldos, fotos y consultas rápidas.',
  erp: 'Para quien prefiere ver el negocio en pantalla. Incluye 1 usuario, clientes, pedidos, ventas, cobros, caja, stock, compras, proveedores y reportes base.',
  completo:
    'Cargá rápido por WhatsApp y controlá todo en la web. Un mismo historial, 1 WhatsApp, 1 usuario y más acciones IA.',
};

export interface ClientPlatformAccess {
  /** Motor interno del ERP; siempre activo si hay algún módulo operativo. */
  erpCoreEnabled: boolean;
  /** Panel web del cliente (/dashboard, etc.). */
  erpWebEnabled: boolean;
  whatsappEnabled: boolean;
  aiEnabled: boolean;
  trialProduct?: TrialProductId | null;
}

export const DEFAULT_PLATFORM_ACCESS: ClientPlatformAccess = {
  erpCoreEnabled: true,
  erpWebEnabled: true,
  whatsappEnabled: false,
  aiEnabled: false,
  trialProduct: null,
};

export function isTrialProductId(value: unknown): value is TrialProductId {
  return typeof value === 'string' && (TRIAL_PRODUCT_IDS as readonly string[]).includes(value);
}

export function platformAccessForTrialProduct(product: TrialProductId): ClientPlatformAccess {
  switch (product) {
    case 'whatsapp':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: false,
        whatsappEnabled: true,
        aiEnabled: true,
        trialProduct: product,
      };
    case 'erp':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: true,
        whatsappEnabled: false,
        aiEnabled: false,
        trialProduct: product,
      };
    case 'completo':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: true,
        whatsappEnabled: true,
        aiEnabled: true,
        trialProduct: product,
      };
    default:
      return { ...DEFAULT_PLATFORM_ACCESS };
  }
}

/** Empresas existentes sin campo: asumen ERP Web habilitado (comportamiento actual). */
export function normalizePlatformAccess(
  raw?: Partial<ClientPlatformAccess> | null
): ClientPlatformAccess {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PLATFORM_ACCESS };
  }
  return {
    erpCoreEnabled: true,
    erpWebEnabled: raw.erpWebEnabled !== false,
    whatsappEnabled: raw.whatsappEnabled === true,
    aiEnabled: raw.aiEnabled === true,
    trialProduct: isTrialProductId(raw.trialProduct) ? raw.trialProduct : null,
  };
}
