export interface LineExtraCostShape {
  nombre: string;
  costo: number;
}

export function sumLineExtraCosts(
  lineQty: number,
  extras: LineExtraCostShape[] | undefined,
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
