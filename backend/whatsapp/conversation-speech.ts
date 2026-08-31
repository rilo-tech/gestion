import { waBold, waCard } from '../../shared/whatsapp-format.ts';

export const COLLECT_ORDER_ITEMS_INTENT = 'collect_order_items';

export const PRODUCT_INTENTS = new Set([
  'create_order',
  'create_sale',
  'create_purchase',
  'update_product_cost',
  'query_stock',
]);

export type HowToTopic =
  | 'create_order'
  | 'create_sale'
  | 'create_purchase'
  | 'register_payment'
  | 'register_cash'
  | 'update_order_status';

/** Pregunta sobre el procedimiento, no un pedido de ejecutar la acción. */
export function utteranceIsHowTo(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const asksHow = /[¿?]/.test(t) || /\bc[oó]mo\b/i.test(t) || /\bqu[eé]\s+datos\b/i.test(t);
  if (!asksHow) return false;
  return (
    /\bc[oó]mo\s+(te\s+)?(paso|pasar|mando|mandar|env[ií]o|enviar|cargo|cargar|registro|registrar|anoto|hago|uso|funciona|doy|dar)\b/i.test(
      t
    ) ||
    /\b(paso|pasar|mando|mandar)\s+(la\s+)?(info|informaci[oó]n|datos|productos?|cliente)\b/i.test(t) ||
    /\bqu[eé]\s+(datos|info|informaci[oó]n)\s+(necesit[aá]s|hace\s+falta|te\s+paso|paso)\b/i.test(t) ||
    /\bc[oó]mo\s+te\s+(paso|doy|mando|envio|envío)\b/i.test(t)
  );
}

/** Pregunta si una función existe o si se puede hacer, no la ejecuta. */
export function utteranceIsCapabilityQuestion(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (utteranceIsHowTo(t)) return false;
  const asks =
    /^(puedo|se puede|se pueden|es posible|acept[aá]s|soport[aá]s)\b/i.test(t) ||
    ((/[¿?]/.test(t) || /^(se\s+pueden?|puedo)\b/i.test(t)) &&
      /\b(puedo|se puede[n]?|es posible)\b/i.test(t));
  if (!asks) return false;
  return /\b(pedido|orden|venta|compra|producto|caja|cobro|cliente)\b/i.test(t);
}

export function expectedItemCountFromText(text: string): number | undefined {
  const match = String(text ?? '').match(
    /(\d{1,3})\s+(?:productos?|prenda[s]?|\b[ií]tems?\b|renglones?)/i
  );
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 2 ? n : undefined;
}

export function howToTopicFromText(text: string): HowToTopic {
  const t = String(text ?? '');
  if (/\b(venta|vend[eé])\b/i.test(t)) return 'create_sale';
  if (/\b(compra|remito|proveedor)\b/i.test(t)) return 'create_purchase';
  if (/\b(cobr|pago|se[nñ]a)\b/i.test(t) && !/\bpedido\b/i.test(t)) return 'register_payment';
  if (/\b(caja|egreso|ingreso)\b/i.test(t)) return 'register_cash';
  if (/\b(estado|entregad|listo)\b/i.test(t) && /\b(paso|pasar|cambiar|move)\b/i.test(t)) {
    return 'update_order_status';
  }
  return 'create_order';
}

export function isPlaceholderProductLabel(value: string | undefined): boolean {
  const t = String(value ?? '').trim();
  if (!t) return false;
  return (
    /^\d+\s+(?:productos?|prendas?|[ií]tems?)\b/i.test(t) ||
    /^(productos?|prendas?|el pedido|un pedido|la venta)$/i.test(t) ||
    /\b(p[aá]salo|movelo|ponelo|estado\s+entregad|a\s+estado)\b/i.test(t) ||
    (/\b(registr\w+|anot\w+|carg\w+|ingres\w+)\b/i.test(t) &&
      /\b(pedido|orden|productos?)\b/i.test(t) &&
      !/\b(remera|canguro|buzo|camiseta|jean|pantal|taza|campera)\b/i.test(t)) ||
    (/\bunos?\s+productos?\b/i.test(t) &&
      !/\b(remera|canguro|buzo|camiseta|jean|pantal|taza|campera)\b/i.test(t))
  );
}

/** El texto es una orden, consulta o corrección, no un nombre de producto. */
export function isNonProductUtterance(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return true;
  if (
    /\b(p[aá]salo|pasalo|movelo|move\s+el|ponelo|cambialo|marcalo|dejalo)\b/i.test(t) &&
    /\b(estado|entregad|listo|pendiente|producci[oó]n)\b/i.test(t)
  ) {
    return true;
  }
  if (/\ba\s+estado\b/i.test(t)) return true;
  if (/^(si|sí|no|ok|dale|listo|cancelar)[\s!¡?.]*$/i.test(t)) return true;
  return false;
}

/**
 * "no, ahora quiero registrar una venta" → cancel + resto.
 * No es un detector de frases: es el acto de cancelar y seguir hablando.
 */
export function splitCancelAndRemainder(text: string): { cancel: boolean; remainder: string } {
  const t = String(text ?? '').trim();
  if (!t) return { cancel: false, remainder: '' };
  const prefixed = t.match(
    /^(no+|n[oó]|nop|cancelar)\s*[,.]?\s+(?:ahora\s+)?(?:quiero\s+)?(.+)$/i
  );
  if (prefixed?.[2]) {
    return { cancel: true, remainder: prefixed[2].trim() };
  }
  return { cancel: false, remainder: t };
}

export function looksLikeCollectingDone(text: string): boolean {
  return /^(listo|nada\s+m[aá]s|eso\s+es\s+todo|termin[eé]|fin)[\s!¡?.]*$/i.test(String(text ?? '').trim());
}

export function looksLikeLargeOrderDraft(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return false;
  const count = expectedItemCountFromText(t);
  if (count && count >= 5) return true;
  return /\bpedido\s+grande\b/i.test(t) || /\bcargar\s+(un\s+)?pedido\s+grande\b/i.test(t);
}

export function hasRealOrderItems(entities: {
  productName?: string;
  items?: Array<{ rawText?: string; productHint?: string; productName?: string }>;
}): boolean {
  const name = String(entities.productName ?? '').trim();
  if (name && !isPlaceholderProductLabel(name)) return true;
  return (entities.items ?? []).some((item) => {
    const label = String(item.productName || item.productHint || item.rawText || '').trim();
    return Boolean(label) && !isPlaceholderProductLabel(label);
  });
}

/** Pedido grande / N productos anunciados, todavía sin renglones reales. */
export function shouldOpenItemCollection(
  text: string,
  entities: {
    productName?: string;
    expectedItemCount?: number;
    collectingItems?: boolean;
    items?: Array<{ rawText?: string; productHint?: string; productName?: string }>;
  }
): boolean {
  if (entities.collectingItems) return true;
  if (utteranceIsHowTo(text) || utteranceIsCapabilityQuestion(text)) return false;
  if (hasRealOrderItems(entities)) return false;
  if (looksLikeLargeOrderDraft(text)) return true;
  const count = entities.expectedItemCount || expectedItemCountFromText(text);
  return Boolean(count && count >= 5);
}

export function productParserAllowed(intent: string): boolean {
  return PRODUCT_INTENTS.has(intent);
}

export function formatHowToReply(topic: HowToTopic, expectedCount?: number): string {
  if (topic === 'create_sale') {
    return waCard({
      title: 'Registrar una venta',
      lines: [
        'Mandame el cliente y los productos, juntos o por partes.',
        'Ejemplo: venta a María, 2 remeras negras L, $4000.',
      ],
      ask: `Si son muchos, mandálos por tandas y cuando termines escribí ${waBold('LISTO')}.`,
    });
  }
  if (topic === 'create_purchase') {
    return waCard({
      title: 'Registrar una compra',
      lines: ['Mandame el proveedor y los productos (o una foto del remito).'],
    });
  }
  if (topic === 'register_payment') {
    return waCard({
      title: 'Registrar un cobro',
      lines: ['Decime el cliente o el pedido y el monto. Ejemplo: cobré 500 a Juan.'],
    });
  }
  if (topic === 'register_cash') {
    return waCard({
      title: 'Movimiento de caja',
      lines: ['Decime si es ingreso o egreso, el monto y el motivo.'],
    });
  }
  if (topic === 'update_order_status') {
    return waCard({
      title: 'Cambiar el estado',
      lines: ['Decime el pedido (o *ese* si ya está en foco) y el estado: pendiente, en producción, listo o entregado.'],
    });
  }
  return formatHowToCreateOrder(expectedCount);
}

export function formatHowToCreateOrder(expectedCount?: number): string {
  const title = expectedCount && expectedCount >= 2 ? `Pedido de ${expectedCount} productos` : 'Pedido con varios productos';
  return waCard({
    title,
    lines: [
      'Podés mandarme el cliente y los productos juntos o por partes.',
      'Ejemplo:',
      '• Cliente: María',
      '• 2 remeras negras L',
      '• 3 canguros rojos XL',
      '• 1 camiseta blanca M',
    ],
    ask: `Si son muchos, mandámelos por tandas y cuando termines escribí ${waBold('LISTO')}.`,
  });
}

export function formatCapabilityOrderReply(): string {
  return waCard({
    title: 'Sí',
    lines: [
      'Podés mandar un pedido con todos los productos que quieras, juntos o por tandas.',
    ],
    ask: `Cuando termines, escribí ${waBold('LISTO')}.`,
  });
}

export function formatCollectOrderItemsAsk(input: {
  clientName?: string;
  expectedCount?: number;
  itemCount?: number;
}): string {
  const who = String(input.clientName ?? '').trim();
  const count = input.expectedCount;
  const have = Number(input.itemCount) || 0;
  const title = who ? `Pedido de ${who}` : count ? `Pedido de ${count} productos` : 'Pedido';
  const lines = [
    have > 0 ? `Ya tengo ${have} producto${have === 1 ? '' : 's'}.` : 'Mandame los productos y voy armando el pedido.',
  ];
  return waCard({
    title,
    lines,
    ask: `Cuando termines escribí ${waBold('LISTO')}.`,
  });
}
