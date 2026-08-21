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
  title: 'Más orden. Más control. Más tiempo para vender.',
  subtitle:
    'Controlá tu negocio sin planillas ni anotaciones sueltas. Registrá pedidos, ventas, cobros y caja desde WhatsApp o desde la web.',
  tagline: 'Todo en un solo lugar, simple y rápido.',
  ctaPrimary: 'Probar 30 días gratis',
  ctaSecondary: 'Ver cómo funciona',
  microcopy: 'Sin tarjeta · Configuración guiada · Cancelás cuando quieras',
};

export const RILOTECH_AUDIENCE_PITCH =
  'Para ferias, talleres, delivery y negocios chicos. Controlá caja, ventas, compras, proveedores y clientes sin sistemas pesados.';

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
    title: 'Elegí cómo trabajar',
    description: 'RILO Bot por WhatsApp, RILO Gestión en la computadora, o los dos juntos.',
  },
  {
    step: '2',
    title: 'Probá 30 días gratis',
    description: 'Sin tarjeta. Cargá tu negocio real. Al vencer, tus datos siguen guardados.',
  },
  {
    step: '3',
    title: 'Activá el plan cuando quieras',
    description:
      'Contratá mensual desde tu cuenta. Si ya tenés un canal, sumá el otro con la misma empresa. La baja no borra datos.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    headline: 'Gestión rápida desde WhatsApp.',
    trialIncludes: `${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá el plan mensual para seguir operando. Tus datos no se borran.',
    trialDays: trialDaysForProduct('whatsapp'),
    whatsapp: true,
    panelWeb: false,
    includes: [
      '1 administrador incluido',
      'Pedidos, ventas, compras, cobros y caja',
      'Confirmación SÍ/NO antes de guardar',
      'Consulta de saldos y caja del día',
      'Alta de cliente o producto al usarlos',
    ],
  },
  {
    id: 'completo',
    label: TRIAL_PRODUCT_LABELS.completo,
    headline: 'Bot + Gestión: WhatsApp y panel web juntos.',
    trialIncludes: `${PANEL_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá RILO Completo. Tus datos no se borran.',
    trialDays: trialDaysForProduct('completo'),
    whatsapp: true,
    panelWeb: true,
    featured: true,
    badgeLabel: 'Más elegido',
    includes: [
      'Todo RILO Bot + RILO Gestión',
      '1 WhatsApp + 1 administrador incluidos',
      'Misma empresa, misma información',
    ],
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    headline: 'Panel web para controlar tu negocio.',
    trialIncludes: `${PANEL_TRIAL_DAYS} días gratis, sin tarjeta`,
    afterTrial: 'Al vencer, contratá el plan mensual. Tus datos no se borran.',
    trialDays: trialDaysForProduct('erp'),
    whatsapp: false,
    panelWeb: true,
    includes: [
      '1 administrador incluido',
      'Clientes, productos, proveedores',
      'Pedidos, ventas, compras y caja',
      'Inicio y configuración básica',
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
      'RILO Bot usa inteligencia artificial de Google Gemini para interpretar mensajes. Puede equivocarse; por eso siempre muestra un resumen y no guarda la operación hasta que confirmás.',
  },
  {
    id: 'solo-whatsapp',
    question: '¿Puedo usar solo RILO Bot sin RILO Gestión?',
    answer:
      'Sí. RILO Bot cubre pedidos, ventas, compras, cobros y caja por WhatsApp. RILO Gestión se suma después en Planes, con la misma cuenta. Email o WhatsApp ya usados no crean otra empresa.',
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
      'Siempre te muestra un resumen y pedís SÍ o NO. Si el cliente o el producto no están claros, te lista opciones para elegir.',
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
      'Los precios de lista se ven en Planes y los publica Superadmin. Primero 30 días gratis; después contratás el plan mensual. Completo sale menos que Bot + Gestión por separado. Si ya pagás, te avisamos antes de cambiar tu cuota.',
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

export function pricingTiersFromCatalog(catalog: CommercialCatalog): RitotechPricingTier[] {
  return RILOTECH_PRICING_TIERS.map((tier) => ({
    ...tier,
    trialDays: catalog.trialDays,
    trialIncludes: `${catalog.trialDays} días gratis, sin tarjeta`,
    afterTrial: litePitch(catalog),
  }));
}

export function faqFromCatalog(catalog: CommercialCatalog): RitotechFaqItem[] {
  return RILOTECH_FAQ.map((item) => {
    if (item.id === 'prueba') {
      return {
        ...item,
        answer: `No. ${catalog.trialDays} días gratis, sin tarjeta. Al vencer, tus datos siguen. Para seguir usando RILO, activá un plan.`,
      };
    }
    if (item.id === 'limites') {
      return {
        ...item,
        answer: `${catalog.trialDays} días gratis en los tres planes, sin tarjeta. No hay plan gratis permanente: al vencer, contratás para seguir operando. Tus datos no se borran.`,
      };
    }
    if (item.id === 'precio') {
      return {
        ...item,
        answer:
          `Primero ${catalog.trialDays} días gratis. Después contratás el plan mensual al precio publicado. ` +
          `RILO Completo sale menos que RILO Bot + RILO Gestión por separado. Si ya pagás, te avisamos antes de cambiar tu cuota.`,
      };
    }
    return item;
  });
}

/** @deprecated Prefer pricingFootnoteForCountry */
export const RILOTECH_PRICING_FOOTNOTE = pricingFootnoteForCountry('UY');

export const RILOTECH_CTA_FINAL = {
  title: 'Empezá hoy.',
  body: `${RILOBOT_TRIAL_DAYS} días gratis, sin tarjeta. Usá RILO Bot, RILO Gestión o los dos. Cancelás cuando quieras.`,
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
    body: 'Escribí “pago de Juan 500” y RILO Bot te pide confirmación antes de imputar el cobro.',
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
    title: 'Cargá más rápido con RILO Bot',
    body: 'Si ya usás el panel, sumá WhatsApp desde Planes para anotar pedidos desde el celular.',
    ctaLabel: 'Sumar RILO Bot',
    ctaRoute: '/planes',
    audience: 'erp',
  },
  {
    id: 'tip-confirm',
    title: 'Siempre confirmás antes de guardar',
    body: 'El bot te manda un resumen. Solo se registra en RILO Gestión si respondés SÍ.',
    audience: 'all',
  },
];
