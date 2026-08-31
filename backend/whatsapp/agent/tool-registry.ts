import { LINGUISTIC_CAPABILITIES } from '../capability-registry.ts';
import type { ToolRegistryEntry } from './tool-types.ts';
import { READ_TOOL_HANDLERS, READ_TOOLS } from './tools/read-tools.ts';
import { WRITE_TOOL_HANDLERS, WRITE_TOOLS } from './tools/write-tools.ts';

const ALL_TOOLS: ToolRegistryEntry[] = [...READ_TOOLS, ...WRITE_TOOLS];

function wiredCapabilities(): Set<string> {
  return new Set(
    LINGUISTIC_CAPABILITIES.filter((row) => row.erp === 'wired' || row.erp === 'partial').map((row) => row.id)
  );
}

export function buildToolRegistry(options?: { includeRequiresAdapter?: boolean }): ToolRegistryEntry[] {
  const wired = wiredCapabilities();
  return ALL_TOOLS.filter((tool) => {
    if (tool.requiresDomainAdapter && !options?.includeRequiresAdapter) return false;
    if (tool.mode === 'read') return true;
    return wired.has(tool.capability) || tool.capability.startsWith('create_') || tool.capability.startsWith('update_');
  }).map((tool) => ({
    ...tool,
    execute: READ_TOOL_HANDLERS[tool.name],
    prepare: WRITE_TOOL_HANDLERS[tool.name]?.prepare,
  }));
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
