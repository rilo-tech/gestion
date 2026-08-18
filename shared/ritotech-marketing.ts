import {
  PANEL_TRIAL_DAYS,
  RILOBOT_TRIAL_DAYS,
  trialDaysForProduct,
} from './trial-state.ts';
import { TRIAL_PRODUCT_LABELS, type TrialProductId } from './platform-access.ts';
import type { BillingCountryCode } from './billing-catalog.ts';
import { getProductPriceForCountry } from './billing-catalog.ts';
import type { CommercialCatalog } from './commercial-catalog.ts';
import { amountMonthlyFor, formatCatalogPriceLabel, litePitch } from './commercial-catalog.ts';

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
  title: 'Organizá pedidos, ventas y cobros escribiendo por WhatsApp.',
  subtitle:
    'RiloBot entiende tus mensajes, te muestra un resumen y guarda solo cuando confirmás. Tené pedidos, cobros, saldos y clientes al día desde el celular, sin planillas ni sistemas pesados.',
  ctaPrimary: 'Registrate gratis',
  ctaSecondary: 'Ver cómo funciona',
  microcopy: `${RILOBOT_TRIAL_DAYS} días a full, sin tarjeta. Después seguís gratis. Un feriante o taller chico puede vivir ahí.`,
};

export const RILOTECH_AUDIENCE_PITCH =
  'Pensado para microempresas, ferias, talleres, delivery y negocios chicos. Sin facturación electrónica: controlá caja, ventas, compras, proveedores y clientes.';

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
    description: 'Consultá quién debe, cuánto y desde cuándo.',
    icon: 'store',
  },
  {
    title: 'Caja al instante',
    description: 'Preguntá cuánto vendiste, cobraste o cuánto te deben sin abrir una planilla.',
    icon: 'chart',
  },
  {
    title: 'Más orden',
    description: 'Cada operación queda asociada al cliente y disponible en el historial.',
    icon: 'team',
  },
];

export const RILOTECH_CHAT_DEMO: RitotechChatMessage[] = [
  { from: 'user', text: 'Venta a María, 2 remeras, cobró 800' },
  {
    from: 'bot',
    text: 'Resumen — Registrar VENTA\n• Cliente: María\n• Producto: 2 remeras\n• Cobrado: $800\n¿Confirmás? Respondé SÍ o NO.',
  },
  { from: 'user', text: 'Sí' },
  {
    from: 'bot',
    text: 'Listo. Venta guardada. Cuando quieras: "saldo de María" o "¿cuánto vendí hoy?".',
  },
];

export const RILOTECH_HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Empezá por RiloBot',
    description:
      'La mayoría arranca solo con WhatsApp: cargás en segundos desde el celular.',
  },
  {
    step: '2',
    title: 'Probá 30 días a full',
    description:
      'Sin tarjeta. Después seguís gratis. Un feriante o taller chico puede vivir ahí. Pagás cuando te pasás de los techos.',
  },
  {
    step: '3',
    title: 'Sumá el otro canal cuando lo necesites',
    description:
      'Ingresá con la misma cuenta. No te registres de nuevo: el panel o RiloBot se suma al mismo negocio, con el historial que ya cargaste.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    headline: 'Recomendado para empezar',
    trialIncludes: `RiloBot + IA · ${RILOBOT_TRIAL_DAYS} días gratis a full`,
    afterTrial: 'Después: plan libre con techos, o plan pago con más IA',
    trialDays: trialDaysForProduct('whatsapp'),
    whatsapp: true,
    panelWeb: false,
    featured: true,
    badgeLabel: 'Recomendado para empezar',
    includes: [
      '1 WhatsApp verificado',
      'Pedidos, ventas, cobros y saldos',
      'Confirmación SÍ/NO antes de guardar',
      '1.000 acciones IA / mes (en plan pago)',
      'Plan libre al vencer: techos de clientes, productos e IA',
      'Fotos básicas y consultas rápidas',
      'WhatsApp extras cobrables por usuario',
      'Sin panel web (podés sumarlo después)',
    ],
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    headline: 'Si preferís la computadora',
    trialIncludes: `Panel web · ${PANEL_TRIAL_DAYS} días gratis a full · 1 usuario`,
    afterTrial: 'Después: plan libre con techos, o plan Panel pago',
    trialDays: trialDaysForProduct('erp'),
    whatsapp: false,
    panelWeb: true,
    includes: [
      '1 usuario web',
      'Clientes, pedidos, ventas y cobros',
      'Caja completa, stock, compras y proveedores',
      'Cuentas a pagar y márgenes',
      'Sin RiloBot (activable después)',
    ],
  },
  {
    id: 'completo',
    label: TRIAL_PRODUCT_LABELS.completo,
    headline: 'WhatsApp para cargar + web para controlar',
    trialIncludes: `RiloBot + panel · ${PANEL_TRIAL_DAYS} días gratis a full`,
    afterTrial: 'Después: plan libre con techos, o paquete combinado',
    trialDays: trialDaysForProduct('completo'),
    whatsapp: true,
    panelWeb: true,
    includes: [
      'Todo RiloBot + todo el panel',
      '1 WhatsApp + 1 usuario incluidos',
      'WhatsApp / usuarios extras a demanda',
      '2.000 acciones IA / mes (en plan pago)',
      'Plan libre al vencer: mismos techos, historial intacto',
      'Historial unificado entre canales',
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
      'RiloBot usa inteligencia artificial de Google Gemini para interpretar mensajes. Puede equivocarse; por eso siempre muestra un resumen y no guarda la operación hasta que confirmás.',
  },
  {
    id: 'solo-whatsapp',
    question: '¿Puedo usar solo WhatsApp sin el panel web?',
    answer:
      'Sí. Es el plan recomendado para empezar: cargás escribiendo mensajes. El panel se suma después desde la misma cuenta (Ingresar), sin registrarte de nuevo ni perder datos. Email o WhatsApp ya usados no crean otra empresa.',
  },
  {
    id: 'solo-erp',
    question: '¿Puedo usar solo el panel web?',
    answer:
      'Sí. Ideal si preferís la PC. RiloBot se suma después desde la misma cuenta, sin un segundo registro.',
  },
  {
    id: 'prueba',
    question: '¿La prueba pide tarjeta?',
    answer: `No. ${RILOBOT_TRIAL_DAYS} días a full, sin tarjeta. Después seguís gratis. Un feriante o taller chico puede vivir ahí. Recién pagás si te pasás de los techos. Tus datos no se borran.`,
  },
  {
    id: 'confirmacion',
    question: '¿El bot guarda solo o me pregunta?',
    answer:
      'Siempre te muestra un resumen y pedís SÍ o NO. Si el cliente o el producto no están claros, te lista opciones para elegir.',
  },
  {
    id: 'limites',
    question: '¿Qué límites tiene la prueba?',
    answer: `${RILOBOT_TRIAL_DAYS} días a full en todos los planes, sin tarjeta. Después seguís gratis: techos de clientes, productos, cargas WhatsApp e IA (los números los ves en la landing; se actualizan desde Plataforma). El plan pago es para cuando te quede chico.`,
  },
  {
    id: 'soporte',
    question: '¿El WhatsApp del bot es el mismo que soporte?',
    answer:
      'El número de Meta/RiloBot es para operar tu negocio (pedidos, ventas). Para soporte humano conviene un WhatsApp de ayuda aparte. En la web verás el link de soporte.',
  },
  {
    id: 'precio',
    question: '¿Cuánto cuesta después?',
    answer:
      'El precio de lista es para cuando te pasás del plan gratis. Primero 30 días a full; después seguís gratis con techos. Si activás un plan pago, podés tener meses de descuento (eso se publica desde la plataforma). Los precios son reajustables: si cambia tu cuota, te avisamos.',
  },
  {
    id: 'instalacion',
    question: '¿Hay que instalar algo?',
    answer: 'No. WhatsApp + navegador. Celular o PC.',
  },
];

export function pricingFootnoteForCountry(country: BillingCountryCode): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return `* Precios pagos en ${currency}. ${RILOBOT_TRIAL_DAYS} días a full, sin tarjeta. Después seguís gratis si no te pasás.`;
}

export function pricingFootnoteFromCatalog(
  country: BillingCountryCode,
  catalog: CommercialCatalog
): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return (
    `* Precios pagos en ${currency}. ${catalog.trialDays} días a full, sin tarjeta. ` +
    `Después seguís gratis hasta ${catalog.lite.maxOperacionesMes} cargas/mes, ` +
    `${catalog.lite.maxClientes} clientes, ${catalog.lite.maxProductos} productos y ${catalog.lite.maxAccionesIaMes} IA/mes. ` +
    `Precios reajustables.`
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

export function pricingTiersFromCatalog(catalog: CommercialCatalog): RitotechPricingTier[] {
  const fmt = (n: number) => n.toLocaleString('es-UY');
  const liteLine =
    `Plan libre en $0: ${catalog.lite.maxClientes} clientes · ${catalog.lite.maxProductos} productos · ${catalog.lite.maxOperacionesMes} cargas WhatsApp · ${catalog.lite.maxAccionesIaMes} IA/mes`;
  return RILOTECH_PRICING_TIERS.map((tier) => {
    const includedAi = catalog.products[tier.id].includedAi;
    const includes = tier.includes.map((line) => {
      if (line.includes('acciones IA / mes (en plan pago)')) {
        return includedAi > 0
          ? `${fmt(includedAi)} acciones IA / mes (en plan pago)`
          : 'Sin cupo de IA (el panel no usa RiloBot)';
      }
      if (line.startsWith('Plan libre')) return liteLine;
      return line;
    });
    if (!includes.some((line) => line.startsWith('Plan libre'))) {
      includes.splice(Math.min(4, includes.length), 0, liteLine);
    }
    return {
      ...tier,
      trialDays: catalog.trialDays,
      trialIncludes:
        tier.id === 'erp'
          ? `Panel web · ${catalog.trialDays} días gratis a full · 1 usuario`
          : tier.id === 'completo'
            ? `RiloBot + panel · ${catalog.trialDays} días gratis a full · ${fmt(catalog.trialAccionesIaMes)} IA en prueba`
            : `RiloBot + IA · ${catalog.trialDays} días gratis a full · ${fmt(catalog.trialAccionesIaMes)} IA en prueba`,
      afterTrial: litePitch(catalog),
      includes,
    };
  });
}

export function faqFromCatalog(catalog: CommercialCatalog): RitotechFaqItem[] {
  const lite = litePitch(catalog);
  return RILOTECH_FAQ.map((item) => {
    if (item.id === 'prueba') {
      return {
        ...item,
        answer: `No. ${catalog.trialDays} días a full, sin tarjeta. ${lite}`,
      };
    }
    if (item.id === 'limites') {
      return {
        ...item,
        answer:
          `${catalog.trialDays} días a full (${fmtAi(catalog.trialAccionesIaMes)} acciones IA/mes). ` +
          `Después seguís gratis: ${catalog.lite.maxClientes} clientes, ${catalog.lite.maxProductos} productos, ${catalog.lite.maxOperacionesMes} cargas WhatsApp y ${catalog.lite.maxAccionesIaMes} IA/mes. ` +
          `RiloBot pago incluye ${fmtAi(catalog.products.whatsapp.includedAi)} IA; Completo ${fmtAi(catalog.products.completo.includedAi)}. Tus datos no se borran.`,
      };
    }
    if (item.id === 'precio') {
      return {
        ...item,
        answer:
          `El precio de lista es para cuando te pasás del plan gratis. Primero ${catalog.trialDays} días a full; después seguís gratis con techos. ` +
          (catalog.introDiscountMonths > 0 && catalog.introDiscountPercent > 0
            ? `El ${catalog.introDiscountPercent}% off de ${catalog.introDiscountMonths} meses no corre desde el registro: corre cuando activás un plan pago. Después, el precio de lista.`
            : 'Si activás un plan pago, cobramos el precio de lista (o lo marcamos desde la plataforma).') +
          ` Los precios son de referencia y pueden reajustarse; si ya pagás, te avisamos antes de cambiar tu cuota.`,
      };
    }
    return item;
  });
}

function fmtAi(n: number): string {
  return n.toLocaleString('es-UY');
}

/** @deprecated Prefer pricingFootnoteForCountry */
export const RILOTECH_PRICING_FOOTNOTE = pricingFootnoteForCountry('UY');

export const RILOTECH_CTA_FINAL = {
  title: 'Probalo con tu negocio real.',
  body: `Empezá ${RILOBOT_TRIAL_DAYS} días a full, sin tarjeta. Después seguís gratis. Un feriante o taller chico puede vivir ahí.`,
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
    title: 'Tip: cobrá por WhatsApp',
    body: 'Escribí “pago de Juan 500” y RiloBot te pide confirmación antes de imputar el cobro.',
    audience: 'whatsapp',
  },
  {
    id: 'upsell-panel',
    title: '¿Querés ver caja y stock en pantalla?',
    body: 'Con el panel web ves entradas, salidas, compras y proveedores. Tu historial de WhatsApp ya queda guardado.',
    ctaLabel: 'Ver panel / planes',
    ctaRoute: '/planes',
    audience: 'whatsapp',
  },
  {
    id: 'upsell-bot',
    title: 'Cargá más rápido con RiloBot',
    body: 'Si ya usás el panel, sumá WhatsApp para anotar pedidos desde el celular sin abrir la web.',
    ctaLabel: 'Conocer RiloBot',
    ctaRoute: '/whatsapp',
    audience: 'erp',
  },
  {
    id: 'tip-confirm',
    title: 'Siempre confirmás antes de guardar',
    body: 'El bot te manda un resumen. Solo se registra en el ERP si respondés SÍ.',
    audience: 'all',
  },
];
