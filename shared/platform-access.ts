/** Producto elegido en registro / trial autoservicio. */
export const TRIAL_PRODUCT_IDS = ['whatsapp', 'erp', 'completo'] as const;

export type TrialProductId = (typeof TRIAL_PRODUCT_IDS)[number];

export const TRIAL_PRODUCT_LABELS: Record<TrialProductId, string> = {
  whatsapp: 'RILO Bot',
  erp: 'RILO Gestión',
  completo: 'RILO Completo',
};

/** Frase corta bajo el nombre del producto (landing / planes). */
export const TRIAL_PRODUCT_TAGLINES: Record<TrialProductId, string> = {
  whatsapp: 'Gestión rápida desde WhatsApp',
  erp: 'Panel web',
  completo: 'Bot + Gestión',
};

export const TRIAL_PRODUCT_DESCRIPTIONS: Record<TrialProductId, string> = {
  whatsapp:
    'Gestión rápida desde WhatsApp. Escribís lo que pasó, RILO Bot lo entiende y antes de guardar te muestra un resumen para que confirmes.',
  erp: 'Panel web para controlar tu negocio en la computadora. Revisá clientes, productos, pedidos, ventas, compras y caja desde un solo lugar.',
  completo:
    'Bot + Gestión: cargá rápido desde WhatsApp y controlá todo desde la web. Una sola información, dos formas de trabajar.',
};

export interface ClientPlatformAccess {
  /** Motor interno del ERP; siempre activo si hay algún módulo operativo. */
  erpCoreEnabled: boolean;
  /** Panel web del cliente (/dashboard, etc.). */
  erpWebEnabled: boolean;
  /**
   * Baja operativa del panel. El producto sigue contratado; el cliente no entra
   * al ERP hasta reactivarlo desde Planes.
   */
  erpWebPaused?: boolean;
  whatsappEnabled: boolean;
  /**
   * Baja operativa de RILO Bot. El producto sigue contratado; el bot no responde
   * hasta reactivarlo desde Planes.
   */
  whatsappPaused?: boolean;
  aiEnabled: boolean;
  trialProduct?: TrialProductId | null;
}

export const DEFAULT_PLATFORM_ACCESS: ClientPlatformAccess = {
  erpCoreEnabled: true,
  erpWebEnabled: true,
  erpWebPaused: false,
  whatsappEnabled: false,
  whatsappPaused: false,
  aiEnabled: false,
  trialProduct: null,
};

export function isTrialProductId(value: unknown): value is TrialProductId {
  return typeof value === 'string' && (TRIAL_PRODUCT_IDS as readonly string[]).includes(value);
}

export function mergePlatformAccessWithProduct(
  existing: ClientPlatformAccess,
  product: TrialProductId
): ClientPlatformAccess {
  const incoming = platformAccessForTrialProduct(product);
  const erpWebEnabled = existing.erpWebEnabled === true || incoming.erpWebEnabled === true;
  const whatsappEnabled = existing.whatsappEnabled === true || incoming.whatsappEnabled === true;
  const aiEnabled = existing.aiEnabled === true || incoming.aiEnabled === true;
  let trialProduct: TrialProductId | null = product;
  if (erpWebEnabled && whatsappEnabled) trialProduct = 'completo';
  else if (whatsappEnabled) trialProduct = 'whatsapp';
  else if (erpWebEnabled) trialProduct = 'erp';
  return {
    erpCoreEnabled: true,
    erpWebEnabled,
    erpWebPaused: incoming.erpWebEnabled ? false : existing.erpWebPaused === true,
    whatsappEnabled,
    whatsappPaused: incoming.whatsappEnabled ? false : existing.whatsappPaused === true,
    aiEnabled,
    trialProduct,
  };
}

/** Panel web contratado y no dado de baja. */
export function isErpWebOperational(access: ClientPlatformAccess): boolean {
  return access.erpWebEnabled === true && access.erpWebPaused !== true;
}

/** RILO Bot contratado y no dado de baja. */
export function isWhatsappOperational(access: ClientPlatformAccess): boolean {
  return access.whatsappEnabled === true && access.whatsappPaused !== true;
}

export function withErpWebPaused(
  access: ClientPlatformAccess,
  paused: boolean
): ClientPlatformAccess {
  if (!access.erpWebEnabled) {
    return { ...access, erpWebPaused: false };
  }
  return { ...access, erpWebPaused: paused };
}

export function withWhatsappPaused(
  access: ClientPlatformAccess,
  paused: boolean
): ClientPlatformAccess {
  if (!access.whatsappEnabled) {
    return { ...access, whatsappPaused: false };
  }
  return { ...access, whatsappPaused: paused };
}

export function productAlreadyEnabled(
  access: ClientPlatformAccess,
  product: TrialProductId
): boolean {
  if (product === 'whatsapp') return access.whatsappEnabled === true;
  if (product === 'erp') return access.erpWebEnabled === true;
  return access.whatsappEnabled === true && access.erpWebEnabled === true;
}

/** Producto comercial efectivo según canales activos. */
export function productIdFromAccess(access: ClientPlatformAccess): TrialProductId | null {
  if (access.erpWebEnabled && access.whatsappEnabled) return 'completo';
  if (access.whatsappEnabled) return 'whatsapp';
  if (access.erpWebEnabled) return 'erp';
  return isTrialProductId(access.trialProduct) ? access.trialProduct : null;
}

export function productLabelForAccess(access: ClientPlatformAccess): string {
  const id = productIdFromAccess(access);
  return id ? TRIAL_PRODUCT_LABELS[id] : 'RILO';
}

export function platformAccessForTrialProduct(product: TrialProductId): ClientPlatformAccess {
  switch (product) {
    case 'whatsapp':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: false,
        erpWebPaused: false,
        whatsappEnabled: true,
        whatsappPaused: false,
        aiEnabled: true,
        trialProduct: product,
      };
    case 'erp':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: true,
        erpWebPaused: false,
        whatsappEnabled: false,
        whatsappPaused: false,
        aiEnabled: false,
        trialProduct: product,
      };
    case 'completo':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: true,
        erpWebPaused: false,
        whatsappEnabled: true,
        whatsappPaused: false,
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
    erpWebPaused: raw.erpWebPaused === true,
    whatsappEnabled: raw.whatsappEnabled === true,
    whatsappPaused: raw.whatsappPaused === true,
    aiEnabled: raw.aiEnabled === true,
    trialProduct: isTrialProductId(raw.trialProduct) ? raw.trialProduct : null,
  };
}
