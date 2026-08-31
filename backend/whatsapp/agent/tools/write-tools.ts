import { assertCanRunWhatsappWrite } from '../../../auth/usage-gates.ts';
import { db } from '../../../firebase.ts';
import { resolveOrderLabel } from '../../../utils/order-number.ts';
import { findClient } from '../../../domain/client/index.ts';
import { findProduct } from '../../../domain/stock/index.ts';
import { resolveOrderForStatus } from '../../order-status.ts';
import type { WhatsappCommandEntities } from '../ai-command-parser.ts';
import type { AgentOperationPlan, AgentPlannedWrite, ToolDefinition, ToolExecutionContext } from '../tool-types.ts';
import {
  nBoolean,
  nNumber,
  nString,
  reqBoolean,
  reqNumber,
  reqString,
  strictObject,
} from '../strict-tool-schema.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function normalizeRequestedOrderStatus(raw: string): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (value.includes('entreg')) return 'entregado';
  if (value.includes('pend')) return 'pendiente';
  if (value.includes('produc')) return 'en_produccion';
  if (value.includes('list')) return 'listo';
  return String(raw ?? '').trim();
}

async function resolveOrderId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ orderId: string; label: string; clientName?: string; fromStatus?: string }> {
  const direct = String(args.orderId ?? '').trim();
  if (direct) {
    const snap = await db.doc(`negocios/${ctx.tenant.businessId}/pedidos/${direct}`).get();
    if (!snap.exists) throw new Error('No encontré ese pedido.');
    const data = snap.data() as Record<string, unknown>;
    return {
      orderId: direct,
      label: resolveOrderLabel({
        numeroPedido: Number(data.numeroPedido) || undefined,
        numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
      }),
      clientName: String(data.clienteNombre ?? '').trim() || undefined,
      fromStatus: String(data.estado ?? '').trim() || undefined,
    };
  }
  const entities: WhatsappCommandEntities = {
    targetOrderId: String(ctx.state?.focusOrder?.id ?? ctx.state?.focusEntities?.order?.id ?? ''),
    targetOrderLabel: String(ctx.state?.focusOrder?.label ?? ctx.state?.focusEntities?.order?.label ?? ''),
    clientName: String(args.clientName ?? ctx.state?.focusEntities?.client?.name ?? ''),
    orderNumber: String(args.orderNumber ?? args.query ?? ''),
  };
  const resolution = await resolveOrderForStatus(ctx.tenant.businessId, ctx.tenant.phone, entities);
  if (resolution.status !== 'unique') {
    throw new Error('No encontré el pedido. Decime el número o el cliente.');
  }
  return {
    orderId: resolution.order.id,
    label: resolution.order.label,
    clientName: resolution.order.clientName,
    fromStatus: resolution.order.estado,
  };
}

function baseWriteTool(
  name: string,
  description: string,
  capability: string,
  properties: Record<string, unknown>
): ToolDefinition {
  return {
    name,
    description,
    mode: 'write',
    capability,
    permission: 'write',
    parameters: strictObject(properties),
  };
}

export const WRITE_TOOLS: ToolDefinition[] = [
  baseWriteTool('create_client', 'Alta de cliente.', 'create_client', {
    name: reqString(),
    telefono: nString(),
  }),
  baseWriteTool('update_client', 'Actualiza un cliente existente.', 'update_client', {
    clientId: reqString(),
    name: nString(),
    telefono: nString(),
  }),
  baseWriteTool('create_product', 'Alta de producto en catálogo.', 'create_product', {
    name: reqString(),
    salePrice: nNumber(),
    cost: nNumber(),
    initialStock: nNumber(),
    controlsStock: nBoolean(),
  }),
  baseWriteTool('update_product_price', 'Actualiza precio de venta.', 'update_product_price', {
    productId: nString(),
    query: nString(),
    salePrice: reqNumber(),
  }),
  baseWriteTool('update_product_cost', 'Actualiza costo de producto.', 'update_product_cost', {
    productId: nString(),
    query: nString(),
    cost: reqNumber(),
  }),
  baseWriteTool('adjust_stock', 'Ajusta stock (+/-).', 'adjust_stock', {
    productId: nString(),
    query: nString(),
    quantity: reqNumber(),
    reason: nString(),
  }),
  baseWriteTool('set_stock', 'Fija stock absoluto.', 'set_stock', {
    productId: nString(),
    query: nString(),
    stock: reqNumber(),
  }),
  baseWriteTool('register_order_payment', 'Registra cobro parcial de pedido.', 'register_order_payment', {
    orderId: nString(),
    amount: reqNumber(),
    clientName: nString(),
    orderNumber: nString(),
  }),
  baseWriteTool('register_order_deposit', 'Registra seña de pedido.', 'register_order_deposit', {
    orderId: nString(),
    amount: reqNumber(),
    clientName: nString(),
    orderNumber: nString(),
  }),
  baseWriteTool('collect_order_full_balance', 'Cobra saldo completo del pedido.', 'collect_order_full_balance', {
    orderId: nString(),
    clientName: nString(),
    orderNumber: nString(),
  }),
  baseWriteTool('update_order_status', 'Cambia estado del pedido.', 'update_order_status', {
    orderId: nString(),
    status: reqString(),
    clientName: nString(),
    orderNumber: nString(),
  }),
  baseWriteTool('register_cash_movement', 'Registra ingreso o egreso de caja.', 'register_cash', {
    type: reqString(),
    amount: reqNumber(),
    concept: nString(),
    ambitoId: nString(),
  }),
  baseWriteTool('create_supplier', 'Alta de proveedor.', 'create_supplier', { name: reqString() }),
  baseWriteTool('create_order', 'Crea un pedido.', 'create_order', {
    clientQuery: nString(),
    clientId: nString(),
    notes: nString(),
    deliveryDate: nString(),
  }),
  baseWriteTool('create_sale', 'Registra una venta.', 'create_sale', {
    clientId: nString(),
    amount: reqNumber(),
  }),
  baseWriteTool('create_purchase', 'Registra una compra.', 'create_purchase', {
    supplierQuery: nString(),
    amount: reqNumber(),
  }),
  baseWriteTool('add_order_extra_cost', 'Agrega costo extra a pedido.', 'add_order_extra_cost', {
    orderId: nString(),
    amount: reqNumber(),
    concept: nString(),
  }),
];

type WriteHandler = {
  prepare: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<AgentPlannedWrite>;
};

async function ensureWritePermission(ctx: ToolExecutionContext): Promise<void> {
  await assertCanRunWhatsappWrite(ctx.tenant.businessId);
}

async function resolveProductId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ productId: string; name: string }> {
  const direct = String(args.productId ?? '').trim();
  if (direct) {
    const snap = await db.doc(`negocios/${ctx.tenant.businessId}/stock/${direct}`).get();
    if (!snap.exists) throw new Error('No encontré ese producto.');
    return { productId: direct, name: String(snap.data()?.nombre ?? '').trim() };
  }
  const query = String(args.query ?? ctx.state?.focusEntities?.product?.name ?? '').trim();
  if (!query) throw new Error('Indicá el producto.');
  const resolved = await findProduct(ctx.tenant.businessId, query, { utterance: ctx.rawUserMessage });
  if (resolved.status === 'not_found') throw new Error(`No encontré un producto llamado ${query}.`);
  if (resolved.status === 'ambiguous') throw new Error(`Encontré más de un producto parecido a ${query}.`);
  return { productId: resolved.entity!.id, name: resolved.entity!.name };
}

async function resolveClientId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ clientId: string; name: string }> {
  const direct = String(args.clientId ?? '').trim();
  if (direct) return { clientId: direct, name: String(args.name ?? ctx.state?.focusEntities?.client?.name ?? '') };
  const query = String(args.clientQuery ?? args.name ?? ctx.state?.focusEntities?.client?.name ?? '').trim();
  if (!query) throw new Error('Indicá el cliente.');
  const resolved = await findClient(ctx.tenant.businessId, query, { utterance: ctx.rawUserMessage });
  if (resolved.status === 'not_found') throw new Error(`No encontré un cliente llamado ${query}.`);
  if (resolved.status === 'ambiguous') throw new Error(`Encontré más de un cliente parecido a ${query}.`);
  return { clientId: resolved.entity!.id, name: resolved.entity!.name };
}

export const WRITE_TOOL_HANDLERS: Record<string, WriteHandler> = {
  create_client: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el nombre del cliente.');
      return {
        tool: 'create_client',
        label: `Crear cliente ${name}`,
        args: { name, telefono: String(args.telefono ?? '').trim() || undefined },
      };
    },
  },
  update_client: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const clientId = String(args.clientId ?? ctx.state?.focusEntities?.client?.id ?? '').trim();
      if (!clientId) throw new Error('Indicá el cliente.');
      return {
        tool: 'update_client',
        label: 'Actualizar cliente',
        args: {
          clientId,
          name: args.name != null ? String(args.name) : undefined,
          telefono: args.telefono != null ? String(args.telefono) : undefined,
        },
      };
    },
  },
  create_product: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el producto.');
      return {
        tool: 'create_product',
        label: `Crear producto ${name}`,
        args: {
          name,
          salePrice: args.salePrice != null ? Number(args.salePrice) : undefined,
          cost: args.cost != null ? Number(args.cost) : undefined,
          initialStock: args.initialStock != null ? Number(args.initialStock) : undefined,
          controlsStock: args.controlsStock === true,
        },
      };
    },
  },
  update_product_price: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const salePrice = Number(args.salePrice) || 0;
      if (salePrice <= 0) throw new Error('Indicá el precio de venta.');
      return {
        tool: 'update_product_price',
        label: `Precio ${product.name} → $${money(salePrice)}`,
        args: { productId: product.productId, salePrice },
      };
    },
  },
  update_product_cost: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const cost = Number(args.cost) || 0;
      if (cost < 0) throw new Error('Indicá el costo.');
      return {
        tool: 'update_product_cost',
        label: `Costo ${product.name} → $${money(cost)}`,
        args: { productId: product.productId, cost },
      };
    },
  },
  adjust_stock: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const quantity = Number(args.quantity) || 0;
      if (!quantity) throw new Error('Indicá la cantidad.');
      return {
        tool: 'adjust_stock',
        label: `Stock ${product.name} ${quantity > 0 ? '+' : ''}${quantity}`,
        args: { productId: product.productId, quantity, reason: String(args.reason ?? 'Ajuste WhatsApp') },
      };
    },
  },
  set_stock: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const stock = Number(args.stock);
      if (!Number.isFinite(stock) || stock < 0) throw new Error('Indicá el stock.');
      return {
        tool: 'set_stock',
        label: `Stock ${product.name} → ${stock}`,
        args: { productId: product.productId, stock },
      };
    },
  },
  register_order_payment: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto del cobro.');
      return {
        tool: 'register_order_payment',
        label: `Cobrar $${money(amount)} al pedido #${order.label}`,
        args: { orderId: order.orderId, amount, clientName: order.clientName },
      };
    },
  },
  register_order_deposit: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto de la seña.');
      return {
        tool: 'register_order_deposit',
        label: `Seña $${money(amount)} al pedido #${order.label}`,
        args: { orderId: order.orderId, amount, clientName: order.clientName, paymentKind: 'senia' },
      };
    },
  },
  collect_order_full_balance: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      return {
        tool: 'collect_order_full_balance',
        label: `Cobrar saldo completo del pedido #${order.label}`,
        args: { orderId: order.orderId, payFullBalance: true, clientName: order.clientName },
      };
    },
  },
  update_order_status: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const status = normalizeRequestedOrderStatus(String(args.status ?? ''));
      if (!status) throw new Error('Indicá el estado.');
      return {
        tool: 'update_order_status',
        label: `Estado #${order.label} → ${status}`,
        args: {
          businessId: ctx.tenant.businessId,
          orderId: order.orderId,
          orderNumber: order.label,
          fromStatus: order.fromStatus,
          status,
          requestedStatus: status,
          clientName: order.clientName,
        },
      };
    },
  },
  register_cash_movement: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const type = String(args.type ?? '').trim().toLowerCase();
      const amount = Number(args.amount) || 0;
      const concept = String(args.concept ?? '').trim();
      if (!['ingreso', 'egreso'].includes(type)) throw new Error('Indicá ingreso o egreso.');
      if (amount <= 0) throw new Error('Indicá el monto.');
      if (!concept) throw new Error('Indicá el concepto.');
      return {
        tool: 'register_cash_movement',
        label: `${type === 'egreso' ? 'Egreso' : 'Ingreso'} $${money(amount)} · ${concept}`,
        args: { type, amount, concept, ambitoId: String(args.ambitoId ?? '').trim() || undefined },
      };
    },
  },
  create_supplier: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el proveedor.');
      return { tool: 'create_supplier', label: `Crear proveedor ${name}`, args: { name } };
    },
  },
  create_order: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const client = await resolveClientId(ctx, args);
      return {
        tool: 'create_order',
        label: `Pedido para ${client.name}`,
        args: {
          clientId: client.clientId,
          clientName: client.name,
          notes: String(args.notes ?? '').trim() || undefined,
          deliveryDate: String(args.deliveryDate ?? '').trim() || undefined,
        },
      };
    },
  },
  create_sale: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      return {
        tool: 'create_sale',
        label: 'Registrar venta',
        args: {
          clientId: String(args.clientId ?? '').trim() || undefined,
          amount: Number(args.amount) || 0,
        },
      };
    },
  },
  create_purchase: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      return {
        tool: 'create_purchase',
        label: 'Registrar compra',
        args: {
          supplierQuery: String(args.supplierQuery ?? '').trim() || undefined,
          amount: Number(args.amount) || 0,
        },
      };
    },
  },
  add_order_extra_cost: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto del costo.');
      return {
        tool: 'add_order_extra_cost',
        label: `Costo extra #${order.label} · $${money(amount)}`,
        args: {
          orderId: order.orderId,
          amount,
          concept: String(args.concept ?? 'Costo extra').trim(),
        },
      };
    },
  },
};

export function buildAgentOperationPlan(
  writes: AgentPlannedWrite[],
  rawUserMessage: string,
  idempotencyKey?: string
): AgentOperationPlan {
  return {
    version: 'v4',
    writes,
    summary: {
      title: writes.length === 1 ? writes[0]!.label : 'Confirmar operaciones',
      lines: writes.map((row) => `• ${row.label}`),
    },
    rawUserMessage,
    idempotencyKey,
  };
}

export function parseAgentOperationPlan(value: unknown): AgentOperationPlan | null {
  if (!value || typeof value !== 'object') return null;
  const plan = value as AgentOperationPlan;
  if (plan.version !== 'v4' || !Array.isArray(plan.writes)) return null;
  return plan;
}
