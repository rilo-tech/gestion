/** Producto elegido en registro / trial autoservicio. */
export const TRIAL_PRODUCT_IDS = ['whatsapp', 'erp', 'completo'] as const;

export type TrialProductId = (typeof TRIAL_PRODUCT_IDS)[number];

export const TRIAL_PRODUCT_LABELS: Record<TrialProductId, string> = {
  whatsapp: 'Solo WhatsApp',
  erp: 'Solo ERP Web',
  completo: 'WhatsApp + ERP',
};

export const TRIAL_PRODUCT_DESCRIPTIONS: Record<TrialProductId, string> = {
  whatsapp:
    'Cargá pedidos, ventas y pagos escribiendo mensajes. Ideal si no querés entrar a un sistema todos los días.',
  erp: 'Controlá clientes, caja, stock, ventas y reportes desde una web ordenada.',
  completo: 'Usá WhatsApp para cargar rápido y el ERP para controlar todo con detalle.',
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
