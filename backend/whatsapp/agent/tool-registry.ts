import { resolveWhatsappCollaboratorGate } from '../collaborator-access.ts';
import { getBusiness, resolveForBusiness } from '../../auth/business.ts';
import type { WhatsappTenantContext } from '../tenant-resolver.ts';
import type { ToolRegistryEntry } from './tool-types.ts';
import { READ_TOOL_HANDLERS, READ_TOOLS } from './tools/read-tools.ts';
import { WRITE_TOOL_HANDLERS, WRITE_TOOLS } from './tools/write-tools.ts';
import { agentCapabilityAllowed } from '../../../shared/business-capability.ts';
import { resolveBusinessProfile } from '../../../shared/business-profile.ts';
import { productIdFromAccess } from '../../../shared/platform-access.ts';
import { emptyModulesMap } from '../../../shared/subscription-modules.ts';
import { writeToolDisposition } from '../v4-write-disposition.ts';
import { featureForAgentCapability } from '../../../shared/tool-feature-map.ts';

const ALL_TOOLS: ToolRegistryEntry[] = [...READ_TOOLS, ...WRITE_TOOLS];

export type ToolRegistryOptions = {
  includeRequiresAdapter?: boolean;
  collaboratorsEnabled?: boolean;
  collaboratorsCanRead?: boolean;
  collaboratorsCanWrite?: boolean;
  collaboratorsCanWriteHours?: boolean;
  collaboratorsCanWritePayments?: boolean;
};

function toolAllowedByGate(tool: ToolRegistryEntry, options?: ToolRegistryOptions): boolean {
  if (tool.requiredModule === 'collaborators') {
    if (!options?.collaboratorsEnabled) return false;
    if (tool.mode === 'read' && options.collaboratorsCanRead === false) return false;
    if (tool.mode === 'write') {
      if (tool.requiresPaymentWrite && options.collaboratorsCanWritePayments === false) return false;
      if (tool.requiresHoursWrite && options.collaboratorsCanWriteHours === false) return false;
      if (tool.requiresTeamManage && options.collaboratorsCanWrite === false) return false;
      if (
        !tool.requiresPaymentWrite &&
        !tool.requiresHoursWrite &&
        !tool.requiresTeamManage &&
        options.collaboratorsCanWrite === false
      ) {
        return false;
      }
    }
  }
  return true;
}

function annotateTool(tool: ToolRegistryEntry): ToolRegistryEntry {
  const risk =
    tool.mode === 'write'
      ? writeToolDisposition(tool.name) === 'EXECUTE_DIRECTLY'
        ? 'low'
        : 'sensitive'
      : 'low';
  const feature = featureForAgentCapability(tool.capability);
  return {
    ...tool,
    risk,
    entity: tool.entity ?? inferEntityFromCapability(tool.capability),
    feature: tool.feature ?? feature ?? undefined,
  };
}

function inferEntityFromCapability(capability: string): string | undefined {
  const c = capability.toLowerCase();
  if (c.includes('collaborator')) return 'collaborator';
  if (c.includes('supplier')) return 'supplier';
  if (c.includes('client')) return 'client';
  if (c.includes('product') || c.includes('stock') || c.includes('rename')) return 'product';
  if (c.includes('order')) return 'order';
  if (c.includes('sale')) return 'sale';
  if (c.includes('purchase') || c.includes('visual')) return 'purchase';
  if (c.includes('cash')) return 'cash';
  if (c.includes('payable')) return 'payable';
  if (c.includes('automation')) return 'automation';
  return undefined;
}

/**
 * Fuente de verdad: READ_TOOLS + WRITE_TOOLS con handler.
 * NO filtrar writes por LINGUISTIC_CAPABILITIES (legacy Gemini) — eso desincroniza tools reales.
 * Gates: requiresDomainAdapter, módulo colaboradores, entitlements/plan (en ForTenant).
 */
export function buildToolRegistry(options?: ToolRegistryOptions): ToolRegistryEntry[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.requiresDomainAdapter && !options?.includeRequiresAdapter) return false;
    if (!toolAllowedByGate(tool, options)) return false;
    if (tool.mode === 'write' && !WRITE_TOOL_HANDLERS[tool.name]) return false;
    return true;
  }).map((tool) =>
    annotateTool({
      ...tool,
      execute: READ_TOOL_HANDLERS[tool.name],
      prepare: WRITE_TOOL_HANDLERS[tool.name]?.prepare,
    })
  );
}

export async function buildToolRegistryForTenant(
  tenant: WhatsappTenantContext,
  options?: Pick<ToolRegistryOptions, 'includeRequiresAdapter'>
): Promise<ToolRegistryEntry[]> {
  const gate = await resolveWhatsappCollaboratorGate(tenant);
  const registry = buildToolRegistry({
    includeRequiresAdapter: options?.includeRequiresAdapter,
    collaboratorsEnabled: gate.canRead || gate.canWrite || gate.canWriteHours || gate.canWritePayments,
    collaboratorsCanRead: gate.canRead,
    collaboratorsCanWrite: gate.canWrite,
    collaboratorsCanWriteHours: gate.canWriteHours,
    collaboratorsCanWritePayments: gate.canWritePayments,
  });
  const business = await getBusiness(tenant.businessId);
  if (!business) return registry;
  const { resolved } = await resolveForBusiness(business);
  const profile = resolveBusinessProfile(business.businessProfile);
  const productId = productIdFromAccess(tenant.platformAccess);
  const entitlements = resolved.entitlements ?? emptyModulesMap(true);
  return registry.filter((tool) =>
    agentCapabilityAllowed({
      productId,
      entitlements,
      profile,
      capability: tool.capability,
    })
  );
}

export function getToolByName(name: string, registry?: ToolRegistryEntry[]): ToolRegistryEntry | undefined {
  const list = registry ?? buildToolRegistry();
  return list.find((tool) => tool.name === name);
}

export function openAiToolsFromRegistry(registry: ToolRegistryEntry[]): Array<Record<string, unknown>> {
  return registry.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
}

export function isWriteTool(name: string, registry?: ToolRegistryEntry[]): boolean {
  const tool = getToolByName(name, registry);
  return tool?.mode === 'write';
}

export function listRegistryToolNames(registry?: ToolRegistryEntry[]): string[] {
  return (registry ?? buildToolRegistry()).map((tool) => tool.name);
}

export function listCollaboratorToolNames(registry?: ToolRegistryEntry[]): string[] {
  const list = registry ?? buildToolRegistry({
    collaboratorsEnabled: true,
    collaboratorsCanRead: true,
    collaboratorsCanWrite: true,
    collaboratorsCanWriteHours: true,
    collaboratorsCanWritePayments: true,
  });
  return list.filter((tool) => tool.requiredModule === 'collaborators').map((tool) => tool.name);
}

/** Registry “completo” para asserts de sync (colaboradores ON, sin adapters incompletos). */
export function buildFullOperationalToolRegistry(): ToolRegistryEntry[] {
  return buildToolRegistry({
    collaboratorsEnabled: true,
    collaboratorsCanRead: true,
    collaboratorsCanWrite: true,
    collaboratorsCanWriteHours: true,
    collaboratorsCanWritePayments: true,
  });
}

/**
 * Detecta desync: tool definida sin handler, handler sin definición, o write implementado no expuesto.
 * Usar en tests al agregar tools nuevas.
 */
export function findAgentToolCatalogGaps(): string[] {
  const gaps: string[] = [];
  const writeDefs = new Set(WRITE_TOOLS.map((t) => t.name));
  const handlerNames = Object.keys(WRITE_TOOL_HANDLERS);

  for (const name of handlerNames) {
    if (!writeDefs.has(name)) gaps.push(`handler_without_definition:${name}`);
  }
  for (const tool of WRITE_TOOLS) {
    if (!WRITE_TOOL_HANDLERS[tool.name]) {
      gaps.push(`definition_without_handler:${tool.name}`);
    }
  }

  const exposed = new Set(listRegistryToolNames(buildFullOperationalToolRegistry()));
  for (const tool of WRITE_TOOLS) {
    if (tool.requiresDomainAdapter) continue;
    if (!WRITE_TOOL_HANDLERS[tool.name]) continue;
    if (!exposed.has(tool.name)) {
      gaps.push(`implemented_write_not_exposed:${tool.name}`);
    }
  }
  return gaps;
}
