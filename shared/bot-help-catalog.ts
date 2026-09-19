import { canUseBusinessFeature } from './business-capability.ts';
import type { BusinessFeatureId, BusinessProfile } from './business-profile.ts';
import type { TrialProductId } from './platform-access.ts';
import { TRIAL_PRODUCT_LABELS } from './platform-access.ts';
import type { SubscriptionModulesMap } from './subscription-modules.ts';

/** Secciones de guía/onboarding — solo UX, no interpretación de mensajes. */
export type BotHelpSectionId =
  | 'cash'
  | 'cash_income'
  | 'cash_expense'
  | 'cash_balance'
  | 'cash_movements'
  | 'sales'
  | 'orders'
  | 'catalog_stock'
  | 'services'
  | 'purchases'
  | 'clients'
  | 'suppliers'
  | 'collaborators'
  | 'payables'
  | 'automations';

export type BotHelpMenuContext = {
  productId: TrialProductId | null;
  profile: BusinessProfile;
  entitlements: SubscriptionModulesMap;
  permission?: boolean;
};

export type BotHelpSectionCopy = {
  id: BotHelpSectionId;
  icon: string;
  label: string;
  title: string;
  intro: string;
  examples: string[];
  bullets: string[];
  tryPrompt: string;
  requiredFeature?: BusinessFeatureId;
};

const SECTION_COPY: Record<BotHelpSectionId, Omit<BotHelpSectionCopy, 'label'> & { defaultLabel: string }> = {
  cash: {
    id: 'cash',
    icon: '💰',
    defaultLabel: 'Caja',
    title: 'Caja',
    intro: 'Registrá ingresos y gastos, y consultá cuánto tenés.',
    examples: ['“Gasté $500 en combustible.”', '“¿Cuánto tengo en caja?”'],
    bullets: ['Registrar movimientos', 'Consultar saldo', 'Ver movimientos del período'],
    tryPrompt: 'Escribime el movimiento que querés registrar o la consulta.',
  },
  cash_income: {
    id: 'cash_income',
    icon: '➕',
    defaultLabel: 'Registrar un ingreso',
    title: 'Registrar un ingreso',
    intro: 'Escribime naturalmente, por ejemplo:',
    examples: ['“Ingresaron $2000 por ventas del día.”'],
    bullets: [
      'Si está claro, lo registra',
      'Si falta un dato, te pregunta',
      'Las acciones sensibles piden confirmación',
    ],
    tryPrompt: 'Escribime el ingreso que querés registrar.',
  },
  cash_expense: {
    id: 'cash_expense',
    icon: '➖',
    defaultLabel: 'Registrar un gasto',
    title: 'Registrar un gasto',
    intro: 'Escribime naturalmente, por ejemplo:',
    examples: ['“Gasté $500 en combustible.”'],
    bullets: [
      'Si está claro, lo registra',
      'Si falta un dato, te pregunta',
      'Las acciones sensibles piden confirmación',
    ],
    tryPrompt: 'Escribime el gasto que querés registrar.',
  },
  cash_balance: {
    id: 'cash_balance',
    icon: '💰',
    defaultLabel: 'Consultar saldo',
    title: 'Consultar saldo',
    intro: 'Podés preguntarme cosas como:',
    examples: ['“¿Cuánto tengo en caja?”', '“¿Cuánto gasté este mes?”'],
    bullets: ['Si tenés una caja predeterminada, la uso automáticamente'],
    tryPrompt: 'Preguntame cuánto tenés o cuánto gastaste.',
  },
  cash_movements: {
    id: 'cash_movements',
    icon: '📋',
    defaultLabel: 'Ver movimientos',
    title: 'Ver movimientos',
    intro: 'Podés pedirme, por ejemplo:',
    examples: ['“Mostrame los movimientos de hoy.”', '“¿Qué entró esta semana?”'],
    bullets: ['Filtrá por fecha o tipo si lo necesitás'],
    tryPrompt: 'Pedime los movimientos que querés ver.',
  },
  sales: {
    id: 'sales',
    icon: '💵',
    defaultLabel: 'Ventas',
    title: 'Ventas',
    intro: 'Por ejemplo:',
    examples: ['“Vendí 2 shampoos a María.”'],
    bullets: [
      'Uso producto, cliente, precio y caja si ya los tengo',
      'Solo te pregunto lo indispensable',
    ],
    tryPrompt: 'Contame la venta que querés registrar.',
  },
  orders: {
    id: 'orders',
    icon: '📋',
    defaultLabel: 'Pedidos',
    title: 'Pedidos',
    intro: 'Podés decirme, por ejemplo:',
    examples: ['“Pedido para Juan: 2 remeras M, entrega el viernes.”'],
    bullets: ['Seguimiento de estados', 'Convertir a venta cuando corresponda'],
    tryPrompt: 'Contame el pedido o trabajo que querés cargar.',
    requiredFeature: 'orders',
  },
  catalog_stock: {
    id: 'catalog_stock',
    icon: '📦',
    defaultLabel: 'Productos y stock',
    title: 'Productos y stock',
    intro: 'Podés preguntarme:',
    examples: ['“¿Cuántas unidades quedan de Shampoo?”', '“Sumale 10 unidades.”'],
    bullets: ['Productos sin stock también pueden existir como servicios o insumos'],
    tryPrompt: 'Preguntame existencias o pedime un ajuste de stock.',
    requiredFeature: 'catalog',
  },
  services: {
    id: 'services',
    icon: '✂️',
    defaultLabel: 'Servicios',
    title: 'Servicios',
    intro: 'Podés consultar o registrar, por ejemplo:',
    examples: ['“¿Cuánto cobro el corte?”', '“Agregá servicio Coloración $3500.”'],
    bullets: ['Ideal para negocios que venden servicios'],
    tryPrompt: 'Contame el servicio o la consulta.',
    requiredFeature: 'services',
  },
  purchases: {
    id: 'purchases',
    icon: '🛒',
    defaultLabel: 'Compras',
    title: 'Compras',
    intro: 'Podés decirme:',
    examples: ['“Registrá una compra de 10 unidades de Producto X.”'],
    bullets: [
      'Mandá foto de factura o remito',
      'Reconozco productos, sumo stock y registro el pago',
    ],
    tryPrompt: 'Contame la compra o mandame la foto de la factura.',
    requiredFeature: 'purchases',
  },
  clients: {
    id: 'clients',
    icon: '👥',
    defaultLabel: 'Clientes',
    title: 'Clientes',
    intro: 'Podés pedirme, por ejemplo:',
    examples: ['“¿Cuánto debe María?”', '“Agregá cliente Juan Pérez.”'],
    bullets: ['Consultar saldos', 'Crear o buscar clientes'],
    tryPrompt: 'Contame qué necesitás del cliente.',
    requiredFeature: 'clients',
  },
  suppliers: {
    id: 'suppliers',
    icon: '🏭',
    defaultLabel: 'Proveedores',
    title: 'Proveedores',
    intro: 'Podés decirme, por ejemplo:',
    examples: ['“Agregá proveedor Mayorista SA.”', '“Buscá el proveedor Disershop.”'],
    bullets: [
      'Buscar y crear proveedores',
      'Registrar compras asociadas',
      'La deuda con proveedores la ves en RILO Gestión',
    ],
    tryPrompt: 'Contame qué necesitás del proveedor.',
    requiredFeature: 'suppliers',
  },
  collaborators: {
    id: 'collaborators',
    icon: '👷',
    defaultLabel: 'Colaboradores',
    title: 'Colaboradores',
    intro: 'Podés consultar o registrar, por ejemplo:',
    examples: ['“¿Cuántas horas trabajó Laura este mes?”'],
    bullets: ['Horas, pagos y resúmenes del equipo'],
    tryPrompt: 'Contame qué necesitás del colaborador.',
    requiredFeature: 'collaborators',
  },
  payables: {
    id: 'payables',
    icon: '📅',
    defaultLabel: 'Cuentas a pagar',
    title: 'Cuentas a pagar',
    intro: 'Podés preguntarme o pedirme, por ejemplo:',
    examples: [
      '“¿Qué vence esta semana?”',
      '“Registrá un gasto fijo de UTE $7500 que vence el día 7 de cada mes.”',
    ],
    bullets: ['Vencimientos y obligaciones pendientes', 'Gastos fijos / recurrentes mensuales'],
    tryPrompt: 'Preguntame por vencimientos o pedime cargar un gasto fijo.',
    requiredFeature: 'payables',
  },
  automations: {
    id: 'automations',
    icon: '⏰',
    defaultLabel: 'Alertas y recordatorios',
    title: 'Alertas y recordatorios',
    intro: 'RILO puede avisarte o enviarte información automáticamente.',
    examples: [
      '“Todos los días a las 19 decime cuánto facturé.”',
      '“Avisame cuando queden menos de 5 unidades.”',
    ],
    bullets: [
      'Resúmenes programados',
      'Alertas por condición (stock, saldos, caja)',
      'Recordatorios de vencimientos',
    ],
    tryPrompt: 'Decime qué recordatorio o alerta querés configurar.',
  },
};

export const BOT_HELP_MAIN_MENU_LIMIT = 7;

export function featureEnabledForHelp(ctx: BotHelpMenuContext, feature: BusinessFeatureId): boolean {
  return canUseBusinessFeature({
    productId: ctx.productId,
    entitlements: ctx.entitlements,
    profile: ctx.profile,
    feature,
    permission: ctx.permission ?? true,
  });
}

function orderLabel(profile: BusinessProfile): string {
  const custom = String(profile.terminology?.orderPlural ?? '').trim();
  if (custom) return custom;
  return profile.mode === 'services' ? 'Trabajos' : 'Pedidos';
}

function catalogLabel(profile: BusinessProfile): string {
  const custom = String(profile.terminology?.catalogPlural ?? '').trim();
  if (custom) return custom;
  const hasStock = profile.enabledFeatures.stock === true;
  return hasStock ? 'Productos y stock' : 'Productos';
}

function sectionLabel(id: BotHelpSectionId, profile: BusinessProfile): string {
  if (id === 'orders') return orderLabel(profile);
  if (id === 'catalog_stock') return catalogLabel(profile);
  return SECTION_COPY[id].defaultLabel;
}

export function resolveSectionCopy(id: BotHelpSectionId, profile: BusinessProfile): BotHelpSectionCopy {
  const base = SECTION_COPY[id];
  const label = sectionLabel(id, profile);
  return {
    ...base,
    label,
    title: id === 'orders' ? label : base.title === base.defaultLabel ? label : base.title,
  };
}

/** Orden estable de secciones principales para menú Bot completo. */
const BOT_MAIN_SECTION_ORDER: BotHelpSectionId[] = [
  'cash',
  'sales',
  'orders',
  'catalog_stock',
  'services',
  'purchases',
  'clients',
  'suppliers',
  'collaborators',
  'payables',
  'automations',
];

const CAJA_MAIN_SECTION_ORDER: BotHelpSectionId[] = [
  'cash_income',
  'cash_expense',
  'cash_balance',
  'cash_movements',
  'automations',
];

function sectionAllowed(ctx: BotHelpMenuContext, id: BotHelpSectionId): boolean {
  if (id === 'automations') {
    return ctx.entitlements.automations === true;
  }
  const required = SECTION_COPY[id].requiredFeature;
  if (id.startsWith('cash_')) {
    return featureEnabledForHelp(ctx, 'cash');
  }
  if (id === 'cash') return featureEnabledForHelp(ctx, 'cash');
  if (id === 'catalog_stock') {
    return (
      featureEnabledForHelp(ctx, 'catalog') ||
      featureEnabledForHelp(ctx, 'products') ||
      featureEnabledForHelp(ctx, 'stock')
    );
  }
  if (id === 'services') {
    return (
      featureEnabledForHelp(ctx, 'services') &&
      !(
        featureEnabledForHelp(ctx, 'catalog') ||
        featureEnabledForHelp(ctx, 'products') ||
        featureEnabledForHelp(ctx, 'stock')
      )
    );
  }
  if (required) return featureEnabledForHelp(ctx, required);
  return true;
}

/** Secciones habilitadas para menú principal (sin paginar). */
export function listEnabledHelpSections(ctx: BotHelpMenuContext): BotHelpSectionId[] {
  if (ctx.productId === 'cash') {
    return CAJA_MAIN_SECTION_ORDER.filter((id) => sectionAllowed(ctx, id));
  }
  return BOT_MAIN_SECTION_ORDER.filter((id) => sectionAllowed(ctx, id));
}

export type BotHelpMenuOption = {
  index: number;
  id: BotHelpSectionId | 'start' | 'more' | 'back';
  label: string;
};

export type BotHelpMenuPage = {
  options: BotHelpMenuOption[];
  hasMore: boolean;
  page: number;
};

export function buildHelpMenuPage(
  ctx: BotHelpMenuContext,
  page = 0,
  opts?: { includeStart?: boolean; startLabel?: string }
): BotHelpMenuPage {
  const all = listEnabledHelpSections(ctx);
  const limit = BOT_HELP_MAIN_MENU_LIMIT;
  const startLabel = opts?.startLabel ?? (ctx.productId === 'cash' ? '❌ Empezar a usar RILO' : '❌ Empezar');
  const startOption: BotHelpMenuOption = { index: 0, id: 'start', label: startLabel };

  if (page === 0) {
    const visible = all.slice(0, limit);
    const hasMore = all.length > limit;
    const options: BotHelpMenuOption[] = [];
    if (opts?.includeStart !== false) options.push(startOption);
    visible.forEach((id, i) => {
      const copy = resolveSectionCopy(id, ctx.profile);
      options.push({ index: options.length, id, label: `${copy.icon} ${copy.label}` });
    });
    if (hasMore) {
      options.push({ index: options.length, id: 'more', label: 'Más opciones' });
    }
    return { options, hasMore, page: 0 };
  }

  const overflow = all.slice(limit);
  const options: BotHelpMenuOption[] = [{ index: 0, id: 'back', label: 'Volver' }];
  overflow.forEach((id) => {
    const copy = resolveSectionCopy(id, ctx.profile);
    options.push({ index: options.length, id, label: `${copy.icon} ${copy.label}` });
  });
  return { options, hasMore: false, page: 1 };
}

export function productWelcomeTitle(productId: TrialProductId | null): string {
  if (productId === 'cash') return TRIAL_PRODUCT_LABELS.cash;
  if (productId === 'whatsapp') return TRIAL_PRODUCT_LABELS.whatsapp;
  return 'RILO';
}

export function buildWelcomeIntro(ctx: BotHelpMenuContext): string {
  if (ctx.productId === 'cash') {
    return 'Desde acá podés registrar lo que entra y sale y consultar cuánto tenés.';
  }
  if (ctx.productId === 'whatsapp') {
    return 'Podés registrar y consultar tu negocio escribiéndome como hablás normalmente.';
  }
  return 'Escribime como hablás normalmente. Yo uso la información de tu negocio y te pregunto solo lo necesario.';
}

export function formatWelcomeMessage(ctx: BotHelpMenuContext, menu: BotHelpMenuPage): string {
  const title = productWelcomeTitle(ctx.productId);
  const prompt =
    ctx.productId === 'cash' ? '*¿Qué querés ver?*' : '*¿Qué querés conocer?*';
  const lines: string[] = [
    `*👋 Bienvenido a ${title}*`,
    '',
    buildWelcomeIntro(ctx),
    '',
    prompt,
    '',
  ];
  for (const opt of menu.options) {
    if (opt.id === 'start') continue;
    lines.push(`${opt.index}. ${opt.label}`);
  }
  const start = menu.options.find((row) => row.id === 'start');
  if (start) lines.push(`${start.index}. ${start.label}`);
  lines.push('', 'Elegí una opción.');
  return lines.join('\n');
}

export function formatHelpMenuMessage(ctx: BotHelpMenuContext, menu: BotHelpMenuPage): string {
  const lines: string[] = [
    'Puedo ayudarte con ventas, pedidos, clientes, productos, stock, caja y más. También podés preguntarme directamente qué querés hacer.',
    '',
    '*¿Con qué necesitás ayuda?*',
    '',
  ];
  for (const opt of menu.options) {
    if (opt.id === 'start') {
      lines.push(`${opt.index}. ❌ Salir`);
      continue;
    }
    lines.push(`${opt.index}. ${opt.label}`);
  }
  lines.push('', 'Elegí una opción o escribí «ayuda ventas», «ayuda stock», etc.');
  return lines.join('\n');
}

export function formatMoreMenuMessage(menu: BotHelpMenuPage): string {
  const lines: string[] = ['*Más funciones*', ''];
  for (const opt of menu.options) {
    lines.push(`${opt.index}. ${opt.label}`);
  }
  lines.push('', 'Elegí una opción.');
  return lines.join('\n');
}

export function formatSectionDetail(copy: BotHelpSectionCopy): string {
  const lines: string[] = [`*${copy.icon} ${copy.title}*`, '', copy.intro];
  for (const ex of copy.examples) lines.push('', ex);
  if (copy.bullets.length) {
    lines.push('');
    for (const bullet of copy.bullets) lines.push(`• ${bullet}`);
  }
  lines.push('', '1. Probar ahora', '2. Ver otra función', '0. Salir de la guía', '', 'Elegí una opción.');
  return lines.join('\n');
}

export function formatUpgradeWelcome(
  productLabel: string,
  sectionLabels: string[]
): string {
  const bullets = sectionLabels.map((label) => `• ${label}`).join('\n');
  return (
    `*🎉 Ahora tenés ${productLabel}*\n\n` +
    `Además de lo que ya usabas, ahora podés:\n\n${bullets}\n\n` +
    `¿Querés conocer alguna?\n\n` +
    `0. Ahora no\n\n` +
    `Elegí una opción.`
  );
}

export function formatNewFeatureNotice(sectionLabel: string): string {
  return (
    `*📦 ${sectionLabel} activado*\n\n` +
    `Ya podés consultarme o registrar operaciones de esta área.\n\n` +
    `1. Sí, mostrame cómo funciona\n` +
    `0. Ahora no\n\n` +
    `Elegí una opción.`
  );
}

export function formatTryNowPrompt(copy: BotHelpSectionCopy): string {
  return `Perfecto. ${copy.tryPrompt}`;
}
