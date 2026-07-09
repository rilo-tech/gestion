import { DEFAULT_TRIAL_DAYS } from '../../../../shared/trial-state.ts';
import {
  TRIAL_PRODUCT_LABELS,
  type TrialProductId,
} from '../../../../shared/platform-access.ts';

export const RILOTECH_TRIAL_DAYS = DEFAULT_TRIAL_DAYS;

export interface RitotechUseCase {
  title: string;
  description: string;
  icon: string;
}

export interface RitotechChatMessage {
  from: 'user' | 'bot';
  text: string;
}

export interface RitotechFaqItem {
  question: string;
  answer: string;
}

export interface RitotechPricingTier {
  id: TrialProductId;
  label: string;
  trialIncludes: string;
  afterTrial: string;
  highlight?: boolean;
}

export const RILOTECH_USE_CASES: RitotechUseCase[] = [
  {
    title: 'Pedidos en marcha',
    description:
      'Registrá pedidos con cliente, productos y fecha de entrega sin abrir el sistema. Ideal si tomás pedidos por teléfono o en el local.',
    icon: '📋',
  },
  {
    title: 'Ventas y cobros del día',
    description:
      'Anotá ventas y pagos parciales mientras atendés. RiloBot te pide confirmación antes de guardar cada operación.',
    icon: '💬',
  },
  {
    title: 'Control desde el panel',
    description:
      'Si elegís ERP Web o el plan completo, revisá stock, caja, clientes y reportes con todo lo cargado por WhatsApp unificado.',
    icon: '📊',
  },
  {
    title: 'Empezá chico, escalá después',
    description:
      'Podés probar solo WhatsApp y activar el panel web más adelante. Tus datos quedan en el mismo negocio.',
    icon: '🚀',
  },
];

export const RILOTECH_CHAT_EXAMPLE: RitotechChatMessage[] = [
  { from: 'user', text: 'Hola, nuevo pedido para María López' },
  {
    from: 'bot',
    text: 'Perfecto. ¿Qué productos y cantidades? Ej: 2 remeras M y 1 buzo L.',
  },
  { from: 'user', text: '2 remeras M $800 c/u y entrega el viernes' },
  {
    from: 'bot',
    text: 'Voy a registrar un pedido para María López (2 remeras M, total $1600, entrega viernes). ¿Confirmás? Respondé SÍ o NO.',
  },
  { from: 'user', text: 'Sí' },
  {
    from: 'bot',
    text: 'Listo, pedido guardado. Cuando actives el panel web vas a verlo en tu listado de pedidos.',
  },
];

export const RILOTECH_HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Elegí tu canal',
    text: 'Solo WhatsApp, solo ERP Web o los dos. La prueba dura ' + DEFAULT_TRIAL_DAYS + ' días sin tarjeta.',
  },
  {
    step: '2',
    title: 'Registrate en minutos',
    text: 'Completá tus datos y verificá el email. Si elegís WhatsApp, autorizamos el número que cargues.',
  },
  {
    step: '3',
    title: 'Empezá a cargar',
    text: 'Escribí por WhatsApp o ingresá al panel. Mismo negocio, mismos datos, distintos accesos según el plan.',
  },
];

export const RILOTECH_PRICING_TIERS: RitotechPricingTier[] = [
  {
    id: 'whatsapp',
    label: TRIAL_PRODUCT_LABELS.whatsapp,
    trialIncludes: 'RiloBot + IA + datos internos del ERP (sin panel web)',
    afterTrial: 'Cuota según volumen de mensajes y módulos. Podés sumar ERP Web como add-on.',
  },
  {
    id: 'erp',
    label: TRIAL_PRODUCT_LABELS.erp,
    trialIncludes: 'Panel web completo (plan intermedio en prueba)',
    afterTrial: 'Cuota mensual por plan y usuarios. WhatsApp IA se cotiza aparte si lo necesitás.',
    highlight: true,
  },
  {
    id: 'completo',
    label: TRIAL_PRODUCT_LABELS.completo,
    trialIncludes: 'WhatsApp + panel web + todos los módulos del plan intermedio',
    afterTrial: 'Paquete integrado con mejor precio que contratar cada canal por separado.',
  },
];

export const RILOTECH_FAQ: RitotechFaqItem[] = [
  {
    question: '¿Puedo usar solo WhatsApp sin entrar al ERP?',
    answer:
      'Sí. Con el plan Solo WhatsApp cargás pedidos, ventas y pagos escribiendo mensajes. Entrás a Mi cuenta para ver tu prueba y datos de acceso; el panel completo (/dashboard) no está incluido hasta que actives ERP Web.',
  },
  {
    question: '¿Puedo empezar por WhatsApp y sumar el panel web después?',
    answer:
      'Sí. Tus datos quedan guardados en el mismo negocio. Contactanos o activá la suscripción para habilitar ERP Web cuando lo necesites.',
  },
  {
    question: '¿Necesito instalar algo?',
    answer:
      'No. El ERP es una web; WhatsApp usa el número que ya tenés. Solo registrás tu negocio y, si elegís RiloBot, escribís al canal autorizado.',
  },
  {
    question: '¿Cuánto cuesta después de la prueba?',
    answer:
      'Durante los ' +
      DEFAULT_TRIAL_DAYS +
      ' días de prueba no pagás. Al activar el plan, la cuota depende del producto (WhatsApp, ERP o completo), usuarios y módulos. Te pasamos el detalle antes de cobrar.',
  },
  {
    question: '¿RiloBot guarda sin preguntar?',
    answer:
      'No. Antes de registrar un pedido, venta o pago te pide confirmación con SÍ o NO. Así evitás errores por mensajes ambiguos.',
  },
  {
    question: '¿Qué rubros están pensados para RiloTech?',
    answer:
      'Negocios que venden productos o servicios con pedidos, entregas y cobros: indumentaria, regalería, ferretería, gastronomía, servicios y emprendimientos en general.',
  },
];
