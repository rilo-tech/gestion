import { TRIAL_RUBROS, type TrialRubroId } from './trial-registration.ts';

export type WhatsappCopy = {
  rubro: TrialRubroId | null;
  /** True only when we have a concrete rubro (not empty / otro). */
  hasProductExamples: boolean;
  productHint: string;
  exampleSale: string;
  exampleOrder: string;
  exampleProduct: string;
  exampleProductOther: string;
};

const GENERIC: WhatsappCopy = {
  rubro: null,
  hasProductExamples: false,
  productHint:
    'Nombrá lo que vendés como lo usás vos. Si hay variantes, agregá el detalle que las distingue.',
  exampleSale: 'Venta a María Silva, lo que vendiste, cobró 180',
  exampleOrder: 'Pedido para Juan Pérez, lo que pidió, $180, entrega el viernes',
  exampleProduct: 'lo que vendés $180',
  exampleProductOther: 'otra cosa que vendés',
};

const BY_RUBRO: Record<Exclude<TrialRubroId, 'otro'>, Omit<WhatsappCopy, 'rubro' | 'hasProductExamples'>> = {
  personalizados: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá el detalle que las distingue (talle, color, personalización).',
    exampleSale: 'Venta a María Silva, remera blanca L con nombre, cobró 1800',
    exampleOrder: 'Pedido para Juan Pérez, taza blanca con foto, $800, entrega el viernes',
    exampleProduct: 'remera blanca L $1800',
    exampleProductOther: 'taza blanca con foto $800',
  },
  ropa: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá talle, color u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, jean azul 42, cobró 2500',
    exampleOrder: 'Pedido para Juan Pérez, campera negra M, $4200, entrega el viernes',
    exampleProduct: 'jean azul 42 $2500',
    exampleProductOther: 'campera negra M',
  },
  almacen: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá peso, marca u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, 1 kilo de fideos, cobró 180',
    exampleOrder: 'Pedido para Juan Pérez, aceite 1.5 L, $250, entrega el viernes',
    exampleProduct: '1 kilo de fideos $180',
    exampleProductOther: 'aceite 1.5 L',
  },
  comida: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá peso, porción u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, 2 kg de asado, cobró 1800',
    exampleOrder: 'Pedido para Juan Pérez, menú del día, $450, entrega el viernes',
    exampleProduct: '2 kg de asado $1800',
    exampleProductOther: 'menú del día',
  },
  servicios: {
    productHint:
      'Nombrá el servicio como lo cobrás. Si hay variantes, agregá el detalle que las distingue (duración, tipo, domicilio).',
    exampleSale: 'Venta a María Silva, corte de pelo, cobró 800',
    exampleOrder: 'Pedido para Juan Pérez, consulta a domicilio, $1500, entrega el viernes',
    exampleProduct: 'corte de pelo $800',
    exampleProductOther: 'consulta a domicilio',
  },
};

const KNOWN_IDS = new Set<string>(TRIAL_RUBROS.map((r) => r.id).filter((id) => id !== 'otro'));

export function normalizeWhatsappRubro(rubro?: string | null): TrialRubroId | null {
  const id = String(rubro ?? '').trim().toLowerCase();
  if (!id || id === 'otro') return null;
  if (KNOWN_IDS.has(id)) return id as TrialRubroId;
  return null;
}

/** Copy for RILO Bot. Without a known rubro, never invents a product name. */
export function whatsappCopyForRubro(rubro?: string | null): WhatsappCopy {
  const id = normalizeWhatsappRubro(rubro);
  if (!id || id === 'otro') return GENERIC;
  const specific = BY_RUBRO[id as Exclude<TrialRubroId, 'otro'>];
  if (!specific) return GENERIC;
  return {
    rubro: id,
    hasProductExamples: true,
    ...specific,
  };
}

export function productExamplesLine(copy: WhatsappCopy): string {
  if (!copy.hasProductExamples) {
    return 'Mandame el nombre como lo vendés, y el precio si querés.';
  }
  return `Ej: ${copy.exampleProduct}  ·  o  ${copy.exampleProductOther}`;
}

export type HelpTopicId =
  | 'pedidos'
  | 'ventas'
  | 'compras'
  | 'cobros'
  | 'caja'
  | 'clientes'
  | 'ganancias'
  | 'productos';

const HELP_MENU_ITEMS: Array<{ id: HelpTopicId; n: number; title: string }> = [
  { id: 'pedidos', n: 1, title: 'Pedidos' },
  { id: 'ventas', n: 2, title: 'Ventas' },
  { id: 'compras', n: 3, title: 'Compras y stock' },
  { id: 'cobros', n: 4, title: 'Cobros y saldos' },
  { id: 'caja', n: 5, title: 'Caja' },
  { id: 'clientes', n: 6, title: 'Clientes' },
];

const UNSUPPORTED_HELP =
  /(?<![\p{L}])(?:factura\s+electr[oó]nica|afip|dgi|imprimir|pdf|excel|enviar(?:le)?\s+al\s+cliente|tienda\s+online|mercado\s*libre|\bmeli\b|andreani|\boca\b|correo\s+argentino|empleados?|sueldos?|n[oó]mina|e-?ticket\s+a\s+cliente|exportar)(?![\p{L}])/iu;

const INTENSE_HELP =
  /\b(pero\s+(tiene|ten[eé]s|necesito)|tiene\s+que\s+poder|no\s+me\s+sirve|entonces\s+para\s+qu[eé]|no\s+puede\s+ser|es\s+b[aá]sico|siempre\s+lo\s+pido)\b/i;

export function riloBotHelpMenu(): string {
  const items = HELP_MENU_ITEMS.map((item) => `${item.n}) ${item.title}`).join('\n');
  return (
    `*Qué puedo hacer*\n\n` +
    `Escribime como hablás: voy aprendiendo tu forma. Te armo un resumen; *SÍ* guarda y *NO* cancela.\n\n` +
    `${items}\n\n` +
    `Decime el *número* o *cómo hago un pedido* y te explico esa parte.`
  );
}

export type SetupGaps = {
  cash: boolean;
  products: boolean;
  suppliers: boolean;
};

export type SetupLoadStep = 'cash' | 'products' | 'suppliers' | 'clients';

export function hasSetupGaps(gaps: SetupGaps): boolean {
  return Boolean(gaps.cash || gaps.products || gaps.suppliers);
}

/** «cargar caja / productos / proveedores» — no usa números para no chocar con el menú 1–6. */
export function matchSetupLoad(text: string): SetupLoadStep | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (t.split(/\s+/).filter(Boolean).length > 6) return null;
  if (
    /^(cargar\s+)?(el\s+)?saldo\s+inicial(\s+de\s+caja)?$/i.test(t) ||
    /^(cargar\s+)?(el\s+)?saldo\s+de\s+caja$/i.test(t) ||
    /\bcargar\s+(el\s+)?(saldo(\s+de)?\s+)?caja\b/i.test(t)
  ) {
    return 'cash';
  }
  if (/\bcargar\s+(algunos\s+)?productos?\b/i.test(t)) return 'products';
  if (/\bcargar\s+(algunos\s+)?proveedores?\b/i.test(t)) return 'suppliers';
  if (/\bcargar\s+(algunos\s+)?clientes?\b/i.test(t)) return 'clients';
  return null;
}

export function riloBotSetupStartCard(gaps: SetupGaps): string {
  const bullets: string[] = [];
  const verbs: string[] = [];
  if (gaps.cash) {
    bullets.push('• *Caja* — saldo inicial (si no, queda en *$0*)');
    verbs.push('*cargar caja*');
  }
  if (gaps.products) {
    bullets.push('• *Productos*');
    verbs.push('*cargar productos*');
  }
  if (gaps.suppliers) {
    bullets.push('• *Proveedores* — o mandá la foto de una factura');
    verbs.push('*cargar proveedores*');
  }
  if (!bullets.length) return '';

  const allNew = gaps.cash && gaps.products && gaps.suppliers;
  const intro = allNew
    ? 'Como recién arrancás, cargá esto primero:'
    : 'Todavía te falta esto para dejar todo configurado:';
  const ask =
    verbs.length === 1
      ? `Escribí ${verbs[0]}.`
      : verbs.length === 2
        ? `Escribí ${verbs[0]} o ${verbs[1]}.`
        : `Escribí ${verbs[0]}, ${verbs[1]} o ${verbs[2]}.`;

  return `*Para empezar*\n\n${intro}\n${bullets.join('\n')}\n\n${ask}`;
}

function topicDetail(id: HelpTopicId, copy: WhatsappCopy): string {
  const again = `¿Otra? Número, o *consultame* para el listado.`;
  if (id === 'pedidos') {
    return (
      `*Pedidos*\n\n` +
      `Mandame algo así:\n` +
      `• ${copy.exampleOrder}\n` +
      `• listame pedidos\n` +
      `• buscá el oversize de Sergio\n\n` +
      `Te muestro el resumen y lo vamos corrigiendo. Si el cliente o el producto no está, te pregunto.\n\n` +
      again
    );
  }
  if (id === 'ventas') {
    return (
      `*Ventas*\n\n` +
      `Mandame algo así:\n` +
      `• ${copy.exampleSale}\n\n` +
      `Igual que un pedido: resumen primero, *SÍ* guarda.\n\n` +
      again
    );
  }
  if (id === 'compras') {
    return (
      `*Compras y stock*\n\n` +
      `Mandá la *foto de la factura o remito*. Registro la compra y sumo stock.\n\n` +
      `No muevo caja ni cambio el costo del producto: eso es otro mensaje.\n\n` +
      `Si querés *caja* o *costos*, preguntame.\n\n` +
      again
    );
  }
  if (id === 'cobros') {
    return (
      `*Cobros y saldos*\n\n` +
      `• Pago de Pedro Gómez 500\n` +
      `• ¿Cuánto debe Pedro?\n` +
      `• me llegó un pago de 500\n` +
      `• listame pedidos con saldo\n\n` +
      `Si no sabés de qué pedido es, decime *me llegó un pago*. Te pido el cliente, el producto o de cuánto fue.\n` +
      `Con el número de la lista: *pagó 500*, *saldalo* o *listo*.\n\n` +
      `El cobro entra a caja y baja el saldo del pedido, igual que en el panel.\n\n` +
      again
    );
  }
  if (id === 'caja') {
    return (
      `*Caja*\n\n` +
      `Si no cargaste saldo, arranca en *$0*.\n\n` +
      `• egreso 500 en personal\n` +
      `• ingreso 2000 a caja del negocio\n` +
      `• gasto 500 flete\n\n` +
      `Si tenés más de una caja y no decís cuál, te pregunto.\n` +
      `Para ver cuánto hay: *saldo neto de las cajas*.\n\n` +
      again
    );
  }
  if (id === 'clientes') {
    return (
      `*Clientes*\n\n` +
      `• Registrar cliente María Pérez\n\n` +
      `Si hay varias Marías, te pregunto cuál. Los apodos los voy memorizando cuando confirmás.\n\n` +
      again
    );
  }
  if (id === 'ganancias') {
    return (
      `*Ganancias y costos*\n\n` +
      `Costo extra del pedido (estampado, vinilo), no es caja:\n` +
      `• costo estampado 200\n\n` +
      `Costo de catálogo, otro mensaje:\n` +
      `• el costo de Taza AA es 147\n\n` +
      again
    );
  }
  return (
    `*Productos*\n\n` +
    `${copy.productHint}\n\n` +
    `Los nombrás al registrar. Si no está, te pregunto si lo creo. La foto de compra suma stock.\n\n` +
    again
  );
}

export function riloBotHelpTopic(id: HelpTopicId, copy: WhatsappCopy): string {
  return topicDetail(id, copy);
}

export function matchHelpTopic(text: string): HelpTopicId | 'menu' | null {
  const t = String(text ?? '').trim();
  if (!t) return 'menu';
  if (looksLikeLiveBusinessQuery(t)) return null;
  if (
    /^(consultame|consultáme|ayuda|help|comandos|menu|menú|listado|opciones|ejemplos?)[\s?¿!.]*$/i.test(t) ||
    /\bqu[eé]\s+(pod[eé]s|podes|puedes|puedo)\s+hacer\b/i.test(t) ||
    /\bqu[eé]\s+hac[eé]s\b/i.test(t) ||
    /\bc[oó]mo\s+(funciona|uso|te uso|hablo)\b/i.test(t)
  ) {
    return 'menu';
  }
  const numbered = t.match(/^(\d{1,2})$/);
  if (numbered) {
    const n = Number(numbered[1]);
    return HELP_MENU_ITEMS.find((item) => item.n === n)?.id ?? null;
  }
  if (/^(el\s+)?primero$/i.test(t)) return 'pedidos';
  if (/^(el\s+)?segundo$/i.test(t)) return 'ventas';
  if (/^(el\s+)?tercero$/i.test(t)) return 'compras';
  if (/^(el\s+)?cuarto$/i.test(t)) return 'cobros';
  if (/^(el\s+)?quinto$/i.test(t)) return 'caja';
  if (/^(el\s+)?sexto$/i.test(t)) return 'clientes';

  if (/\b(ganancia|estampado|vinilo|costo\s+extra|costo\s+de\s+cat[aá]logo|m[aá]rgen)\b/i.test(t)) {
    return 'ganancias';
  }
  if (/\b(compra|remito|factura|stock|proveedor)\b/i.test(t)) return 'compras';
  if (/\b(egreso|ingreso|gasto|flete|caja)\b/i.test(t)) return 'caja';
  if (/\b(cobro|cobr[eé]|pago|se[ñn]a|saldo|cu[aá]nto\s+debe)\b/i.test(t)) return 'cobros';
  if (/\bclientes?\b/i.test(t)) return 'clientes';
  if (/\b(productos?|cat[aá]logo)\b/i.test(t)) return 'productos';
  if (/\bventas?\b/i.test(t)) return 'ventas';
  if (/\b(pedidos?|[oó]rdenes?)\b/i.test(t)) return 'pedidos';
  return null;
}

export function looksLikeUnsupportedHelp(text: string): boolean {
  return UNSUPPORTED_HELP.test(String(text ?? ''));
}

export function looksLikeIntenseHelp(text: string): boolean {
  return INTENSE_HELP.test(String(text ?? ''));
}

/** Pregunta de datos reales (saldo, cuánto hay), no «cómo hago…». */
export function looksLikeLiveBusinessQuery(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (looksLikeCashBalanceQuery(t)) return true;
  if (/\bcu[aá]nto\s+debe\b/i.test(t)) return true;
  if (/[¿?]/.test(t) && !isHelpHowToQuestion(t)) return true;
  return false;
}

export function looksLikeCashBalanceQuery(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^(el\s+)?saldos?[\s?¿!.]*$/i.test(t)) return true;
  return (
    /\bsaldo\s+neto\b/i.test(t) ||
    /\bcu[aá]nto\s+saldo\b/i.test(t) ||
    /\bsaldo\s+(de\s+)?(la[s]?\s+)?cajas?\b/i.test(t) ||
    /\bcu[aá]nto\s+(tengo|hay|queda)(?:\s+(?:en|de|como))?\b/i.test(t) ||
    /\bqu[eé]\s+saldo\s+(tengo|hay|queda)\b/i.test(t) ||
    /\bcu[aá]nto\s+hay\s+en\s+(la\s+)?caja/i.test(t)
  );
}

function isHelpHowToQuestion(text: string): boolean {
  const t = String(text ?? '').trim();
  return (
    /^[¿?]?c[oó]mo\b/i.test(t) ||
    /^[¿?]?qu[eé]\s+(es|puedo|pod[eé]s|podes|hac[eé]s)\b/i.test(t) ||
    /\bqu[eé]\s+(puedo|pod[eé]s|podes)\s+hacer\b/i.test(t)
  );
}

export function isThanksText(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return (
    /^(muchas\s+|mil\s+)?gracias(\s+a\s+vos)?[\s!¡?.]*$/i.test(t) ||
    /^(thanks|ty|thank you)[\s!¡?.]*$/i.test(t) ||
    /^(ok|dale|bueno)[,.]?\s+gracias[\s!¡?.]*$/i.test(t)
  );
}

/** Seguir en la ayuda (número, «cómo hago…») y no arrancar un pedido. */
export function isHelpFollowUp(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (looksLikeLiveBusinessQuery(t)) return false;
  if (matchSetupLoad(t)) return true;
  if (/^(consultame|consultáme|ayuda|help|comandos|menu|menú|listado|opciones)[\s?¿!.]*$/i.test(t)) {
    return true;
  }
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^(el\s+)?(primero|segundo|tercero|cuarto|quinto|sexto)$/i.test(t)) return true;
  if (/^[¿?]?c[oó]mo\b/i.test(t) || /^[¿?]?qu[eé]\s+(es|puedo|pod[eé]s|podes|hac[eé]s)\b/i.test(t)) {
    return true;
  }
  if (looksLikeUnsupportedHelp(t) || looksLikeIntenseHelp(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && matchHelpTopic(t)) return true;
  return false;
}

export function riloBotUnsupportedHelp(intense: boolean): string {
  if (intense) {
    return (
      `Todavía no llego a eso por WhatsApp.\n\n` +
      `Si lo necesitás sí o sí, escribile a *soporte* y lo vemos.\n` +
      `Mientras, ¿te ayudo con un pedido, una compra o caja?`
    );
  }
  return (
    `Eso todavía no lo hago por acá.\n\n` +
    `Puedo con pedidos, ventas, compras, cobros, caja y clientes.\n` +
    `Decime el *número* o cómo lo querés hacer.`
  );
}

/** Manual corto (Mi cuenta). El detalle lo da el bot al preguntar. */
export function riloBotManualLines(_copy: WhatsappCopy): string[] {
  return [
    'Escribís como hablás. Voy aprendiendo tu forma. SÍ guarda, NO cancela.',
    ...HELP_MENU_ITEMS.map((item) => `${item.n}) ${item.title}`),
    'Por WhatsApp, pedile el detalle: un número o «cómo hago un pedido».',
  ];
}

export function riloBotManualMessage(_copy: WhatsappCopy): string {
  return riloBotHelpMenu();
}
