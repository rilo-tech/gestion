import { DEFAULT_TRIAL_DAYS } from './trial-state.ts';
import { TRIAL_PRODUCT_LABELS, type TrialProductId } from './platform-access.ts';

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
  trialIncludes: string;
  afterTrial: string;
}

export const RILOTECH_USE_CASES: RitotechUseCase[] = [
  {
    title: 'Cargás desde el celular',
    description:
      'Registrás pedidos y cobros escribiendo por WhatsApp. Ideal si no querés abrir una computadora todos los días.',
    icon: 'phone',
  },
  {
    title: 'Comercio con pedidos y entregas',
    description:
      'Seguís quién debe, qué falta entregar y qué se cobró. Todo queda en el mismo historial del negocio.',
    icon: 'store',
  },
  {
    title: 'Control con panel web',
    description:
      'Clientes, stock, caja y reportes en una web ordenada. Para cuando querés ver el negocio con detalle.',
    icon: 'chart',
  },
  {
    title: 'Varias personas en el negocio',
    description:
      'Roles y permisos en el ERP. WhatsApp autorizado por número para quien carga rápido desde el teléfono.',
    icon: 'team',
  },
];

export const RILOTECH_CHAT_DEMO: RitotechChatMessage[] = [
  { from: 'user', text: 'Hola, nuevo pedido para María García' },
  {
    from: 'bot',
    text: 'Hola. Decime los productos y cantidades. Ej: 2 remeras talle M, seña $500.',
  },
  { from: 'user', text: '2 remeras M y 1 buzo L. Seña 800' },
  {
    from: 'bot',
    text: 'Voy a registrar un pedido para María García (2 remeras M, 1 buzo L, seña $800). ¿Confirmás? Respondé SÍ o NO.',
  },
  { from: 'user', text: 'Sí' },
  {
    from: 'bot',
    text: 'Listo. Pedido guardado. Cuando quieras consultá saldos o cargá un pago con un mensaje.',
  },
];

export const RILOTECH_HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Elegís tu canal',
    description: 'Solo WhatsApp, solo ERP Web o los dos. La prueba incluye lo que elijas.',
  },
  {
    step: '2',
    title: 'Creás tu cuenta',
    description: `Registro en minutos con verificación por email. ${DEFAULT_TRIAL_DAYS} días de prueba sin tarjeta.`,
  },
  {
    step: '3',
    title: 'Empezás a cargar',
    description:
      'Por WhatsApp escribís mensajes naturales; en el panel web ves listados, stock, caja y reportes.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    trialIncludes: 'RiloBot + IA + datos del negocio (sin panel web completo)',
    afterTrial: 'Plan WhatsApp según volumen de mensajes y usuarios autorizados',
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    trialIncludes: 'Panel web, plan intermedio de prueba, usuarios según plan',
    afterTrial: 'Cuota mensual ERP según plan y módulos activos',
  },
  {
    id: 'completo',
    label: TRIAL_PRODUCT_LABELS.completo,
    trialIncludes: 'WhatsApp + panel web + todos los módulos del plan intermedio',
    afterTrial: 'Paquete combinado con descuento respecto a contratar por separado',
  },
];

export const RILOTECH_FAQ: RitotechFaqItem[] = [
  {
    id: 'solo-whatsapp',
    question: '¿Puedo registrarme solo por WhatsApp sin el ERP Web?',
    answer:
      'Sí. Elegís "Solo WhatsApp" al registrarte. Cargás pedidos y ventas por mensaje y entrás a Mi cuenta para ver tu prueba. El panel completo (/dashboard) se activa si después contratás o activás ERP Web.',
  },
  {
    id: 'solo-erp',
    question: '¿Puedo usar solo el panel web sin WhatsApp?',
    answer:
      'Sí. Con "Solo ERP Web" tenés clientes, stock, caja, ventas y reportes en la web. RiloBot es un add-on que podés activar más adelante desde tu cuenta o con soporte.',
  },
  {
    id: 'datos',
    question: '¿Se pierden mis datos si empiezo por un solo canal?',
    answer:
      'No. Tus pedidos, clientes y movimientos quedan en el mismo negocio. Si empezás por WhatsApp y luego activás el ERP Web, ves el historial en el panel.',
  },
  {
    id: 'prueba',
    question: `¿Cuánto dura la prueba y qué incluye?`,
    answer: `La prueba dura ${DEFAULT_TRIAL_DAYS} días e incluye el producto que elijas (WhatsApp, ERP o completo). No pedimos tarjeta para empezar. Al vencer, podés activar un plan de pago para seguir operando.`,
  },
  {
    id: 'confirmacion',
    question: '¿RiloBot guarda todo automáticamente?',
    answer:
      'No sin tu OK. Para pedidos, ventas y pagos el bot te muestra un resumen y pedís confirmación con SÍ o NO antes de guardar en el sistema.',
  },
  {
    id: 'precio',
    question: '¿Cuánto cuesta después de la prueba?',
    answer:
      'Los precios finales dependen del plan (WhatsApp, ERP o completo) y del tamaño de tu negocio. Durante la prueba ves exactamente qué módulos tenés activos. Al activar, acordamos la cuota mensual — sin sorpresas respecto a lo que probaste.',
  },
  {
    id: 'instalacion',
    question: '¿Hay que instalar algo?',
    answer:
      'No. Es 100 % web y WhatsApp. Entrás desde el navegador o escribís al número de RiloBot. Funciona en celular y computadora.',
  },
];

export const RILOTECH_PRICING_FOOTNOTE = `Prueba gratis ${DEFAULT_TRIAL_DAYS} días · Sin tarjeta para empezar · Precios de pago se confirman al activar el plan`;
