import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatV4Confirmation,
  formatV4InvalidCandidateSelection,
  V4_CANDIDATE_SELECTION_PROMPT,
  V4_CONFIRMATION_PROMPT,
} from './v4-ui-copy.ts';
import { presentConfirmationPlan, presentNumberedCandidateSelection } from './agent/agent-presenter.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';

describe('V4 UX copy — confirmación', () => {
  it('A: pendingPlan presentado contiene el cierre estándar', () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_cash_movement',
          label: 'Ingreso $1.000 · Zulma',
          args: { businessId: 'rilo', amount: 1000, concept: 'Zulma', direction: 'in' },
        },
      ],
      'ingreso 1000 zulma',
      'wa:test:cash'
    );
    plan.summary = { title: 'Ingreso $1.000 · Zulma', lines: [] };
    const card = presentConfirmationPlan(plan);
    assert.match(card, /¿Confirmo\? Sí \/ No/);
    assert.equal(V4_CONFIRMATION_PROMPT, '¿Confirmo? Sí / No');
  });

  it('formatV4Confirmation agrega siempre el cierre', () => {
    const card = formatV4Confirmation({
      title: 'Pedido #00229 → Entregado',
      lines: [],
    });
    assert.match(card, /Pedido #00229 → Entregado/);
    assert.match(card, /¿Confirmo\? Sí \/ No$/);
  });
});

describe('V4 UX copy — selección numerada', () => {
  const clients = [
    { id: 'a', name: 'Pizzería Acapella', telefono: '099111111' },
    { id: 'b', name: 'Acapella Eventos', local: 'Centro' },
    { id: 'c', name: 'Acapella Salto', telefono: '098222222' },
  ];

  it('B: candidate_selection muestra opciones numeradas', () => {
    const card = presentNumberedCandidateSelection('client', clients);
    assert.match(card, /^1\. Pizzería Acapella/m);
    assert.match(card, /\n2\. Acapella Eventos/);
    assert.match(card, /\n3\. Acapella Salto/);
  });

  it('C: candidate_selection contiene el copy obligatorio', () => {
    const card = presentNumberedCandidateSelection('client', clients);
    assert.match(card, /Respondeme con el número de la opción\./);
    assert.equal(V4_CANDIDATE_SELECTION_PROMPT, 'Respondeme con el número de la opción.');
  });

  it('títulos por tipo de entidad', () => {
    assert.match(presentNumberedCandidateSelection('client', clients), /Encontré más de un cliente/);
    assert.match(
      presentNumberedCandidateSelection('product', [{ id: 'p1', name: 'Remera' }]),
      /Encontré varias opciones/
    );
    assert.match(
      presentNumberedCandidateSelection('order', [
        { id: 'o1', number: '00229', statusLabel: 'Listo', total: 900 },
      ]),
      /Encontré varios pedidos/
    );
    assert.match(
      presentNumberedCandidateSelection('supplier', [{ id: 's1', name: 'Textil Norte' }]),
      /Encontré más de un proveedor/
    );
  });

  it('número inválido usa copy estándar', () => {
    assert.equal(
      formatV4InvalidCandidateSelection(3),
      'Esa opción no está en la lista. Respondeme con un número del 1 al 3.'
    );
  });
});
