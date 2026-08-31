import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { OPERATION_CATALOG } from './operation-catalog.ts';
import type { WhatsappIntent } from './ai-command-parser.ts';
import {
  semanticOperationPayload,
  semanticSummaryLines,
  type SemanticCommand,
} from './semantic-command.ts';

export type PlannedOperation = {
  intent: string;
  label: string;
  payload: Record<string, unknown>;
};

export type OperationPlan = {
  operations: PlannedOperation[];
  summary: { title: string; lines: string[] };
  requiresConfirmation: boolean;
  rawUserMessage: string;
  conversationAction?: string;
  schemaWarnings?: string[];
};

function compactItem(item: {
  quantity?: number;
  productName?: string;
  productHint?: string;
  rawText?: string;
  skipped?: boolean;
}): string | null {
  if (item.skipped) return null;
  const name = String(item.productName || item.productHint || item.rawText || '').trim();
  if (!name) return null;
  const qty = Number(item.quantity) || 1;
  return qty > 1 ? `${qty} ${name}` : name;
}

function pickPayload(entities: WhatsappCommandEntities): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const keys: Array<keyof WhatsappCommandEntities> = [
    'clientName',
    'clientId',
    'spokenClientName',
    'items',
    'amount',
    'notes',
    'deliveryDate',
    'paid',
    'payFullBalance',
    'collectionAmount',
    'seniaAmount',
    'requestedStatus',
    'orderStatus',
    'descuentoFisicoAlcance',
    'extraCosts',
    'targetOrderId',
    'targetOrderLabel',
    'supplierName',
    'purchaseLines',
    'cashType',
    'cashConcept',
    'cashAmbitoHint',
  ];
  for (const key of keys) {
    const value = entities[key];
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

/**
 * Plan inmutable de lo que se va a ejecutar.
 * La confirmación SÍ ejecuta ESTE plan; no vuelve a interpretar el mensaje.
 */
export function buildOperationPlanFromCommand(command: SemanticCommand): OperationPlan {
  const operations: PlannedOperation[] = command.operations.map((op) => {
    const spec = OPERATION_CATALOG[op.intent];
    return {
      intent: op.intent,
      label: spec?.action || op.intent,
      payload: semanticOperationPayload(op),
    };
  });
  const primary = command.operations[0];
  const spec = primary ? OPERATION_CATALOG[primary.intent] : undefined;
  return {
    operations,
    summary: {
      title: spec?.action || primary?.intent || 'unknown',
      lines: semanticSummaryLines(primary),
    },
    requiresConfirmation: spec?.confirmation ?? true,
    rawUserMessage: command.rawMessage,
    conversationAction: command.conversationAction,
    schemaWarnings: command.schemaWarnings,
  };
}

/**
 * Plan inmutable de lo que se va a ejecutar.
 * La confirmación SÍ ejecuta ESTE plan; no vuelve a interpretar el mensaje.
 */
export function buildOperationPlan(
  intent: string,
  entities: WhatsappCommandEntities
): OperationPlan {
  if (entities.semanticCommand) {
    return buildOperationPlanFromCommand(entities.semanticCommand);
  }
  const spec = OPERATION_CATALOG[intent as WhatsappIntent];
  const payload = pickPayload(entities);
  const operations: PlannedOperation[] = [
    {
      intent,
      label: spec?.action || intent,
      payload,
    },
  ];

  if (intent === 'create_order' && (entities.paid || entities.payFullBalance || Number(entities.collectionAmount) > 0)) {
    operations.push({
      intent: 'register_collection',
      label: 'Cobro relacionado al pedido (caja + saldo)',
      payload: {
        amount: entities.collectionAmount ?? entities.amount,
        paid: true,
        payFullBalance: entities.payFullBalance ?? false,
      },
    });
  }
  if (intent === 'create_order' && entities.requestedStatus) {
    operations.push({
      intent: 'set_order_status',
      label: `Estado ${entities.requestedStatus}`,
      payload: { requestedStatus: entities.requestedStatus },
    });
  }
  if (
    intent === 'update_order_status' &&
    (entities.paid || entities.payFullBalance || Number(entities.amount) > 0)
  ) {
    operations.push({
      intent: 'register_collection',
      label: 'Cobro del saldo / monto informado',
      payload: {
        amount: entities.amount,
        payFullBalance: entities.payFullBalance ?? false,
        paid: true,
      },
    });
  }

  const itemLines = (entities.items ?? []).map(compactItem).filter((line): line is string => Boolean(line));
  const lines = [
    entities.clientName ? `Cliente: ${entities.clientName}` : '',
    ...itemLines.map((line) => `Ítem: ${line}`),
    entities.notes ? `Diseño: ${entities.notes}` : '',
    entities.amount != null ? `Venta: ${entities.amount}` : '',
    entities.paid ? 'Pago informado' : '',
    entities.requestedStatus ? `Estado: ${entities.requestedStatus}` : '',
    entities.deliveryDate ? `Entrega: ${entities.deliveryDate}` : '',
  ].filter(Boolean);

  return {
    operations,
    summary: {
      title: spec?.action || intent,
      lines,
    },
    requiresConfirmation: spec?.confirmation ?? true,
    rawUserMessage: String(entities.rawUserMessage || entities.sourceText || ''),
  };
}
