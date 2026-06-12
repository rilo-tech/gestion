export type LineExtraCost = {
  nombre: string;
  costo: number;
};

export function normalizeLineExtraCosts(
  raw: unknown,
  legacyPersonalizacion?: number,
  lineQty = 1
): LineExtraCost[] {
  const qty = Math.max(1, Number(lineQty) || 1);

  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const data = entry as Record<string, unknown>;
        const nombre = String(data.nombre ?? '').trim();
        const costo = Number(data.costo) || 0;
        if (!nombre && costo <= 0) return null;

        return {
          nombre: nombre || 'Costo extra',
          costo,
        };
      })
      .filter((entry): entry is LineExtraCost => entry !== null);
  }

  const legacy = Number(legacyPersonalizacion) || 0;
  if (legacy <= 0) return [];

  const unit = qty > 0 ? legacy / qty : legacy;
  return [{ nombre: 'Personalización', costo: unit }];
}

export function sumLineExtraCosts(
  lineQty: number,
  extras: LineExtraCost[] | undefined,
  legacyPersonalizacion?: number
): number {
  const qty = Math.max(0, Number(lineQty) || 0);
  const list = Array.isArray(extras) ? extras : [];

  if (list.length > 0) {
    const unitTotal = list.reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
    return qty * unitTotal;
  }

  return Number(legacyPersonalizacion) || 0;
}
