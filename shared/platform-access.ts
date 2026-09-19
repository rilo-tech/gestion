import type { WebExperienceId } from './product-capability-contract.ts';
import { webExperienceForProduct } from './product-capability-contract.ts';

/** Producto elegido en registro / trial autoservicio. */
export const TRIAL_PRODUCT_IDS = ['cash', 'whatsapp', 'erp', 'completo'] as const;

export type TrialProductId = (typeof TRIAL_PRODUCT_IDS)[number];

/** Alias comerciales legibles (EF: bot / gestion / complete). */
export const COMMERCIAL_PRODUCT_ALIASES: Record<TrialProductId, string> = {
  cash: 'caja',
  whatsapp: 'bot',
  erp: 'gestion',
  completo: 'complete',
};

export const TRIAL_PRODUCT_LABELS: Record<TrialProductId, string> = {
  cash: 'RILO Caja',
  whatsapp: 'RILO Bot',
  erp: 'RILO Gestión',
  completo: 'RILO Completo',
};

/** Frase corta bajo el nombre del producto (landing / planes). */
export const TRIAL_PRODUCT_TAGLINES: Record<TrialProductId, string> = {
  cash: 'Ingresos y gastos por WhatsApp',
  whatsapp: 'Tu negocio por WhatsApp',
  erp: 'Panel web',
  completo: 'Bot + Gestión',
};

export const TRIAL_PRODUCT_DESCRIPTIONS: Record<TrialProductId, string> = {
  cash:
    'RILO Caja usa IA para ayudarte a registrar movimientos hablando como hablás. Anotá ingresos, gastos y cobros por WhatsApp, consultá tu saldo y recibí resúmenes claros.',
  whatsapp:
    'Anotá y consultá tu negocio por WhatsApp. RILO deja todo ordenado y podés revisar tu actividad desde Resumen RILO.',
  erp: 'Panel web para controlar tu negocio en la computadora. Revisá clientes, productos, pedidos, ventas, compras y caja desde un solo lugar.',
  completo:
    'Usalo por WhatsApp cuando estás trabajando. Controlalo desde RILO Gestión cuando querés ver todo. Una sola información, dos formas de trabajar.',
};

function resolveWhatsappOnlyProduct(
  existing: ClientPlatformAccess,
  incoming: TrialProductId
): TrialProductId {
  if (incoming === 'cash') return 'cash';
  if (incoming === 'whatsapp') return 'whatsapp';
  if (existing.trialProduct === 'cash') return 'cash';
  return 'whatsapp';
}

export type { WebExperienceId };

export interface ClientPlatformAccess {
  /** Motor interno del ERP; siempre activo si hay algún módulo operativo. */
  erpCoreEnabled: boolean;
  /** Panel web del cliente (/dashboard, Resumen RILO, etc.). */
  erpWebEnabled: boolean;
  /**
   * Experiencia web efectiva.
   * - none: sin panel
   * - summary: Resumen RILO (Bot)
   * - full: RILO Gestión
   * - cash_only: solo Caja
   */
  webExperience?: WebExperienceId;
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
  webExperience: 'full',
  erpWebPaused: false,
  whatsappEnabled: false,
  whatsappPaused: false,
  aiEnabled: false,
  trialProduct: null,
};

export function isTrialProductId(value: unknown): value is TrialProductId {
  return typeof value === 'string' && (TRIAL_PRODUCT_IDS as readonly string[]).includes(value);
}

/** Acepta ids internos (`cash`) y aliases comerciales (`caja`). */
export function resolveTrialProductId(value: unknown): TrialProductId | null {
  if (isTrialProductId(value)) return value;
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'caja' || raw === 'rilo_caja' || raw === 'rilo-caja') return 'cash';
  if (raw === 'bot' || raw === 'rilobot') return 'whatsapp';
  if (raw === 'gestion' || raw === 'gestión' || raw === 'panel') return 'erp';
  if (raw === 'complete' || raw === 'full') return 'completo';
  return null;
}

export function mergePlatformAccessWithProduct(
  existing: ClientPlatformAccess,
  product: TrialProductId
): ClientPlatformAccess {
  const incoming = platformAccessForTrialProduct(product);
  let erpWebEnabled = existing.erpWebEnabled === true || incoming.erpWebEnabled === true;
  const whatsappEnabled = existing.whatsappEnabled === true || incoming.whatsappEnabled === true;
  const aiEnabled = existing.aiEnabled === true || incoming.aiEnabled === true;

  /**
   * Upgrade Caja → Bot: Bot usa Resumen RILO (summary), no panel full.
   * Upgrade Caja → Gestión/Completo: sale del perfil cash_only.
   */
  if (existing.trialProduct === 'cash' && product === 'whatsapp') {
    erpWebEnabled = true;
  }

  let trialProduct: TrialProductId | null = product;
  if (product === 'completo') {
    trialProduct = 'completo';
  } else if (product === 'cash' && (!existing.trialProduct || existing.trialProduct === 'cash')) {
    trialProduct = 'cash';
  } else if (existing.trialProduct === 'cash' && (product === 'erp' || product === 'whatsapp')) {
    trialProduct = erpWebEnabled && whatsappEnabled && product === 'erp' ? 'completo' : product;
  } else if (
    erpWebEnabled &&
    whatsappEnabled &&
    resolveWebExperience(incoming, product) === 'full' &&
    resolveWebExperience(existing, existing.trialProduct) === 'full'
  ) {
    trialProduct = 'completo';
  } else if (whatsappEnabled && resolveWebExperience(incoming, product) === 'summary') {
    trialProduct = resolveWhatsappOnlyProduct(existing, product);
  } else if (whatsappEnabled && !erpWebEnabled) {
    trialProduct = resolveWhatsappOnlyProduct(existing, product);
  } else if (erpWebEnabled && resolveWebExperience(incoming, product) === 'full' && !whatsappEnabled) {
    trialProduct = 'erp';
  } else if (erpWebEnabled && whatsappEnabled) {
    // Bot summary + WA no es Completo.
    const exp = resolveWebExperience(incoming, product);
    trialProduct = exp === 'full' ? 'completo' : product === 'whatsapp' ? 'whatsapp' : product;
  } else if (erpWebEnabled) {
    trialProduct = product === 'cash' ? 'cash' : 'erp';
  }

  const webExperience = resolveWebExperience(
    { ...incoming, trialProduct, erpWebEnabled, whatsappEnabled },
    trialProduct
  );

  return {
    erpCoreEnabled: true,
    erpWebEnabled,
    webExperience,
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
  const current = productIdFromAccess(access);
  if (product === 'cash') return current === 'cash';
  if (product === 'whatsapp') {
    return current === 'whatsapp' || current === 'completo';
  }
  if (product === 'erp') {
    return current === 'erp' || current === 'completo';
  }
  return current === 'completo';
}

/** Producto comercial efectivo según canales activos. */
export function productIdFromAccess(access: ClientPlatformAccess): TrialProductId | null {
  // Caja: WA + panel mínimo; trialProduct es la señal canónica.
  if (access.trialProduct === 'cash' && access.whatsappEnabled === true) {
    return 'cash';
  }
  const exp = resolveWebExperience(access, access.trialProduct);
  // Bot con Resumen RILO: no confundir con Completo.
  if (access.whatsappEnabled && (exp === 'summary' || access.trialProduct === 'whatsapp')) {
    if (exp !== 'full') return 'whatsapp';
  }
  if (access.erpWebEnabled && access.whatsappEnabled && exp === 'full') return 'completo';
  if (access.whatsappEnabled) return 'whatsapp';
  if (access.erpWebEnabled) return access.trialProduct === 'cash' ? 'cash' : 'erp';
  return isTrialProductId(access.trialProduct) ? access.trialProduct : null;
}

export function resolveWebExperience(
  access: Pick<ClientPlatformAccess, 'webExperience' | 'erpWebEnabled' | 'whatsappEnabled' | 'trialProduct'>,
  productHint?: TrialProductId | null
): WebExperienceId {
  if (
    access.webExperience === 'none' ||
    access.webExperience === 'summary' ||
    access.webExperience === 'full' ||
    access.webExperience === 'cash_only'
  ) {
    return access.webExperience;
  }
  const product = productHint ?? access.trialProduct ?? null;
  if (product) return webExperienceForProduct(product);
  if (access.erpWebEnabled && access.whatsappEnabled) return 'full';
  if (access.erpWebEnabled) return 'full';
  if (access.whatsappEnabled) return 'summary';
  return 'none';
}

export function isSummaryWebExperience(access: ClientPlatformAccess): boolean {
  return resolveWebExperience(access) === 'summary';
}

export function isFullWebExperience(access: ClientPlatformAccess): boolean {
  return resolveWebExperience(access) === 'full';
}

export function productLabelForAccess(access: ClientPlatformAccess): string {
  const id = productIdFromAccess(access);
  return id ? TRIAL_PRODUCT_LABELS[id] : 'RILO';
}

export function platformAccessForTrialProduct(product: TrialProductId): ClientPlatformAccess {
  switch (product) {
    case 'cash':
      return {
        erpCoreEnabled: true,
        erpWebEnabled: true,
        webExperience: 'cash_only',
        erpWebPaused: false,
        whatsappEnabled: true,
        whatsappPaused: false,
        aiEnabled: true,
        trialProduct: product,
      };
    case 'whatsapp':
      return {
        erpCoreEnabled: true,
        /** Resumen RILO (mini panel), no Gestión completa. */
        erpWebEnabled: true,
        webExperience: 'summary',
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
        webExperience: 'full',
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
        webExperience: 'full',
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
  const trialProduct = isTrialProductId(raw.trialProduct) ? raw.trialProduct : null;
  const base: ClientPlatformAccess = {
    erpCoreEnabled: true,
    erpWebEnabled: raw.erpWebEnabled !== false,
    erpWebPaused: raw.erpWebPaused === true,
    whatsappEnabled: raw.whatsappEnabled === true,
    whatsappPaused: raw.whatsappPaused === true,
    aiEnabled: raw.aiEnabled === true,
    trialProduct,
    webExperience: raw.webExperience,
  };
  // Legacy Bot: erpWebEnabled false + whatsapp → summary (Resumen RILO).
  if (
    trialProduct === 'whatsapp' &&
    raw.erpWebEnabled === false &&
    raw.webExperience == null
  ) {
    base.erpWebEnabled = true;
    base.webExperience = 'summary';
  }
  base.webExperience = resolveWebExperience(base, trialProduct);
  return base;
}
