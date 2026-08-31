import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactWhatsappText,
  formatChoiceMessage,
  formatWhatsappMessage,
  formatWhatsappResponse,
  renderListPage,
  splitWhatsappMessages,
  WA_FORBIDDEN_PAGER_PHRASES,
  WA_PRESENT,
} from '../../shared/whatsapp-format.ts';
import { numberedOptionItems, presentSimple, transactionViewFor } from './whatsapp-present.ts';

function pagesHaveFullItems(pages: string[], items: string[]): void {
  const joined = pages.join('\n');
  for (const item of items) {
    assert.ok(joined.includes(item), `item ausente: ${item}`);
  }
}

describe('presentación WhatsApp', () => {
  it('pedido de 2 items: un mensaje corto', () => {
    const view = transactionViewFor('create_order', {
      clientName: 'Yovana',
      items: [
        { quantity: 1, rawText: 'Dry Cool blanca L', productName: 'Dry Cool blanca L' },
        { quantity: 1, rawText: 'Dry Cool negra XL', productName: 'Dry Cool negra XL' },
      ],
      deliveryDate: '2026-08-29',
    });
    assert.ok(view);
    const { pages } = formatWhatsappResponse(view!);
    assert.equal(pages.length, 1);
    assert.match(pages[0]!, /\*Pedido a Yovana\*/);
    assert.match(pages[0]!, /¿Confirmo\?/);
    assert.ok(pages[0]!.length < 500);
  });

  it('pedido de 15 items: varios mensajes, pregunta solo al final, ningún item cortado', () => {
    const items = Array.from({ length: 15 }, (_, index) => ({
      quantity: 1,
      rawText: `Prenda ${index + 1} extra larga para no cortar`,
      productName: `Prenda ${index + 1} extra larga para no cortar`,
    }));
    const view = transactionViewFor('create_order', {
      clientName: 'Yovana',
      items,
      deliveryDate: '2026-08-29',
      listWantAll: true,
    });
    const { pages } = formatWhatsappResponse(view!);
    assert.ok(pages.length >= 2);
    const bullets = items.map((item) => `• ${item.productName}`);
    pagesHaveFullItems(pages, bullets);
    for (const page of pages.slice(0, -1)) {
      assert.doesNotMatch(page, /¿Confirmo\?/);
    }
    assert.match(pages[pages.length - 1]!, /¿Confirmo\?/);
    assert.match(pages[0]!, /1\/\d/);
  });

  it('listado de 25 productos: paginado en exploración (primera página corta)', () => {
    const items = Array.from({ length: 25 }, (_, index) => `${index + 1}. Producto ${index + 1}`);
    const { pages, listContext } = formatWhatsappResponse({
      kind: 'explore',
      title: 'Productos encontrados',
      items,
    });
    assert.equal(pages.length, 1);
    assert.equal(pages[0]!.split('\n').filter((line) => /^\d+\./.test(line.trim())).length, WA_PRESENT.explorePageSize);
    assert.equal(listContext?.totalResults, 25);
    assert.equal(listContext?.sentAll, false);
    const all = formatWhatsappResponse({ kind: 'explore', title: 'Productos encontrados', items, wantAll: true });
    assert.ok(all.pages.length >= 3);
    pagesHaveFullItems(all.pages, items);
  });

  it('selección de 12 productos conserva numeración', () => {
    const labels = Array.from({ length: 12 }, (_, index) => `Camiseta ${index + 1}`);
    const items = numberedOptionItems(labels);
    const pages = renderListPage({
      title: 'Opciones',
      items,
      currentPage: 1,
      pageSize: 6,
      wantAll: true,
    });
    assert.ok(pages.length >= 2);
    assert.match(pages[0]!, /^1\. /m);
    assert.match(pages.join('\n'), /^12\. /m);
    assert.match(pages.join('\n'), /6\. Camiseta 6/);
    assert.match(pages.join('\n'), /7\. Camiseta 7/);
  });

  it('respuesta simple no agrega títulos innecesarios', () => {
    const text = presentSimple('Juan te debe $500');
    assert.equal(text, 'Juan te debe $500');
    assert.doesNotMatch(text, /\*Saldo\*/);
    assert.doesNotMatch(text, /\*Resumen\*/);
  });

  it('ningún mensaje generado contiene Leer más / Ver más', () => {
    const items = Array.from({ length: 20 }, (_, index) => `• Ítem ${index + 1} completo`);
    const tx = formatWhatsappResponse({
      kind: 'transaction',
      title: 'Pedido',
      items,
      question: '¿Confirmo?',
      wantAll: true,
    });
    const explore = formatWhatsappResponse({
      kind: 'explore',
      title: 'Productos',
      items,
      wantAll: true,
    });
    for (const page of [...tx.pages, ...explore.pages]) {
      const lower = page.toLowerCase();
      for (const phrase of WA_FORBIDDEN_PAGER_PHRASES) {
        assert.equal(lower.includes(phrase), false, page);
      }
    }
  });

  it('el formatter central no deja líneas vacías entre opciones ni viñetas', () => {
    const messy = '*Título*\n\n\n1. Uno\n\n2. Dos\n\n\n¿Cuál?';
    const compact = compactWhatsappText(messy);
    assert.equal(compact, '*Título*\n1. Uno\n2. Dos\n¿Cuál?');
    const choice = formatChoiceMessage({
      title: 'Encontré estas opciones',
      options: ['Canguro felpa rojo XL', 'Canguro algodón rojo XL', 'Canguro frisa rojo XL'],
      noneLabel: 'Ninguno de estos',
    });
    assert.equal(
      choice,
      '*Encontré estas opciones*\n1. Canguro felpa rojo XL\n2. Canguro algodón rojo XL\n3. Canguro frisa rojo XL\n4. Ninguno de estos\n¿Cuál querés?'
    );
    const summary = formatWhatsappMessage({
      title: 'Pedido a Juan',
      lines: ['• 2 Dry Cool negras L', '• 1 Dry Cool blanca XL', '• 3 Algodón rojas M'],
      ask: '📅 ¿Para qué fecha es la entrega?',
    });
    assert.doesNotMatch(summary, /\n\n/);
    assert.match(summary, /📅 ¿Para qué fecha es la entrega\?/);
  });

  it('los mensajes largos se dividen antes de WhatsApp y no cortan viñetas', () => {
    const block = [
      '*Productos*',
      '',
      ...Array.from({ length: 12 }, (_, index) => `• Producto entero número ${index + 1} con detalle`),
    ].join('\n');
    const pages = splitWhatsappMessages(block, 180);
    assert.ok(pages.length >= 2);
    pagesHaveFullItems(
      pages,
      Array.from({ length: 12 }, (_, index) => `• Producto entero número ${index + 1} con detalle`)
    );
  });
});
