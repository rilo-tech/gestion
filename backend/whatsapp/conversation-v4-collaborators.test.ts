import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildToolRegistry,
  buildToolRegistryForTenant,
  getToolByName,
  listCollaboratorToolNames,
} from './agent/tool-registry.ts';
import { executeReadToolCall, prepareWriteToolCalls } from './agent/tool-executor.ts';
import { READ_TOOL_HANDLERS } from './agent/tools/read-tools.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { presentCollaboratorList, presentCollaboratorBalance } from './agent/agent-presenter.ts';
import {
  buildCandidateSelectionState,
  inferEntityTypeFromTool,
  resolveCandidateSelectionTurn,
} from './v4-candidate-selection.ts';
import { shouldCancelFrozenPlan, shouldExecuteFrozenPlan, shouldInviteConfirmEdit } from './v4-confirm.ts';
import { V4_CONFIRM_INTENT } from './v4-confirm.ts';
import { planAllowsAutoCommit, presentAutoCommittedPlan } from './v4-auto-commit.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-collab',
  phone: '+59899123456',
  role: 'admin',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const ctx: ToolExecutionContext = {
  tenant,
  state: {
    businessId: 'biz-collab',
    phone: '+59899123456',
    updatedAt: new Date().toISOString(),
  },
  rawUserMessage: 'Dame la lista de mis colaboradores',
};

describe('RILO Bot v4 collaborators registry', () => {
  it('includes collaborator tools when module gate is enabled', () => {
    const names = listCollaboratorToolNames(
      buildToolRegistry({
        collaboratorsEnabled: true,
        collaboratorsCanRead: true,
        collaboratorsCanWrite: true,
      })
    );
    assert.ok(names.includes('register_collaborator_hours'));
    assert.ok(names.includes('register_collaborator_extra'));
    assert.ok(names.includes('update_collaborator_movement'));
    assert.ok(names.includes('get_collaborator_balance'));
  });

  it('excludes collaborator tools when module gate is disabled', () => {
    const names = listCollaboratorToolNames(
      buildToolRegistry({ collaboratorsEnabled: false, collaboratorsCanRead: false, collaboratorsCanWrite: false })
    );
    assert.equal(names.length, 0);
  });

  it('list_collaborators uses strict handler contract', async () => {
    const original = READ_TOOL_HANDLERS.list_collaborators;
    READ_TOOL_HANDLERS.list_collaborators = async () => ({
      items: [
        { id: 'c1', name: 'Ana Pérez', modalidad: 'por_hora', activo: true },
        { id: 'c2', name: 'Juan Silva', modalidad: 'fijo', activo: true },
      ],
      total: 2,
      hasMore: false,
      activeCount: 2,
    });
    try {
      const registry = buildToolRegistry({
        collaboratorsEnabled: true,
        collaboratorsCanRead: true,
        collaboratorsCanWrite: true,
      });
      const result = await executeReadToolCall(
        { id: '1', name: 'list_collaborators', arguments: { query: null, active: true, modalidad: null, limit: null, offset: null } },
        ctx,
        registry
      );
      assert.equal(result.ok, true);
      assert.equal(result.name, 'list_collaborators');
      const reply = presentCollaboratorList(result.output);
      assert.match(reply, /Colaboradores/);
      assert.match(reply, /Ana Pérez/);
      assert.match(reply, /2 colaboradores activos/);
    } finally {
      READ_TOOL_HANDLERS.list_collaborators = original;
    }
  });

  it('find_collaborator maps to collaborator entity type for ambiguity', () => {
    assert.equal(inferEntityTypeFromTool('find_collaborator'), 'collaborator');
    const patch = buildCandidateSelectionState({
      entityType: 'collaborator',
      options: [
        { index: 1, entityId: 'c1', label: 'Ana Pérez · Por hora' },
        { index: 2, entityId: 'c2', label: 'Ana López · Fijo' },
      ],
      resume: { originalUserText: 'Buscame a Ana', blockedTool: 'find_collaborator' },
    });
    assert.equal(patch.pendingIntent, 'awaiting:candidate_selection');
    const resolution = resolveCandidateSelectionTurn('2', {
      type: 'candidate_selection',
      entityType: 'collaborator',
      options: [
        { index: 1, entityId: 'c1', label: 'Ana Pérez · Por hora' },
        { index: 2, entityId: 'c2', label: 'Ana López · Fijo' },
      ],
      resume: { originalUserText: 'Buscame a Ana', blockedTool: 'find_collaborator' },
    });
    assert.equal(resolution.kind, 'selected');
    if (resolution.kind === 'selected') {
      assert.equal(resolution.option.entityId, 'c2');
    }
  });
});

describe('RILO Bot v4 collaborator write plan', () => {
  it('create_collaborator prepares confirmation plan without executing', async () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: true,
      collaboratorsCanRead: true,
      collaboratorsCanWrite: true,
    });
    const originalPrepare = registry.find((row) => row.name === 'create_collaborator')?.prepare;
    assert.ok(originalPrepare);
    const stubPrepare = async () => ({
      tool: 'create_collaborator',
      label: 'Agregar colaborador · Ana Pérez',
      args: { name: 'Ana Pérez' },
      summaryTitle: 'Agregar colaborador',
      summaryLines: ['• Nombre: Ana Pérez'],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'create_collaborator' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [{ id: 'w1', name: 'create_collaborator', arguments: { name: 'Ana Pérez', telefono: null, email: null, notas: null, modalidad: null, valorHora: null, montoFijoPeriodo: null, periodoReferencia: null } }],
      ctx,
      stubRegistry
    );
    assert.equal(plan.summary.title, 'Agregar colaborador');
    assert.deepEqual(plan.summary.lines, ['• Nombre: Ana Pérez']);
    assert.equal(plan.writes.length, 1);
    assert.equal(getToolByName('create_collaborator', stubRegistry)?.mode, 'write');
  });

  it('register_collaborator_hours prepares confirmation with ERP preview fields', async () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: true,
      collaboratorsCanRead: true,
      collaboratorsCanWrite: true,
      collaboratorsCanWriteHours: true,
      collaboratorsCanWritePayments: true,
    });
    const stubPrepare = async () => ({
      tool: 'register_collaborator_hours',
      label: 'Registrar 10 h · Flor Silva',
      args: {
        colaboradorId: 'c-flor',
        collaboratorName: 'Flor Silva',
        date: '2026-08-31',
        hours: 10,
        generatedAmount: 5000,
        estimatedBalance: 12000,
        movementBody: { colaboradorId: 'c-flor', tipo: 'horas', fecha: '2026-08-31', horas: 10, monto: 5000 },
      },
      summaryTitle: 'Registrar horas',
      summaryLines: [
        '• Colaborador: Flor Silva',
        '• Fecha: 31/08/2026',
        '• Horas: 10',
        '• Importe generado: $5.000',
        '• Nuevo saldo estimado: $12.000',
      ],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'register_collaborator_hours' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [
        {
          id: 'w-hours',
          name: 'register_collaborator_hours',
          arguments: {
            collaboratorId: null,
            query: 'Flor Silva',
            targetReference: null,
            date: '2026-08-31',
            hours: 10,
            horaDesde: null,
            horaHasta: null,
            valorHora: null,
            hourlyRate: null,
            valuationMode: null,
            notes: null,
          },
        },
      ],
      { ...ctx, rawUserMessage: 'registra 10hs hoy para Flor Silva' },
      stubRegistry
    );
    assert.equal(plan.summary.title, 'Registrar horas');
    assert.match(plan.summary.lines.join('\n'), /Flor Silva/);
    assert.match(plan.summary.lines.join('\n'), /10/);
  });

  it('register_collaborator_hours unvalued plan shows Sin valorar', async () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: true,
      collaboratorsCanRead: true,
      collaboratorsCanWrite: true,
      collaboratorsCanWriteHours: true,
      collaboratorsCanWritePayments: true,
    });
    const stubPrepare = async () => ({
      tool: 'register_collaborator_hours',
      label: 'Registrar 10 h · Flor Silva',
      args: {
        colaboradorId: 'c-flor',
        collaboratorName: 'Flor Silva',
        date: '2026-08-31',
        hours: 10,
        valuationMode: 'unvalued',
        generatedAmount: null,
        movementBody: {
          colaboradorId: 'c-flor',
          tipo: 'horas',
          fecha: '2026-08-31',
          horas: 10,
          valuationMode: 'unvalued',
        },
      },
      summaryTitle: 'Registrar horas',
      summaryLines: [
        '• Colaborador: Flor Silva',
        '• Fecha: 31/08/2026',
        '• Horas: 10',
        '• Importe: Sin valorar',
      ],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'register_collaborator_hours' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [
        {
          id: 'w-unvalued',
          name: 'register_collaborator_hours',
          arguments: {
            collaboratorId: null,
            query: 'Flor Silva',
            targetReference: null,
            date: '2026-08-31',
            hours: 10,
            horaDesde: null,
            horaHasta: null,
            valorHora: null,
            hourlyRate: null,
            valuationMode: 'unvalued',
            notes: null,
          },
        },
      ],
      { ...ctx, rawUserMessage: 'registra 10hs hoy para Flor Silva sin importe' },
      stubRegistry
    );
    assert.match(plan.summary.lines.join('\n'), /Sin valorar/);
    assert.doesNotMatch(plan.summary.lines.join('\n'), /Importe generado/);
  });

  it('register_collaborator_extra plan adds to balance instead of subtracting', async () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: true,
      collaboratorsCanRead: true,
      collaboratorsCanWrite: true,
      collaboratorsCanWriteHours: true,
      collaboratorsCanWritePayments: true,
    });
    const stubPrepare = async () => ({
      tool: 'register_collaborator_extra',
      label: 'Extra $100 · Victoria Airala',
      args: {
        colaboradorId: 'c-victoria',
        collaboratorName: 'Victoria Airala',
        date: '2026-09-02',
        amount: 100,
        extraTipo: 'reparto',
        extraTipoLabel: 'Reparto',
        concept: '2 envíos a Jenni',
        currentBalance: 1440,
        estimatedBalance: 1540,
        movementBody: {
          colaboradorId: 'c-victoria',
          tipo: 'extra',
          fecha: '2026-09-02',
          monto: 100,
          extraTipo: 'reparto',
          concepto: '2 envíos a Jenni',
        },
      },
      summaryTitle: 'Registrar extra a colaborador',
      summaryLines: [
        '• Colaborador: Victoria Airala',
        '• Importe: $100',
        '• Tipo: Reparto',
        '• Concepto: 2 envíos a Jenni',
        '• Saldo actual: $1.440',
        '• Nuevo saldo estimado: $1.540',
      ],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'register_collaborator_extra' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [
        {
          id: 'w-extra',
          name: 'register_collaborator_extra',
          arguments: {
            collaboratorId: null,
            query: 'Victoria Airala',
            targetReference: null,
            date: '2026-09-02',
            amount: 100,
            extraTipo: 'reparto',
            concept: '2 envíos a Jenni',
            notes: null,
          },
        },
      ],
      { ...ctx, rawUserMessage: 'Victoria Airala 2 envios $100 a Jenni' },
      stubRegistry
    );
    assert.equal(plan.summary.title, 'Registrar extra a colaborador');
    assert.match(plan.summary.lines.join('\n'), /Victoria Airala/);
    assert.match(plan.summary.lines.join('\n'), /Nuevo saldo estimado: \$1\.540/);
    assert.doesNotMatch(plan.summary.lines.join('\n'), /después del pago/i);
  });

  it('update_collaborator_movement zero rate shows $0/h in confirmation', async () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: true,
      collaboratorsCanRead: true,
      collaboratorsCanWrite: true,
      collaboratorsCanWriteHours: true,
      collaboratorsCanWritePayments: true,
    });
    const stubPrepare = async () => ({
      tool: 'update_collaborator_movement',
      label: 'Modificar horas · Flor Silva',
      args: {
        movementId: 'mov-flor-31',
        colaboradorId: 'c-flor',
        collaboratorName: 'Flor Silva',
        date: '2026-08-31',
        hours: 10,
        valorHora: 0,
        valuationMode: 'explicit_rate',
        generatedAmount: 0,
        previousValorHora: 150,
        previousGeneratedAmount: 1500,
        previousUnvalued: false,
        movementBody: {
          colaboradorId: 'c-flor',
          tipo: 'horas',
          fecha: '2026-08-31',
          horas: 10,
          valorHora: 0,
          valuationMode: 'explicit_rate',
        },
      },
      summaryTitle: '👷 Modificar horas · Flor Silva',
      summaryLines: [
        '• Fecha: 31/08/2026',
        '• Importe actual: $1.500',
        '• Horas: 10',
        '• Valor hora actual: $150/h',
        '• Nuevo valor hora: *$0/h*',
        '• Nuevo importe: *$0*',
      ],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'update_collaborator_movement' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [
        {
          id: 'w-update-rate',
          name: 'update_collaborator_movement',
          arguments: {
            movementId: null,
            collaboratorId: null,
            query: 'Flor Silva',
            targetReference: null,
            date: '2026-08-31',
            hours: null,
            hourlyRate: 0,
            amount: null,
            horaDesde: null,
            horaHasta: null,
            valorHora: null,
            valuationMode: 'explicit_rate',
            notes: null,
            activo: null,
          },
        },
      ],
      { ...ctx, rawUserMessage: 'poné el valor hora en cero para Flor el 31/08' },
      stubRegistry
    );
    assert.match(plan.summary.title ?? '', /Modificar horas · Flor Silva/);
    assert.match(plan.summary.lines.join('\n'), /\$0\/h/);
    assert.match(plan.summary.lines.join('\n'), /\*\$0\*/);
  });

  it('get_collaborator_balance presenter separates unvalued hours', () => {
    const reply = presentCollaboratorBalance({
      status: 'resolved',
      name: 'Flor Silva',
      devengadoLifetime: 2000,
      pagadoLifetime: 500,
      saldoAcumulado: 1500,
      valuedHoursPeriodo: 20,
      unvaluedHoursPeriodo: 10,
      unvaluedHoursLifetime: 10,
      hasUnvaluedHours: true,
    });
    assert.match(reply, /Horas sin valorar: 10 h/);
    assert.match(reply, /Saldo pendiente/);
    assert.match(reply, /pendientes de valoración/);
  });

  it('exact No invites edit on frozen collaborator plan; cancelá cancels', () => {
    const plan = buildAgentOperationPlan(
      [{ tool: 'create_collaborator', label: 'Agregar colaborador · Ana Pérez', args: { name: 'Ana Pérez' } }],
      'Agregá a Ana Pérez'
    );
    assert.equal(shouldExecuteFrozenPlan(V4_CONFIRM_INTENT, 'Sí'), true);
    assert.equal(shouldInviteConfirmEdit(V4_CONFIRM_INTENT, 'No'), true);
    assert.equal(shouldCancelFrozenPlan(V4_CONFIRM_INTENT, 'No'), false);
    assert.equal(shouldCancelFrozenPlan(V4_CONFIRM_INTENT, 'cancelá'), true);
    assert.equal(shouldExecuteFrozenPlan(V4_CONFIRM_INTENT, 'No'), false);
    assert.ok(plan.planId);
  });
});

describe('RILO Bot v4 collaborator auto-commit', () => {
  it('horas, extras y rename permiten auto-commit; pagos y caja no', () => {
    assert.equal(
      planAllowsAutoCommit(
        buildAgentOperationPlan(
          [{ tool: 'register_collaborator_hours', label: 'h', args: { hours: 24 } }],
          'horas'
        )
      ),
      true
    );
    assert.equal(
      planAllowsAutoCommit(
        buildAgentOperationPlan(
          [{ tool: 'register_collaborator_extra', label: 'e', args: { amount: 500 } }],
          'extra'
        )
      ),
      true
    );
    assert.equal(
      planAllowsAutoCommit(
        buildAgentOperationPlan(
          [{ tool: 'rename_products', label: 'r', args: { productIds: ['a'], newBaseName: 'X' } }],
          'rename'
        )
      ),
      true
    );
    assert.equal(
      planAllowsAutoCommit(
        buildAgentOperationPlan(
          [{ tool: 'register_collaborator_payment', label: 'p', args: { amount: 500 } }],
          'pago'
        )
      ),
      false
    );
    assert.equal(
      planAllowsAutoCommit(
        buildAgentOperationPlan(
          [{ tool: 'register_cash_movement', label: 'c', args: { amount: 100 } }],
          'caja'
        )
      ),
      false
    );
  });

  it('presentAutoCommittedPlan muestra resumen sin Confirmo', () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_collaborator_hours',
          label: 'Registrar 24 h · Flor Silva',
          args: {
            colaboradorId: 'c-flor',
            collaboratorName: 'Flor Silva',
            hours: 24,
            date: '2026-09-03',
          },
          summaryTitle: 'Registrar horas',
          summaryLines: [
            '• Colaborador: Flor Silva',
            '• Fecha: 03/09',
            '• Horas: 24',
            '• Importe: Sin valorar',
          ],
        },
      ],
      'Registra 24hs para Florencia en fecha 03/09'
    );
    const text = presentAutoCommittedPlan(plan);
    assert.match(text, /Horas registradas/);
    assert.match(text, /Flor Silva/);
    assert.match(text, /24/);
    assert.match(text, /Si querés hacer algún otro cambio, decime/);
    assert.doesNotMatch(text, /¿Confirmo\?/);
  });

  it('handleV4 auto-ejecuta horas sin pedirse Sí', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_collaborator_hours',
          label: 'Registrar 24 h · Flor Silva',
          args: {
            colaboradorId: 'c-flor',
            collaboratorName: 'Flor Silva',
            hours: 24,
            date: '2026-09-03',
            movementBody: { colaboradorId: 'c-flor', tipo: 'horas', fecha: '2026-09-03', horas: 24 },
          },
          summaryTitle: 'Registrar horas',
          summaryLines: [
            '• Colaborador: Flor Silva',
            '• Fecha: 03/09',
            '• Horas: 24',
            '• Importe: Sin valorar',
          ],
        },
      ],
      'Registra 24hs para Florencia en fecha 03/09'
    );

    let executed = false;
    let savedPatch: Record<string, unknown> | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'Registra 24hs para Florencia en fecha 03/09', messageId: 'h1' },
        text: 'Registra 24hs para Florencia en fecha 03/09',
        state: {
          businessId: tenant.businessId,
          phone: tenant.phone,
          updatedAt: new Date().toISOString(),
        },
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) => {
          savedPatch = patch as Record<string, unknown>;
          return {
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          };
        },
        appendTurns: async () => {},
        assertAi: async () => {},
        tryOnboarding: async () => ({ kind: 'skip' as const }),
        createAgent: () =>
          ({
            runTurn: async () => ({
              reply: '¿Confirmo? Sí / No',
              executed: false,
              intent: 'confirm_v4',
              operationPlan: plan,
              statePatch: {
                pendingIntent: V4_CONFIRM_INTENT,
                operationPlan: plan as unknown as Record<string, unknown>,
              },
            }),
          }) as never,
        executePlan: async () => {
          executed = true;
          return {
            reply: 'Listo. Registré *24 h* el *03/09/2026* para *Flor Silva*.',
            data: { collaboratorId: 'c-flor', kind: 'collaborator_hours' },
          };
        },
      }
    );

    assert.equal(executed, true);
    assert.equal(result.executed, true);
    assert.equal(result.intent, 'v4_auto_commit');
    assert.match(result.reply, /Registré/);
    assert.match(result.reply, /03\/09\/2026/);
    assert.match(result.reply, /Si querés hacer algún otro cambio, decime/);
    assert.doesNotMatch(result.reply, /¿Confirmo\?/);
    assert.equal(savedPatch?.pendingIntent ?? null, null);
  });
});

describe('RILO Bot v4 collaborator tenant registry', () => {
  it('buildToolRegistryForTenant resolves without throwing for test tenant', async () => {
    const registry = await buildToolRegistryForTenant(tenant);
    assert.ok(Array.isArray(registry));
  });
});
