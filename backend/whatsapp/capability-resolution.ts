/**
 * Resolución estructurada de preguntas de capacidad.
 * BACKEND decide status; el copy solo explica ese status (nunca lo invierte).
 */
import {
  KNOWN_UNAVAILABLE_CAPABILITIES,
  type KnownUnavailableCapability,
} from '../../shared/bot-capability-catalog.ts';
import type { BotHelpSectionId } from '../../shared/bot-help-catalog.ts';
import {
  utteranceIsCapabilityLimits,
  utteranceIsCapabilityOverview,
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
  howToTopicFromText,
} from './conversation-speech.ts';
import type { BotCapabilitySnapshot } from './bot-capability-service.ts';

export type CapabilityResolutionStatus =
  | 'available'
  | 'unavailable'
  | 'restricted_by_plan'
  | 'restricted_by_permission'
  | 'restricted_by_module'
  | 'requires_adapter'
  | 'panel_only'
  | 'unknown';

export type CapabilityUserIntent =
  | 'capability_question'
  | 'how_to'
  | 'capability_overview'
  | 'capability_limits'
  | 'execute';

export type CapabilityResolution = {
  capability: string;
  status: CapabilityResolutionStatus;
  reason: string;
  availableAlternative?: string;
  tools: string[];
  userMessageIntent: CapabilityUserIntent;
  /** Respuesta anclada al status; el LLM no puede contradecirla. */
  groundedReply: string;
};

type TopicSpec = {
  id: string;
  match: RegExp;
  tools: string[];
  availableExample: string;
  knownId?: string;
  panelOnly?: boolean;
};

const HELP_LABELS: Partial<Record<BotHelpSectionId, string>> = {
  sales: 'Ventas',
  orders: 'Pedidos',
  clients: 'Clientes',
  catalog_stock: 'Productos y stock',
  cash: 'Caja',
  purchases: 'Compras',
  suppliers: 'Proveedores',
  collaborators: 'Colaboradores',
  payables: 'Cuentas a pagar',
  automations: 'Automatizaciones',
  services: 'Servicios',
};

const TOPICS: TopicSpec[] = [
  {
    id: 'create_sale',
    match: /\b(venta|vender|vend[ií]|registr\w*\s+(una\s+)?venta)\b/i,
    tools: ['create_sale'],
    availableExample:
      'Sí. Por ejemplo escribime: «Venta a María por $1.500, pagó $800» y te voy pidiendo lo que falte.',
  },
  {
    id: 'query_supplier_balance',
    match: /(cu[aá]nto|saldo|deuda).{0,40}(proveedor|le\s+debo)|le\s+debo\s+a|debo\s+a\s+\w+/i,
    tools: ['get_supplier_balance'],
    knownId: 'query_supplier_balance',
    availableExample: 'Sí. Decime el proveedor y te consulto el saldo.',
  },
  {
    id: 'register_supplier_payment',
    match: /pag(ar|arle|o|arle).{0,30}proveedor|proveedor.{0,30}pag/i,
    tools: [],
    knownId: 'register_supplier_payment',
    panelOnly: true,
    availableExample: 'Sí. Indicame proveedor y monto.',
  },
  {
    id: 'remove_order_item',
    match:
      /(borrar|quitar|eliminar|sacar).{0,50}([ií]tem|producto|rengl[oó]n).{0,40}pedido|(borrar|quitar|eliminar|sacar).{0,40}pedido|pedido.{0,40}(borrar|quitar|eliminar|sacar)/i,
    tools: [],
    knownId: 'remove_order_item',
    panelOnly: true,
    availableExample: 'Sí. Indicame el pedido y el ítem.',
  },
  {
    id: 'ingest_visual_document',
    match: /\b(foto|imagen|remito|factura|comprobante)\b/i,
    tools: ['ingest_visual_document'],
    availableExample: 'Sí. Mandame la foto y te ayudo a cargar la compra.',
  },
  {
    id: 'adjust_stock',
    match: /\b(stock|inventario|modificar\s+stock|ajustar\s+stock)\b/i,
    tools: ['adjust_stock', 'set_stock', 'get_stock'],
    availableExample: 'Sí. Por ejemplo: «Quedan 12 remeras negras M» o «¿Cuántas camisetas hay?»',
  },
  {
    id: 'aggregate_sales',
    match: /\b(reporte|reportes|totales?\s+de\s+ventas|cu[aá]nto\s+factur)\b/i,
    tools: ['aggregate_sales', 'get_cash_income_summary'],
    knownId: 'aggregate_sales',
    availableExample: 'Sí. Puedo darte un resumen de ingresos de caja por período.',
  },
  {
    id: 'create_order',
    match: /\b(pedido|orden)\b/i,
    tools: ['create_order'],
    availableExample:
      'Sí. Por ejemplo: «Pedido para Martín: 3 buzos para el viernes» y te ayudo a cargarlo.',
  },
  {
    id: 'register_cash_movement',
    match: /\b(caja|ingreso|egreso|gasto)\b/i,
    tools: ['register_cash_movement', 'get_cash_balance'],
    availableExample: 'Sí. Por ejemplo: «Gasté $500 en envíos» o «¿Cuánto hay en caja?»',
  },
  {
    id: 'create_client',
    match: /\b(cliente|clientes)\b/i,
    tools: ['create_client', 'get_client_balance', 'find_client'],
    availableExample: 'Sí. Puedo crear clientes y consultar saldos. Ej: «¿Cuánto debe Pedro?»',
  },
  {
    id: 'create_purchase',
    match: /\b(compra|compras|proveedor)\b/i,
    tools: ['create_purchase', 'ingest_visual_document'],
    availableExample: 'Sí. Podés dictarme la compra o mandarme una foto del remito.',
  },
];

export function classifyCapabilitySpeech(text: string): CapabilityUserIntent {
  const t = String(text ?? '').trim();
  if (!t) return 'execute';
  if (utteranceIsHowTo(t)) return 'how_to';
  if (utteranceIsCapabilityOverview(t)) return 'capability_overview';
  if (utteranceIsCapabilityLimits(t)) return 'capability_limits';
  if (utteranceIsCapabilityQuestion(t)) return 'capability_question';
  return 'execute';
}

function knownById(id: string | undefined): KnownUnavailableCapability | undefined {
  if (!id) return undefined;
  return KNOWN_UNAVAILABLE_CAPABILITIES.find((row) => row.id === id);
}

function statusFromUnavailableReason(
  reasonUnavailable?: string
): CapabilityResolutionStatus {
  const reason = String(reasonUnavailable ?? '');
  if (reason.includes('adapter')) return 'requires_adapter';
  if (reason.includes('permission')) return 'restricted_by_permission';
  if (reason.includes('plan') || reason.includes('entitled')) return 'restricted_by_plan';
  if (reason.includes('module') || reason.includes('gated') || reason.includes('feature')) {
    return 'restricted_by_module';
  }
  if (reason.includes('handler')) return 'unavailable';
  return 'unavailable';
}

function replyForStatus(
  status: CapabilityResolutionStatus,
  opts: { hint?: string; availableExample?: string; howTo?: boolean }
): string {
  switch (status) {
    case 'available':
      if (opts.howTo) {
        return (
          opts.availableExample?.replace(/^Sí\.\s*/i, 'Así: ') ??
          'Decime los datos y te guío paso a paso. No ejecuto nada hasta que me indiques la operación.'
        );
      }
      return (
        opts.availableExample ??
        'Sí. Decime qué querés hacer y te voy pidiendo lo que falte.'
      );
    case 'requires_adapter':
    case 'panel_only':
      return (
        opts.hint ??
        'Esa acción todavía no la hago por WhatsApp, pero podés realizarla desde RILO Gestión.'
      );
    case 'unavailable':
      return opts.hint ?? 'Todavía no puedo hacer eso directamente por WhatsApp.';
    case 'restricted_by_plan':
      return 'Esa función no está incluida en tu plan actual.';
    case 'restricted_by_permission':
      return 'No tenés permiso para realizar esa acción desde este usuario.';
    case 'restricted_by_module':
      return 'Ese módulo no está habilitado en tu negocio.';
    case 'unknown':
    default:
      return 'Esa acción no la tengo identificada como disponible por WhatsApp. Decime qué querés hacer y te explico la alternativa.';
  }
}

function resolveTopicStatus(
  topic: TopicSpec,
  snapshot: BotCapabilitySnapshot
): {
  status: CapabilityResolutionStatus;
  reason: string;
  tools: string[];
  hint?: string;
  alternative?: string;
} {
  const known = knownById(topic.knownId);
  const availableNames = new Set(snapshot.available.map((c) => c.toolName));

  if (topic.tools.some((t) => availableNames.has(t))) {
    return {
      status: 'available',
      reason: 'tool_operational',
      tools: topic.tools.filter((t) => availableNames.has(t)),
    };
  }

  if (known?.reason === 'requires_adapter' || topic.tools.some((t) =>
    snapshot.unavailable.some((u) => u.toolName === t && u.status === 'requires_adapter')
  )) {
    return {
      status: 'requires_adapter',
      reason: 'requires_adapter',
      tools: topic.tools,
      hint: known?.userHint,
      alternative: 'RILO Gestión',
    };
  }

  if (known || topic.panelOnly) {
    return {
      status: topic.panelOnly ? 'panel_only' : 'unavailable',
      reason: known?.reason ?? 'not_implemented',
      tools: topic.tools,
      hint: known?.userHint,
      alternative: 'RILO Gestión',
    };
  }

  for (const toolName of topic.tools) {
    const row = snapshot.unavailable.find((u) => u.toolName === toolName);
    if (row) {
      const status = statusFromUnavailableReason(row.reasonUnavailable);
      return {
        status,
        reason: row.reasonUnavailable ?? status,
        tools: [toolName],
        alternative: status === 'requires_adapter' ? 'RILO Gestión' : undefined,
      };
    }
  }

  return {
    status: 'unavailable',
    reason: 'not_in_registry',
    tools: topic.tools,
    alternative: 'RILO Gestión',
  };
}

function buildOverviewReply(snapshot: BotCapabilitySnapshot): string {
  const labels = snapshot.helpSections
    .map((id) => HELP_LABELS[id])
    .filter((label): label is string => Boolean(label));
  const unique = [...new Set(labels)];
  if (!unique.length) {
    return 'Por WhatsApp puedo ayudarte con lo habilitado en tu plan. Decime qué querés hacer y te oriento.';
  }
  return [
    'Por WhatsApp puedo ayudarte con:',
    ...unique.map((label) => `• ${label}`),
    'Decime qué querés hacer y te guío con un ejemplo.',
  ].join('\n');
}

function buildLimitsReply(snapshot: BotCapabilitySnapshot): string {
  const hints = snapshot.knownUnavailable.slice(0, 3).map((row) => row.userHint);
  if (!hints.length) {
    return 'Hay algunas tareas que todavía requieren RILO Gestión, como ciertas ediciones avanzadas. Si me preguntás por algo puntual, te digo si lo hago por WhatsApp.';
  }
  return [
    'Hay algunas tareas que todavía requieren RILO Gestión o no están disponibles por WhatsApp.',
    hints[0],
    'Si me preguntás por una acción puntual, te digo exactamente si la puedo hacer acá.',
  ].join('\n\n');
}

function howToExample(topicId: string): string {
  switch (topicId) {
    case 'create_sale':
      return 'Para registrar una venta escribime algo como: «Venta a María por $1.500, pagó $800». Te voy pidiendo lo que falte.';
    case 'create_order':
      return 'Para un pedido: «Pedido para Martín: 3 buzos para el viernes».';
    case 'register_payment':
      return 'Para un cobro: «Lucía pagó $1.000» o «Cobrale el saldo a Pedro».';
    case 'create_purchase':
      return 'Para una compra: dictame los ítems o mandame una foto del remito/factura.';
    case 'register_cash':
      return 'Para caja: «Gasté $500 en envíos» o «¿Cuánto hay en caja?»';
    default:
      return 'Decime qué querés hacer (venta, pedido, cobro, compra, caja) y te explico con un ejemplo.';
  }
}

/**
 * Resuelve pregunta de capacidad / how_to / overview contra el snapshot REAL del tenant.
 * El status es inmutable: formatCapabilityResolutionReply no lo “mejora”.
 */
export function resolveCapabilityFromUtterance(
  text: string,
  snapshot: BotCapabilitySnapshot
): CapabilityResolution {
  const intent = classifyCapabilitySpeech(text);

  if (intent === 'capability_overview') {
    return {
      capability: 'overview',
      status: 'available',
      reason: 'tenant_snapshot',
      tools: snapshot.available.map((c) => c.toolName),
      userMessageIntent: intent,
      groundedReply: buildOverviewReply(snapshot),
    };
  }

  if (intent === 'capability_limits') {
    return {
      capability: 'limits',
      status: 'available',
      reason: 'tenant_limits',
      tools: [],
      userMessageIntent: intent,
      groundedReply: buildLimitsReply(snapshot),
    };
  }

  if (intent === 'how_to') {
    const topic = howToTopicFromText(text);
    const mapped =
      topic === 'create_sale'
        ? TOPICS.find((t) => t.id === 'create_sale')
        : topic === 'create_purchase'
          ? TOPICS.find((t) => t.id === 'create_purchase')
          : topic === 'create_order'
            ? TOPICS.find((t) => t.id === 'create_order')
            : topic === 'register_cash'
              ? TOPICS.find((t) => t.id === 'register_cash_movement')
              : undefined;
    if (mapped) {
      const resolved = resolveTopicStatus(mapped, snapshot);
      return {
        capability: mapped.id,
        status: resolved.status,
        reason: resolved.reason,
        availableAlternative: resolved.alternative,
        tools: resolved.tools,
        userMessageIntent: 'how_to',
        groundedReply:
          resolved.status === 'available'
            ? howToExample(mapped.id)
            : replyForStatus(resolved.status, {
                hint: resolved.hint,
                howTo: true,
              }),
      };
    }
    return {
      capability: topic,
      status: 'available',
      reason: 'how_to_generic',
      tools: [],
      userMessageIntent: 'how_to',
      groundedReply: howToExample(topic),
    };
  }

  if (intent !== 'capability_question') {
    return {
      capability: 'none',
      status: 'unknown',
      reason: 'not_capability_question',
      tools: [],
      userMessageIntent: 'execute',
      groundedReply: '',
    };
  }

  const topic = TOPICS.find((row) => row.match.test(text));
  if (!topic) {
    return {
      capability: 'unknown',
      status: 'unknown',
      reason: 'unmapped_capability',
      tools: [],
      userMessageIntent: 'capability_question',
      groundedReply: replyForStatus('unknown', {}),
    };
  }

  const resolved = resolveTopicStatus(topic, snapshot);
  return {
    capability: topic.id,
    status: resolved.status,
    reason: resolved.reason,
    availableAlternative: resolved.alternative,
    tools: resolved.tools,
    userMessageIntent: 'capability_question',
    groundedReply: replyForStatus(resolved.status, {
      hint: resolved.hint,
      availableExample: topic.availableExample,
    }),
  };
}

/** Garantiza que un status unavailable nunca se presente como “sí puedo”. */
export function assertResolutionDoesNotFlipUnavailable(
  resolution: CapabilityResolution
): void {
  const blocked = new Set<CapabilityResolutionStatus>([
    'unavailable',
    'requires_adapter',
    'panel_only',
    'restricted_by_plan',
    'restricted_by_permission',
    'restricted_by_module',
    'unknown',
  ]);
  if (!blocked.has(resolution.status)) return;
  const reply = resolution.groundedReply.toLowerCase();
  if (/^s[ií]\b/.test(reply.trim()) || /\bs[ií],?\s+puedo\b/.test(reply)) {
    throw new Error(`CAPABILITY_STATUS_FLIPPED:${resolution.capability}:${resolution.status}`);
  }
}

export function formatCapabilityResolutionReply(resolution: CapabilityResolution): string {
  assertResolutionDoesNotFlipUnavailable(resolution);
  return resolution.groundedReply.trim();
}

/** Bloque inmutable para el agente si algún camino aún pasa por LLM. */
export function formatImmutableCapabilityBlock(resolution: CapabilityResolution): string {
  return [
    'CAPABILITY_RESOLUTION (INMUTABLE — no cambies el status):',
    `capability=${resolution.capability}`,
    `status=${resolution.status}`,
    `reason=${resolution.reason}`,
    `userMessageIntent=${resolution.userMessageIntent}`,
    `groundedReply=${resolution.groundedReply}`,
    'Si status no es available: NUNCA digas que sí podés hacerlo. Solo explicá el groundedReply en tono natural sin contradecirlo.',
  ].join('\n');
}
