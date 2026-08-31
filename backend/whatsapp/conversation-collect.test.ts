import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules } from './ai-command-parser.ts';
import { catalogQueryForItem } from './conversation-contract.ts';
import {
  decideCatalogMatch,
  extractSpokenProductType,
  filterCatalogCandidates,
} from './catalog-rank.ts';
import {
  extractDeliveryDateFromText,
  extractNotesHintFromText,
  formatClientChoices,
  formatOperationSummary,
  formatProductChoices,
  todayDateOnly,
} from './lookups.ts';
import {
  formatOrderFinanceLines,
  planRelatedOrderFinance,
} from './order-finance.ts';
import { applyFollowUpToEntities, ensureOrderItems } from './turn-interpreter.ts';
import { presentOrderCollecting, presentOrderConfirm } from './whatsapp-present.ts';

const LAISS =
  'Registra un pedido del cliente Laissmachado - ig un canguro XL rojo con diseño de ceibal ya esta pago $1550';

describe('TEST — pedido Laissmachado: interpretar todo y preguntar solo la fecha', () => {
  it('parsea cliente completo, ítem, diseño, pago y NO asume fecha', () => {
    const parsed = parseWithRules(LAISS);
    assert.equal(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    ensureOrderItems(entities);

    assert.equal(entities.spokenClientName || entities.clientName, 'Laissmachado - ig');
    assert.equal(entities.amount, 1550);
    assert.equal(entities.paid, true);
    assert.equal(entities.deliveryDate, undefined);

    const item = entities.items?.[0];
    assert.ok(item, 'debe haber 1 ítem');
    assert.equal(entities.items?.length, 1);
    assert.equal(item!.quantity, 1);
    assert.equal(item!.attributes?.type || extractSpokenProductType(item!.rawText || ''), 'canguro');
    assert.equal(String(item!.attributes?.size || '').toUpperCase(), 'XL');
    assert.match(String(item!.attributes?.color || ''), /roj/i);
    assert.match(String(entities.notes || extractNotesHintFromText(LAISS) || ''), /ceibal/i);
    assert.doesNotMatch(String(entities.notes || extractNotesHintFromText(LAISS) || ''), /pago|1550/i);

    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      paid: entities.paid,
      sourceText: LAISS,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
  });

  it('la query de catálogo no duplica rawText ni el nombre candidato', () => {
    const query = catalogQueryForItem({
      quantity: 1,
      rawText: 'un canguro XL rojo',
      productHint: 'canguro',
      attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
      productName: 'Canguro felpa Rojo XL',
    });
    assert.match(query, /canguro/i);
    assert.match(query, /XL/i);
    assert.match(query, /roj/i);
    assert.doesNotMatch(query, /canguro.+\bcanguro\b/i);
    assert.doesNotMatch(query, /\(Rojo/i);
    assert.doesNotMatch(query, /felpa sw/i);
  });

  it('elige automáticamente Canguro felpa Rojo XL si es el candidato dominante', () => {
    const catalog = [
      { id: '1', nombre: 'Canguro felpa Rojo XL', label: 'Canguro felpa Rojo XL', score: 80 },
      { id: '2', nombre: 'Canguro felpa comb gris con manga Rojo XL', label: 'Canguro felpa comb gris con manga Rojo XL', score: 80 },
      { id: '3', nombre: 'Canguro felpa Rojo L', label: 'Canguro felpa Rojo L', score: 80 },
      { id: '4', nombre: 'Canguro felpa Rojo M', label: 'Canguro felpa Rojo M', score: 80 },
      { id: '5', nombre: 'Canguro felpa Rojo S', label: 'Canguro felpa Rojo S', score: 80 },
      { id: '6', nombre: 'Canguro felpa Rojo XXL', label: 'Canguro felpa Rojo XXL', score: 80 },
      { id: '7', nombre: 'Camiseta algodón Rojo XL', label: 'Camiseta algodón Rojo XL', score: 80 },
    ];
    const filtered = filterCatalogCandidates(catalog, { type: 'canguro', size: 'XL', color: 'rojo' });
    assert.equal(filtered.length, 1, filtered.map((row) => row.nombre).join(' | '));
    assert.match(filtered[0]!.nombre, /Canguro felpa Rojo XL/i);
    const decision = decideCatalogMatch(catalog, { type: 'canguro', size: 'XL', color: 'rojo' });
    assert.equal(decision.status, 'unique');
    if (decision.status === 'unique') {
      assert.match(decision.item.nombre, /Canguro felpa Rojo XL/i);
    }
  });

  it('pregunta solo si hay empate real (felpa vs algodón vs frisa)', () => {
    const extras = Array.from({ length: 10 }, (_, index) => ({
      id: `x${index}`,
      nombre: `Canguro extra ${index} rojo XL`,
      label: `Canguro extra ${index} rojo XL`,
      score: 40,
    }));
    const catalog = [
      { id: '1', nombre: 'Canguro felpa rojo XL', label: 'Canguro felpa rojo XL', score: 86 },
      { id: '2', nombre: 'Canguro algodón rojo XL', label: 'Canguro algodón rojo XL', score: 84 },
      { id: '3', nombre: 'Canguro frisa rojo XL', label: 'Canguro frisa rojo XL', score: 83 },
      ...extras,
    ];
    const decision = decideCatalogMatch(catalog, { type: 'canguro', size: 'XL', color: 'rojo' });
    assert.equal(decision.status, 'ambiguous');
    if (decision.status === 'ambiguous') {
      assert.equal(decision.options.length, 3);
      assert.ok(decision.rest.length >= 1);
      assert.equal(decision.options.some((row) => /extra/.test(row.nombre)), false);
    }
  });

  it('el progreso mientras falta la fecha es compacto y no re-pregunta lo ya sabido', () => {
    const entities = {
      clientName: 'Laissmachado - ig',
      spokenClientName: 'Laissmachado - ig',
      notes: 'diseño de ceibal',
      amount: 1550,
      paid: true,
      sourceText: LAISS,
      items: [{ quantity: 1, rawText: 'canguro XL rojo', productName: 'Canguro felpa rojo XL' }],
    };
    const card = presentOrderCollecting(entities, '📅 ¿Para qué fecha es la entrega?');
    assert.match(card, /\*Pedido a Laissmachado - ig\*/);
    assert.match(card, /Canguro felpa rojo XL/);
    assert.equal((card.match(/Canguro felpa rojo XL/gi) ?? []).length, 1);
    assert.match(card, /Diseño: Ceibal/);
    assert.match(card, /Venta: \$1\.550/);
    assert.match(card, /Pago: \$1\.550 → saldo \$0/);
    assert.match(card, /📅 ¿Para qué fecha es la entrega\?/);
    assert.doesNotMatch(card, /Fecha de entrega/);
    assert.doesNotMatch(card, /Si algo está mal/);
    assert.doesNotMatch(card, /Cómo responder/);
    assert.doesNotMatch(card, /Monto: \$1550/);
    assert.doesNotMatch(card, /\n\n/);
  });

  it('«mañana y el diseño que diga» completa fecha y notas sin perder el resto', () => {
    const collected = {
      clientName: 'Laissmachado - ig',
      spokenClientName: 'Laissmachado - ig',
      clientLocked: true,
      notes: 'diseño de ceibal',
      amount: 1550,
      paid: true,
      items: [
        {
          quantity: 1,
          rawText: 'canguro XL rojo',
          productName: 'Canguro felpa rojo XL',
          productId: 'sku-1',
          productLocked: true,
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'mañana y el diseño que diga Ceibal 2026', {
      type: 'field',
      field: 'deliveryDate',
    });
    assert.ok(next.deliveryDate);
    assert.notEqual(next.deliveryDate, todayDateOnly());
    assert.match(String(next.notes), /Ceibal 2026/i);
    assert.equal(next.clientName, 'Laissmachado - ig');
    assert.equal(next.items?.[0]?.productName, 'Canguro felpa rojo XL');
    assert.equal(next.items?.[0]?.productId, 'sku-1');
    assert.equal(next.amount, 1550);
    assert.equal(next.paid, true);
  });

  it('tras la fecha, el resumen final pide ¿Confirmo? y no explica de más', () => {
    const tomorrow = extractDeliveryDateFromText('mañana');
    const entities = {
      clientName: 'Laissmachado - ig',
      notes: 'diseño de ceibal',
      amount: 1550,
      paid: true,
      sourceText: LAISS,
      deliveryDate: tomorrow,
      items: [{ quantity: 1, rawText: 'canguro XL rojo', productName: 'Canguro felpa rojo XL' }],
    };
    const card = presentOrderConfirm(entities);
    assert.match(card, /Entrega:/);
    assert.match(card, /¿Confirmo\?/);
    assert.doesNotMatch(card, /Si algo está mal/);
    const summary = formatOperationSummary('create_order', entities);
    assert.match(summary, /¿Confirmo\?/);
    assert.match(summary, /Pago: \$1\.550/);
  });

  it('corrección «no, es para el lunes y el diseño dice Ceibal 2026» solo cambia fecha y notas', () => {
    const collected = {
      clientName: 'Laissmachado - ig',
      notes: 'diseño de ceibal',
      amount: 1550,
      paid: true,
      deliveryDate: extractDeliveryDateFromText('mañana') || '2026-08-29',
      items: [
        {
          quantity: 1,
          rawText: 'canguro XL rojo',
          productName: 'Canguro felpa rojo XL',
          productId: 'sku-1',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
    };
    const next = applyFollowUpToEntities(
      collected,
      'no, es para el lunes y el diseño dice Ceibal 2026',
      { type: 'confirmation' }
    );
    assert.ok(next.deliveryDate);
    assert.notEqual(next.deliveryDate, collected.deliveryDate);
    assert.match(String(next.notes), /Ceibal 2026/i);
    assert.equal(next.clientName, 'Laissmachado - ig');
    assert.equal(next.items?.[0]?.productName, 'Canguro felpa rojo XL');
    assert.equal(next.items?.[0]?.productId, 'sku-1');
    assert.equal(next.amount, 1550);
    assert.equal(next.paid, true);
  });
});

describe('TEST — opciones compactas', () => {
  it('lista de productos usa 1. 2. 3. y Ninguno de estos, sin internals', () => {
    const text = formatProductChoices(
      [
        { nombre: 'Canguro felpa rojo XL', score: 88 },
        { nombre: 'Canguro algodón rojo XL', score: 84 },
        { nombre: 'Canguro frisa rojo XL', score: 83 },
      ],
      'canguro XL rojo',
      { allowCreate: true, hasMore: true }
    );
    assert.match(text, /\*Encontré estas opciones\*/);
    assert.match(text, /^1\. Canguro felpa rojo XL$/m);
    assert.match(text, /^2\. Canguro algodón rojo XL$/m);
    assert.match(text, /^3\. Canguro frisa rojo XL$/m);
    assert.match(text, /^4\. Ninguno de estos$/m);
    assert.match(text, /¿Cuál querés\?/);
    assert.doesNotMatch(text, /Cómo responder/);
    assert.doesNotMatch(text, /mismo color y talle/);
    assert.doesNotMatch(text, /Crear nuevo/);
    assert.doesNotMatch(text, /Ítem 1 de/);
    assert.doesNotMatch(text, /\n\n/);
  });

  it('lista de clientes máximo 3, sin texto de matcher', () => {
    const text = formatClientChoices(
      [
        { nombre: 'Laissmachado - ig', score: 92 },
        { nombre: 'Laiss Machado', score: 80 },
      ],
      'Laissmachado - ig',
      { allowCreate: true }
    );
    assert.match(text, /\*Encontré 2 clientes\*/);
    assert.match(text, /^1\. Laissmachado - ig$/m);
    assert.match(text, /¿Cuál es\?/);
    assert.doesNotMatch(text, /Registrar nuevo/);
    assert.doesNotMatch(text, /Cómo responder/);
  });

  it('el cobro relacionado se lee Venta / Pago / saldo', () => {
    const lines = formatOrderFinanceLines(
      planRelatedOrderFinance({ amount: 1550, paid: true, sourceText: LAISS })
    ).join('\n');
    assert.match(lines, /Venta: \$1\.550/);
    assert.match(lines, /Pago: \$1\.550 → saldo \$0/);
    assert.doesNotMatch(lines, /Cobro:/);
  });
});
