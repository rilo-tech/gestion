import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideCatalogMatch,
  pageChoicePool,
  presentFamilyVariantMissing,
  signalsFromItem,
} from './catalog-rank.ts';
import { ensureSingleListAsk as ensureAsk, WA_LIST_ASK_PRODUCT } from '../../shared/whatsapp-visual.ts';
import { appendListAskIfNumberedResults } from './v4-whatsapp-present.ts';

const poloDryFamily = [
  { id: 'l', nombre: 'Remera Polo Dry Negro L', score: 70 },
  { id: 'm', nombre: 'Remera Polo Dry Negro M', score: 70 },
  { id: 'xl', nombre: 'Remera Polo Dry Negro XL', score: 70 },
  { id: 'xs', nombre: 'Remera Polo Dry Negro XS', score: 70 },
  { id: 'xxl', nombre: 'Remera Polo Dry Negro XXL', score: 70 },
];

const distractors = [
  { id: 'cool', nombre: 'Camiseta Dry Cool Negro S', score: 80 },
  { id: 'dama', nombre: 'Camiseta Dry Dama Negro S', score: 78 },
  { id: 'algo', nombre: 'Remera Polo Algodón Negro S', score: 76 },
];

describe('catalog hierarchical match', () => {
  it('A) exact Remera Polo Dry Negro L → unique', () => {
    const decision = decideCatalogMatch(
      [...poloDryFamily, ...distractors],
      signalsFromItem({ rawText: 'Remera Polo Dry Negro L', productHint: 'Remera Polo Dry Negro L' }),
      'Remera Polo Dry Negro L'
    );
    assert.equal(decision.status, 'unique');
    if (decision.status === 'unique') {
      assert.match(decision.item.nombre, /Remera Polo Dry Negro L/i);
      assert.ok(decision.kind === 'EXACT' || decision.kind === 'HIGH_CONFIDENCE');
    }
  });

  it('B) missing S → FAMILY_MATCH_VARIANT_MISSING same family only', () => {
    const signals = signalsFromItem({
      rawText: 'Remera Polo Dry Negro S',
      productHint: 'Remera Polo Dry Negro S',
    });
    assert.equal(signals.type, 'remera');
    assert.ok(signals.models?.includes('polo'));
    assert.equal(signals.fabric, 'dry');
    assert.equal(signals.color, 'negro');
    assert.equal(signals.size, 'S');

    const decision = decideCatalogMatch([...poloDryFamily, ...distractors], signals, 'Remera Polo Dry Negro S');
    assert.equal(decision.status, 'ambiguous');
    if (decision.status === 'ambiguous') {
      assert.equal(decision.kind, 'FAMILY_MATCH_VARIANT_MISSING');
      assert.equal(decision.missingVariant, 'S');
      for (const row of [...decision.options, ...decision.rest]) {
        assert.match(row.nombre, /Remera Polo Dry Negro/i);
        assert.doesNotMatch(row.nombre, /Camiseta|Algodón|Cool|Dama/i);
      }
      assert.ok(!decision.options.some((row) => /Camiseta Dry Cool/i.test(row.nombre)));
    }
  });

  it('C) Ver más stays inside family pool', () => {
    const signals = signalsFromItem({
      rawText: 'Remera Polo Dry Negro S',
      productHint: 'Remera Polo Dry Negro S',
    });
    const decision = decideCatalogMatch([...poloDryFamily, ...distractors], signals, 'Remera Polo Dry Negro S');
    assert.equal(decision.status, 'ambiguous');
    if (decision.status !== 'ambiguous') return;
    const pool = [...decision.options, ...decision.rest];
    const page1 = pageChoicePool(pool, 0, 3);
    const page2 = pageChoicePool(pool, 3, 3);
    assert.equal(page1.shown.length, 3);
    assert.ok(page2.shown.length >= 1);
    for (const row of [...page1.shown, ...page2.shown]) {
      assert.match(row.nombre, /Remera Polo Dry Negro/i);
    }
  });

  it('gris melange en remito → color gris, sin tela melange', () => {
    const signals = signalsFromItem({
      rawText: 'CAMISETA GRIS MELANGE S',
      productHint: 'CAMISETA GRIS MELANGE S',
      attributes: { type: 'camiseta', color: 'gris melange', size: 'S', fabric: 'melange' },
    });
    assert.equal(signals.color, 'gris');
    assert.equal(signals.fabric, null);
    assert.equal(signals.size, 'S');
    assert.equal(signals.type, 'camiseta');

    const pool = [
      { id: 'algo-s', nombre: 'Camiseta algodón Gris S', color: 'Gris', talle: 'S', score: 50 },
      { id: 'polo-l', nombre: 'Remera Polo Algodón M/Larga Gris L', color: 'Gris', talle: 'L', score: 50 },
      { id: 'dry-s', nombre: 'Camiseta dry cool Gris S', color: 'Gris', talle: 'S', score: 50 },
    ];
    const decision = decideCatalogMatch(pool, signals, 'CAMISETA GRIS MELANGE S');
    // Con color+talle+tipo, debe priorizar camiseta talle S (no polo L).
    assert.ok(decision.status === 'unique' || decision.status === 'ambiguous');
    if (decision.status === 'unique') {
      assert.match(decision.item.nombre, /Camiseta algodón Gris S/i);
    } else if (decision.status === 'ambiguous') {
      assert.ok(decision.options.every((row) => /Camiseta/i.test(row.nombre)));
      assert.ok(decision.options.every((row) => row.talle === 'S' || /\bS\b/i.test(row.nombre)));
    }
  });

  it('D) Remera Polo Algodón ≠ Dry', () => {
    const decision = decideCatalogMatch(
      [...poloDryFamily, ...distractors],
      signalsFromItem({
        rawText: 'Remera Polo Algodón Negro S',
        productHint: 'Remera Polo Algodón Negro S',
      }),
      'Remera Polo Algodón Negro S'
    );
    if (decision.status === 'unique') {
      assert.match(decision.item.nombre, /Algodón/i);
    } else if (decision.status === 'ambiguous') {
      assert.ok(decision.options.every((row) => /Algodón/i.test(row.nombre) || !/Dry(?!\s)/i.test(row.nombre)));
      assert.ok(!decision.options.some((row) => /Remera Polo Dry/i.test(row.nombre)));
    }
  });

  it('E) dri typo → Dry XL', () => {
    const signals = signalsFromItem({
      rawText: 'remera polo dri negro xl',
      productHint: 'remera polo dri negro xl',
    });
    assert.equal(signals.fabric, 'dry');
    const decision = decideCatalogMatch([...poloDryFamily, ...distractors], signals, 'remera polo dri negro xl');
    assert.equal(decision.status, 'unique');
    if (decision.status === 'unique') {
      assert.match(decision.item.nombre, /Remera Polo Dry Negro XL/i);
    }
  });

  it('F) una sola frase Indicame producto', () => {
    const body = presentFamilyVariantMissing({
      queryLabel: 'Remera Polo Dry Negro S',
      familyLabel: 'Remera Polo Dry Negro',
      missingVariant: 'S',
      options: poloDryFamily.slice(0, 3).map((row) => ({ name: row.nombre })),
      hasMore: true,
    });
    const withAsk = ensureAsk(`${body}\n\n${WA_LIST_ASK_PRODUCT}\n\nIndicame qué ítem querés usar o qué querés hacer.`, 'product');
    const outbound = appendListAskIfNumberedResults(withAsk);
    const matches = outbound.match(/Si no es ninguno|Indicame qué /g) ?? [];
    assert.equal(matches.length, 1, outbound);
    assert.match(outbound, /Si no es ninguno, indicame el nombre con el que está guardado/);
    assert.equal((outbound.match(/Si no es ninguno/g) ?? []).length, 1);
  });

  it('G) sin más resultados no ofrece Ver más', () => {
    const pool = poloDryFamily.slice(0, 2);
    const page = pageChoicePool(pool, 0, 3);
    assert.equal(page.rest.length, 0);
  });
});
