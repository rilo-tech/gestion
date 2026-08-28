import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  getConversationState,
  saveConversationState,
} from './conversation-state.ts';
import { db } from '../firebase.ts';
import {
  createCatalogProductFromWhatsapp,
  createClientFromWhatsapp,
  createSupplierFromWhatsapp,
  registerCashFromWhatsapp,
} from './erp-writes.ts';
import { extractAmountFromText } from './lookups.ts';
import { productExamplesLine, whatsappCopyForRubro } from './copy.ts';
import {
  isHelpFollowUp,
  matchSetupLoad,
  hasSetupGaps,
  type SetupGaps,
  type SetupLoadStep,
} from '../../shared/whatsapp-copy.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';

type OnboardingResult = {
  reply: string;
  replies?: string[];
  intent: string;
  executed: boolean;
  businessId?: string;
};

export const ONBOARDING_MENU = 'onboarding_menu';
export const ONBOARDING_CASH = 'onboarding_cash';
export const ONBOARDING_CASH_CONFIRM = 'onboarding_cash_confirm';
export const ONBOARDING_PRODUCTS = 'onboarding_products';
export const ONBOARDING_PRODUCT_CONFIRM = 'onboarding_product_confirm';
export const ONBOARDING_CLIENTS = 'onboarding_clients';
export const ONBOARDING_CLIENT_CONFIRM = 'onboarding_client_confirm';
export const ONBOARDING_SUPPLIERS = 'onboarding_suppliers';
export const ONBOARDING_SUPPLIER_CONFIRM = 'onboarding_supplier_confirm';

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no|cancelar|cancel|n)$/i;
const DONE = /^(listo|listo\.|termin[eé]|fin|nada m[aá]s)$/i;
const SKIP_ZERO = /^(4|cero|de cero|empezar de cero|despu[eé]s|despues|skip)$/i;
const REOPEN = /^(configurar|configuraci[oó]n inicial)$/i;

export function isOnboardingIntent(intent?: string | null): boolean {
  return (
    intent === ONBOARDING_MENU ||
    intent === ONBOARDING_CASH ||
    intent === ONBOARDING_CASH_CONFIRM ||
    intent === ONBOARDING_PRODUCTS ||
    intent === ONBOARDING_PRODUCT_CONFIRM ||
    intent === ONBOARDING_CLIENTS ||
    intent === ONBOARDING_CLIENT_CONFIRM ||
    intent === ONBOARDING_SUPPLIERS ||
    intent === ONBOARDING_SUPPLIER_CONFIRM
  );
}

export function isSetupReopenText(text: string): boolean {
  return REOPEN.test(text.trim());
}

function firstName(fullName?: string): string {
  const name = String(fullName ?? '').trim();
  if (!name) return '';
  return name.split(/\s+/)[0] ?? name;
}

export function buildHowToMessage(userName?: string, rubro?: string | null): string {
  const hi = firstName(userName);
  void rubro;
  return (
    `Hola${hi ? ` ${hi}` : ''} 👋 Soy RILO Bot.\n\n` +
    `Anoto pedidos, ventas, compras, cobros, clientes y caja.\n` +
    `Escribís como hablás: voy aprendiendo tu forma. Te armo un resumen; *SÍ* guarda y *NO* cancela.\n\n` +
    `Si no cargaste saldo, la caja arranca en *$0*.\n\n` +
    `¿Qué querés hacer? O escribí *consultame* y te listo las opciones.`
  );
}

export function buildSetupMenu(): string {
  return waCard({
    title: 'Empezar',
    lines: [
      `La caja arranca en ${waBold('$0')}. Productos y proveedores se crean cuando anotes.`,
      '',
      '¿Querés cargar algo ahora?',
      '1) Saldo inicial de caja',
      '2) Algunos productos',
      '3) Algunos proveedores',
      '4) Listo, ya quiero operar',
    ],
  });
}

export function buildWelcomeMessage(
  userName?: string,
  _offerSetup = false,
  rubro?: string | null
): string {
  return buildHowToMessage(userName, rubro);
}

export function welcomeMessages(
  userName?: string,
  offerSetup = false,
  rubro?: string | null
): string[] {
  const howTo = buildHowToMessage(userName, rubro);
  if (!offerSetup) return [howTo];
  return [howTo, buildSetupMenu()];
}

function looksLikeOperation(text: string): boolean {
  if (matchSetupLoad(text)) return false;
  return /\b(venta|vend[ií]|pedido|orden|pago|cobro|abon[oó]|saldo|caja)\b/i.test(text);
}

export async function loadSetupGaps(businessId: string): Promise<SetupGaps> {
  try {
    const [cash, stock, suppliers] = await Promise.all([
      db.collection(`negocios/${businessId}/movimientos_caja`).limit(1).get(),
      db.collection(`negocios/${businessId}/stock`).limit(5).get(),
      db.collection(`negocios/${businessId}/proveedores`).limit(1).get(),
    ]);
    const hasProduct = stock.docs.some((doc) => doc.data()?.activo !== false);
    return {
      cash: cash.empty,
      products: !hasProduct,
      suppliers: suppliers.empty,
    };
  } catch {
    return { cash: false, products: false, suppliers: false };
  }
}

async function markSetupDone(businessId: string, phone: string): Promise<void> {
  await saveConversationState(businessId, phone, {
    pendingIntent: null,
    pendingPayload: null,
    setupStatus: 'done',
  });
}

async function showMenu(
  tenant: WhatsappTenantContext,
  extra?: string
): Promise<OnboardingResult> {
  await saveConversationState(tenant.businessId, tenant.phone, {
    pendingIntent: ONBOARDING_MENU,
    pendingPayload: null,
    setupStatus: 'offered',
  });
  const body = extra ? `${extra}\n\n${buildSetupMenu()}` : buildSetupMenu();
  return {
    reply: body,
    intent: ONBOARDING_MENU,
    executed: false,
    businessId: tenant.businessId,
  };
}

export async function beginWelcome(
  tenant: WhatsappTenantContext
): Promise<OnboardingResult> {
  const state = await getConversationState(tenant.businessId, tenant.phone);
  const gaps = await loadSetupGaps(tenant.businessId);
  const offerSetup = state?.setupStatus !== 'done' && hasSetupGaps(gaps);
  if (offerSetup) {
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_MENU,
      pendingPayload: null,
      setupStatus: 'offered',
    });
  }
  const pages = welcomeMessages(tenant.userName, offerSetup, tenant.rubro);
  return {
    reply: pages[0] ?? buildWelcomeMessage(tenant.userName, offerSetup, tenant.rubro),
    replies: pages.length > 1 ? pages : undefined,
    intent: 'greeting',
    executed: false,
    businessId: tenant.businessId,
  };
}

export async function reopenSetupMenu(
  tenant: WhatsappTenantContext
): Promise<OnboardingResult> {
  return showMenu(tenant, 'Podés cargar saldo de caja, productos o proveedores. Cada alta te la confirmo antes.');
}

function skipReply(): string {
  return (
    'Listo. Si no cargaste saldo, la caja queda en $0. ' +
    'Productos y proveedores se siguen creando cuando anotes pedidos, compras o ventas.\n' +
    'Cuando quieras, escribinos una venta o un pedido.'
  );
}

async function startCash(tenant: WhatsappTenantContext): Promise<OnboardingResult> {
  await saveConversationState(tenant.businessId, tenant.phone, {
    pendingIntent: ONBOARDING_CASH,
    pendingPayload: null,
    setupStatus: 'offered',
  });
  return {
    reply: waCard({
      title: 'Saldo de caja',
      lines: ['Mandá el monto (ej. 5000). Si no hay, 0 o *LISTO*.'],
    }),
    intent: ONBOARDING_CASH,
    executed: false,
    businessId: tenant.businessId,
  };
}

async function startProducts(tenant: WhatsappTenantContext): Promise<OnboardingResult> {
  await saveConversationState(tenant.businessId, tenant.phone, {
    pendingIntent: ONBOARDING_PRODUCTS,
    pendingPayload: null,
    setupStatus: 'offered',
  });
  return {
    reply: waCard({
      title: 'Productos',
      lines: [
        'Mandame uno por mensaje, con el detalle que lo distingue y el precio si querés.',
        productExamplesLine(whatsappCopyForRubro(tenant.rubro)),
        'Cuando termines, *LISTO*.',
      ],
    }),
    intent: ONBOARDING_PRODUCTS,
    executed: false,
    businessId: tenant.businessId,
  };
}

async function startClients(tenant: WhatsappTenantContext): Promise<OnboardingResult> {
  await saveConversationState(tenant.businessId, tenant.phone, {
    pendingIntent: ONBOARDING_CLIENTS,
    pendingPayload: null,
    setupStatus: 'offered',
  });
  return {
    reply: waCard({
      title: 'Clientes',
      lines: ['Mandame uno por mensaje, nombre y apellido.', 'Ej: María Silva', 'Cuando termines, *LISTO*.'],
    }),
    intent: ONBOARDING_CLIENTS,
    executed: false,
    businessId: tenant.businessId,
  };
}

async function startSuppliers(tenant: WhatsappTenantContext): Promise<OnboardingResult> {
  await saveConversationState(tenant.businessId, tenant.phone, {
    pendingIntent: ONBOARDING_SUPPLIERS,
    pendingPayload: null,
    setupStatus: 'offered',
  });
  return {
    reply: waCard({
      title: 'Proveedores',
      lines: [
        'Mandame uno por mensaje, con el nombre.',
        'Ej: Disershop',
        'O mandá la *foto de una factura* y lo registro con la compra.',
        'Cuando termines, *LISTO*.',
      ],
    }),
    intent: ONBOARDING_SUPPLIERS,
    executed: false,
    businessId: tenant.businessId,
  };
}

export async function startSetupStep(
  tenant: WhatsappTenantContext,
  step: SetupLoadStep
): Promise<OnboardingResult> {
  if (step === 'cash') return startCash(tenant);
  if (step === 'products') return startProducts(tenant);
  if (step === 'suppliers') return startSuppliers(tenant);
  return startClients(tenant);
}

/**
 * Maneja el wizard de configuración inicial.
 * Devuelve null si el mensaje parece una operación real: el handler debe seguir el flujo normal.
 */
export async function handleOnboardingPending(
  tenant: WhatsappTenantContext,
  text: string,
  pendingIntent: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<OnboardingResult | null> {
  const trimmed = text.trim();
  if (!isOnboardingIntent(pendingIntent)) return null;

  if (looksLikeOperation(trimmed) && !/^(1|2|3|4)$/.test(trimmed)) {
    await markSetupDone(tenant.businessId, tenant.phone);
    return null;
  }
  const setupStep = matchSetupLoad(trimmed);
  if (setupStep) {
    return startSetupStep(tenant, setupStep);
  }
  if (
    !/^(1|2|3|4)$/.test(trimmed) &&
    (/\b(consultame|consultáme|ayuda|help)\b/i.test(trimmed) || isHelpFollowUp(trimmed))
  ) {
    return null;
  }

  if (pendingIntent === ONBOARDING_MENU) {
    if (SKIP_ZERO.test(trimmed) || CONFIRM_NO.test(trimmed) || DONE.test(trimmed)) {
      await markSetupDone(tenant.businessId, tenant.phone);
      return {
        reply: skipReply(),
        intent: 'onboarding_skip',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    if (trimmed === '1') return startCash(tenant);
    if (trimmed === '2') return startProducts(tenant);
    if (trimmed === '3') return startSuppliers(tenant);
    return {
      reply: `Respondé 1, 2, 3 o 4.\n\n${buildSetupMenu()}`,
      intent: ONBOARDING_MENU,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_CASH) {
    if (DONE.test(trimmed) || trimmed === '0') {
      return showMenu(tenant, 'Caja en $0. ¿Querés cargar otra cosa o empezás a operar?');
    }
    const amount = extractAmountFromText(trimmed);
    if (!(amount != null && amount > 0)) {
      return {
        reply: 'No entendí el monto. Mandá un número (ej. 5000), 0 o LISTO.',
        intent: ONBOARDING_CASH,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_CASH_CONFIRM,
      pendingPayload: { amount },
      setupStatus: 'offered',
    });
    return {
      reply: waCard({
        title: 'Saldo inicial',
        ask: `¿Registro $${amount} en caja?\n${waBold('SÍ')} / ${waBold('NO')}`,
      }),
      intent: ONBOARDING_CASH_CONFIRM,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_CASH_CONFIRM) {
    if (CONFIRM_NO.test(trimmed)) {
      return showMenu(tenant, 'No registré el saldo. ¿Querés cargar otra cosa?');
    }
    if (!CONFIRM_YES.test(trimmed)) {
      return {
        reply: 'Respondé SÍ para registrar el saldo inicial, o NO para cancelar.',
        intent: ONBOARDING_CASH_CONFIRM,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    const amount = Number(pendingPayload?.amount) || 0;
    if (amount <= 0) {
      return showMenu(tenant, 'No había un monto válido.');
    }
    const result = await registerCashFromWhatsapp(tenant, {
      cashType: 'ingreso',
      amount,
      cashConcept: 'Saldo inicial',
    });
    return showMenu(tenant, `${result.reply}\n¿Querés cargar productos, proveedores, u otra cosa?`);
  }

  if (pendingIntent === ONBOARDING_PRODUCTS) {
    if (DONE.test(trimmed) || CONFIRM_NO.test(trimmed)) {
      return showMenu(tenant, 'Listo con productos. ¿Querés cargar otra cosa?');
    }
    const amount = extractAmountFromText(trimmed);
    const nombre = trimmed
      .replace(/\$\s*[\d.]+(?:,\d{2})?/g, '')
      .replace(/\b[\d.]+(?:,\d{2})?\s*(?:pesos)?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!nombre) {
      return {
        reply: `Indicá el producto con el detalle que lo distingue. ${productExamplesLine(whatsappCopyForRubro(tenant.rubro))} O LISTO.`,
        intent: ONBOARDING_PRODUCTS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_PRODUCT_CONFIRM,
      pendingPayload: { nombre, precioVenta: amount ?? 0 },
      setupStatus: 'offered',
    });
    const priceHint = amount != null && amount > 0 ? ` a $${amount}` : '';
    return {
      reply: `¿Guardo el producto "${nombre}"${priceHint} (sin control de stock)?\nSÍ = crear · NO = otro producto · LISTO = terminar.`,
      intent: ONBOARDING_PRODUCT_CONFIRM,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_PRODUCT_CONFIRM) {
    if (DONE.test(trimmed)) {
      return showMenu(tenant, 'Listo con productos. ¿Querés cargar otra cosa?');
    }
    if (CONFIRM_NO.test(trimmed)) {
      await saveConversationState(tenant.businessId, tenant.phone, {
        pendingIntent: ONBOARDING_PRODUCTS,
        pendingPayload: null,
        setupStatus: 'offered',
      });
      return {
        reply: 'Ok. Mandá otro producto o LISTO.',
        intent: ONBOARDING_PRODUCTS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    if (!CONFIRM_YES.test(trimmed)) {
      return {
        reply: 'Respondé SÍ para guardar, NO para otro producto, o LISTO.',
        intent: ONBOARDING_PRODUCT_CONFIRM,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    const nombre = String(pendingPayload?.nombre ?? '').trim();
    const precioVenta = Number(pendingPayload?.precioVenta) || 0;
    if (!nombre) {
      return startProducts(tenant);
    }
    const created = await createCatalogProductFromWhatsapp(tenant.businessId, { nombre, precioVenta });
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_PRODUCTS,
      pendingPayload: null,
      setupStatus: 'offered',
    });
    return {
      reply: `Guardé "${created.nombre}". Mandá otro producto o LISTO.`,
      intent: ONBOARDING_PRODUCTS,
      executed: true,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_CLIENTS) {
    if (DONE.test(trimmed) || CONFIRM_NO.test(trimmed)) {
      return showMenu(tenant, 'Listo con clientes. ¿Querés cargar otra cosa?');
    }
    const nombre = trimmed.replace(/\s+/g, ' ').trim();
    if (nombre.length < 2) {
      return {
        reply: 'Indicá nombre y apellido. Ej: María Silva. O LISTO.',
        intent: ONBOARDING_CLIENTS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_CLIENT_CONFIRM,
      pendingPayload: { nombre },
      setupStatus: 'offered',
    });
    return {
      reply: `¿Registro el cliente "${nombre}"?\nSÍ = crear · NO = otro nombre · LISTO = terminar.`,
      intent: ONBOARDING_CLIENT_CONFIRM,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_CLIENT_CONFIRM) {
    if (DONE.test(trimmed)) {
      return showMenu(tenant, 'Listo con clientes. ¿Querés cargar otra cosa?');
    }
    if (CONFIRM_NO.test(trimmed)) {
      await saveConversationState(tenant.businessId, tenant.phone, {
        pendingIntent: ONBOARDING_CLIENTS,
        pendingPayload: null,
        setupStatus: 'offered',
      });
      return {
        reply: 'Ok. Mandá otro cliente o LISTO.',
        intent: ONBOARDING_CLIENTS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    if (!CONFIRM_YES.test(trimmed)) {
      return {
        reply: 'Respondé SÍ para registrar, NO para otro nombre, o LISTO.',
        intent: ONBOARDING_CLIENT_CONFIRM,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    const nombre = String(pendingPayload?.nombre ?? '').trim();
    if (!nombre) {
      return startClients(tenant);
    }
    const created = await createClientFromWhatsapp(tenant.businessId, nombre);
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_CLIENTS,
      pendingPayload: null,
      setupStatus: 'offered',
    });
    return {
      reply: `Registré a ${created.nombre}. Mandá otro cliente o LISTO.`,
      intent: ONBOARDING_CLIENTS,
      executed: true,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_SUPPLIERS) {
    if (DONE.test(trimmed) || CONFIRM_NO.test(trimmed)) {
      return showMenu(tenant, 'Listo con proveedores. ¿Querés cargar otra cosa?');
    }
    const nombre = trimmed.replace(/\s+/g, ' ').trim();
    if (nombre.length < 2) {
      return {
        reply: 'Indicá el nombre del proveedor. Ej: Disershop. O LISTO.',
        intent: ONBOARDING_SUPPLIERS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_SUPPLIER_CONFIRM,
      pendingPayload: { nombre },
      setupStatus: 'offered',
    });
    return {
      reply: `¿Registro el proveedor "${nombre}"?\nSÍ = crear · NO = otro nombre · LISTO = terminar.`,
      intent: ONBOARDING_SUPPLIER_CONFIRM,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (pendingIntent === ONBOARDING_SUPPLIER_CONFIRM) {
    if (DONE.test(trimmed)) {
      return showMenu(tenant, 'Listo con proveedores. ¿Querés cargar otra cosa?');
    }
    if (CONFIRM_NO.test(trimmed)) {
      await saveConversationState(tenant.businessId, tenant.phone, {
        pendingIntent: ONBOARDING_SUPPLIERS,
        pendingPayload: null,
        setupStatus: 'offered',
      });
      return {
        reply: 'Ok. Mandá otro proveedor o LISTO.',
        intent: ONBOARDING_SUPPLIERS,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    if (!CONFIRM_YES.test(trimmed)) {
      return {
        reply: 'Respondé SÍ para registrar, NO para otro nombre, o LISTO.',
        intent: ONBOARDING_SUPPLIER_CONFIRM,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    const nombre = String(pendingPayload?.nombre ?? '').trim();
    if (!nombre) {
      return startSuppliers(tenant);
    }
    const created = await createSupplierFromWhatsapp(tenant.businessId, nombre);
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_SUPPLIERS,
      pendingPayload: null,
      setupStatus: 'offered',
    });
    return {
      reply: `Registré a ${created.nombre}. Mandá otro proveedor o LISTO.`,
      intent: ONBOARDING_SUPPLIERS,
      executed: true,
      businessId: tenant.businessId,
    };
  }

  return null;
}
