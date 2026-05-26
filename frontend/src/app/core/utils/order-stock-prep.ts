import type { OrderStockPreparationLine, OrderStockPreparationView } from '../services/order.service';

export function getStockPrepPendiente(line: OrderStockPreparationLine): number {
  return Math.max(0, line.cantidadPedida - (Number(line.cantidadUsada) || 0));
}

export function buildSuggestedStockAllocations(
  view: OrderStockPreparationView
): Array<{ lineIndex: number; cantidadFaltante: number }> {
  return view.lines.map((line) => {
    const pendiente = getStockPrepPendiente(line);
    let faltante: number;

    if (view.stockPreparado) {
      faltante = Math.min(pendiente, Math.max(0, Number(line.cantidadFaltante) || 0));
    } else if (!line.controlaStock) {
      faltante = 0;
    } else {
      const reservar = Math.min(pendiente, Math.max(0, Number(line.sugeridoReservar) || 0));
      faltante = Math.max(0, pendiente - reservar);
    }

    return { lineIndex: line.lineIndex, cantidadFaltante: faltante };
  });
}

export function splitProductDisplayName(nombre: string): { base: string; variant: string } {
  const parts = String(nombre ?? '')
    .split(' - ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return { base: nombre?.trim() || '—', variant: '' };
  }
  return { base: parts[0], variant: parts.slice(1).join(' · ') };
}
