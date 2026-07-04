import type {
  OrderLineItem,
  OrderStockPreparationLine,
  OrderStockPreparationView,
} from '../services/order.service';

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

/** Ajusta reserva/faltante locales cuando cambia la cantidad pedida sin guardar. */
export function syncOrderLineStockReservationFields(line: OrderLineItem): void {
  const stockItemId = String(line.stockItemId ?? '').trim();
  if (!stockItemId || line.controlaStock === false) return;

  const cantidadPedida = Math.max(0, Number(line.cantidad) || 0);
  const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
  const pendiente = Math.max(0, cantidadPedida - cantidadUsada);

  let cantidadReservada = Math.max(0, Number(line.cantidadReservada) || 0);
  let cantidadFaltante = Math.max(0, Number(line.cantidadFaltante) || 0);

  if (cantidadReservada + cantidadFaltante > pendiente) {
    cantidadReservada = Math.min(cantidadReservada, pendiente);
    cantidadFaltante = Math.max(0, pendiente - cantidadReservada);
  }

  line.cantidadReservada = cantidadReservada;
  line.cantidadFaltante = cantidadFaltante;
}

export function buildStockPrepLinesFromDraftOrder(
  draftLines: OrderLineItem[],
  serverLines: OrderStockPreparationLine[]
): OrderStockPreparationLine[] {
  const usedServerIndices = new Set<number>();
  const serverByIndex = new Map(serverLines.map((line) => [line.lineIndex, line]));
  const result: OrderStockPreparationLine[] = [];

  draftLines.forEach((draft, lineIndex) => {
    const stockItemId = String(draft.stockItemId ?? '').trim();
    const cantidadPedida = Math.max(0, Number(draft.cantidad) || 0);
    if (!stockItemId || cantidadPedida <= 0) return;

    let base: OrderStockPreparationLine | undefined;
    const atIndex = serverByIndex.get(lineIndex);
    if (atIndex && atIndex.stockItemId === stockItemId && !usedServerIndices.has(atIndex.lineIndex)) {
      base = atIndex;
      usedServerIndices.add(atIndex.lineIndex);
    } else {
      base = serverLines.find(
        (line) => line.stockItemId === stockItemId && !usedServerIndices.has(line.lineIndex)
      );
      if (base) usedServerIndices.add(base.lineIndex);
    }

    syncOrderLineStockReservationFields(draft);

    const cantidadUsada = Math.max(0, Number(draft.cantidadUsada ?? base?.cantidadUsada) || 0);
    const cantidadReservada = Math.max(0, Number(draft.cantidadReservada ?? base?.cantidadReservada) || 0);
    const cantidadFaltante = Math.max(0, Number(draft.cantidadFaltante ?? base?.cantidadFaltante) || 0);
    const pendiente = Math.max(0, cantidadPedida - cantidadUsada);
    const stockDisponible = Number(draft.stockDisponible ?? base?.stockDisponible) || 0;
    const sugeridoReservar = Math.min(
      pendiente,
      Math.max(0, stockDisponible) + cantidadReservada
    );

    result.push({
      lineIndex,
      stockItemId,
      nombre: String(draft.nombre ?? base?.nombre ?? 'Producto').trim() || 'Producto',
      cantidadPedida,
      cantidadReservada,
      cantidadUsada,
      cantidadFaltante,
      stockReal: base?.stockReal ?? 0,
      stockReservadoGlobal: base?.stockReservadoGlobal ?? 0,
      stockDisponible,
      sugeridoReservar,
      controlaStock: draft.controlaStock ?? base?.controlaStock ?? true,
      permitirStockNegativo: draft.permitirStockNegativo ?? base?.permitirStockNegativo ?? false,
    });
  });

  return result;
}

export function mergeDraftOrderIntoStockPrepView(
  view: OrderStockPreparationView,
  draftLines: OrderLineItem[]
): OrderStockPreparationView {
  return {
    ...view,
    lines: buildStockPrepLinesFromDraftOrder(draftLines, view.lines),
  };
}

export function splitProductDisplayName(nombre: string): { base: string; variant: string } {
  const text = String(nombre ?? '').trim();
  if (!text) return { base: '—', variant: '' };

  if (text.includes(' - ')) {
    const parts = text.split(' - ').map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) return { base: text, variant: '' };
    return { base: parts[0], variant: parts.slice(1).join(' ') };
  }

  return { base: text, variant: '' };
}
