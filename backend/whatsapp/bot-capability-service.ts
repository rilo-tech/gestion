/**
 * Fuente de verdad operacional de lo que RILO puede hacer por WhatsApp.
 * Disponibilidad = tools en buildToolRegistry / buildToolRegistryForTenant
 * (handlers + gates + entitlements). El help/copy NO decide disponibilidad.
 */
import {
  HELP_SECTION_OPERATIONAL_TOOLS,
  KNOWN_UNAVAILABLE_CAPABILITIES,
  helpSectionHasOperationalTool,
  type KnownUnavailableCapability,
} from '../../shared/bot-capability-catalog.ts';
import {
  listEnabledHelpSections,
  type BotHelpMenuContext,
  type BotHelpSectionId,
} from '../../shared/bot-help-catalog.ts';
import type { ToolRegistryEntry } from './agent/tool-types.ts';
import {
  buildFullOperationalToolRegistry,
  buildToolRegistry,
  buildToolRegistryForTenant,
  findAgentToolCatalogGaps,
  type ToolRegistryOptions,
} from './agent/tool-registry.ts';
import { READ_TOOLS } from './agent/tools/read-tools.ts';
import { WRITE_TOOLS, WRITE_TOOL_HANDLERS } from './agent/tools/write-tools.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export type BotCapabilityStatus = 'available' | 'unavailable' | 'requires_adapter';

export type BotCapabilityItem = {
  toolName: string;
  capability: string;
  mode: 'read' | 'write';
  status: BotCapabilityStatus;
  risk?: string;
  description: string;
  reasonUnavailable?: string;
};

export type BotCapabilitySnapshot = {
  available: BotCapabilityItem[];
  unavailable: BotCapabilityItem[];
  readCapabilities: BotCapabilityItem[];
  writeCapabilities: BotCapabilityItem[];
  sensitiveCapabilities: BotCapabilityItem[];
  helpSections: BotHelpSectionId[];
  knownUnavailable: KnownUnavailableCapability[];
  /** Texto para el agente: qué puede / qué no (sin tecnicismos internos al usuario). */
  agentCapabilityBrief: string;
};

function toItem(
  tool: ToolRegistryEntry,
  status: BotCapabilityStatus,
  reasonUnavailable?: string
): BotCapabilityItem {
  return {
    toolName: tool.name,
    capability: tool.capability,
    mode: tool.mode,
    status,
    risk: tool.risk,
    description: tool.description,
    reasonUnavailable,
  };
}

export function buildCapabilitySnapshotFromRegistry(
  availableRegistry: ToolRegistryEntry[],
  helpCtx?: BotHelpMenuContext | null
): BotCapabilitySnapshot {
  const availableNames = new Set(availableRegistry.map((t) => t.name));
  const available = availableRegistry.map((t) => toItem(t, 'available'));

  const allDefs = [...READ_TOOLS, ...WRITE_TOOLS];
  const unavailable: BotCapabilityItem[] = [];
  for (const tool of allDefs) {
    if (availableNames.has(tool.name)) continue;
    if (tool.requiresDomainAdapter) {
      unavailable.push(toItem(tool, 'requires_adapter', 'requires_domain_adapter'));
      continue;
    }
    if (tool.mode === 'write' && !WRITE_TOOL_HANDLERS[tool.name]) {
      unavailable.push(toItem(tool, 'unavailable', 'missing_handler'));
      continue;
    }
    unavailable.push(toItem(tool, 'unavailable', 'gated_or_not_entitled'));
  }

  const readCapabilities = available.filter((c) => c.mode === 'read');
  const writeCapabilities = available.filter((c) => c.mode === 'write');
  const sensitiveCapabilities = available.filter((c) => c.risk === 'sensitive');

  const featureSections = helpCtx ? listEnabledHelpSections(helpCtx) : (Object.keys(HELP_SECTION_OPERATIONAL_TOOLS) as BotHelpSectionId[]);
  const helpSections = featureSections.filter((id) =>
    helpSectionHasOperationalTool(id, availableNames)
  );

  const knownUnavailable = KNOWN_UNAVAILABLE_CAPABILITIES.filter((row) => {
    if (!row.toolName) return true;
    return !availableNames.has(row.toolName);
  });

  return {
    available,
    unavailable,
    readCapabilities,
    writeCapabilities,
    sensitiveCapabilities,
    helpSections,
    knownUnavailable,
    agentCapabilityBrief: formatAgentCapabilityBrief({
      available,
      knownUnavailable,
      helpSections,
    }),
  };
}

function formatAgentCapabilityBrief(input: {
  available: BotCapabilityItem[];
  knownUnavailable: KnownUnavailableCapability[];
  helpSections: BotHelpSectionId[];
}): string {
  const writes = input.available.filter((c) => c.mode === 'write').map((c) => c.toolName);
  const reads = input.available.filter((c) => c.mode === 'read').map((c) => c.toolName);
  const lines = [
    'CAPACIDADES REALES DE ESTE TENANT (fuente: registry operacional).',
    'NUNCA afirmes que podés ejecutar algo si no está en availableTools.',
    'Si preguntan qué podés hacer: respondé en español rioplatense, corto, con ejemplos de las categorías habilitadas. No menciones tools, handlers, adapters ni modelos de IA.',
    `helpCategories=${input.helpSections.join(',') || 'none'}`,
    `availableTools=${[...writes, ...reads].join(',') || 'none'}`,
    'Si preguntan por una acción NO disponible, explicá con honestidad y ofrecé alternativa real (otra tool disponible o RILO Gestión).',
  ];
  for (const row of input.knownUnavailable) {
    lines.push(`unavailableHint:${row.id}=${row.userHint}`);
  }
  return lines.join('\n');
}

export function buildOperationalCapabilitySnapshot(
  options?: ToolRegistryOptions
): BotCapabilitySnapshot {
  return buildCapabilitySnapshotFromRegistry(buildToolRegistry(options));
}

export function buildFullOperationalCapabilitySnapshot(): BotCapabilitySnapshot {
  return buildCapabilitySnapshotFromRegistry(buildFullOperationalToolRegistry());
}

export async function resolveBotCapabilitiesForTenant(
  tenant: WhatsappTenantContext,
  helpCtx?: BotHelpMenuContext | null
): Promise<BotCapabilitySnapshot> {
  const registry = await buildToolRegistryForTenant(tenant);
  return buildCapabilitySnapshotFromRegistry(registry, helpCtx);
}

export function isToolOperationallyAvailable(
  snapshot: BotCapabilitySnapshot,
  toolName: string
): boolean {
  return snapshot.available.some((c) => c.toolName === toolName);
}

export function findCapabilitySyncGaps(): string[] {
  const gaps = [...findAgentToolCatalogGaps()];
  const full = buildFullOperationalToolRegistry();
  const exposed = new Set(full.map((t) => t.name));

  for (const [sectionId, tools] of Object.entries(HELP_SECTION_OPERATIONAL_TOOLS)) {
    const anyExposed = tools.some((name) => exposed.has(name));
    if (!anyExposed) {
      gaps.push(`help_section_without_operational_tool:${sectionId}`);
    }
  }

  for (const tool of [...READ_TOOLS, ...WRITE_TOOLS]) {
    if (!tool.requiresDomainAdapter) continue;
    if (exposed.has(tool.name)) {
      gaps.push(`requires_adapter_accidentally_exposed:${tool.name}`);
    }
  }

  for (const row of KNOWN_UNAVAILABLE_CAPABILITIES) {
    if (!row.toolName) continue;
    if (exposed.has(row.toolName)) {
      gaps.push(`known_unavailable_but_operational:${row.toolName}`);
    }
  }

  return gaps;
}
