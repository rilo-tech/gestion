import { db } from '../firebase.ts';
import { allocateOrderNumber, formatOrderNumber } from '../utils/order-number.ts';
import { allocateSaleNumber } from '../utils/sale-number.ts';
import { enrichOrderItemsStockControl } from '../utils/order-stock-reservations.ts';
import { normalizeTransactionDateToIso } from '../utils/transaction-date.ts';
import { computeComprobanteSaldoPendiente } from '../../shared/comprobantes-config.ts';
import {
  collectClientBalance,
  getClientPendingDebts,
} from '../utils/client-collections.ts';
import {
  normalizeOrderPhotos,
  uploadOrderPhoto,
  type OrderPhotoRecord,
} from '../utils/order-photos.ts';
import { downloadWhatsappMedia } from './meta-api.ts';
import { findClientByName, findStockItemByName } from './lookups.ts';
import { whatsappCopyForRubro } from './copy.ts';
import type { WhatsappCommandEntities, WhatsappPurchaseLine } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { parsePurchaseInput, persistPurchase, persistPurchaseDraft } from '../utils/purchase-finance.ts';
import { purchasePanelUrl } from './purchase-payment.ts';
import { assertCanCreateClient, assertCanCreateProduct } from '../auth/usage-gates.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function resolveClient(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<{ id: string; nombre: string } | null> {
  const clientId = String(entities.clientId ?? '').trim();
  if (clientId) {
    const snap = await db.doc(`negocios/${businessId}/clientes/${clientId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) return null;
    return {
      id: snap.id,
      nombre: String(data.nombre ?? entities.clientName ?? '').trim() || 'Cliente',
    };
  }

  const name = String(entities.clientName ?? '').trim();
  if (!name) return null;
  return findClientByName(businessId, name);
}

async function buildLineItems(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<{
  items: Array<{
    stockItemId: string;
    nombre: string;
    cantidad: number;
    precioVenta: number;
    costoUnitario: number;
    precioUnitario: number;
    subtotal: number;
    tipoLinea: 'producto' | 'concepto';
    mueveStock: boolean;
  }>;
  total: number;
}> {
  const quantity = Math.max(1, Number(entities.quantity) || 1);
  const productName = String(entities.productName ?? '').trim();
  const amount = Number(entities.amount) || 0;

  if (productName) {
    if (entities.productId) {
      const snap = await db.doc(`negocios/${businessId}/stock/${entities.productId}`).get();
      if (snap.exists) {
        const data = snap.data() as {
          nombre?: string;
          precioVenta?: number;
          precio?: number;
          costo?: number;
        };
        const nombre = String(data.nombre ?? productName).trim() || productName;
        const stockPrice = Number(data.precioVenta ?? data.precio) || 0;
        const unitPrice = amount > 0 ? amount / quantity : stockPrice || amount;
        const precio = unitPrice > 0 ? unitPrice : stockPrice;
        const subtotal = precio * quantity;
        return {
          items: [
            {
              stockItemId: snap.id,
              nombre,
              cantidad: quantity,
              precioVenta: precio,
              costoUnitario: Number(data.costo) || 0,
              precioUnitario: precio,
              subtotal,
              tipoLinea: 'producto',
              mueveStock: false,
            },
          ],
          total: subtotal,
        };
      }
    }

    const stock = await findStockItemByName(businessId, productName);
    if (stock) {
      const unitPrice = amount > 0 ? amount / quantity : stock.precioVenta || amount;
      const precio = unitPrice > 0 ? unitPrice : stock.precioVenta;
      const subtotal = precio * quantity;
      return {
        items: [
          {
            stockItemId: stock.id,
            nombre: stock.nombre,
            cantidad: quantity,
            precioVenta: precio,
            costoUnitario: stock.costo,
            precioUnitario: precio,
            subtotal,
            tipoLinea: 'producto',
            mueveStock: false,
          },
        ],
        total: subtotal,
      };
    }
  }

  const label =
    productName ||
    String(entities.notes ?? '').trim().slice(0, 80) ||
    String(entities.imageSummary ?? '').trim().slice(0, 80) ||
    'Concepto WhatsApp';
  const total = amount > 0 ? amount : 0;
  const unit = quantity > 0 ? total / quantity : total;

  return {
    items: [
      {
        stockItemId: '',
        nombre: label,
        cantidad: quantity,
        precioVenta: unit,
        costoUnitario: 0,
        precioUnitario: unit,
        subtotal: total,
        tipoLinea: 'concepto',
        mueveStock: false,
      },
    ],
    total,
  };
}

async function attachWhatsappPhotoToOrder(
  businessId: string,
  orderId: string,
  mediaId: string | undefined
): Promise<OrderPhotoRecord | null> {
  if (!mediaId) return null;
  const media = await downloadWhatsappMedia(mediaId);
  if (!media) return null;

  let contentType = media.contentType;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    contentType = 'image/jpeg';
  }

  const photo = await uploadOrderPhoto(
    businessId,
    orderId,
    media.buffer,
    contentType,
    'whatsapp-foto'
  );

  const orderRef = db.doc(`negocios/${businessId}/pedidos/${orderId}`);
  const snap = await orderRef.get();
  const existing = normalizeOrderPhotos(snap.data()?.fotos);
  await orderRef.update({ fotos: [...existing, photo] });
  return photo;
}

export async function createOrderFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  raw: string
): Promise<{ reply: string; orderId: string }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}". Creálo en el ERP o escribí el nombre exacto.`
        : `Indicá el cliente, por ejemplo: "${whatsappCopyForRubro(tenant.rubro).exampleOrder}".`
    );
  }

  const built = await buildLineItems(tenant.businessId, entities);
  if (built.total <= 0 && !entities.mediaId) {
    throw new Error(
      'No pude determinar el monto. Incluí el importe, por ejemplo: "pedido para Juan $5000".'
    );
  }

  const total = built.total > 0 ? built.total : 0;
  const orderItems = await enrichOrderItemsStockControl(
    tenant.businessId,
    built.items.map((line) => ({
      stockItemId: line.stockItemId,
      nombre: line.nombre,
      cantidad: line.cantidad,
      precioVenta: line.precioVenta,
      costoUnitario: line.costoUnitario,
      controlaStock: false,
    }))
  );

  const { numero, label } = await allocateOrderNumber(tenant.businessId);
  const now = normalizeTransactionDateToIso(entities.orderDate ?? new Date().toISOString());
  const fechaEntrega = normalizeTransactionDateToIso(entities.deliveryDate ?? now);
  const descripcion = [
    String(entities.notes ?? '').trim() || raw.trim(),
    entities.imageSummary ? `Foto: ${entities.imageSummary}` : '',
    'Origen: WhatsApp RiloBot',
  ]
    .filter(Boolean)
    .join(' · ');

  const docRef = await db.collection(`negocios/${tenant.businessId}/pedidos`).add({
    clienteId: client.id,
    clienteNombre: client.nombre,
    descripcion,
    estado: 'pendiente',
    fechaEntrega,
    items: orderItems,
    total,
    costoReal: orderItems.reduce(
      (acc, line) => acc + (Number(line.costoUnitario) || 0) * (Number(line.cantidad) || 0),
      0
    ),
    gananciaEstimada: 0,
    numeroPedido: numero,
    numeroPedidoLabel: label || formatOrderNumber(numero),
    esDonacion: total === 0,
    senia: 0,
    totalPagado: 0,
    saldo: total,
    pagos: [],
    seniaBloqueada: false,
    stockDescontado: false,
    stockPreparado: false,
    estadoStock: 'sin_preparar',
    fotos: [],
    origenWhatsapp: true,
    whatsappPhone: tenant.phone,
    negocioId: tenant.businessId,
    createdAt: now,
  });

  let photoNote = '';
  try {
    const photo = await attachWhatsappPhotoToOrder(
      tenant.businessId,
      docRef.id,
      entities.mediaId
    );
    if (photo) photoNote = ' Adjunté la foto al pedido.';
  } catch (error) {
    console.warn('[whatsapp] No se pudo adjuntar foto al pedido:', error);
    photoNote = ' (No pude adjuntar la foto; el pedido igual quedó registrado.)';
  }

  return {
    orderId: docRef.id,
    reply: `Listo. Pedido #${label} para ${client.nombre} por $${money(total)}.${photoNote}`,
  };
}

export async function createSaleFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  raw: string
): Promise<{ reply: string; ventaId: string }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "venta a María $2500".'
    );
  }

  const built = await buildLineItems(tenant.businessId, entities);
  if (built.total <= 0) {
    throw new Error('Indicá el monto de la venta, por ejemplo: "venta a María $2500".');
  }

  const paid = entities.paid === true;
  const montoCobrado = paid ? built.total : 0;
  const { numero, label } = await allocateSaleNumber(tenant.businessId);
  const timestamp = normalizeTransactionDateToIso(entities.orderDate ?? new Date().toISOString());
  const items = built.items.map((line) => ({
    tipoLinea: 'concepto' as const,
    stockItemId: line.stockItemId,
    nombre: line.nombre,
    descripcion: line.nombre,
    cantidad: line.cantidad,
    precioUnitario: line.precioUnitario,
    subtotal: line.subtotal,
    costoUnitario: line.costoUnitario,
    mueveStock: false,
  }));

  const ventaRef = await db.collection(`negocios/${tenant.businessId}/ventas`).add({
    origen: 'mostrador',
    pedidoId: null,
    estado: 'confirmada',
    tipoComprobante: 'ticket',
    numeroVenta: numero,
    ventaLabel: label,
    clienteId: client.id,
    items,
    total: built.total,
    costoReal: 0,
    gananciaEstimada: built.total,
    totalPagadoAnterior: 0,
    montoCobrado,
    saldoPendiente: computeComprobanteSaldoPendiente(built.total, montoCobrado),
    medioPago: 'efectivo',
    notas: [
      String(entities.notes ?? '').trim() || raw.trim(),
      'Origen: WhatsApp RiloBot',
    ]
      .filter(Boolean)
      .join(' · '),
    esDonacion: false,
    fecha: timestamp,
    origenWhatsapp: true,
    whatsappPhone: tenant.phone,
    negocioId: tenant.businessId,
  });

  if (montoCobrado > 0) {
    const movimiento = await db.collection(`negocios/${tenant.businessId}/movimientos_caja`).add({
      tipo: 'ingreso',
      monto: montoCobrado,
      medio: 'efectivo',
      concepto: `Venta WhatsApp #${label}`,
      ambito: 'general',
      fecha: timestamp,
      origenId: ventaRef.id,
      origenTipo: 'venta_mostrador',
      origenGrupo: 'venta',
      pedidoId: null,
      ventaId: ventaRef.id,
      ventaLabel: label,
      clienteId: client.id,
      negocioId: tenant.businessId,
    });
    await ventaRef.update({ movimientoCajaId: movimiento.id });
  }

  const saldo = computeComprobanteSaldoPendiente(built.total, montoCobrado);
  return {
    ventaId: ventaRef.id,
    reply:
      saldo > 0
        ? `Listo. Venta #${label} a ${client.nombre} por $${money(built.total)}. Queda saldo $${money(saldo)}.`
        : `Listo. Venta #${label} a ${client.nombre} por $${money(built.total)} (cobrada).`,
  };
}

export async function registerPaymentFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "pago de Juan $500".'
    );
  }

  const amount = Number(entities.amount) || 0;
  if (amount <= 0) {
    throw new Error('Indicá el monto del pago, por ejemplo: "pago de Juan $500".');
  }

  const result = await collectClientBalance(tenant.businessId, client.id, {
    monto: amount,
    medioPago: 'efectivo',
    notas: 'Cobro vía WhatsApp RiloBot',
  });

  return {
    reply: `Registré cobro de $${money(result.monto)} a ${client.nombre}. Saldo restante: $${money(result.saldoRestante)}.`,
  };
}

export async function queryBalanceFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "saldo de Pedro".'
    );
  }

  const debts = await getClientPendingDebts(tenant.businessId, client.id);
  const total = debts.reduce((acc, debt) => acc + debt.saldo, 0);
  if (total <= 0) {
    return { reply: `${client.nombre} no tiene saldo pendiente.` };
  }

  const detail = debts
    .slice(0, 5)
    .map((debt) => `• ${debt.label}: $${money(debt.saldo)}`)
    .join('\n');

  return {
    reply: `Saldo de ${client.nombre}: $${money(total)}.\n${detail}`,
  };
}

export async function createClientFromWhatsapp(
  businessId: string,
  nombre: string
): Promise<{ id: string; nombre: string }> {
  const clean = String(nombre ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del cliente.');
  await assertCanCreateClient(businessId);

  const docRef = await db.collection(`negocios/${businessId}/clientes`).add({
    nombre: clean,
    activo: true,
    telefono: '',
    email: '',
    notas: 'Alta vía WhatsApp RiloBot',
    origenWhatsapp: true,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre: clean };
}

export async function createSupplierFromWhatsapp(
  businessId: string,
  nombre: string
): Promise<{ id: string; nombre: string }> {
  const clean = String(nombre ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del proveedor.');

  const docRef = await db.collection(`negocios/${businessId}/proveedores`).add({
    nombre: clean,
    activo: true,
    telefono: '',
    email: '',
    notas: 'Alta vía WhatsApp RiloBot',
    origenWhatsapp: true,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre: clean };
}

/** Catálogo para pedidos/ventas (sin stock) o para compras (con control de stock). */
export async function createCatalogProductFromWhatsapp(
  businessId: string,
  input: { nombre: string; precioVenta?: number; costo?: number; controlaStock?: boolean }
): Promise<{ id: string; nombre: string; precioVenta: number }> {
  const nombre = String(input.nombre ?? '').trim();
  if (!nombre) throw new Error('Indicá el nombre del producto.');
  await assertCanCreateProduct(businessId);
  const precioVenta = Number(input.precioVenta) || 0;
  const costo = Number(input.costo) || 0;
  const controlaStock = input.controlaStock === true;

  const docRef = await db.collection(`negocios/${businessId}/stock`).add({
    nombre,
    precioVenta,
    precio: precioVenta,
    costo,
    precioSugerido: precioVenta,
    stockActual: 0,
    stockMinimo: 0,
    stockReservado: 0,
    controlaStock,
    permitirStockNegativo: false,
    activo: true,
    notas: controlaStock
      ? 'Alta vía WhatsApp RiloBot (compra)'
      : 'Alta vía WhatsApp RiloBot (sin control de stock)',
    origenWhatsapp: true,
    negocioId: businessId,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre, precioVenta };
}

export async function queryCashTodayFromWhatsapp(
  tenant: WhatsappTenantContext
): Promise<{ reply: string }> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const snap = await db.collection(`negocios/${tenant.businessId}/movimientos_caja`).get();
  let ingresos = 0;
  let egresos = 0;
  let count = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as { tipo?: string; monto?: number; fecha?: string };
    const fecha = String(data.fecha ?? '');
    if (!fecha || fecha < startIso || fecha > endIso) continue;
    const monto = Number(data.monto) || 0;
    if (data.tipo === 'egreso') egresos += monto;
    else ingresos += monto;
    count += 1;
  }

  const neto = ingresos - egresos;
  return {
    reply:
      count === 0
        ? 'Hoy no hay movimientos de caja registrados.'
        : `Caja de hoy (${count} mov.):\n• Ingresos: $${money(ingresos)}\n• Egresos: $${money(egresos)}\n• Neto: $${money(neto)}`,
  };
}

export async function registerCashFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const tipo = entities.cashType === 'egreso' ? 'egreso' : 'ingreso';
  const amount = Number(entities.amount) || 0;
  if (amount <= 0) {
    throw new Error('Indicá el monto, por ejemplo: "gasto 500 nafta".');
  }
  const concepto =
    String(entities.cashConcept ?? '').trim() ||
    String(entities.notes ?? '').trim() ||
    (tipo === 'egreso' ? 'Gasto WhatsApp' : 'Ingreso WhatsApp');

  const fecha = new Date().toISOString();
  await db.collection(`negocios/${tenant.businessId}/movimientos_caja`).add({
    tipo,
    monto: amount,
    medio: 'efectivo',
    concepto,
    categoriaId: null,
    descripcion: 'Origen: WhatsApp RiloBot',
    ambito: 'general',
    fecha,
    createdAt: fecha,
    origenTipo: tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
    origenGrupo: 'manual',
    origenId: null,
    pedidoId: null,
    numeroPedido: null,
    numeroPedidoLabel: null,
    clienteId: null,
    negocioId: tenant.businessId,
    origenWhatsapp: true,
    whatsappPhone: tenant.phone,
  });

  return {
    reply: `Listo. ${tipo === 'egreso' ? 'Egreso' : 'Ingreso'} de $${money(amount)}: ${concepto}.`,
  };
}

function purchaseLinesFromEntities(entities: WhatsappCommandEntities): WhatsappPurchaseLine[] {
  const existing = Array.isArray(entities.purchaseLines) ? entities.purchaseLines : [];
  if (existing.length) {
    return existing.filter((line) => String(line.productName ?? '').trim() && Number(line.quantity) > 0);
  }
  const name = String(entities.productName ?? '').trim();
  if (!name) return [];
  const quantity = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  const unitCost = amount > 0 ? amount / quantity : 0;
  return [
    {
      productName: name,
      productId: entities.productId,
      quantity,
      unitCost,
    },
  ];
}

export async function createPurchaseFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  raw: string
): Promise<{ reply: string; compraId: string; draft?: boolean }> {
  const supplierName = String(entities.supplierName ?? '').trim();
  if (!supplierName && !entities.supplierId) {
    throw new Error('Indicá el proveedor, por ejemplo: "compra a Distribuidora López" o mandá la foto de la factura.');
  }

  const lines = purchaseLinesFromEntities(entities);
  if (!lines.length) {
    throw new Error(
      'No pude leer los productos de la compra. Mandá la foto del remito/factura o el detalle (producto, cantidad y costo).'
    );
  }

  const items = lines.map((line, index) => {
    const productId = String(line.productId ?? '').trim();
    if (!productId) {
      throw new Error(`Falta vincular el producto "${line.productName}" al catálogo.`);
    }
    const cantidad = Math.max(1, Number(line.quantity) || 1);
    const costoUnitario = Math.max(0, Number(line.unitCost) || 0);
    return {
      id: `wa_${index + 1}`,
      tipoLinea: 'stock' as const,
      ambito: 'negocio',
      productoId: productId,
      productoNombre: line.productName,
      descripcion: line.productName,
      cantidad,
      costoUnitario,
      importe: cantidad * costoUnitario,
      afectaStock: true,
      enOferta: false,
    };
  });

  const medioPagoId = String(entities.paymentMedioId ?? '').trim() || 'efectivo';
  const saveAsDraft = entities.saveAsDraft === true || !String(entities.paymentMedioId ?? '').trim();
  const pago = {
    medioPagoId,
    tarjetaId: String(entities.paymentTarjetaId ?? '').trim() || undefined,
    cuotas: Math.max(1, Number(entities.paymentCuotas) || 1),
    fechaPrimerVencimiento: String(entities.paymentDueDate ?? '').trim() || undefined,
  };

  const parsed = await parsePurchaseInput(
    tenant.businessId,
    {
      proveedorId: entities.supplierId ?? '',
      proveedor: supplierName,
      notas: [
        String(entities.notes ?? '').trim() || raw.trim(),
        entities.imageSummary ? `Foto: ${entities.imageSummary}` : '',
        'Origen: WhatsApp RiloBot',
      ]
        .filter(Boolean)
        .join(' · '),
      numeroComprobante: String(entities.invoiceNumber ?? '').trim(),
      tipoComprobante: 'factura',
      fecha: entities.orderDate ?? new Date().toISOString().slice(0, 10),
      items,
      pago,
    },
    saveAsDraft ? { relaxed: true } : undefined
  );

  if (parsed.error || !parsed.input) {
    throw new Error(parsed.error || 'No pude armar la compra.');
  }

  if (saveAsDraft) {
    const saved = await persistPurchaseDraft(tenant.businessId, parsed.input);
    const url = purchasePanelUrl(saved.id, true);
    return {
      compraId: saved.id,
      draft: true,
      reply:
        `Guardé un borrador de compra a ${supplierName || 'proveedor'} por $${money(parsed.input.total)}.\n` +
        `No moví stock ni caja.\n` +
        `Completalo en el panel (pago y confirmar):\n${url}`,
    };
  }

  const timestamp = new Date().toISOString();
  await Promise.all(
    items.map((line) =>
      db.doc(`negocios/${tenant.businessId}/stock/${line.productoId}`).update({
        controlaStock: true,
        updatedAt: timestamp,
      })
    )
  );

  const saved = await persistPurchase(tenant.businessId, parsed.input);
  const pagoLabel =
    String(entities.paymentTarjetaLabel ?? '').trim() ||
    String(entities.paymentMedioLabel ?? medioPagoId).trim();
  return {
    compraId: saved.id,
    reply:
      `Listo. Compra ${saved.compraLabel} a ${supplierName || 'proveedor'} por $${money(parsed.input.total)}.\n` +
      `Pago: ${pagoLabel}. El stock ya se sumó.`,
  };
}
