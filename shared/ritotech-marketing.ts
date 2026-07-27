import {
  PANEL_TRIAL_DAYS,
  RILOBOT_TRIAL_DAYS,
  trialDaysForProduct,
} from './trial-state.ts';
import { TRIAL_PRODUCT_LABELS, type TrialProductId } from './platform-access.ts';
import type { BillingCountryCode } from './billing-catalog.ts';
import { getProductPriceForCountry } from './billing-catalog.ts';

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
  ctaPrimary: `Probar RiloBot ${RILOBOT_TRIAL_DAYS} días gratis`,
  ctaSecondary: 'Ver cómo funciona',
  microcopy: `Sin tarjeta · 1 WhatsApp · Configuración guiada · Cancelás cuando quieras`,
};

export const RILOTECH_AUDIENCE_PITCH =
  'Pensado para microempresas, ferias, talleres, delivery y negocios chicos. Sin facturación electrónica: controlá caja, ventas, compras, proveedores y clientes.';

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
    title: `Probá ${RILOBOT_TRIAL_DAYS} o ${PANEL_TRIAL_DAYS} días gratis`,
    description: `RiloBot ${RILOBOT_TRIAL_DAYS} días · Panel/Completo ${PANEL_TRIAL_DAYS} días. Sin tarjeta. Si te sirve, activás el plan.`,
  },
  {
    step: '3',
    title: 'Sumá el panel cuando lo necesites',
    description:
      'Caja avanzada, stock, compras y reportes. Todo el historial de WhatsApp ya está ahí.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    headline: 'Recomendado para empezar',
    trialIncludes: `RiloBot + IA · ${RILOBOT_TRIAL_DAYS} días · 100 acciones IA en prueba`,
    afterTrial: 'Plan RiloBot mensual (1 WhatsApp, 1.000 acciones IA)',
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
      'Fotos básicas y consultas rápidas',
      'WhatsApp extras cobrables por usuario',
      'Sin panel web (podés sumarlo después)',
    ],
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    headline: 'Si preferís la computadora',
    trialIncludes: `Panel web · ${PANEL_TRIAL_DAYS} días · 1 usuario`,
    afterTrial: 'Plan Panel Web según módulos activos',
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
    trialIncludes: `RiloBot + panel · ${PANEL_TRIAL_DAYS} días · 200 acciones IA en prueba`,
    afterTrial: 'Paquete combinado (mejor precio que por separado)',
    trialDays: trialDaysForProduct('completo'),
    whatsapp: true,
    panelWeb: true,
    includes: [
      'Todo RiloBot + todo el panel',
      '1 WhatsApp + 1 usuario incluidos',
      'WhatsApp / usuarios extras a demanda',
      '2.000 acciones IA / mes (en plan pago)',
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
      'Sí. Es el plan recomendado para empezar: cargás escribiendo mensajes. Después, si querés ver reportes o stock, activás el panel sin perder datos.',
  },
  {
    id: 'solo-erp',
    question: '¿Puedo usar solo el panel web?',
    answer:
      'Sí. Ideal si preferís la PC. RiloBot se puede sumar después para cargar más rápido desde el celular.',
  },
  {
    id: 'prueba',
    question: '¿La prueba pide tarjeta?',
    answer: `No. RiloBot ${RILOBOT_TRIAL_DAYS} días · Panel y Completo ${PANEL_TRIAL_DAYS} días, sin tarjeta. Recién al activar el plan de pago vas a poder pagar con Mercado Pago. Tus datos no se borran cuando termina la prueba.`,
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
    answer: `RiloBot: ${RILOBOT_TRIAL_DAYS} días, 100 acciones IA, 1 WhatsApp y fotos básicas. Panel: ${PANEL_TRIAL_DAYS} días y 1 usuario. Completo: ${PANEL_TRIAL_DAYS} días, 1 WhatsApp, 1 usuario y 200 acciones IA.`,
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
      'Mostramos precios en moneda local (UYU o ARS). El valor final depende del plan y add-ons. En la prueba ves qué usás; al activar confirmás la cuota.',
  },
  {
    id: 'instalacion',
    question: '¿Hay que instalar algo?',
    answer: 'No. WhatsApp + navegador. Celular o PC.',
  },
];

export function pricingFootnoteForCountry(country: BillingCountryCode): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return `* Precios en ${currency}. RiloBot ${RILOBOT_TRIAL_DAYS} días · Panel/Completo ${PANEL_TRIAL_DAYS} días · Sin tarjeta · Pagás recién al activar`;
}

/** @deprecated Prefer pricingFootnoteForCountry */
export const RILOTECH_PRICING_FOOTNOTE = pricingFootnoteForCountry('UY');

export const RILOTECH_CTA_FINAL = {
  title: 'Probalo con tu negocio real.',
  body: 'Enviá tu primer pedido o venta hoy. No pedimos tarjeta y tus datos no se borran cuando termina la prueba.',
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
