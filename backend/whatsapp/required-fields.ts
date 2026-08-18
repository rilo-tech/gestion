import type { WhatsappCommandEntities, WhatsappIntent } from './ai-command-parser.ts';
import { todayDateOnly } from './lookups.ts';
import { whatsappCopyForRubro } from './copy.ts';

export type RequiredFieldKey = 'clientName' | 'productName' | 'amount' | 'deliveryDate' | 'supplierName';

export interface RequiredFieldSpec {
  key: RequiredFieldKey;
  label: string;
}

const ORDER_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
  { key: 'productName', label: 'Producto (con el detalle que lo distingue)' },
  { key: 'amount', label: 'Precio de venta' },
  { key: 'deliveryDate', label: 'Fecha de entrega' },
];

const SALE_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
  { key: 'productName', label: 'Producto (con el detalle que lo distingue)' },
  { key: 'amount', label: 'Precio de venta' },
];

const PAYMENT_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
  { key: 'amount', label: 'Monto cobrado' },
];

const CASH_FIELDS: RequiredFieldSpec[] = [{ key: 'amount', label: 'Monto' }];

const PURCHASE_FIELDS: RequiredFieldSpec[] = [
  { key: 'supplierName', label: 'Proveedor' },
  { key: 'productName', label: 'Productos (foto de factura/remito o detalle con cantidad y costo)' },
];

const BALANCE_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
];

function examplesFor(rubro?: string | null): Partial<Record<WhatsappIntent, string>> {
  const copy = whatsappCopyForRubro(rubro);
  return {
    create_order: `Ej: ${copy.exampleOrder}`,
    create_sale: `Ej: ${copy.exampleSale}`,
    create_purchase: 'Ej: Compra a Distribuidora López, 10 remeras a $800, pagó transferencia. O mandá la foto de la factura/remito.',
    register_payment: 'Ej: Pago de Pedro Gómez 500',
    register_cash: 'Ej: Gasto 500 nafta  ·  Ingreso de caja 2000',
    query_balance: 'Ej: Saldo de María Silva',
  };
}

function specsFor(intent: string): RequiredFieldSpec[] {
  if (intent === 'create_order') return ORDER_FIELDS;
  if (intent === 'create_sale') return SALE_FIELDS;
  if (intent === 'create_purchase') return PURCHASE_FIELDS;
  if (intent === 'register_payment') return PAYMENT_FIELDS;
  if (intent === 'register_cash') return CASH_FIELDS;
  if (intent === 'query_balance') return BALANCE_FIELDS;
  return [];
}

function hasValue(entities: WhatsappCommandEntities, key: RequiredFieldKey): boolean {
  if (key === 'clientName') {
    return Boolean(entities.clientId || String(entities.clientName ?? '').trim());
  }
  if (key === 'supplierName') {
    return Boolean(entities.supplierId || String(entities.supplierName ?? '').trim());
  }
  if (key === 'productName') {
    const lines = Array.isArray(entities.purchaseLines) ? entities.purchaseLines : [];
    return Boolean(
      entities.productId ||
        String(entities.productName ?? '').trim() ||
        lines.some((line) => String(line.productName ?? '').trim()) ||
        entities.mediaId ||
        String(entities.imageSummary ?? '').trim()
    );
  }
  if (key === 'amount') {
    return Number(entities.amount) > 0;
  }
  if (key === 'deliveryDate') {
    return Boolean(String(entities.deliveryDate ?? '').trim());
  }
  return false;
}

export function missingRequiredFields(
  intent: string,
  entities: WhatsappCommandEntities
): RequiredFieldSpec[] {
  return specsFor(intent).filter((field) => !hasValue(entities, field.key));
}

export function applyOrderDateDefault(intent: string, entities: WhatsappCommandEntities): void {
  if ((intent === 'create_order' || intent === 'create_sale') && !entities.orderDate) {
    entities.orderDate = todayDateOnly();
  }
}

export function formatMissingFieldsReply(
  intent: string,
  missing: RequiredFieldSpec[],
  entities: WhatsappCommandEntities,
  rubro?: string | null
): string {
  const example = examplesFor(rubro)[intent as WhatsappIntent] ?? '';
  const allSpecs = specsFor(intent);
  const noneFilled = allSpecs.length > 0 && missing.length === allSpecs.length;

  if (noneFilled) {
    const lines = allSpecs.map((field) => `• ${field.label}`);
    const carga =
      intent === 'create_order' || intent === 'create_sale'
        ? 'La fecha de carga, si no la decís, queda hoy.\n'
        : '';
    return (
      `Para ${intentLabel(intent)} pasame:\n` +
      `${lines.join('\n')}\n` +
      carga +
      (example ? `\n${example}` : '')
    );
  }

  const lines = missing.map((field) => `• ${field.label}`);
  const known: string[] = [];
  if (entities.supplierName) known.push(`proveedor ${entities.supplierName}`);
  if (entities.clientName) known.push(`cliente ${entities.clientName}`);
  if (entities.productName) known.push(entities.productName);
  if (Number(entities.amount) > 0) known.push(`$${entities.amount}`);
  const prefix = known.length ? `Tengo ${known.join(', ')}. ` : '';
  return (
    `${prefix}Me faltan:\n${lines.join('\n')}\n` +
    (example ? `\n${example}` : '') +
    `\nMandame esos datos o NO para cancelar.`
  );
}

function intentLabel(intent: string): string {
  if (intent === 'create_purchase') return 'una compra';
  if (intent === 'create_order') return 'un pedido';
  if (intent === 'create_sale') return 'una venta';
  if (intent === 'register_payment') return 'un cobro';
  if (intent === 'register_cash') return 'caja';
  if (intent === 'query_balance') return 'consultar un saldo';
  return 'eso';
}
