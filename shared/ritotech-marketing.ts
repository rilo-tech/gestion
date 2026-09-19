import {
  PANEL_TRIAL_DAYS,
  RILOBOT_TRIAL_DAYS,
  trialDaysForProduct,
} from './trial-state.ts';
import { TRIAL_PRODUCT_LABELS, type TrialProductId } from './platform-access.ts';
import type { BillingCountryCode } from './billing-catalog.ts';
import { getProductPriceForCountry } from './billing-catalog.ts';
import type { CommercialCatalog } from './commercial-catalog.ts';
import {
  amountMonthlyFor,
  DEFAULT_COMMERCIAL_CATALOG,
  extraErpUserPriceFor,
  extraWhatsappNumberPriceFor,
  formatCatalogPriceLabel,
  litePitch,
  overlayUsagePacksForCountry,
  parseUsageMode,
  usagePackPriceLabel,
  whatsappActionsLabel,
} from './commercial-catalog.ts';
import {
  productSellsErpUserAddons,
  productSellsWhatsappNumberAddons,
} from './commercial-seat-policy.ts';

export interface RitotechUseCase {
  title: string;
  description: string;
  icon: 'phone' | 'store' | 'chart' | 'team';
}

export interface RitotechChatMessage {
  from: 'user' | 'bot';
  text: string;
}

export interface RitotechFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface RitotechPricingTier {
  id: TrialProductId;
  label: string;
  headline: string;
  trialIncludes: string;
  afterTrial: string;
  trialDays: number;
  whatsapp: boolean;
  panelWeb: boolean;
  featured?: boolean;
  badgeLabel?: string;
  includes: string[];
}

export const RILOTECH_HERO = {
  title: 'Registrá ventas, pedidos y cobros hablando por WhatsApp.',
  subtitle:
    'Escribile a RILO como hablás. Él organiza la información de tu negocio. Con RILO Bot también podés revisar tu actividad en Resumen RILO.',
  tagline: 'Cargás hablando. Lo ves ordenado.',
  ctaPrimary: `Probar RILO gratis`,
  ctaSecondary: 'Ver demo',
  microcopy: 'Sin tarjeta · sin instalar nada · cancelás cuando quieras',
};

/** Orden comercial público: Bot → Gestión → Completo. */
export const LANDING_PRODUCT_ORDER: TrialProductId[] = ['whatsapp', 'erp', 'completo'];

export const RILOTECH_AUDIENCE_PITCH =
  'No abras Excel para anotar todo. Escribile a RILO. Para ferias, talleres, delivery y negocios chicos.';

/** Respaldo comercial: los montos de la web se pueden actualizar. */
export const RILOTECH_PRICE_ADJUSTMENT_NOTE =
  'Los precios publicados son de referencia y pueden reajustarse. Si ya estás en un plan pago, te avisamos antes de cambiar tu cuota.';

export const RILOTECH_USE_CASES: RitotechUseCase[] = [
  {
    title: 'Ahorrá carga manual',
    description: 'Decilo una vez por WhatsApp. Rilo interpreta y prepara el registro.',
    icon: 'phone',
  },
  {
    title: 'No pierdas cobros',
    description: 'Preguntale cuánto te deben sin abrir una planilla.',
    icon: 'store',
  },
  {
    title: 'Caja al instante',
    description: 'Preguntá cuánto vendiste o cobraste hoy.',
    icon: 'chart',
  },
  {
    title: 'Más orden',
    description: 'Todo queda asociado al cliente y disponible en historial.',
    icon: 'team',
  },
];

/** Carrusel “Decíselo a RILO” — solo casos respaldados por tools operativas. */
export const RILOTECH_SAY_IT_CASES = [
  { id: 'sale', label: 'VENTA', example: 'Vendí 2 remeras a Ana por $1.600.' },
  { id: 'order', label: 'PEDIDO', example: 'Pedido para Martín: 3 buzos para el viernes.' },
  { id: 'collect', label: 'COBRO', example: 'Lucía pagó $1.000.' },
  { id: 'client_balance', label: 'CLIENTE', example: '¿Cuánto debe Pedro?' },
  { id: 'cash_today', label: 'CAJA', example: '¿Cuánto vendí hoy?' },
  { id: 'stock', label: 'STOCK', example: '¿Cuántas camisetas negras M quedan?' },
] as const;

export const RILOTECH_CHAT_DEMO: RitotechChatMessage[] = [
  { from: 'user', text: 'Venta a María, 2 remeras, total $1.500. Pagó $800.' },
  {
    from: 'bot',
    text: 'Listo. Venta registrada.\nTotal: $1.500\nCobrado: $800\nSaldo: $700.',
  },
];

export const RILOTECH_HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Escribile a RILO',
    description: 'Mandá el pedido, la venta o la consulta por WhatsApp, como hablás.',
  },
  {
    step: '2',
    title: 'RILO entiende y trabaja',
    description:
      'Si está claro, actúa. Si falta algo, pregunta. Las acciones sensibles te piden confirmación.',
  },
  {
    step: '3',
    title: 'Lo ves ordenado',
    description:
      'Con RILO Bot revisás la actividad en Resumen RILO. Con Completo, además tenés RILO Gestión completa.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    headline: 'Empezá por WhatsApp.',
    trialIncludes: `${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá el plan mensual para seguir operando. Tus datos no se borran.',
    trialDays: trialDaysForProduct('whatsapp'),
    whatsapp: true,
    panelWeb: true,
    featured: false,
    badgeLabel: undefined,
    includes: [
      'Pedidos, ventas, compras, cobros y caja por WhatsApp',
      'Resumen RILO web para revisar lo anotado',
      'Avisos de pedidos y vencimientos',
      'Actúa cuando está claro; pregunta si falta información',
    ],
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    headline: 'Solo panel web.',
    trialIncludes: `${PANEL_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá el plan mensual. Tus datos no se borran.',
    trialDays: trialDaysForProduct('erp'),
    whatsapp: false,
    panelWeb: true,
    includes: [
      'Clientes, productos, proveedores',
      'Pedidos, ventas, compras y caja',
      'Listados, fichas y control en pantalla',
    ],
  },
  {
    id: 'completo',
    label: TRIAL_PRODUCT_LABELS.completo,
    headline: 'WhatsApp + panel.',
    trialIncludes: `${PANEL_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá RILO Completo. Tus datos no se borran.',
    trialDays: trialDaysForProduct('completo'),
    whatsapp: true,
    panelWeb: true,
    featured: true,
    badgeLabel: 'Mejor valor',
    includes: [
      'RILO Bot + RILO Gestión',
      'Cargás hablando. Controlás en pantalla.',
      'Sale menos que Bot + Gestión por separado',
    ],
  },
];

export function priceLabelForTier(
  productId: TrialProductId,
  country: BillingCountryCode
): string {
  return getProductPriceForCountry(productId, country)?.label ?? '';
}

export const RILOTECH_FAQ: RitotechFaqItem[] = [
  {
    id: 'para-quien',
    question: '¿Es para mi negocio si no hago factura electrónica?',
    answer:
      'Sí. Rilo es una herramienta de gestión operativa. No reemplaza la facturación electrónica, comprobantes fiscales ni el asesoramiento contable que correspondan a tu actividad.',
  },
  {
    id: 'ia',
    question: '¿Cómo usa inteligencia artificial?',
    answer:
      'RILO Bot interpreta lo que escribís. Si la instrucción es clara y segura, actúa. Si falta información, pregunta. Las acciones sensibles te piden confirmación antes de guardar.',
  },
  {
    id: 'solo-whatsapp',
    question: '¿Puedo usar solo RILO Bot sin RILO Gestión?',
    answer:
      'Sí. RILO Bot cubre pedidos, ventas, compras, cobros y caja por WhatsApp. En Inicio ves tu cupo y cómo usarlo. RILO Gestión se suma después en Planes, con la misma cuenta. Email o WhatsApp ya usados no crean otra empresa.',
  },
  {
    id: 'solo-erp',
    question: '¿Puedo usar solo RILO Gestión?',
    answer:
      'Sí. Ideal si preferís la PC. RILO Bot se suma después en Planes, con la misma cuenta, sin un segundo registro.',
  },
  {
    id: 'prueba',
    question: '¿La prueba pide tarjeta?',
    answer: `No. ${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta. Al vencer, tus datos siguen. Para seguir usando RILO, activá un plan.`,
  },
  {
    id: 'confirmacion',
    question: '¿El bot guarda solo o me pregunta?',
    answer:
      'Si está claro y es seguro, registra. Si falta un dato, te pregunta. En operaciones sensibles te pide confirmación. Si hay dudas de cliente o producto, te lista opciones.',
  },
  {
    id: 'limites',
    question: '¿Qué límites tiene la prueba?',
    answer: `${RILOBOT_TRIAL_DAYS} días gratis en los tres planes, sin tarjeta. No hay plan gratis permanente: al vencer, contratás para seguir operando. Tus datos no se borran.`,
  },
  {
    id: 'soporte',
    question: '¿El WhatsApp del bot es el mismo que soporte?',
    answer:
      'El número de Meta/RILO Bot es para operar tu negocio (pedidos, ventas). Para soporte humano conviene un WhatsApp de ayuda aparte. En la web verás el link de soporte.',
  },
  {
    id: 'precio',
    question: '¿Cuánto cuesta después?',
    answer:
      `Los precios de lista se ven en Planes y los publica Superadmin. Primero ${RILOBOT_TRIAL_DAYS} días gratis; después contratás el plan mensual. Completo sale menos que Bot + Gestión por separado. Si ya pagás, te avisamos antes de cambiar tu cuota.`,
  },
  {
    id: 'cupos',
    question: '¿Qué pasa si me quedo corto de mensajes o de acciones por WhatsApp?',
    answer:
      'Cada plan incluye un cupo mensual. SÍ, NO y elegir un número también cuentan. Si operás más, en Mi plan comprás un pack extra para ese mes, al mismo precio que ves en Planes.',
  },
  {
    id: 'extras',
    question: '¿Puedo agregar usuarios o números de WhatsApp?',
    answer:
      'Sí. En RILO Bot sumás números de WhatsApp; en Gestión, usuarios del panel; en Completo, ambos (son cosas distintas). Lo confirmás antes de agregar; se cobra en la próxima renovación.',
  },
  {
    id: 'instalacion',
    question: '¿Hay que instalar algo?',
    answer: 'No. WhatsApp + navegador. Celular o PC.',
  },
];

export function pricingFootnoteForCountry(country: BillingCountryCode): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return `* Precios en ${currency}. ${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta. Al vencer, contratá para seguir.`;
}

export function pricingFootnoteFromCatalog(
  country: BillingCountryCode,
  catalog: CommercialCatalog
): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return (
    `* Precios en ${currency}. ${catalog.trialDays} días gratis, sin tarjeta. ` +
    `Al vencer la prueba, tus datos siguen y contratás un plan para seguir operando.`
  );
}

export function priceLabelFromCatalog(
  productId: TrialProductId,
  country: BillingCountryCode,
  catalog?: CommercialCatalog | null
): string {
  if (catalog) {
    return formatCatalogPriceLabel(country, amountMonthlyFor(catalog, productId, country));
  }
  return getProductPriceForCountry(productId, country)?.label ?? '';
}

export function quotaLinesForProduct(
  catalog: CommercialCatalog,
  productId: TrialProductId,
  country: BillingCountryCode = 'UY'
): string[] {
  const quote = catalog.products[productId];
  const lines: string[] = [];
  const sellsWa = productSellsWhatsappNumberAddons(productId);
  const sellsUsers = productSellsErpUserAddons(productId);

  if (sellsWa) {
    const actionsLine = whatsappActionsLabel(quote?.includedAi ?? 0, parseUsageMode(quote?.usageMode));
    if (actionsLine) lines.push(actionsLine);
    if ((quote?.includedWhatsapp ?? 0) > 0) {
      lines.push(`${quote.includedWhatsapp.toLocaleString('es-UY')} mensajes de WhatsApp al mes`);
    }
    const numbers = quote?.includedWhatsappNumbers ?? 1;
    if (numbers > 0) {
      lines.push(
        numbers === 1 ? '1 número de WhatsApp incluido' : `${numbers} números de WhatsApp incluidos`
      );
    }
    const extraWa = extraWhatsappNumberPriceFor(catalog, productId, country);
    if (extraWa > 0) {
      lines.push(`Número adicional: ${formatCatalogPriceLabel(country, extraWa)}`);
    }
  }

  if (sellsUsers) {
    const users = quote?.includedErpUsers ?? 1;
    if (users > 0) {
      lines.push(
        users === 1
          ? '1 usuario de RILO Gestión incluido'
          : `${users} usuarios de RILO Gestión incluidos`
      );
    }
    const extraUser = extraErpUserPriceFor(catalog, productId, country);
    if (extraUser > 0) {
      lines.push(`Usuario adicional: ${formatCatalogPriceLabel(country, extraUser)}`);
    }
  }
  return lines;
}

export function pricingTiersFromCatalog(
  catalog: CommercialCatalog,
  country: BillingCountryCode = 'UY'
): RitotechPricingTier[] {
  const rank = new Map(LANDING_PRODUCT_ORDER.map((id, index) => [id, index]));
  return RILOTECH_PRICING_TIERS.filter((tier) => rank.has(tier.id))
    .sort((a, b) => (rank.get(a.id) ?? 9) - (rank.get(b.id) ?? 9))
    .map((tier) => ({
      ...tier,
      trialDays: catalog.trialDays,
      trialIncludes: `${catalog.trialDays} días gratis, sin tarjeta`,
      afterTrial: litePitch(catalog),
      includes: [...quotaLinesForProduct(catalog, tier.id, country), ...tier.includes],
    }));
}

export function usagePackCardsFromCatalog(
  catalog: CommercialCatalog,
  country: BillingCountryCode
) {
  return overlayUsagePacksForCountry(catalog, country);
}

export function faqFromCatalog(
  catalog: CommercialCatalog,
  country: BillingCountryCode = 'UY'
): RitotechFaqItem[] {
  const packed: CommercialCatalog = {
    ...catalog,
    usagePacks: catalog.usagePacks ?? DEFAULT_COMMERCIAL_CATALOG.usagePacks,
  };
  return RILOTECH_FAQ.map((item) => {
    if (item.id === 'prueba') {
      return {
        ...item,
        answer: `No. ${packed.trialDays} días gratis, sin tarjeta. Al vencer, tus datos siguen. Para seguir usando RILO, activá un plan.`,
      };
    }
    if (item.id === 'limites') {
      return {
        ...item,
        answer: `${packed.trialDays} días gratis en los tres planes, sin tarjeta. No hay plan gratis permanente: al vencer, contratás para seguir operando. Tus datos no se borran.`,
      };
    }
    if (item.id === 'precio') {
      const wa = packed.usagePacks.whatsapp;
      return {
        ...item,
        answer:
          `Primero ${packed.trialDays} días gratis. Después contratás el plan mensual al precio publicado. ` +
          `Cada plan incluye un cupo de mensajes e IA. Si te quedás corto, comprás un pack de ${wa.quantity.toLocaleString('es-UY')} mensajes para ese mes, al precio de Planes. ` +
          `RILO Completo sale menos que RILO Bot + RILO Gestión por separado. Si ya pagás, te avisamos antes de cambiar tu cuota.`,
      };
    }
    if (item.id === 'cupos') {
      const wa = packed.usagePacks.whatsapp;
      const ai = packed.usagePacks.ai;
      return {
        ...item,
        answer:
          `Cada plan incluye un cupo mensual. Si te quedás corto, en Mi plan comprás un pack de ${wa.quantity.toLocaleString('es-UY')} mensajes ` +
          `(${usagePackPriceLabel(packed, 'whatsapp', country)}) o ${ai.quantity.toLocaleString('es-UY')} acciones por WhatsApp ` +
          `(${usagePackPriceLabel(packed, 'ai', country)}). El plan se cobra aparte y se renueva solo.`,
      };
    }
    return item;
  });
}

/** @deprecated Prefer pricingFootnoteForCountry */
export const RILOTECH_PRICING_FOOTNOTE = pricingFootnoteForCountry('UY');

export const RILOTECH_CTA_FINAL = {
  title: 'Empezá hoy.',
  body: `${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta. Probá RILO Bot y sumá el panel cuando lo necesites.`,
};

/** Tips / upsells in-app (sesión). */
export interface ProductCoachTip {
  id: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaRoute?: string;
  audience: 'whatsapp' | 'erp' | 'all';
}

export const RILOTECH_COACH_TIPS: ProductCoachTip[] = [
  {
    id: 'tip-bot-caja',
    title: 'Consejo de RILO Bot',
    body: 'Podés registrar ventas, pedidos y cobros hablando por WhatsApp.',
    ctaLabel: 'Probar por WhatsApp',
    ctaRoute: '/inicio',
    audience: 'whatsapp',
  },
  {
    id: 'tip-bot-confirm',
    title: 'Consejo de RILO Bot',
    body: 'Si el mensaje está claro, registra. Si falta info, pregunta. Las acciones sensibles te piden confirmación.',
    audience: 'whatsapp',
  },
  {
    id: 'upsell-panel',
    title: '¿Querés ver caja y stock en pantalla?',
    body: 'Con RILO Gestión ves entradas, salidas, compras y proveedores. Tu historial de WhatsApp ya queda guardado.',
    ctaLabel: 'Ver panel / planes',
    ctaRoute: '/planes',
    audience: 'whatsapp',
  },
  {
    id: 'upsell-bot',
    title: '¿Querés cargar ventas hablando por WhatsApp?',
    body: 'Conocé RILO Completo y sumá RILO Bot sin dejar el panel.',
    ctaLabel: 'Conocé RILO Completo',
    ctaRoute: '/planes',
    audience: 'erp',
  },
  {
    id: 'tip-avisos',
    title: 'RILO te avisa lo importante',
    body: 'Pedidos para hoy, vencimientos y saldos. Abrí la campanita del encabezado para verlos.',
    ctaLabel: 'Ver avisos',
    ctaRoute: '/avisos',
    audience: 'all',
  },
];
