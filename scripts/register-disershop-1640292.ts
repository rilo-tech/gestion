/**
 * Registra e-Ticket Disershop A-1640292 en negocio `rilo`.
 *
 *   npx tsx scripts/register-disershop-1640292.ts           # dry-run
 *   npx tsx scripts/register-disershop-1640292.ts --apply   # aplicar
 */
import dotenv from 'dotenv';
dotenv.config();
delete process.env.USE_FIRESTORE_EMULATOR;
delete process.env.FIRESTORE_EMULATOR_HOST;

import { db } from '../backend/firebase.ts';
import { persistPurchase, type ParsedPurchaseInput, type ParsedPurchaseLine } from '../backend/utils/purchase-finance.ts';
import { roundPurchaseMoney } from '../backend/utils/purchase-document-totals.ts';

const APPLY = process.argv.includes('--apply');
const businessId = 'rilo';
const SUPPLIER_ID = 've0Eql4w8WGmmDYNblJ0';
const SUPPLIER_NAME = 'Disershop';

/** Matches confirmados por el usuario (1A, 2A, 3A, 4A, 5B). */
const STOCK_LINES: Array<{
  productId: string;
  name: string;
  qty: number;
  unitNet: number;
  subtotalNet: number;
  remito: string;
}> = [
  { productId: 'AgWgZ1ncmizZJ7ovZzjt', name: 'Camiseta algodón Blanco XL', qty: 1, unitNet: 163.11, subtotalNet: 163.11, remito: 'CAMISETA BLANCA XL' },
  { productId: '8DAARUti44vePen3VcAv', name: 'Camiseta algodón Blanco XXL', qty: 3, unitNet: 163.11, subtotalNet: 489.34, remito: 'CAMISETA BLANCA XXL' },
  { productId: 'RDjLSxboi7gf1GWW4IP8', name: 'Camiseta algodón Negro S', qty: 3, unitNet: 163.11, subtotalNet: 489.34, remito: 'CAMISETA NEGRA S' },
  { productId: 'aeQwKjVgfbZ0CmhwDRTX', name: 'Camiseta algodón Gris S', qty: 4, unitNet: 163.11, subtotalNet: 652.46, remito: 'CAMISETA GRIS MELANGE S' },
  { productId: 'iskWDztErcOHLSHfBQ2O', name: 'Camiseta algodón Gris M', qty: 4, unitNet: 163.11, subtotalNet: 652.46, remito: 'CAMISETA GRIS MELANGE M' },
  { productId: '6oEAaQXLvCU6BXJRdlng', name: 'Camiseta algodón Gris L', qty: 6, unitNet: 163.11, subtotalNet: 978.69, remito: 'CAMISETA GRIS MELANGE L' },
  { productId: 'mFz7N0DZuPm7e3rnFUEg', name: 'Camiseta algodón Gris XXL', qty: 2, unitNet: 163.11, subtotalNet: 326.23, remito: 'CAMISETA GRIS MELANGE XXL' },
  { productId: '6cQzPzECB2LKyiVNejPo', name: 'Camiseta algodón Gris XL', qty: 2, unitNet: 163.11, subtotalNet: 326.23, remito: 'CAMISETA GRIS MELANGE XL' },
  { productId: '4T5HYLUkIqbcLREkd3Wt', name: 'Camiseta algodón niño Blanco 8', qty: 2, unitNet: 122.13, subtotalNet: 244.26, remito: 'CAMISETA NIÑO BLANCA 8' },
  { productId: 'GaXcXCa7DZo1n6LJ0l1w', name: 'Camiseta Dry Dama Negro S', qty: 1, unitNet: 122.13, subtotalNet: 122.13, remito: 'Camiseta dama DryCool II Negro S' },
  { productId: 'dymuKoPV1geuHzHjqHtL', name: 'Camiseta Dry Dama Negro XXL', qty: 2, unitNet: 122.13, subtotalNet: 244.26, remito: 'Camiseta dama DryCool II Negro XXL' },
  { productId: 'j0OMBf5NupL0b9gXIfYa', name: 'Camiseta Dry Dama Negro XL', qty: 1, unitNet: 122.13, subtotalNet: 122.13, remito: 'Camiseta dama DryCool II Negro XL' },
];

const INSUMO_LINES = [
  { desc: 'Tinta DTF Otter Pro 500ml Blanco', qty: 1, unitNet: 1631.15, subtotalNet: 1631.15 },
  { desc: 'Tinta DTF Otter Pro 500ml Amarillo', qty: 1, unitNet: 1385.25, subtotalNet: 1385.25 },
];

const DOC = {
  netTotal: 7827.05,
  taxTotal: 1721.95,
  grossTotal: 9549.0,
  taxRate: 22,
  numeroComprobante: 'A-1640292',
  fecha: '2026-09-14T12:00:00.000Z',
};

async function ensureInsumoProduct(descripcion: string, unitNet: number): Promise<{ id: string; name: string }> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const target = descripcion.toLowerCase();
  for (const doc of snap.docs) {
    const name = String(doc.data().nombre ?? '').trim();
    if (name.toLowerCase() === target) {
      return { id: doc.id, name };
    }
  }
  if (!APPLY) {
    return { id: `__dry_${descripcion.slice(0, 12)}__`, name: descripcion };
  }
  const ref = db.collection(`negocios/${businessId}/stock`).doc();
  const grossCost = roundPurchaseMoney(unitNet * (1 + DOC.taxRate / 100));
  await ref.set({
    nombre: descripcion,
    controlaStock: false,
    activo: true,
    costo: grossCost,
    stockActual: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origen: 'register-disershop-1640292',
  });
  return { id: ref.id, name: descripcion };
}

async function verifyStockProducts(): Promise<void> {
  for (const line of STOCK_LINES) {
    const snap = await db.doc(`negocios/${businessId}/stock/${line.productId}`).get();
    if (!snap.exists) throw new Error(`Producto no encontrado: ${line.productId} (${line.name})`);
    const data = snap.data() ?? {};
    const label = [data.nombre, data.color, data.talle].filter(Boolean).join(' ');
    console.log(`  OK ${line.qty}× ${line.name}  →  ${label}  (stock ${data.stockActual ?? 0})`);
  }
}

function buildItems(
  insumos: Array<{ id: string; name: string; qty: number; unitNet: number; subtotalNet: number; desc: string }>
): ParsedPurchaseLine[] {
  const items: ParsedPurchaseLine[] = [];
  let i = 0;
  for (const line of STOCK_LINES) {
    items.push({
      id: `line_${++i}`,
      tipoLinea: 'stock',
      ambito: 'negocio',
      descripcion: line.remito,
      productoId: line.productId,
      productoNombre: line.name,
      cantidad: line.qty,
      costoUnitario: line.unitNet,
      importe: line.subtotalNet,
      afectaStock: true,
      enOferta: false,
      descuentoOfertaPct: 0,
      ahorroOferta: 0,
    });
  }
  for (const line of insumos) {
    items.push({
      id: `line_${++i}`,
      tipoLinea: 'insumo',
      ambito: 'negocio',
      descripcion: line.desc,
      productoId: line.id.startsWith('__') ? undefined : line.id,
      productoNombre: line.name,
      cantidad: line.qty,
      costoUnitario: line.unitNet,
      importe: line.subtotalNet,
      afectaStock: false,
      enOferta: false,
      descuentoOfertaPct: 0,
      ahorroOferta: 0,
    });
  }
  return items;
}

async function alreadyRegistered(): Promise<string | null> {
  const snap = await db.collection(`negocios/${businessId}/compras`).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const nro = String(data.numeroComprobante ?? data.nroComprobante ?? '').trim();
    const notas = String(data.notas ?? '');
    if (nro.includes('1640292') || notas.includes('A-1640292')) {
      return doc.id;
    }
  }
  return null;
}

async function main() {
  console.log(`\n=== Compra Disershop A-1640292 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const existing = await alreadyRegistered();
  if (existing) {
    console.log(`Ya existe compra con ese comprobante: ${existing}`);
    process.exit(0);
  }

  console.log('Stock products:');
  await verifyStockProducts();

  const insumosResolved = [];
  for (const line of INSUMO_LINES) {
    const p = await ensureInsumoProduct(line.desc, line.unitNet);
    console.log(`  Insumo: ${p.name} (${p.id})`);
    insumosResolved.push({ ...p, qty: line.qty, unitNet: line.unitNet, subtotalNet: line.subtotalNet, desc: line.desc });
  }

  const items = buildItems(insumosResolved);
  const netLines = roundPurchaseMoney(items.reduce((s, l) => s + l.importe, 0));
  console.log(`\nNet lines sum: ${netLines} (doc ${DOC.netTotal})`);
  console.log(`Gross total: ${DOC.grossTotal}`);
  console.log(`Payment: efectivo (contado) — sin egreso de caja (como RILO Bot)`);

  const input: ParsedPurchaseInput = {
    proveedorId: SUPPLIER_ID,
    proveedor: SUPPLIER_NAME,
    notas: 'e-Ticket A-1640292 · Venta Contado Logística · registrado desde Cursor',
    numeroComprobante: DOC.numeroComprobante,
    tipoComprobante: 'factura',
    fecha: DOC.fecha,
    items,
    pago: {
      medioPagoId: 'efectivo',
      cuotas: 1,
    },
    totalNegocio: DOC.grossTotal,
    totalPersonal: 0,
    total: DOC.grossTotal,
    documentNetTotal: DOC.netTotal,
    documentTaxTotal: DOC.taxTotal,
    documentGrossTotal: DOC.grossTotal,
    documentTaxRate: DOC.taxRate,
    priceTaxMode: 'net',
  };

  if (!APPLY) {
    console.log('\nDry-run OK. Re-run with --apply to create purchase + stock.');
    return;
  }

  const result = await persistPurchase(businessId, input, {
    skipCash: true,
    skipProductCostUpdate: false,
  });

  console.log(`\nCREATED compra #${result.compraLabel} id=${result.id}`);

  for (const line of STOCK_LINES) {
    const snap = await db.doc(`negocios/${businessId}/stock/${line.productId}`).get();
    console.log(`  stock now ${line.name}: ${snap.data()?.stockActual}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
