import { getBusiness } from '../auth/business.ts';
import { assertCanUseAi, formatThrownUsage, isUsageLimitError, resolveBillingMode } from '../auth/usage-gates.ts';
import { resolveTenantByPhone } from './tenant-resolver.ts';
import { assertWhatsappFeatures } from './feature-guard.ts';
import {
  clearConversationState,
  getConversationState,
  saveConversationState,
} from './conversation-state.ts';
import {
  parseWhatsappCommand,
  type ParsedWhatsappCommand,
  type WhatsappCommandEntities,
} from './ai-command-parser.ts';
import { executeWhatsappCommand } from './erp-integration.ts';
import {
  beginWelcome,
  handleOnboardingPending,
  isOnboardingIntent,
  isSetupReopenText,
  reopenSetupMenu,
} from './onboarding.ts';
import { downloadWhatsappMedia } from './meta-api.ts';
import {
  extractAmountFromText,
  extractClientHintFromText,
  extractDeliveryDateFromText,
  formatClientChoices,
  formatOperationSummary,
  formatProductChoices,
  formatSupplierChoices,
  resolveClientMatch,
  resolveProductMatch,
  resolveSupplierMatch,
  type MatchedClient,
  type MatchedStockItem,
} from './lookups.ts';
import {
  applyOrderDateDefault,
  formatMissingFieldsReply,
  missingRequiredFields,
} from './required-fields.ts';
import {
  createCatalogProductFromWhatsapp,
  createClientFromWhatsapp,
  createSupplierFromWhatsapp,
} from './erp-writes.ts';
import {
  applyCardToEntities,
  applyDraftToEntities,
  applyMedioToEntities,
  cardsForMedio,
  extractPaymentCuotas,
  formatCardChoices,
  formatPaymentChoices,
  isDraftRequest,
  loadPurchasePaymentContext,
  matchMedioFromText,
  paymentNeedsCard,
  SELECT_CARD_INTENT,
  SELECT_PAYMENT_INTENT,
} from './purchase-payment.ts';

export interface WhatsappInboundMessage {
  from: string;
  text?: string;
  mediaId?: string | null;
  mediaType?: string | null;
}

export interface WhatsappHandlerResult {
  reply: string;
  intent: string;
  executed: boolean;
  businessId?: string;
}

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no|cancelar|cancel|n)$/i;
const SELECT_CLIENT_INTENT = 'select_client';
const SELECT_PRODUCT_INTENT = 'select_product';
const SELECT_SUPPLIER_INTENT = 'select_supplier';
const CLARIFY_INTENT = 'clarify';
const CONFIRM_CREATE_CLIENT = 'confirm_create_client';
const CONFIRM_CREATE_PRODUCT = 'confirm_create_product';
const CONFIRM_CREATE_SUPPLIER = 'confirm_create_supplier';
const CONFIRM_INTENT_PREFIX = 'confirm:';

type NamedCandidate = { id: string; nombre: string; label?: string; score?: number; precioVenta?: number };

function isSubscriptionBlocked(business: Awaited<ReturnType<typeof getBusiness>>): boolean {
  if (!business) return true;
  if (business.estadoSuscripcion !== 'activa') return true;
  return resolveBillingMode(business) === 'blocked';
}

function whatsappSignupUrl(): string {
  const base = (process.env.APP_URL ?? 'https://rilo-7eff4.web.app').replace(/\/$/, '');
  return `${base}/probar-gratis?producto=whatsapp`;
}

/** Toda operación de negocio pide resumen + SÍ/NO. */
function needsConfirmation(intent: string): boolean {
  return [
    'create_order',
    'create_sale',
    'create_purchase',
    'register_payment',
    'query_balance',
    'query_cash',
    'register_cash',
  ].includes(intent);
}

function needsClient(intent: string): boolean {
  return ['create_order', 'create_sale', 'register_payment', 'query_balance'].includes(intent);
}

function needsSupplier(intent: string): boolean {
  return intent === 'create_purchase';
}

function needsAmount(intent: string): boolean {
  return ['create_order', 'create_sale', 'register_payment', 'register_cash'].includes(intent);
}

function unitPriceFromEntities(entities: WhatsappCommandEntities): number {
  const qty = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  return amount > 0 ? amount / qty : 0;
}

function entitiesFromParsed(
  parsed: ParsedWhatsappCommand,
  mediaId?: string | null
): WhatsappCommandEntities {
  const entities: WhatsappCommandEntities =
    'entities' in parsed ? { ...(parsed.entities ?? {}) } : {};
  if (mediaId) entities.mediaId = mediaId;
  return entities;
}

function ensurePurchaseLines(entities: WhatsappCommandEntities): void {
  if (Array.isArray(entities.purchaseLines) && entities.purchaseLines.length) return;
  const name = String(entities.productName ?? '').trim();
  if (!name) return;
  const quantity = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  entities.purchaseLines = [
    {
      productName: name,
      productId: entities.productId,
      quantity,
      unitCost: amount > 0 ? amount / quantity : 0,
    },
  ];
}

function purchaseLineIndex(payload: Record<string, unknown>): number | null {
  const raw = Number(payload.lineIndex);
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function purchaseLineCost(
  entities: WhatsappCommandEntities,
  payload: Record<string, unknown>
): number {
  const idx = purchaseLineIndex(payload);
  if (idx == null) return 0;
  return Number(entities.purchaseLines?.[idx]?.unitCost) || 0;
}

function applyProductToEntities(
  entities: WhatsappCommandEntities,
  productId: string,
  productName: string,
  payload: Record<string, unknown>
): void {
  const idx = purchaseLineIndex(payload);
  if (idx != null) {
    const lines = [...(entities.purchaseLines ?? [])];
    const current = lines[idx];
    if (current) {
      lines[idx] = { ...current, productId, productName };
      entities.purchaseLines = lines;
      return;
    }
  }
  entities.productId = productId;
  entities.productName = productName;
}

function confirmationReply(intent: string, entities: WhatsappCommandEntities): string {
  return formatOperationSummary(intent, entities);
}

async function askConfirmation(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, {
    pendingIntent: `${CONFIRM_INTENT_PREFIX}${intent}`,
    pendingPayload: entities as Record<string, unknown>,
  });
  return {
    reply: confirmationReply(intent, entities),
    intent,
    executed: false,
    businessId,
  };
}

async function askPaymentMethod(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const ctx = await loadPurchasePaymentContext(businessId);
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_PAYMENT_INTENT,
    pendingPayload: { originalIntent: 'create_purchase', entities } as Record<string, unknown>,
  });
  return {
    reply: formatPaymentChoices(ctx.medios),
    intent: SELECT_PAYMENT_INTENT,
    executed: false,
    businessId,
  };
}

async function askPaymentCard(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities,
  cards: { id: string; label: string }[]
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_CARD_INTENT,
    pendingPayload: {
      originalIntent: 'create_purchase',
      entities,
      candidates: cards.map((c) => ({ id: c.id, nombre: c.label })),
    } as Record<string, unknown>,
  });
  return {
    reply: formatCardChoices(cards),
    intent: SELECT_CARD_INTENT,
    executed: false,
    businessId,
  };
}

async function ensurePurchasePayment(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const ctx = await loadPurchasePaymentContext(businessId);
  const cuotasFromHint = extractPaymentCuotas(
    [entities.notes, entities.paymentHint].filter(Boolean).join(' ')
  );
  if (cuotasFromHint && !entities.paymentCuotas) entities.paymentCuotas = cuotasFromHint;

  if (entities.saveAsDraft) {
    applyDraftToEntities(entities, entities.paymentIncompleteReason);
    return askConfirmation(businessId, phone, 'create_purchase', entities);
  }

  if (!entities.paymentMedioId) {
    const hint = String(entities.paymentHint ?? entities.notes ?? '').trim();
    const matched = hint ? matchMedioFromText(hint, ctx.medios) : null;
    if (matched) applyMedioToEntities(entities, matched);
  } else if (!entities.paymentMedioLabel) {
    const medio = ctx.medios.find((m) => m.id === entities.paymentMedioId);
    if (medio) applyMedioToEntities(entities, medio);
  }

  if (!entities.paymentMedioId) {
    return askPaymentMethod(businessId, phone, entities);
  }

  const medio = ctx.medios.find((m) => m.id === entities.paymentMedioId);
  if (!medio) {
    entities.paymentMedioId = undefined;
    entities.paymentMedioLabel = undefined;
    return askPaymentMethod(businessId, phone, entities);
  }

  if (paymentNeedsCard(medio, entities)) {
    const cards = cardsForMedio(ctx.tarjetas, medio.id);
    if (!cards.length) {
      applyDraftToEntities(
        entities,
        `El medio «${medio.label}» necesita una cuenta en Finanzas. Lo dejé para completar en el panel.`
      );
      return askConfirmation(businessId, phone, 'create_purchase', entities);
    }
    if (cards.length === 1) {
      applyCardToEntities(entities, cards[0]!);
    } else {
      return askPaymentCard(businessId, phone, entities, cards);
    }
  }

  return askConfirmation(businessId, phone, 'create_purchase', entities);
}

async function prepareOperation(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, { setupStatus: 'done' });

  applyOrderDateDefault(intent, entities);
  const missing = missingRequiredFields(intent, entities);
  if (missing.length) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'bundle',
        missingKeys: missing.map((field) => field.key),
        entities,
      },
    });
    return {
      reply: formatMissingFieldsReply(intent, missing, entities, rubro),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  // 1) Cliente
  if (needsClient(intent) && !entities.clientId) {
    const query = String(entities.clientName ?? '').trim();
    if (!query) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'client',
          entities,
        },
      });
      return {
        reply:
          'No quedó claro el cliente.\n¿Para qué cliente es?\nEscribí el nombre o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }

    const resolved = await resolveClientMatch(businessId, query);
    if (resolved.status === 'none') {
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_CLIENT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: query,
        },
      });
      return {
        reply: `No encontré el cliente "${query}".\n¿Lo registro y sigo?\nSÍ = crear · otro nombre = buscar ese · NO = cancelar.`,
        intent: CONFIRM_CREATE_CLIENT,
        executed: false,
        businessId,
      };
    }

    if (resolved.status === 'ambiguous') {
      const candidates: MatchedClient[] = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_CLIENT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: formatClientChoices(candidates, resolved.query, { allowCreate: true }),
        intent: SELECT_CLIENT_INTENT,
        executed: false,
        businessId,
      };
    }

    entities.clientId = resolved.client.id;
    entities.clientName = resolved.client.nombre;
  }

  if (needsSupplier(intent) && !entities.supplierId) {
    const query = String(entities.supplierName ?? '').trim();
    if (!query) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'supplier',
          entities,
        },
      });
      return {
        reply:
          'No quedó claro el proveedor.\n¿De qué proveedor es la compra?\nEscribí el nombre o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }

    const resolved = await resolveSupplierMatch(businessId, query);
    if (resolved.status === 'none') {
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_SUPPLIER,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: query,
        },
      });
      return {
        reply: `No encontré el proveedor "${query}".\n¿Lo registro y sigo?\nSÍ = crear · otro nombre = buscar ese · NO = cancelar.`,
        intent: CONFIRM_CREATE_SUPPLIER,
        executed: false,
        businessId,
      };
    }

    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_SUPPLIER_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: formatSupplierChoices(candidates, resolved.query, { allowCreate: true }),
        intent: SELECT_SUPPLIER_INTENT,
        executed: false,
        businessId,
      };
    }

    entities.supplierId = resolved.supplier.id;
    entities.supplierName = resolved.supplier.nombre;
  }

  if (intent === 'create_purchase') {
    ensurePurchaseLines(entities);
    const lines = [...(entities.purchaseLines ?? [])];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.productId) continue;
      const productQuery = String(line.productName ?? '').trim();
      if (!productQuery) continue;
      const resolved = await resolveProductMatch(businessId, productQuery);
      if (resolved.status === 'unique') {
        lines[i] = {
          ...line,
          productId: resolved.product.id,
          productName: resolved.product.label || resolved.product.nombre,
        };
        continue;
      }
      if (resolved.status === 'ambiguous') {
        const candidates: MatchedStockItem[] = resolved.candidates;
        entities.purchaseLines = lines;
        await saveConversationState(businessId, phone, {
          pendingIntent: SELECT_PRODUCT_INTENT,
          pendingPayload: {
            originalIntent: intent,
            query: resolved.query,
            lineIndex: i,
            entities,
            allowCreate: true,
            candidates: candidates.map((c) => ({
              id: c.id,
              nombre: c.nombre,
              label: c.label,
              score: c.score,
              precioVenta: c.precioVenta,
            })),
          },
        });
        return {
          reply: formatProductChoices(candidates, resolved.query, { allowCreate: true }),
          intent: SELECT_PRODUCT_INTENT,
          executed: false,
          businessId,
        };
      }
      entities.purchaseLines = lines;
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_PRODUCT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: productQuery,
          lineIndex: i,
        },
      });
      const costHint = Number(line.unitCost) > 0 ? ` a costo $${line.unitCost}` : '';
      return {
        reply: `No encontré "${productQuery}" en el catálogo.\n¿Lo creo y sumo el stock de esta compra${costHint}?\nSÍ = crear y usar · NO = cancelar.`,
        intent: CONFIRM_CREATE_PRODUCT,
        executed: false,
        businessId,
      };
    }
    entities.purchaseLines = lines.filter(
      (line) => String(line.productName ?? '').trim() && Number(line.quantity) > 0
    );
    const unresolved = (entities.purchaseLines ?? []).filter((line) => !line.productId);
    if (unresolved.length || !(entities.purchaseLines ?? []).length) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'bundle',
          missingKeys: ['productName'],
          entities,
        },
      });
      return {
        reply:
          'No pude armar los productos de la compra.\nMandá la foto del remito/factura o el detalle (producto, cantidad y costo), o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    return ensurePurchasePayment(businessId, phone, entities);
  }

  // 2) Producto (si mencionaron uno)
  const productQuery = String(entities.productName ?? '').trim();
  if (
    (intent === 'create_order' || intent === 'create_sale') &&
    productQuery &&
    !entities.productId &&
    !entities.productAsConcept
  ) {
    const resolved = await resolveProductMatch(businessId, productQuery);
    if (resolved.status === 'ambiguous') {
      const candidates: MatchedStockItem[] = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_PRODUCT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            label: c.label,
            score: c.score,
            precioVenta: c.precioVenta,
          })),
        },
      });
      return {
        reply: formatProductChoices(candidates, resolved.query, { allowCreate: true }),
        intent: SELECT_PRODUCT_INTENT,
        executed: false,
        businessId,
      };
    }
    if (resolved.status === 'unique') {
      entities.productId = resolved.product.id;
      entities.productName = resolved.product.label || resolved.product.nombre;
      if (entities.amount == null && resolved.product.precioVenta > 0) {
        const qty = Math.max(1, Number(entities.quantity) || 1);
        entities.amount = resolved.product.precioVenta * qty;
      }
    }
    if (resolved.status === 'none') {
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_PRODUCT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: productQuery,
        },
      });
      const unit = unitPriceFromEntities(entities);
      const priceHint = unit > 0 ? ` a $${unit}` : '';
      return {
        reply: `No encontré el producto "${productQuery}".\n¿Lo guardo en el catálogo${priceHint}? (solo para pedidos/ventas, sin control de stock)\nSÍ = crear y usar · NO = usar solo como texto esta vez · o cancelá con "cancelar".`,
        intent: CONFIRM_CREATE_PRODUCT,
        executed: false,
        businessId,
      };
    }
  }

  // 3) Monto
  if (needsAmount(intent) && !(Number(entities.amount) > 0) && !entities.mediaId) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'amount',
        entities,
      },
    });
    return {
      reply: `Falta el monto${entities.clientName ? ` para ${entities.clientName}` : ''}.\n¿Cuál es el importe? (ej. 5000) o NO para cancelar.`,
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (intent === 'register_cash' && !entities.cashType) {
    entities.cashType = 'egreso';
  }

  // 4) Resumen + confirmación siempre
  return askConfirmation(businessId, phone, intent, entities);
}

async function mergeClarifyIntoEntities(
  text: string,
  entities: WhatsappCommandEntities,
  missingKeys: string[],
  rubro?: string | null
): Promise<WhatsappCommandEntities> {
  const next = { ...entities };
  const parsed = await parseWhatsappCommand({ text, rubro });
  if ('entities' in parsed && parsed.entities) {
    const incoming = parsed.entities;
    if (incoming.clientName) {
      next.clientName = incoming.clientName;
      next.clientId = undefined;
    }
    if (incoming.productName) next.productName = incoming.productName;
    if (incoming.quantity) next.quantity = incoming.quantity;
    if (incoming.amount) next.amount = incoming.amount;
    if (incoming.deliveryDate) next.deliveryDate = incoming.deliveryDate;
    if (incoming.orderDate) next.orderDate = incoming.orderDate;
    if (incoming.paid != null) next.paid = incoming.paid;
    if (incoming.cashType) next.cashType = incoming.cashType;
    if (incoming.cashConcept) next.cashConcept = incoming.cashConcept;
    if (incoming.supplierName) {
      next.supplierName = incoming.supplierName;
      next.supplierId = undefined;
    }
    if (incoming.invoiceNumber) next.invoiceNumber = incoming.invoiceNumber;
    if (incoming.purchaseLines?.length) next.purchaseLines = incoming.purchaseLines;
    if (incoming.paymentHint) next.paymentHint = incoming.paymentHint;
    if (incoming.paymentCuotas) next.paymentCuotas = incoming.paymentCuotas;
    if (incoming.saveAsDraft) next.saveAsDraft = true;
  }

  if (!(Number(next.amount) > 0)) {
    const amount = extractAmountFromText(text);
    if (amount) next.amount = amount;
  }
  if (!next.deliveryDate) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) next.deliveryDate = delivery;
  }
  if (!next.clientName && missingKeys.includes('clientName')) {
    const hint = extractClientHintFromText(text);
    if (hint) next.clientName = hint;
    else if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{1,60}$/.test(text.trim())) {
      next.clientName = text.trim();
      next.clientId = undefined;
    }
  }
  if (!next.productName && missingKeys.includes('productName')) {
    const cleaned = text.trim();
    const onlyDate = Boolean(extractDeliveryDateFromText(cleaned)) && cleaned.split(/\s+/).length <= 4;
    const onlyAmount = extractAmountFromText(cleaned) != null && cleaned.length <= 12;
    if (cleaned.length >= 3 && !onlyDate && !onlyAmount) {
      next.productName = cleaned;
    }
  }
  if (!next.supplierName && missingKeys.includes('supplierName')) {
    const hint = text.trim();
    if (hint.length >= 2 && hint.length <= 80) {
      next.supplierName = hint;
      next.supplierId = undefined;
    }
  }
  return next;
}

async function handlePendingClarify(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const missingField = String(payload.missingField ?? '').trim();
  const missingKeys = Array.isArray(payload.missingKeys)
    ? payload.missingKeys.map((key) => String(key))
    : missingField
      ? [missingField]
      : [];
  let entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };

  if (!originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo el pedido o consulta.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  entities = await mergeClarifyIntoEntities(text, entities, missingKeys, rubro);

  if (missingField === 'client' && !entities.clientName) {
    entities.clientName = text.trim();
    entities.clientId = undefined;
  } else if (missingField === 'supplier' && !entities.supplierName) {
    entities.supplierName = text.trim();
    entities.supplierId = undefined;
  } else if (missingField === 'amount' && !(Number(entities.amount) > 0)) {
    const amount = extractAmountFromText(text) ?? Number(text.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!(amount > 0)) {
      return {
        reply: 'No entendí el monto. Escribí solo el número (ej. 5000) o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    entities.amount = amount;
  }

  return prepareOperation(businessId, phone, originalIntent, entities, rubro);
}

async function handlePendingSelection(
  businessId: string,
  phone: string,
  text: string,
  kind: 'client' | 'product' | 'supplier',
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as NamedCandidate[];
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const query = String(payload.query ?? '');
  const allowCreate = payload.allowCreate === true;

  const choiceMatch = text.trim().match(/^(\d{1,2})$/);
  if (!choiceMatch || !originalIntent || (!candidates.length && !(allowCreate && query))) {
    return {
      reply:
        kind === 'client'
          ? formatClientChoices(candidates, query, { allowCreate })
          : kind === 'supplier'
            ? formatSupplierChoices(candidates, query, { allowCreate })
            : formatProductChoices(candidates, query, { allowCreate }),
      intent:
        kind === 'client'
          ? SELECT_CLIENT_INTENT
          : kind === 'supplier'
            ? SELECT_SUPPLIER_INTENT
            : SELECT_PRODUCT_INTENT,
      executed: false,
      businessId,
    };
  }

  const index = Number(choiceMatch[1]) - 1;

  // Opción "Crear/registrar nuevo" = último número
  if (allowCreate && query && index === candidates.length) {
    try {
      if (kind === 'product') {
        const created = await createCatalogProductFromWhatsapp(businessId, {
          nombre: query,
          precioVenta: unitPriceFromEntities(entities),
          costo: purchaseLineCost(entities, payload),
          controlaStock: originalIntent === 'create_purchase',
        });
        applyProductToEntities(entities, created.id, created.nombre, payload);
        if (originalIntent !== 'create_purchase' && entities.amount == null && created.precioVenta > 0) {
          const qty = Math.max(1, Number(entities.quantity) || 1);
          entities.amount = created.precioVenta * qty;
        }
      } else if (kind === 'supplier') {
        const created = await createSupplierFromWhatsapp(businessId, query);
        entities.supplierId = created.id;
        entities.supplierName = created.nombre;
      } else {
        const created = await createClientFromWhatsapp(businessId, query);
        entities.clientId = created.id;
        entities.clientName = created.nombre;
      }
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    } catch (error) {
      return {
        reply: await formatThrownUsage(error, businessId),
        intent: 'error',
        executed: false,
        businessId,
      };
    }
  }

  const chosen = candidates[index];
  if (!chosen) {
    return {
      reply: `Número inválido. Elegí entre 1 y ${candidates.length + (allowCreate && query ? 1 : 0)}, o NO para cancelar.`,
      intent:
        kind === 'client'
          ? SELECT_CLIENT_INTENT
          : kind === 'supplier'
            ? SELECT_SUPPLIER_INTENT
            : SELECT_PRODUCT_INTENT,
      executed: false,
      businessId,
    };
  }

  if (kind === 'client') {
    entities.clientId = chosen.id;
    entities.clientName = chosen.nombre;
  } else if (kind === 'supplier') {
    entities.supplierId = chosen.id;
    entities.supplierName = chosen.nombre;
  } else {
    applyProductToEntities(entities, chosen.id, chosen.label || chosen.nombre, payload);
    if (
      originalIntent !== 'create_purchase' &&
      entities.amount == null &&
      Number(chosen.precioVenta) > 0
    ) {
      const qty = Math.max(1, Number(entities.quantity) || 1);
      entities.amount = Number(chosen.precioVenta) * qty;
    }
  }

  return prepareOperation(businessId, phone, originalIntent, entities, rubro);
}

async function handleConfirmCreateClient(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.clientName ?? '').trim();

  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    // Otro nombre
    entities.clientName = text.trim();
    entities.clientId = undefined;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (!proposedName || !originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  try {
    const created = await createClientFromWhatsapp(businessId, proposedName);
    entities.clientId = created.id;
    entities.clientName = created.nombre;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: await formatThrownUsage(error, businessId),
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleConfirmCreateProduct(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.productName ?? '').trim();

  if (/^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!originalIntent || !proposedName) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  // NO = usar como concepto libre esta vez (sin alta en catálogo)
  if (CONFIRM_NO.test(text.trim())) {
    if (originalIntent === 'create_purchase') {
      await clearConversationState(businessId, phone);
      return {
        reply: 'Cancelé la compra. Para sumar stock el producto tiene que estar en el catálogo.',
        intent: 'cancelled',
        executed: false,
        businessId,
      };
    }
    entities.productId = undefined;
    entities.productName = proposedName;
    entities.productAsConcept = true;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (!CONFIRM_YES.test(text.trim())) {
    return {
      reply:
        originalIntent === 'create_purchase'
          ? `¿Creo "${proposedName}" en el catálogo y sumo el stock de esta compra?\nSÍ = crear · NO = cancelar.`
          : `¿Guardo "${proposedName}" en el catálogo (sin stock)?\nSÍ = crear · NO = solo texto esta vez · cancelar = abortar.`,
      intent: CONFIRM_CREATE_PRODUCT,
      executed: false,
      businessId,
    };
  }

  try {
    const created = await createCatalogProductFromWhatsapp(businessId, {
      nombre: proposedName,
      precioVenta: unitPriceFromEntities(entities),
      costo: purchaseLineCost(entities, payload),
      controlaStock: originalIntent === 'create_purchase',
    });
    applyProductToEntities(entities, created.id, created.nombre, payload);
    if (
      originalIntent !== 'create_purchase' &&
      entities.amount == null &&
      created.precioVenta > 0
    ) {
      const qty = Math.max(1, Number(entities.quantity) || 1);
      entities.amount = created.precioVenta * qty;
    }
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: await formatThrownUsage(error, businessId),
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleConfirmCreateSupplier(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.supplierName ?? '').trim();

  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    entities.supplierName = text.trim();
    entities.supplierId = undefined;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (!proposedName || !originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  try {
    const created = await createSupplierFromWhatsapp(businessId, proposedName);
    entities.supplierId = created.id;
    entities.supplierName = created.nombre;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: error instanceof Error ? error.message : 'No pude registrar el proveedor.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleSelectPurchasePayment(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const ctx = await loadPurchasePaymentContext(businessId);
  const trimmed = text.trim();
  const cuotas = extractPaymentCuotas(trimmed);
  if (cuotas) entities.paymentCuotas = cuotas;

  if (isDraftRequest(trimmed)) {
    applyDraftToEntities(entities);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const choiceMatch = trimmed.match(/^(\d{1,2})$/);
  if (choiceMatch) {
    const index = Number(choiceMatch[1]) - 1;
    if (index === ctx.medios.length) {
      applyDraftToEntities(entities);
      return ensurePurchasePayment(businessId, phone, entities);
    }
    const medio = ctx.medios[index];
    if (!medio) {
      return {
        reply: formatPaymentChoices(ctx.medios),
        intent: SELECT_PAYMENT_INTENT,
        executed: false,
        businessId,
      };
    }
    applyMedioToEntities(entities, medio);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const matched = matchMedioFromText(trimmed, ctx.medios);
  if (matched) {
    applyMedioToEntities(entities, matched);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  return {
    reply: `No reconocí ese medio.\n\n${formatPaymentChoices(ctx.medios)}`,
    intent: SELECT_PAYMENT_INTENT,
    executed: false,
    businessId,
  };
}

async function handleSelectPurchaseCard(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as Array<{
    id: string;
    nombre: string;
  }>;
  const trimmed = text.trim();

  if (isDraftRequest(trimmed)) {
    applyDraftToEntities(entities);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const choiceMatch = trimmed.match(/^(\d{1,2})$/);
  if (choiceMatch) {
    const index = Number(choiceMatch[1]) - 1;
    if (index === candidates.length) {
      applyDraftToEntities(entities);
      return ensurePurchasePayment(businessId, phone, entities);
    }
    const chosen = candidates[index];
    if (chosen) {
      applyCardToEntities(entities, { id: chosen.id, label: chosen.nombre, ambitoDefault: 'negocio', activa: true, medioPagoId: entities.paymentMedioId ?? '' });
      return ensurePurchasePayment(businessId, phone, entities);
    }
  }

  const n = trimmed.toLowerCase();
  const byName = candidates.find((c) => c.nombre.toLowerCase() === n || c.nombre.toLowerCase().includes(n));
  if (byName) {
    applyCardToEntities(entities, {
      id: byName.id,
      label: byName.nombre,
      ambitoDefault: 'negocio',
      activa: true,
      medioPagoId: entities.paymentMedioId ?? '',
    });
    return ensurePurchasePayment(businessId, phone, entities);
  }

  return {
    reply: formatCardChoices(
      candidates.map((c) => ({
        id: c.id,
        label: c.nombre,
        ambitoDefault: 'negocio',
        activa: true,
        medioPagoId: entities.paymentMedioId ?? '',
      }))
    ),
    intent: SELECT_CARD_INTENT,
    executed: false,
    businessId,
  };
}

async function handlePendingConfirmation(
  businessId: string,
  phone: string,
  text: string,
  pendingIntent: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  const intent = pendingIntent.startsWith(CONFIRM_INTENT_PREFIX)
    ? pendingIntent.slice(CONFIRM_INTENT_PREFIX.length)
    : pendingIntent;

  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    const entities = (pendingPayload ?? {}) as WhatsappCommandEntities;
    return {
      reply: `${confirmationReply(intent, entities)}\n\nRespondé solo SÍ o NO.`,
      intent,
      executed: false,
      businessId,
    };
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'No encontré tu cuenta. Contactá a soporte.',
      intent: 'error',
      executed: false,
    };
  }

  const entities = (pendingPayload ?? {}) as WhatsappCommandEntities;
  const parsed = {
    intent,
    confidence: 1,
    entities,
    raw: String(entities.notes ?? text),
  } as ParsedWhatsappCommand;

  const result = await executeWhatsappCommand(tenant, parsed);
  await clearConversationState(businessId, phone);

  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId,
  };
}

export async function handleWhatsappMessage(
  message: WhatsappInboundMessage
): Promise<WhatsappHandlerResult> {
  const phone = message.from.trim();
  const text = String(message.text ?? '').trim();
  const mediaId = message.mediaId?.trim() || null;

  if (!phone || (!text && !mediaId)) {
    return { reply: '', intent: 'empty', executed: false };
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    const registerUrl = whatsappSignupUrl();
    return {
      reply:
        `Hola 👋 Soy RILO Bot.\n` +
        `Tu número todavía no está registrado.\n\n` +
        `Para usarme, creá tu cuenta acá (prueba gratis):\n${registerUrl}\n\n` +
        `Usá el mismo WhatsApp con el que me escribís. Cuando termines el registro, volvé a escribirme.`,
      intent: 'unauthorized',
      executed: false,
    };
  }

  if (tenant.accessRevoked) {
    return {
      reply:
        `Este WhatsApp está dado de baja en la cuenta.\n\n` +
        `Si lo reactivaste desde Superadmin o Planes, escribime de nuevo en un momento. ` +
        `Si sigue sin andar, pedile al admin que vuelva a dar de alta el número en la empresa.`,
      intent: 'account_offboarded',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const business = await getBusiness(tenant.businessId);
  const guard = assertWhatsappFeatures(tenant, {
    subscriptionActive: !isSubscriptionBlocked(business),
  });

  if (!guard.ok) {
    return {
      reply: guard.message,
      intent: guard.reason,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const state = await getConversationState(tenant.businessId, phone);
  if (state?.pendingIntent && text) {
    if (isOnboardingIntent(state.pendingIntent)) {
      const onboarded = await handleOnboardingPending(
        tenant,
        text,
        state.pendingIntent,
        state.pendingPayload
      );
      if (onboarded) return onboarded;
    }
    if (state.pendingIntent === SELECT_CLIENT_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'client',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_SUPPLIER_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'supplier',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PRODUCT_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'product',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === CONFIRM_CREATE_CLIENT) {
      return handleConfirmCreateClient(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === CONFIRM_CREATE_SUPPLIER) {
      return handleConfirmCreateSupplier(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PAYMENT_INTENT) {
      return handleSelectPurchasePayment(tenant.businessId, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === SELECT_CARD_INTENT) {
      return handleSelectPurchaseCard(tenant.businessId, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === CONFIRM_CREATE_PRODUCT) {
      return handleConfirmCreateProduct(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === CLARIFY_INTENT) {
      return handlePendingClarify(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (
      state.pendingIntent.startsWith(CONFIRM_INTENT_PREFIX) ||
      needsConfirmation(state.pendingIntent)
    ) {
      return handlePendingConfirmation(
        tenant.businessId,
        phone,
        text,
        state.pendingIntent,
        state.pendingPayload
      );
    }
  }

  let image: { buffer: Buffer; contentType: string } | null = null;
  if (mediaId) {
    image = await downloadWhatsappMedia(mediaId);
    if (!image && !text) {
      return {
        reply:
          'Recibí la imagen pero no pude descargarla. Probá mandarla de nuevo, o escribí “compra” y el detalle del remito.',
        intent: 'error',
        executed: false,
        businessId: tenant.businessId,
      };
    }
  }

  if (image) {
    try {
      await assertCanUseAi(tenant.businessId, 2);
    } catch (error) {
      if (isUsageLimitError(error)) {
        return {
          reply: await formatThrownUsage(error, tenant.businessId),
          intent: 'ai_quota',
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }
  }

  const parsed = await parseWhatsappCommand({
    text,
    image,
    mediaId,
    rubro: tenant.rubro,
    businessId: tenant.businessId,
  });

  if (parsed.intent === 'greeting') {
    return beginWelcome(tenant);
  }

  if (isSetupReopenText(text) && !mediaId) {
    return reopenSetupMenu(tenant);
  }

  if (parsed.intent === 'help' || parsed.intent === 'unknown') {
    const result = await executeWhatsappCommand(tenant, parsed);
    return {
      reply: result.reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  }

  const entities = entitiesFromParsed(parsed, mediaId);
  return prepareOperation(tenant.businessId, phone, parsed.intent, entities, tenant.rubro);
}
