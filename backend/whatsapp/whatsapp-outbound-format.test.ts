import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatWhatsappOutbound,
  formatWhatsappOutboundPages,
  presentV4WhatsappHandlerResult,
  presentV4WhatsappText,
} from './v4-whatsapp-present.ts';
import {
  presentCashBalance,
  presentClientBalanceFromToolOutput,
  presentClientList,
  presentConfirmationPlan,
  presentNumberedCandidateSelection,
  presentOrderListFromToolOutput,
  presentStock,
} from './agent/agent-presenter.ts';
import { agentErrorReply } from './agent/agent-errors.ts';
import { presentOrderQuery } from './conversation-query.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { formatV4InvalidCandidateSelection } from './v4-ui-copy.ts';

describe('formatWhatsappOutbound — payload Meta', () => {
  it('conserva *bold* nativo sin escapar', () => {
    const input = '*Saldo total de caja:* $27.908,73';
    const out = formatWhatsappOutbound(input);
    assert.equal(out, input);
    assert.doesNotMatch(out, /\\\*Saldo/);
  });

  it('convierte **bold** markdown a *bold* WhatsApp', () => {
    const out = formatWhatsappOutbound('**Pedido #00242**');
    assert.equal(out, '*Pedido #00242*');
    assert.doesNotMatch(out, /\*\*/);
  });

  it('convierte ** anidados en una pasada', () => {
    assert.equal(formatWhatsappOutbound('****Doble****'), '*Doble*');
  });

  it('deshace escapes \\* del LLM', () => {
    const out = formatWhatsappOutbound('\\*Cobrar $1.675\\* al pedido #00242');
    assert.equal(out, '*Cobrar $1.675* al pedido #00242');
    assert.doesNotMatch(out, /\\/);
  });

  it('elimina HTML y preserva negrita', () => {
    const out = formatWhatsappOutbound('<strong>Pedido #00242</strong>');
    assert.equal(out, '*Pedido #00242*');
    assert.doesNotMatch(out, /<[^>]+>/);
  });

  it('convierte __bold__ y <br> a formato WhatsApp', () => {
    assert.equal(formatWhatsappOutbound('__Total__'), '*Total*');
    assert.equal(formatWhatsappOutbound('Línea 1<br>Línea 2'), 'Línea 1\nLínea 2');
  });

  it('presentV4WhatsappText es alias idempotente', () => {
    const raw = '*Pedido #00242*';
    assert.equal(presentV4WhatsappText(raw), raw);
  });
});

describe('formatWhatsappOutboundPages — burbujas Meta-ready', () => {
  it('parte mensajes largos y conserva negrita en cada burbuja', () => {
    const long = `*${'Pedido '.repeat(40)}*`;
    const pages = formatWhatsappOutboundPages(long);
    assert.ok(pages.length >= 1);
    for (const page of pages) {
      assert.doesNotMatch(page, /\*\*|\\\*|<[^>]+>/);
    }
  });

  it('mantiene un resumen de compra típico (12 ítems) en una sola burbuja', () => {
    const lines = [
      '*🛒 Compra · Disershop*',
      ...Array.from(
        { length: 12 },
        (_, i) => `• ${i + 1} Producto ejemplo talle ${i} · $${(100 + i * 10).toFixed(2).replace('.', ',')}`
      ),
      '',
      'Neto $11.942,62 · IVA $2.627,38',
      '*Total $14.570*',
      '40 artículos',
    ];
    const pages = formatWhatsappOutboundPages(lines.join('\n'));
    assert.equal(pages.length, 1, pages.map((p) => p.split('\n').length).join(','));
    assert.match(pages[0]!, /Total \$14\.570/);
    assert.match(pages[0]!, /12 Producto ejemplo/);
  });

  it('formatea cada página cuando replies viene pre-partido', () => {
    const pages = formatWhatsappOutboundPages('', ['**Uno**', '\\*Dos\\*']);
    assert.deepEqual(pages, ['*Uno*', '*Dos*']);
  });
});

describe('V4 presenters — salida con *bold* para Meta', () => {
  it('caja multi-ámbito', () => {
    const text = presentCashBalance({
      saldo: 27908.73,
      byAmbito: [
        { label: 'Rilo', saldo: -22071.19 },
        { label: 'Personal', saldo: 49979.92 },
      ],
    });
    assert.match(text, /^\*💰 Saldo de caja\*/);
    assert.match(text, /• Rilo: -\$22\.071,19/);
    assert.match(text, /• Personal: \$49\.979,92/);
    assert.match(text, /• \*Total:\* \$27\.908,73/);
    assert.doesNotMatch(text, /\\\*|\*\*/);
  });

  it('detalle de pedido', () => {
    const text = presentOrderQuery({
      metric: 'details',
      label: '00242',
      clientName: 'Beta',
      statusLabel: 'Pendiente',
      total: 3350,
      saldo: 3350,
    });
    assert.match(text, /^\*Pedido #00242\*/);
    assert.match(text, /• Total: \*\$3\.350\*/);
    assert.match(text, /• Saldo: \*\$3\.350\*/);
  });

  it('listado de pedidos', () => {
    const text = presentOrderListFromToolOutput({
      status: 'ok',
      items: [
        {
          id: 'a',
          number: '00240',
          statusLabel: 'Pendiente',
          total: 1000,
          deliveryDate: '2026-09-01',
        },
        {
          id: 'b',
          number: '00241',
          statusLabel: 'Listo',
          total: 2000,
          deliveryDate: '2026-09-02',
        },
      ],
      total: 2,
      filter: { clientName: 'Beta' },
    });
    assert.match(text, /^\*Pedidos de Beta\*/);
    assert.match(text, /#00240/);
    assert.match(text, /#00241/);
    assert.doesNotMatch(text, /\*\*/);
  });

  it('detalle de deuda lista solo comprobantes con saldo e ítems', () => {
    const text = presentClientBalanceFromToolOutput({
      status: 'resolved',
      clientName: 'Natalia Silva - Nato',
      balance: 1850,
      pending: [
        {
          kind: 'venta',
          label: 'Venta #00251',
          detail: 'Venta mostrador',
          date: '2026-08-10',
          balance: 300,
          items: [{ name: 'Limpieza Vico', quantity: 1 }],
        },
        {
          kind: 'pedido',
          label: 'Pedido #00226',
          detail: 'listo',
          date: '2026-08-25',
          balance: 550,
          items: [{ name: 'Camiseta dry cool Niño Negro 10', quantity: 1 }],
        },
      ],
    });
    assert.match(text, /Natalia Silva - Nato/);
    assert.match(text, /1\.850/);
    assert.match(text, /Venta #00251/);
    assert.match(text, /Limpieza Vico/);
    assert.match(text, /Pedido #00226/);
    assert.match(text, /Camiseta dry cool Niño Negro 10/);
    assert.match(text, /Total pendiente/);
    assert.doesNotMatch(text, /#00087/);
  });

  it('detalle de pedidos lista cada ítem del ERP', () => {
    const text = presentOrderListFromToolOutput({
      status: 'ok',
      detail: true,
      clientBalance: 1850,
      filter: { clientName: 'Natalia Silva - Nato' },
      items: [
        {
          id: 'a',
          number: '00226',
          statusLabel: 'Listo',
          total: 550,
          balance: 550,
          deliveryDate: '2026-08-25',
          items: [{ name: 'Camiseta dry cool Niño Negro 10', quantity: 1 }],
        },
        {
          id: 'b',
          number: '00087',
          statusLabel: 'Entregado',
          total: 2490,
          balance: 0,
          items: [
            { name: 'Canguro felpa Azul M', quantity: 1 },
            { name: 'Taza AA Blanco', quantity: 5 },
            { name: 'Camiseta algodón Negro L', quantity: 2 },
          ],
        },
      ],
      total: 2,
    });
    assert.match(text, /Natalia Silva - Nato/);
    assert.match(text, /#00226/);
    assert.match(text, /Camiseta dry cool Niño Negro 10/);
    assert.match(text, /#00087/);
    assert.match(text, /Canguro felpa Azul M/);
    assert.match(text, /Taza AA Blanco/);
    assert.match(text, /Camiseta algodón Negro L/);
    assert.doesNotMatch(text, /3 productos/i);
  });

  it('clientes y stock', () => {
    const clients = presentClientList({
      items: [{ name: 'Acapella', telefono: '099111111' }],
      total: 1,
    });
    assert.match(clients, /^\*Clientes\*/);

    const stock = presentStock({ name: 'Buzo XL', stock: 12 });
    assert.match(stock, /^\*Buzo XL\*/);
    assert.match(stock, /Stock actual: \*12\*/);
  });

  it('confirmación con plan congelado', () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_order_payment',
          label: 'Cobrar $1.675 al pedido #00242',
          args: { businessId: 'rilo', orderId: 'o1', amount: 1675 },
        },
      ],
      'cobrar',
      'wa:test'
    );
    plan.summary = {
      title: 'Cobrar $1.675 al pedido #00242',
      lines: ['• Cobrar $1.675 al pedido #00242'],
    };
    const text = presentConfirmationPlan(plan);
    assert.match(text, /^\*Cobrar \$1\.675 al pedido #00242\*/);
    assert.match(text, /¿Confirmo\? \*Sí\* \/ \*No\*$/);
  });

  it('selección numerada', () => {
    const text = presentNumberedCandidateSelection('client', [
      { id: 'a', name: 'Pizzería Acapella' },
      { id: 'b', name: 'Acapella Eventos' },
    ]);
    assert.match(text, /^\*👥 Clientes encontrados\*/);
    assert.match(text, /1\. 👤 Pizzería Acapella/);
    assert.match(text, /Indicame qué ítem querés usar/);
  });

  it('error de selección inválida', () => {
    const text = formatV4InvalidCandidateSelection(3);
    assert.match(text, /Opción inválida\. Indicá un número del 1 al 3/);
    assert.doesNotMatch(text, /\*\*/);
  });
});

describe('presentV4WhatsappHandlerResult — hook global V4', () => {
  it('normaliza reply y replies antes de Meta', () => {
    const formatted = presentV4WhatsappHandlerResult({
      reply: '**Listo**',
      replies: ['**Página 1**', '\\*Página 2\\*'],
      intent: 'agent_v4',
      executed: false,
      businessId: 'rilo',
    });
    assert.equal(formatted.reply, '*Página 1*');
    assert.deepEqual(formatted.replies, ['*Página 1*', '*Página 2*']);
  });

  it('incluye páginas extra (ej. aviso de cuota) ya formateadas', () => {
    const formatted = presentV4WhatsappHandlerResult(
      {
        reply: '**Pedido**',
        intent: 'agent_v4',
        executed: false,
        businessId: 'rilo',
      },
      ['**Cuota**']
    );
    assert.deepEqual(formatted.replies, ['*Pedido*', '*Cuota*']);
  });
});

describe('Agent output simulado', () => {
  it('texto final del LLM pasa por formatter sin reinterpretar datos', () => {
    const llm = '**Pedido #00242**\n\n• Cliente: Beta\n• Total: **$3.350**';
    const out = formatWhatsappOutbound(llm);
    assert.match(out, /^\*Pedido #00242\*/);
    assert.match(out, /• Total: \*\$3\.350\*/);
    assert.match(out, /• Cliente: Beta/);
  });

  it('errores del agente no agregan markdown ajeno', () => {
    const err = agentErrorReply(new Error('No encontré ese pedido.'));
    assert.equal(formatWhatsappOutbound(err), err);
  });
});

describe('Puerta final Meta (sendWhatsappText)', () => {
  it('el body que iría a Meta conserva * sin backslash', () => {
    const payload = formatWhatsappOutbound('**Cobrar $1.675** al pedido #00242');
    assert.equal(payload, '*Cobrar $1.675* al pedido #00242');
    assert.doesNotMatch(payload, /\\\*|\*\*|<[^>]+>/);
  });
});
