import { getBusiness, resolveForBusiness } from '../../../auth/business.ts';
import {
  assertActionAvailable,
  buildAutomationCategoryMenus,
  createAutomation,
  formatAutomationConfirmation,
  formatAvailableActionsMenu,
  formatCategoryActionsMenu,
  getAutomation,
  getAutomationAction,
  listAutomations,
  setAutomationStatus,
  summarizeAutomation,
  updateAutomation,
} from '../../../automation/index.ts';
import type { AutomationAvailabilityContext } from '../../../automation/automation-availability.ts';
import type {
  AutomationActionId,
  AutomationType,
} from '../../../../shared/automation-types.ts';
import { resolveBusinessProfile } from '../../../../shared/business-profile.ts';
import { productIdFromAccess } from '../../../../shared/platform-access.ts';
import { emptyModulesMap } from '../../../../shared/subscription-modules.ts';
import type { ToolDefinition, ToolExecutionContext } from '../tool-types.ts';
import {
  nArray,
  nBoolean,
  nInteger,
  nNumber,
  nString,
  reqString,
  strictObject,
} from '../strict-tool-schema.ts';
import { formatAutomationsListMenu } from '../../../automation/automation-presenters.ts';
import { defaultComparatorForAction } from '../../../automation/automation-action-registry.ts';

async function automationContext(ctx: ToolExecutionContext): Promise<AutomationAvailabilityContext> {
  const business = await getBusiness(ctx.tenant.businessId);
  const profile = resolveBusinessProfile(business?.businessProfile);
  const { resolved } = business ? await resolveForBusiness(business) : { resolved: { entitlements: emptyModulesMap(true) } };
  return {
    productId: productIdFromAccess(ctx.tenant.platformAccess),
    entitlements: resolved.entitlements ?? emptyModulesMap(true),
    profile,
    permission: true,
  };
}

function scheduleFromArgs(args: Record<string, unknown>) {
  const schedule: Record<string, unknown> = {};
  if (args.time != null) schedule.time = String(args.time);
  if (args.timezone != null) schedule.timezone = String(args.timezone);
  if (Array.isArray(args.daysOfWeek)) schedule.daysOfWeek = args.daysOfWeek;
  if (args.runAt != null) schedule.runAt = String(args.runAt);
  return Object.keys(schedule).length ? schedule : undefined;
}

function normalizeAutomationType(raw: unknown): AutomationType {
  const value = String(raw ?? 'recurring').trim();
  if (value === 'scheduled_once' || value === 'condition_watch') return value;
  return 'recurring';
}

export const AUTOMATION_READ_TOOLS: ToolDefinition[] = [
  {
    name: 'list_available_automation_actions',
    description:
      'Lista categorías y acciones de automatización disponibles para este tenant (recordatorios, resúmenes, alertas). Usar cuando el usuario pregunta qué puede configurar.',
    parameters: strictObject({
      categoryId: nString(),
      categoryIndex: nInteger(),
    }),
    mode: 'read',
    capability: 'automations',
  },
  {
    name: 'list_automations',
    description: 'Lista automatizaciones configuradas del negocio.',
    parameters: strictObject({}),
    mode: 'read',
    capability: 'automations',
  },
  {
    name: 'list_rilo_avisos',
    description:
      'Lista los avisos RILO activos (Qué tengo hoy, Resumen del día, Vencimientos, etc.) con horario real. Usar cuando preguntan "¿qué avisos tengo?" o "¿a qué hora me mandás el resumen?".',
    parameters: strictObject({}),
    mode: 'read',
    capability: 'automations',
  },
  {
    name: 'get_automation',
    description: 'Detalle de una automatización por id.',
    parameters: strictObject({
      automationId: reqString(),
    }),
    mode: 'read',
    capability: 'automations',
  },
];

const automationFlatParams = {
  productId: nString(),
  threshold: nNumber(),
  comparator: nString(),
  ambitoId: nString(),
  thresholdDays: nInteger(),
  cardId: nString(),
  leadDays: nInteger(),
  collaboratorId: nString(),
  includeRevenue: nBoolean(),
  includeProfit: nBoolean(),
  includeSalesCount: nBoolean(),
};

function parametersFromArgs(args: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const key of [
    'productId',
    'threshold',
    'comparator',
    'ambitoId',
    'thresholdDays',
    'cardId',
    'leadDays',
    'collaboratorId',
    'includeRevenue',
    'includeProfit',
    'includeSalesCount',
  ]) {
    if (args[key] !== undefined && args[key] !== null) parameters[key] = args[key];
  }
  return parameters;
}

export const AUTOMATION_WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'update_rilo_aviso',
    description:
      'Cambia un aviso RILO (activar/desactivar, hora, días antes de vencimientos). Misma config que el panel ERP. Ej: "mandame el resumen a las 20", "no quiero más el resumen diario", "avisame vencimientos 5 días antes". presetId: daily_attention|daily_summary|payables_due|overdue_orders|low_stock.',
    parameters: strictObject({
      presetId: reqString(),
      enabled: nBoolean(),
      time: nString(),
      daysBefore: nInteger(),
    }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
  {
    name: 'prepare_create_automation',
    description:
      'Prepara crear una automatización (recurring, scheduled_once o condition_watch). Requiere confirmación.',
    parameters: strictObject({
      type: reqString(),
      actionId: reqString(),
      time: nString(),
      timezone: nString(),
      daysOfWeek: nArray(nInteger()),
      runAt: nString(),
      label: nString(),
      ...automationFlatParams,
    }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
  {
    name: 'prepare_update_automation',
    description: 'Prepara modificar una automatización existente.',
    parameters: strictObject({
      automationId: reqString(),
      time: nString(),
      timezone: nString(),
      daysOfWeek: nArray(nInteger()),
      runAt: nString(),
      label: nString(),
      ...automationFlatParams,
    }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
  {
    name: 'prepare_pause_automation',
    description: 'Prepara pausar una automatización.',
    parameters: strictObject({ automationId: reqString() }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
  {
    name: 'prepare_resume_automation',
    description: 'Prepara reactivar una automatización pausada.',
    parameters: strictObject({ automationId: reqString() }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
  {
    name: 'prepare_cancel_automation',
    description: 'Prepara cancelar/eliminar una automatización.',
    parameters: strictObject({ automationId: reqString() }),
    mode: 'write',
    capability: 'automations',
    permission: 'write',
  },
];

export const AUTOMATION_READ_HANDLERS: Record<
  string,
  (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<Record<string, unknown>>
> = {
  async list_available_automation_actions(args, ctx) {
    const avail = await automationContext(ctx);
    const menus = buildAutomationCategoryMenus(avail);
    const categoryId = String(args.categoryId ?? '').trim();
    const categoryIndex = args.categoryIndex != null ? Number(args.categoryIndex) : undefined;

    if (categoryId) {
      const category = menus.find((row) => row.id === categoryId);
      if (!category) {
        return { status: 'not_found', message: 'Categoría no disponible.' };
      }
      return {
        status: 'resolved',
        categoryId: category.id,
        message: formatCategoryActionsMenu(category),
        actions: category.actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: action.icon,
          description: action.description,
          automationTypesSupported: action.automationTypesSupported,
          parameterSchema: action.parameterSchema,
        })),
        presentVerbatim: true,
      };
    }

    if (categoryIndex != null && Number.isFinite(categoryIndex)) {
      const category = menus[categoryIndex - 1];
      if (!category) {
        return { status: 'not_found', message: 'Opción inválida.' };
      }
      return {
        status: 'resolved',
        categoryId: category.id,
        message: formatCategoryActionsMenu(category),
        actions: category.actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: action.icon,
        })),
        presentVerbatim: true,
      };
    }

    const menu = formatAvailableActionsMenu(menus);
    return {
      status: 'resolved',
      message: menu.body,
      categories: menus.map((row) => ({ id: row.id, label: row.label, icon: row.icon })),
      presentVerbatim: true,
    };
  },

  async list_automations(_args, ctx) {
    const rows = await listAutomations(ctx.tenant.businessId, { status: ['active', 'paused'] });
    const items = await Promise.all(
      rows.map(async (row, index) => {
        const action = getAutomationAction(row.actionId);
        const detailParts: string[] = [];
        if (row.type === 'recurring' && row.schedule?.time) detailParts.push(row.schedule.time);
        if (row.type === 'condition_watch') detailParts.push('alerta');
        const summary = await summarizeAutomation(row, ctx.tenant.businessId);
        return {
          index: index + 1,
          id: row.id,
          icon: action?.icon ?? '⏰',
          label: row.label ?? action?.label ?? row.actionId,
          detail: detailParts.join(' · ') || summary[1]?.replace(/^•\s*/, '') || row.status,
          status: row.status,
        };
      })
    );

    return {
      status: 'resolved',
      automations: items,
      message: items.length
        ? formatAutomationsListMenu(items)
        : '*⏰ Tus automatizaciones*\n\nNo tenés automatizaciones activas.',
      presentVerbatim: true,
    };
  },

  async list_rilo_avisos(_args, ctx) {
    const { listPresetViews } = await import('../../../automation/automation-presets-service.ts');
    const { prefs } = await (async () => {
      const { loadAutomationUserPrefs } = await import('../../../automation/automation-prefs.ts');
      return { prefs: await loadAutomationUserPrefs(ctx.tenant.businessId) };
    })();
    const data = await listPresetViews(ctx.tenant.businessId);
    const simpleIds = new Set([
      'daily_attention',
      'daily_summary',
      'payables_due',
      'overdue_orders',
      'low_stock',
    ]);
    const active = data.presets.filter((p) => simpleIds.has(p.preset.id) && p.enabled);
    const lines = active.map((p) => {
      const time = p.time ? ` — ${p.time}` : '';
      const extra =
        p.preset.id === 'payables_due'
          ? ` (${prefs.avisos?.payablesDaysBefore ?? 3} días antes)`
          : '';
      return `• ${p.preset.label}${time}${extra}`;
    });
    return {
      status: 'resolved',
      message: lines.length
        ? `Tenés activos:\n\n${lines.join('\n')}`
        : 'No tenés avisos activos. Decime si querés activar “Qué tengo hoy” o el resumen del día.',
      presentVerbatim: true,
      presets: active.map((p) => ({
        id: p.preset.id,
        label: p.preset.label,
        time: p.time,
        enabled: p.enabled,
      })),
    };
  },

  async get_automation(args, ctx) {
    const automationId = String(args.automationId ?? '').trim();
    const row = await getAutomation(ctx.tenant.businessId, automationId);
    if (!row) return { status: 'not_found', message: 'Automatización no encontrada.' };
    const action = getAutomationAction(row.actionId);
    const summary = await summarizeAutomation(row, ctx.tenant.businessId);
    return {
      status: 'resolved',
      automation: row,
      action: action
        ? { id: action.id, label: action.label, icon: action.icon, category: action.category }
        : null,
      summaryLines: summary,
    };
  },
};

type WritePrepareResult = {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  summaryTitle?: string;
  summaryLines?: string[];
};

export const AUTOMATION_WRITE_HANDLERS: Record<
  string,
  { prepare: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<WritePrepareResult> }
> = {
  update_rilo_aviso: {
    async prepare(args, ctx) {
      const presetId = String(args.presetId ?? '').trim();
      const known = [
        'daily_attention',
        'daily_summary',
        'payables_due',
        'overdue_orders',
        'low_stock',
        'orders_due_today',
        'payment_promises_due',
      ];
      if (!known.includes(presetId)) {
        throw new Error('Indicá qué aviso: daily_attention, daily_summary, payables_due, overdue_orders o low_stock.');
      }
      const enabled = args.enabled === false ? false : args.enabled === true ? true : undefined;
      const time = args.time != null ? String(args.time).trim() : undefined;
      const daysBefore =
        args.daysBefore != null && Number.isFinite(Number(args.daysBefore))
          ? Math.max(0, Math.min(30, Math.round(Number(args.daysBefore))))
          : undefined;
      const lines: string[] = [`• Aviso: ${presetId}`];
      if (enabled === true) lines.push('• Activar');
      if (enabled === false) lines.push('• Desactivar');
      if (time) lines.push(`• Hora: ${time}`);
      if (daysBefore != null) lines.push(`• Días antes: ${daysBefore}`);
      return {
        tool: 'update_rilo_aviso',
        label: 'Cambiar aviso RILO',
        summaryTitle: 'RILO te avisa',
        summaryLines: lines,
        args: { presetId, enabled, time, daysBefore },
      };
    },
  },
  prepare_create_automation: {
    async prepare(args, ctx) {
      const avail = await automationContext(ctx);
      const actionId = String(args.actionId ?? '').trim() as AutomationActionId;
      assertActionAvailable(actionId, avail);
      const action = getAutomationAction(actionId)!;
      const type = normalizeAutomationType(args.type);
      if (!action.automationTypesSupported.includes(type)) {
        throw new Error('AUTOMATION_TYPE_NOT_SUPPORTED');
      }

      const parameters = parametersFromArgs(args);
      if (type === 'condition_watch' && parameters.comparator == null) {
        parameters.comparator = defaultComparatorForAction(actionId);
      }

      const schedule = scheduleFromArgs(args);
      const summaryLines = await summarizeAutomation(
        { actionId, type, parameters, schedule },
        ctx.tenant.businessId
      );
      if (type === 'recurring' && schedule?.time) {
        summaryLines.unshift(`• ${String(schedule.time)}`);
      }

      return {
        tool: 'prepare_create_automation',
        label: action.label,
        summaryTitle: 'Automatización',
        summaryLines,
        args: {
          type,
          actionId,
          parameters,
          schedule,
          label: String(args.label ?? action.label),
          recipientPhone: ctx.tenant.phone,
        },
      };
    },
  },
  prepare_update_automation: {
    async prepare(args, ctx) {
      const automationId = String(args.automationId ?? '').trim();
      const existing = await getAutomation(ctx.tenant.businessId, automationId);
      if (!existing) throw new Error('AUTOMATION_NOT_FOUND');

      const parameters = args.parameters
        ? { ...existing.parameters, ...(args.parameters as Record<string, unknown>) }
        : { ...existing.parameters, ...parametersFromArgs(args) };
      const schedule = scheduleFromArgs(args) ?? existing.schedule;
      const summaryLines = await summarizeAutomation(
        {
          actionId: existing.actionId,
          type: existing.type,
          parameters,
          schedule,
        },
        ctx.tenant.businessId
      );

      return {
        tool: 'prepare_update_automation',
        label: existing.label ?? existing.actionId,
        summaryTitle: 'Modificar automatización',
        summaryLines,
        args: {
          automationId,
          parameters,
          schedule,
          label: args.label != null ? String(args.label) : existing.label,
        },
      };
    },
  },
  prepare_pause_automation: {
    async prepare(args, ctx) {
      const automationId = String(args.automationId ?? '').trim();
      const existing = await getAutomation(ctx.tenant.businessId, automationId);
      if (!existing) throw new Error('AUTOMATION_NOT_FOUND');
      const action = getAutomationAction(existing.actionId);
      return {
        tool: 'prepare_pause_automation',
        label: existing.label ?? existing.actionId,
        summaryTitle: 'Pausar automatización',
        summaryLines: [`• ${action?.icon ?? '⏰'} ${action?.label ?? existing.actionId}`],
        args: { automationId },
      };
    },
  },
  prepare_resume_automation: {
    async prepare(args, ctx) {
      const automationId = String(args.automationId ?? '').trim();
      const existing = await getAutomation(ctx.tenant.businessId, automationId);
      if (!existing) throw new Error('AUTOMATION_NOT_FOUND');
      const action = getAutomationAction(existing.actionId);
      return {
        tool: 'prepare_resume_automation',
        label: existing.label ?? existing.actionId,
        summaryTitle: 'Reactivar automatización',
        summaryLines: [`• ${action?.icon ?? '⏰'} ${action?.label ?? existing.actionId}`],
        args: { automationId },
      };
    },
  },
  prepare_cancel_automation: {
    async prepare(args, ctx) {
      const automationId = String(args.automationId ?? '').trim();
      const existing = await getAutomation(ctx.tenant.businessId, automationId);
      if (!existing) throw new Error('AUTOMATION_NOT_FOUND');
      const action = getAutomationAction(existing.actionId);
      return {
        tool: 'prepare_cancel_automation',
        label: existing.label ?? existing.actionId,
        summaryTitle: 'Cancelar automatización',
        summaryLines: [`• ${action?.icon ?? '⏰'} ${action?.label ?? existing.actionId}`],
        args: { automationId },
      };
    },
  },
};

export function automationConfirmationText(plan: WritePrepareResult): string {
  return formatAutomationConfirmation(plan.summaryTitle ?? 'Automatización', plan.summaryLines ?? []);
}

export async function executeAutomationWrite(
  tenant: ToolExecutionContext['tenant'],
  write: { tool: string; args: Record<string, unknown> }
): Promise<{ reply: string; data?: Record<string, unknown> }> {
  switch (write.tool) {
    case 'update_rilo_aviso': {
      const { setPresetEnabled } = await import('../../../automation/automation-presets-service.ts');
      const { saveAutomationUserPrefs, loadAutomationUserPrefs } = await import(
        '../../../automation/automation-prefs.ts'
      );
      const presetId = String(write.args.presetId ?? '') as import('../../../../shared/automation-presets.ts').AutomationPresetId;
      const enabled =
        write.args.enabled === false ? false : write.args.enabled === true ? true : true;
      const time = write.args.time != null ? String(write.args.time) : undefined;
      const daysBefore =
        write.args.daysBefore != null ? Number(write.args.daysBefore) : undefined;

      if (daysBefore != null && Number.isFinite(daysBefore)) {
        const current = await loadAutomationUserPrefs(tenant.businessId);
        await saveAutomationUserPrefs(tenant.businessId, {
          avisos: {
            ...(current.avisos ?? { payablesDaysBefore: 3, updatedAt: new Date().toISOString() }),
            payablesDaysBefore: daysBefore,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      const view = await setPresetEnabled({
        businessId: tenant.businessId,
        presetId,
        enabled,
        time,
        actor: `whatsapp:${tenant.phone}`,
      });

      // If only daysBefore change on payables and already enabled, also patch automation params
      if (daysBefore != null && view.automationId) {
        const { updateAutomation } = await import('../../../automation/index.ts');
        await updateAutomation({
          businessId: tenant.businessId,
          automationId: view.automationId,
          parameters: { daysBefore },
        });
      }

      const state = enabled ? 'activado' : 'desactivado';
      const timeBit = time ? ` a las ${time}` : '';
      return {
        reply: `Listo. Aviso *${view.preset.label}* ${state}${timeBit}.`,
        data: { presetId, enabled, time, daysBefore, kind: 'rilo_aviso' },
      };
    }
    case 'prepare_create_automation': {
      const created = await createAutomation({
        businessId: tenant.businessId,
        type: normalizeAutomationType(write.args.type),
        actionId: String(write.args.actionId ?? '') as AutomationActionId,
        parameters: (write.args.parameters as Record<string, unknown>) ?? {},
        schedule: write.args.schedule as Record<string, unknown> | undefined,
        recipientPhone: String(write.args.recipientPhone ?? tenant.phone),
        label: write.args.label != null ? String(write.args.label) : undefined,
      });
      return {
        reply: `Listo. Configuré *${created.label ?? created.actionId}*.`,
        data: { automationId: created.id, kind: 'automation' },
      };
    }
    case 'prepare_update_automation': {
      const updated = await updateAutomation({
        businessId: tenant.businessId,
        automationId: String(write.args.automationId ?? ''),
        parameters: write.args.parameters as Record<string, unknown> | undefined,
        schedule: write.args.schedule as Record<string, unknown> | undefined,
        label: write.args.label != null ? String(write.args.label) : undefined,
      });
      return {
        reply: `Listo. Actualicé la automatización *${updated.label ?? updated.actionId}*.`,
        data: { automationId: updated.id, kind: 'automation' },
      };
    }
    case 'prepare_pause_automation': {
      const row = await setAutomationStatus(
        tenant.businessId,
        String(write.args.automationId ?? ''),
        'paused'
      );
      return { reply: `Listo. Pausé *${row.label ?? row.actionId}*.`, data: { automationId: row.id } };
    }
    case 'prepare_resume_automation': {
      const row = await setAutomationStatus(
        tenant.businessId,
        String(write.args.automationId ?? ''),
        'active'
      );
      return { reply: `Listo. Reactivé *${row.label ?? row.actionId}*.`, data: { automationId: row.id } };
    }
    case 'prepare_cancel_automation': {
      const row = await setAutomationStatus(
        tenant.businessId,
        String(write.args.automationId ?? ''),
        'cancelled'
      );
      return { reply: `Listo. Cancelé *${row.label ?? row.actionId}*.`, data: { automationId: row.id } };
    }
    default:
      throw new Error(`Unknown automation write: ${write.tool}`);
  }
}
