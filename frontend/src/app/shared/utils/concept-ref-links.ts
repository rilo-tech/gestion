export type ConceptRefContext = {
  pedidoId?: string | null;
  ventaId?: string | null;
  numeroPedidoLabel?: string | null;
  ventaLabel?: string | null;
};

export type ConceptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'pedido'; ref: string; pedidoId: string }
  | { kind: 'venta'; ref: string; ventaId: string };

export function buildConceptSegments(
  concepto: string,
  ctx: ConceptRefContext
): ConceptSegment[] {
  if (!concepto) return [{ kind: 'text', value: '—' }];

  const regex = /#\S+/g;
  const segments: ConceptSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pedidoLinked = false;
  let ventaLinked = false;

  const pedidoRef =
    ctx.pedidoId && ctx.numeroPedidoLabel ? `#${ctx.numeroPedidoLabel}` : null;
  const ventaRef = ctx.ventaId && ctx.ventaLabel ? `#${ctx.ventaLabel}` : null;

  while ((match = regex.exec(concepto)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: concepto.slice(lastIndex, match.index) });
    }

    const ref = match[0];
    const textBefore = concepto
      .slice(Math.max(0, match.index - 40), match.index)
      .toLowerCase();
    const linked = linkRef(ref, textBefore, ctx, pedidoRef, ventaRef, pedidoLinked, ventaLinked);

    if (linked) {
      segments.push(linked.segment);
      pedidoLinked = linked.pedidoLinked;
      ventaLinked = linked.ventaLinked;
    } else {
      segments.push({ kind: 'text', value: ref });
    }

    lastIndex = match.index + ref.length;
  }

  if (lastIndex < concepto.length) {
    segments.push({ kind: 'text', value: concepto.slice(lastIndex) });
  }

  return segments.length ? segments : [{ kind: 'text', value: concepto }];
}

function linkRef(
  ref: string,
  textBefore: string,
  ctx: ConceptRefContext,
  pedidoRef: string | null,
  ventaRef: string | null,
  pedidoLinked: boolean,
  ventaLinked: boolean
):
  | { segment: ConceptSegment; pedidoLinked: boolean; ventaLinked: boolean }
  | null {
  if (ctx.pedidoId && !pedidoLinked) {
    if (pedidoRef && ref === pedidoRef) {
      return {
        segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
        pedidoLinked: true,
        ventaLinked,
      };
    }
    if (textBefore.includes('pedido')) {
      return {
        segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
        pedidoLinked: true,
        ventaLinked,
      };
    }
  }

  if (ctx.ventaId && !ventaLinked) {
    if (ventaRef && ref === ventaRef) {
      return {
        segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
        pedidoLinked,
        ventaLinked: true,
      };
    }
    if (textBefore.includes('venta')) {
      return {
        segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
        pedidoLinked,
        ventaLinked: true,
      };
    }
  }

  if (ctx.pedidoId && !pedidoLinked && !ctx.ventaId) {
    return {
      segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
      pedidoLinked: true,
      ventaLinked,
    };
  }

  if (ctx.ventaId && !ventaLinked && !ctx.pedidoId) {
    return {
      segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
      pedidoLinked,
      ventaLinked: true,
    };
  }

  return null;
}
