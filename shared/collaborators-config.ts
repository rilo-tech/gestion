export interface CollaboratorExtraTipoConfig {
  id: string;
  nombre: string;
}

export const DEFAULT_COLLABORATOR_EXTRA_TIPOS: CollaboratorExtraTipoConfig[] = [
  { id: 'reparto', nombre: 'Reparto' },
  { id: 'premio', nombre: 'Premio' },
  { id: 'aguinaldo', nombre: 'Aguinaldo' },
  { id: 'bonificacion', nombre: 'Bonificación' },
  { id: 'otro', nombre: 'Otro' },
];

const LEGACY_EXTRA_LABELS: Record<string, string> = {
  reparto: 'Reparto',
  premio: 'Premio',
  aguinaldo: 'Aguinaldo',
  bonificacion: 'Bonificación',
  otro: 'Otro',
};

export function slugifyCollaboratorExtraTipoId(label: string): string {
  const slug = String(label ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || 'extra';
}

export function normalizeCollaboratorExtraTipos(raw: unknown): CollaboratorExtraTipoConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_COLLABORATOR_EXTRA_TIPOS.map((item) => ({ ...item }));
  }

  const map = new Map<string, CollaboratorExtraTipoConfig>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const nombre = String(obj.nombre ?? obj.label ?? '').trim();
    const idRaw = String(obj.id ?? '').trim();
    const id = idRaw || (nombre ? slugifyCollaboratorExtraTipoId(nombre) : '');
    if (!id || !nombre) continue;
    if (!map.has(id)) {
      map.set(id, { id, nombre });
    }
  }

  const normalized = [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return normalized.length > 0
    ? normalized
    : DEFAULT_COLLABORATOR_EXTRA_TIPOS.map((item) => ({ ...item }));
}

export function resolveCollaboratorExtraTipoLabel(
  tipos: CollaboratorExtraTipoConfig[],
  id?: string
): string {
  const key = String(id ?? '').trim();
  if (!key) return 'Extra';
  const found = tipos.find((tipo) => tipo.id === key);
  if (found) return found.nombre;
  return LEGACY_EXTRA_LABELS[key] ?? key;
}

export function normalizeCollaboratorExtraTipoValue(
  value: unknown,
  tipos: CollaboratorExtraTipoConfig[]
): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return tipos[0]?.id ?? DEFAULT_COLLABORATOR_EXTRA_TIPOS[0].id;
  }
  if (tipos.some((tipo) => tipo.id === raw)) return raw;
  return raw;
}
