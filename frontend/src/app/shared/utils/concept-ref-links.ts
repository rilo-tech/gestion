export type ConceptRefContext = {
  pedidoId?: string | null;
  ventaId?: string | null;
  compraId?: string | null;
  numeroPedidoLabel?: string | null;
  ventaLabel?: string | null;
  compraLabel?: string | null;
};

export type ConceptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'pedido'; ref: string; pedidoId: string }
  | { kind: 'venta'; ref: string; ventaId: string }
  | { kind: 'compra'; ref: string; compraId: string };

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
  let compraLinked = false;

  const pedidoRef =
    ctx.pedidoId && ctx.numeroPedidoLabel ? `#${ctx.numeroPedidoLabel}` : null;
  const ventaRef = ctx.ventaId && ctx.ventaLabel ? `#${ctx.ventaLabel}` : null;
  const compraRef = ctx.compraId && ctx.compraLabel ? `#${ctx.compraLabel}` : null;

  while ((match = regex.exec(concepto)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: concepto.slice(lastIndex, match.index) });
    }

    const ref = match[0];
    const textBefore = concepto
      .slice(Math.max(0, match.index - 40), match.index)
      .toLowerCase();
    const linked = linkRef(
      ref,
      textBefore,
      ctx,
      pedidoRef,
      ventaRef,
      compraRef,
      pedidoLinked,
      ventaLinked,
      compraLinked
    );

    if (linked) {
      segments.push(linked.segment);
      pedidoLinked = linked.pedidoLinked;
      ventaLinked = linked.ventaLinked;
      compraLinked = linked.compraLinked;
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
  compraRef: string | null,
  pedidoLinked: boolean,
  ventaLinked: boolean,
  compraLinked: boolean
):
  | {
      segment: ConceptSegment;
      pedidoLinked: boolean;
      ventaLinked: boolean;
      compraLinked: boolean;
    }
  | null {
  if (ctx.pedidoId && !pedidoLinked) {
    if (pedidoRef && ref === pedidoRef) {
      return {
        segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
        pedidoLinked: true,
        ventaLinked,
        compraLinked,
      };
    }
    if (textBefore.includes('pedido')) {
      return {
        segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
        pedidoLinked: true,
        ventaLinked,
        compraLinked,
      };
    }
  }

  if (ctx.ventaId && !ventaLinked) {
    if (ventaRef && ref === ventaRef) {
      return {
        segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
        pedidoLinked,
        ventaLinked: true,
        compraLinked,
      };
    }
    if (textBefore.includes('venta')) {
      return {
        segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
        pedidoLinked,
        ventaLinked: true,
        compraLinked,
      };
    }
  }

  if (ctx.compraId && !compraLinked) {
    if (compraRef && ref === compraRef) {
      return {
        segment: { kind: 'compra', ref, compraId: ctx.compraId },
        pedidoLinked,
        ventaLinked,
        compraLinked: true,
      };
    }
    if (textBefore.includes('compra')) {
      return {
        segment: { kind: 'compra', ref, compraId: ctx.compraId },
        pedidoLinked,
        ventaLinked,
        compraLinked: true,
      };
    }
  }

  if (ctx.pedidoId && !pedidoLinked && !ctx.ventaId && !ctx.compraId) {
    return {
      segment: { kind: 'pedido', ref, pedidoId: ctx.pedidoId },
      pedidoLinked: true,
      ventaLinked,
      compraLinked,
    };
  }

  if (ctx.ventaId && !ventaLinked && !ctx.pedidoId && !ctx.compraId) {
    return {
      segment: { kind: 'venta', ref, ventaId: ctx.ventaId },
      pedidoLinked,
      ventaLinked: true,
      compraLinked,
    };
  }

  if (ctx.compraId && !compraLinked && !ctx.pedidoId && !ctx.ventaId) {
    return {
      segment: { kind: 'compra', ref, compraId: ctx.compraId },
      pedidoLinked,
      ventaLinked,
      compraLinked: true,
    };
  }

  return null;
}
