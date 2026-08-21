import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  getConversationState,
  saveConversationState,
} from './conversation-state.ts';
import {
  createCatalogProductFromWhatsapp,
  createClientFromWhatsapp,
  registerCashFromWhatsapp,
} from './erp-writes.ts';
import { extractAmountFromText } from './lookups.ts';
import { productExamplesLine, whatsappCopyForRubro } from './copy.ts';

type OnboardingResult = {
  reply: string;
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

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no|cancelar|cancel|n)$/i;
const DONE = /^(listo|listo\.|termin[eé]|fin|nada m[aá]s)$/i;
const SKIP_ZERO = /^(4|cero|de cero|empezar de cero|despu[eé]s|despues|skip)$/i;
const REOPEN = /^(configurar|configuraci[oó]n inicial|cargar (caja|productos|clientes)|saldo inicial)$/i;

export function isOnboardingIntent(intent?: string | null): boolean {
  return (
    intent === ONBOARDING_MENU ||
    intent === ONBOARDING_CASH ||
    intent === ONBOARDING_CASH_CONFIRM ||
    intent === ONBOARDING_PRODUCTS ||
    intent === ONBOARDING_PRODUCT_CONFIRM ||
    intent === ONBOARDING_CLIENTS ||
    intent === ONBOARDING_CLIENT_CONFIRM
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
  const copy = whatsappCopyForRubro(rubro);
  return (
    `Hola${hi ? ` ${hi}` : ''} 👋 Soy RILO Bot.\n\n` +
    `Anoto pedidos, ventas, cobros, saldos y caja. Escribís como hablás, te muestro un resumen y confirmás con SÍ.\n\n` +
    `${copy.productHint}\n` +
    `Ejemplos:\n` +
    `• ${copy.exampleSale}\n` +
    `• ${copy.exampleOrder}\n\n` +
    `Si hay varias Marías, te pregunto cuál es. Si el cliente no está, te pregunto si lo registrás.\n\n` +
    `Si tenés dudas de cómo usarme, escribí Consultame.`
  );
}

export function buildSetupMenu(): string {
  return (
    `La caja arranca en $0. Productos y clientes se van creando cuando anotes pedidos, ventas o cobros.\n\n` +
    `¿Querés cargar algo ahora?\n` +
    `1) Saldo inicial de caja\n` +
    `2) Algunos productos\n` +
    `3) Algunos clientes\n` +
    `4) Listo, ya quiero operar`
  );
}

export function buildWelcomeMessage(
  userName?: string,
  offerSetup = false,
  rubro?: string | null
): string {
  const howTo = buildHowToMessage(userName, rubro);
  if (!offerSetup) {
    return `${howTo}\n\n¿Qué querés hacer ahora? Pedido, venta, cobro o consultar un saldo.`;
  }
  return `${howTo}\n\n${buildSetupMenu()}`;
}

function looksLikeOperation(text: string): boolean {
  return /\b(venta|vend[ií]|pedido|orden|pago|cobro|abon[oó]|saldo|caja)\b/i.test(text);
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
  const offerSetup = state?.setupStatus !== 'done';
  if (offerSetup) {
    await saveConversationState(tenant.businessId, tenant.phone, {
      pendingIntent: ONBOARDING_MENU,
      pendingPayload: null,
      setupStatus: 'offered',
    });
  }
  return {
    reply: buildWelcomeMessage(tenant.userName, offerSetup, tenant.rubro),
    intent: 'greeting',
    executed: false,
    businessId: tenant.businessId,
  };
}

export async function reopenSetupMenu(
  tenant: WhatsappTenantContext
): Promise<OnboardingResult> {
  return showMenu(tenant, 'Podés cargar saldo de caja, productos o clientes. Cada alta te la confirmo antes.');
}

function skipReply(): string {
  return (
    'Listo. Si no cargaste saldo, la caja queda en $0. ' +
    'Productos y clientes se siguen creando cuando anotes pedidos, ventas o cobros.\n' +
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
    reply:
      '¿Cuál es el saldo inicial de caja?\nMandá el monto (ej. 5000). Si no hay, escribí 0 o LISTO.',
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
    reply:
      `Mandame un producto por mensaje, con el detalle que lo distingue y el precio si querés.\n` +
      `${productExamplesLine(whatsappCopyForRubro(tenant.rubro))}\n` +
      'Cuando termines, escribí LISTO.',
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
    reply:
      'Mandame un cliente por mensaje, con nombre y apellido.\n' +
      'Ej: María Silva\n' +
      'Cuando termines, escribí LISTO.',
    intent: ONBOARDING_CLIENTS,
    executed: false,
    businessId: tenant.businessId,
  };
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
  if (/\b(consultame|consultáme|ayuda|help)\b/i.test(trimmed)) {
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
    if (trimmed === '3') return startClients(tenant);
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
      reply: `¿Registro saldo inicial de caja $${amount}?\nRespondé SÍ o NO.`,
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
    return showMenu(tenant, `${result.reply}\n¿Querés cargar productos, clientes, u otra cosa?`);
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

  return null;
}
