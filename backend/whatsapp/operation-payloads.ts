import type { WhatsappCommandEntities, WhatsappIntent, WhatsappPurchaseLine } from './ai-command-parser.ts';
import type { ExtraCostItem } from './lookups.ts';
import type { LineItemIntent } from './conversation-contract.ts';
import { OPERATION_CATALOG } from './operation-catalog.ts';

export type HelpPayload = Record<string, never>;
export type GreetingPayload = Record<string, never>;
export type HowToPayload = { helpTopic?: string; expectedItemCount?: number };
export type CapabilityPayload = { helpTopic?: string; expectedItemCount?: number };
export type UnknownPayload = { raw?: string };

export type CreateOrderPayload = {
  clientName?: string;
  clientPhone?: string;
  clientId?: string;
  items: LineItemIntent[];
  amount?: number;
  notes?: string;
  deliveryDate?: string;
  orderDate?: string;
  seniaAmount?: number;
  paid?: boolean;
  payFullBalance?: boolean;
  extraCosts?: ExtraCostItem[];
};

export type CreateSalePayload = {
  clientName?: string;
  clientId?: string;
  items: LineItemIntent[];
  amount?: number;
  notes?: string;
  orderDate?: string;
  paid?: boolean;
  seniaAmount?: number;
  extraCosts?: ExtraCostItem[];
};

export type CreatePurchasePayload = {
  supplierName?: string;
  supplierId?: string;
  purchaseLines: WhatsappPurchaseLine[];
  invoiceNumber?: string;
  amount?: number;
  orderDate?: string;
  mediaId?: string;
  saveAsDraft?: boolean;
};

export type RegisterPaymentPayload = {
  clientName?: string;
  clientId?: string;
  amount?: number;
  payFullBalance?: boolean;
  paymentKind?: 'senia' | 'pago';
  paymentHint?: string;
  orderNumber?: string;
  targetOrderId?: string;
  targetOrderLabel?: string;
  referToLast?: boolean;
};

export type RegisterCashPayload = {
  amount: number;
  cashType: 'ingreso' | 'egreso';
  cashConcept?: string;
  cashAmbitoHint?: string;
  cashAmbitoId?: string;
  cashAmbitoLabel?: string;
};

export type CreateClientPayload = {
  clientName: string;
  clientPhone?: string;
};

export type RegisterCostPayload = {
  extraCosts: ExtraCostItem[];
  orderNumber?: string;
  targetOrderId?: string;
  clientName?: string;
  referToLast?: boolean;
};

export type UpdateProductCostPayload = {
  productName?: string;
  productId?: string;
  amount: number;
};

export type UpdateOrderStatusPayload = {
  orderStatus: string;
  orderNumber?: string;
  targetOrderId?: string;
  clientName?: string;
  paid?: boolean;
  payFullBalance?: boolean;
  amount?: number;
  referToLast?: boolean;
};

export type QueryBalancePayload = {
  clientName?: string;
  clientId?: string;
};

export type QueryCashPayload = {
  cashAmbitoHint?: string;
  cashAmbitoId?: string;
};

export type QueryStatusPayload = {
  clientName?: string;
  orderNumber?: string;
  targetOrderId?: string;
  productName?: string;
  listOrders?: boolean;
  referToLast?: boolean;
};

export type QueryStockPayload = {
  productHint?: string;
  color?: string;
  size?: string;
  wantAll?: boolean;
};

export type HelpOperation = { intent: 'help'; payload: HelpPayload };
export type GreetingOperation = { intent: 'greeting'; payload: GreetingPayload };
export type HowToOperation = { intent: 'how_to'; payload: HowToPayload };
export type CapabilityQuestionOperation = { intent: 'capability_question'; payload: CapabilityPayload };
export type CreateOrderOperation = { intent: 'create_order'; payload: CreateOrderPayload };
export type CreateSaleOperation = { intent: 'create_sale'; payload: CreateSalePayload };
export type CreatePurchaseOperation = { intent: 'create_purchase'; payload: CreatePurchasePayload };
export type RegisterPaymentOperation = { intent: 'register_payment'; payload: RegisterPaymentPayload };
export type RegisterCashOperation = { intent: 'register_cash'; payload: RegisterCashPayload };
export type CreateClientOperation = { intent: 'create_client'; payload: CreateClientPayload };
export type RegisterCostOperation = { intent: 'register_cost'; payload: RegisterCostPayload };
export type UpdateProductCostOperation = { intent: 'update_product_cost'; payload: UpdateProductCostPayload };
export type UpdateOrderStatusOperation = { intent: 'update_order_status'; payload: UpdateOrderStatusPayload };
export type QueryBalanceOperation = { intent: 'query_balance'; payload: QueryBalancePayload };
export type QueryCashOperation = { intent: 'query_cash'; payload: QueryCashPayload };
export type QueryStatusOperation = { intent: 'query_status'; payload: QueryStatusPayload };
export type QueryStockOperation = { intent: 'query_stock'; payload: QueryStockPayload };
export type UnknownOperation = { intent: 'unknown'; payload: UnknownPayload };

export type Operation =
  | HelpOperation
  | GreetingOperation
  | HowToOperation
  | CapabilityQuestionOperation
  | CreateOrderOperation
  | CreateSaleOperation
  | CreatePurchaseOperation
  | RegisterPaymentOperation
  | RegisterCashOperation
  | CreateClientOperation
  | RegisterCostOperation
  | UpdateProductCostOperation
  | UpdateOrderStatusOperation
  | QueryBalanceOperation
  | QueryCashOperation
  | QueryStatusOperation
  | QueryStockOperation
  | UnknownOperation;

export function payloadKeysFor(intent: WhatsappIntent): string[] {
  return [...OPERATION_CATALOG[intent].required, ...OPERATION_CATALOG[intent].optional];
}

export function entitiesToOperation(
  intent: WhatsappIntent,
  entities: WhatsappCommandEntities
): Operation {
  switch (intent) {
    case 'help':
      return { intent, payload: {} };
    case 'greeting':
      return { intent, payload: {} };
    case 'how_to':
      return {
        intent,
        payload: { helpTopic: entities.helpTopic, expectedItemCount: entities.expectedItemCount },
      };
    case 'capability_question':
      return {
        intent,
        payload: { helpTopic: entities.helpTopic, expectedItemCount: entities.expectedItemCount },
      };
    case 'create_order':
      return {
        intent,
        payload: {
          clientName: entities.clientName,
          clientPhone: entities.clientPhone,
          clientId: entities.clientId,
          items: entities.items ?? [],
          amount: entities.amount,
          notes: entities.notes,
          deliveryDate: entities.deliveryDate,
          orderDate: entities.orderDate,
          seniaAmount: entities.seniaAmount,
          paid: entities.paid,
          payFullBalance: entities.payFullBalance,
          extraCosts: entities.extraCosts,
        },
      };
    case 'create_sale':
      return {
        intent,
        payload: {
          clientName: entities.clientName,
          clientId: entities.clientId,
          items: entities.items ?? [],
          amount: entities.amount,
          notes: entities.notes,
          orderDate: entities.orderDate,
          paid: entities.paid,
          seniaAmount: entities.seniaAmount,
          extraCosts: entities.extraCosts,
        },
      };
    case 'create_purchase':
      return {
        intent,
        payload: {
          supplierName: entities.supplierName,
          supplierId: entities.supplierId,
          purchaseLines: entities.purchaseLines ?? [],
          invoiceNumber: entities.invoiceNumber,
          amount: entities.amount,
          orderDate: entities.orderDate,
          mediaId: entities.mediaId,
          saveAsDraft: entities.saveAsDraft,
        },
      };
    case 'register_payment':
      return {
        intent,
        payload: {
          clientName: entities.clientName,
          clientId: entities.clientId,
          amount: entities.amount,
          payFullBalance: entities.payFullBalance,
          paymentKind: entities.paymentKind,
          paymentHint: entities.paymentHint,
          orderNumber: entities.orderNumber,
          targetOrderId: entities.targetOrderId,
          targetOrderLabel: entities.targetOrderLabel,
          referToLast: entities.referToLast,
        },
      };
    case 'register_cash':
      return {
        intent,
        payload: {
          amount: Number(entities.amount) || 0,
          cashType: entities.cashType === 'ingreso' ? 'ingreso' : 'egreso',
          cashConcept: entities.cashConcept,
          cashAmbitoHint: entities.cashAmbitoHint,
          cashAmbitoId: entities.cashAmbitoId,
          cashAmbitoLabel: entities.cashAmbitoLabel,
        },
      };
    case 'create_client':
      return {
        intent,
        payload: { clientName: String(entities.clientName ?? ''), clientPhone: entities.clientPhone },
      };
    case 'register_cost':
      return {
        intent,
        payload: {
          extraCosts: entities.extraCosts ?? [],
          orderNumber: entities.orderNumber,
          targetOrderId: entities.targetOrderId,
          clientName: entities.clientName,
          referToLast: entities.referToLast,
        },
      };
    case 'update_product_cost':
      return {
        intent,
        payload: {
          productName: entities.productName,
          productId: entities.productId,
          amount: Number(entities.amount) || 0,
        },
      };
    case 'update_order_status':
      return {
        intent,
        payload: {
          orderStatus: String(entities.orderStatus ?? ''),
          orderNumber: entities.orderNumber,
          targetOrderId: entities.targetOrderId,
          clientName: entities.clientName,
          paid: entities.paid,
          payFullBalance: entities.payFullBalance,
          amount: entities.amount,
          referToLast: entities.referToLast,
        },
      };
    case 'query_balance':
      return {
        intent,
        payload: { clientName: entities.clientName, clientId: entities.clientId },
      };
    case 'query_cash':
      return {
        intent,
        payload: { cashAmbitoHint: entities.cashAmbitoHint, cashAmbitoId: entities.cashAmbitoId },
      };
    case 'query_status':
      return {
        intent,
        payload: {
          clientName: entities.clientName,
          orderNumber: entities.orderNumber,
          targetOrderId: entities.targetOrderId,
          productName: entities.productName,
          listOrders: entities.listOrders,
          referToLast: entities.referToLast,
        },
      };
    case 'query_stock':
      return {
        intent,
        payload: {
          productHint: entities.productName || entities.items?.[0]?.productHint,
          color: entities.items?.[0]?.attributes?.color ?? undefined,
          size: entities.items?.[0]?.attributes?.size ?? undefined,
          wantAll: entities.listWantAll,
        },
      };
    default:
      return { intent: 'unknown', payload: { raw: entities.sourceText } };
  }
}

export function operationToEntities(operation: Operation): WhatsappCommandEntities {
  const payload = operation.payload as Record<string, unknown>;
  const entities: WhatsappCommandEntities = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) (entities as Record<string, unknown>)[key] = value;
  }
  if (operation.intent === 'query_stock') {
    const stock = operation.payload;
    if (stock.productHint) entities.productName = stock.productHint;
    if (stock.color || stock.size) {
      entities.items = [
        {
          quantity: 1,
          rawText: [stock.productHint, stock.color, stock.size].filter(Boolean).join(' '),
          productHint: stock.productHint,
          attributes: { color: stock.color ?? null, size: stock.size ?? null },
        },
      ];
    }
    if (stock.wantAll) entities.listWantAll = true;
  }
  return entities;
}

export function emptyPayloadFor(intent: WhatsappIntent): Operation {
  return entitiesToOperation(intent, {});
}
