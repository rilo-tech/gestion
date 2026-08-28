import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { todayDateOnly } from './lookups.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';

export type RequiredFieldKey = 'clientName' | 'productName' | 'amount' | 'deliveryDate' | 'supplierName';

export interface RequiredFieldSpec {
  key: RequiredFieldKey;
  label: string;
}

const ORDER_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
  { key: 'productName', label: 'Producto (con el detalle que lo distingue)' },
  { key: 'amount', label: 'Precio de venta' },
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

const CASH_FIELDS: RequiredFieldSpec[] = [{ key: 'amount', label: 'Monto (ej. 500 o 4015)' }];

const PURCHASE_FIELDS: RequiredFieldSpec[] = [
  { key: 'supplierName', label: 'Proveedor' },
  { key: 'productName', label: 'Productos (foto de factura/remito o detalle con cantidad y costo)' },
];

const COST_FIELDS: RequiredFieldSpec[] = [
  { key: 'productName', label: 'Producto del catálogo' },
  { key: 'amount', label: 'Nuevo costo' },
];

const CLIENT_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Nombre y apellido del cliente' },
];

const BALANCE_FIELDS: RequiredFieldSpec[] = [
  { key: 'clientName', label: 'Cliente (nombre y apellido)' },
];

function specsFor(intent: string): RequiredFieldSpec[] {
  if (intent === 'create_order') return ORDER_FIELDS;
  if (intent === 'create_sale') return SALE_FIELDS;
  if (intent === 'create_purchase') return PURCHASE_FIELDS;
  if (intent === 'register_payment') return PAYMENT_FIELDS;
  if (intent === 'register_cash') return CASH_FIELDS;
  if (intent === 'update_product_cost') return COST_FIELDS;
  if (intent === 'query_balance') return BALANCE_FIELDS;
  if (intent === 'create_client') return CLIENT_FIELDS;
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
    // «ya pagó todo»: el monto lo saca del saldo, no hace falta preguntarlo.
    if (entities.payFullBalance) return true;
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
  _rubro?: string | null
): string {
  const allSpecs = specsFor(intent);
  const noneFilled = allSpecs.length > 0 && missing.length === allSpecs.length;

  if (noneFilled) {
    const carga =
      intent === 'create_order' || intent === 'create_sale'
        ? 'La fecha de carga, si no la decís, queda hoy.'
        : undefined;
    return waCard({
      title: intentTitle(intent),
      lines: [
        'Para anotarlo necesito:',
        ...allSpecs.map((field) => `• ${field.label}`),
        ...(carga ? [carga] : []),
      ],
      ask: 'Mandamelo como hablás, en el orden que quieras.',
    });
  }

  const known: string[] = [];
  if (entities.supplierName) known.push(`Proveedor: ${entities.supplierName}`);
  if (entities.clientName) known.push(`Cliente: ${entities.clientName}`);
  if (entities.productName) known.push(`Producto: ${entities.productName}`);
  if (Number(entities.amount) > 0) known.push(`Monto: $${entities.amount}`);
  const extras = (entities.extraCosts ?? []).filter((item) => Number(item.costo) > 0);
  if (extras.length) {
    known.push(extras.map((item) => `${item.nombre} $${item.costo}`).join(', '));
  }
  const have = known.map((item) => `• ${item}`);
  if (missing.length === 1) {
    return waCard({
      title: intentTitle(intent),
      lines: have.length ? have : undefined,
      ask: `Me falta ${missing[0]!.label.toLowerCase()}.\nEscribilo como quieras, o ${waBold('NO')} para cancelar.`,
    });
  }
  return waCard({
    title: intentTitle(intent),
    lines: [...have, 'Me faltan:', ...missing.map((field) => `• ${field.label}`)],
    ask: `Mandamelos en una frase. ${waBold('NO')} cancela.`,
  });
}

function intentTitle(intent: string): string {
  if (intent === 'create_purchase') return 'Compra';
  if (intent === 'create_order') return 'Pedido';
  if (intent === 'create_sale') return 'Venta';
  if (intent === 'register_payment') return 'Cobro';
  if (intent === 'register_cash') return 'Caja';
  if (intent === 'update_product_cost') return 'Costo de catálogo';
  if (intent === 'query_balance') return 'Saldo';
  if (intent === 'create_client') return 'Cliente nuevo';
  return 'Falta un dato';
}
