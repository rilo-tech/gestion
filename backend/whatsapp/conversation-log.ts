export type WhatsappTurnLog = {
  rawMessage?: string;
  activeTask?: string | null;
  conversationAction?: string;
  parsedIntent?: string;
  itemQueries?: string[];
  memoryUsed?: string[];
  resolvedEntities?: string[];
  confidence?: number;
  ambiguities?: string[];
  question?: string;
  executed?: boolean;
  stalePending?: string | null;
  focusEntities?: string[];
  classifiedConversationAction?: string;
  intent?: string;
  whyFallbackWasUsed?: string | null;
  productParserExecuted?: boolean;
  finalOperationPlan?: string | null;
  engine?: string | null;
  llmOutput?: string | null;
};

export function logWhatsappTurn(event: WhatsappTurnLog): void {
  const payload = {
    rawMessage: String(event.rawMessage ?? '').slice(0, 240),
    activeTask: event.activeTask ?? null,
    conversationAction: event.conversationAction,
    parsedIntent: event.parsedIntent,
    intent: event.intent ?? event.parsedIntent,
    itemQueries: event.itemQueries?.slice(0, 12),
    memoryUsed: event.memoryUsed?.slice(0, 8),
    resolvedEntities: event.resolvedEntities?.slice(0, 8),
    confidence: event.confidence,
    ambiguities: event.ambiguities?.slice(0, 8),
    question: event.question ? String(event.question).slice(0, 180) : undefined,
    executed: event.executed,
    stalePending: event.stalePending ?? null,
    focusEntities: event.focusEntities?.slice(0, 8),
    classifiedConversationAction: event.classifiedConversationAction,
    whyFallbackWasUsed: event.whyFallbackWasUsed ?? null,
    productParserExecuted: event.productParserExecuted ?? false,
    finalOperationPlan: event.finalOperationPlan
      ? String(event.finalOperationPlan).slice(0, 180)
      : null,
    engine: event.engine ?? null,
    llmOutput: event.llmOutput ? String(event.llmOutput).slice(0, 400) : null,
  };
  console.info('[whatsapp:turn]', JSON.stringify(payload));
}

type TraceableLine = {
  quantity?: number;
  itemKey?: string;
  sourceSpan?: string;
  productId?: string;
  productName?: string;
  productHint?: string;
  rawText?: string;
  skipped?: boolean;
  attributes?: { type?: string | null; color?: string | null; size?: string | null };
};

/** Trazas temporales para cazar duplicación de ítems. Buscar `[whatsapp:items]` en logs. */
export function traceOrderItems(stage: string, items: TraceableLine[] | null | undefined): void {
  const list = Array.isArray(items) ? items.filter((item) => !item?.skipped) : [];
  console.info(
    '[whatsapp:items]',
    JSON.stringify({
      stage,
      count: list.length,
      items: list.slice(0, 12).map((item) => ({
        q: Number(item.quantity) || 1,
        key: item.itemKey || null,
        span: item.sourceSpan || null,
        id: item.productId || null,
        name: item.productName || null,
        hint: item.productHint || null,
        raw: item.rawText || null,
        type: item.attributes?.type || null,
        size: item.attributes?.size || null,
        color: item.attributes?.color || null,
      })),
    })
  );
}
