/**
 * Reparación idempotente de compra #00018 (Disershop).
 *
 * Uso:
 *   npx tsx scripts/repair-compra-00018-disershop.ts           # auditoría + dry-run
 *   npx tsx scripts/repair-compra-00018-disershop.ts --apply   # aplicar cambios
 */
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolvePurchaseLabel } from '../backend/utils/purchase-number.ts';
import { loadFinanzasConfig, findTarjetaInConfig, getMedioPagoById } from '../backend/utils/finance-config.ts';
import {
  parsePurchaseInput,
  updateConfirmedPurchase,
  type ParsedPurchaseInput,
  type ParsedPurchaseLine,
} from '../backend/utils/purchase-finance.ts';
import { buildInstallmentMontos } from '../backend/utils/card-statements.ts';
import { invalidatePayablesReconcileCache } from '../backend/utils/payables.ts';
import { roundPurchaseMoney } from '../backend/utils/purchase-document-totals.ts';

const APPLY = process.argv.includes('--apply');
const businessId = 'rilo';
const TARGET_LABEL = '00018';

const DOCUMENT = {
  netTotal: 3571.31,
  taxTotal: 785.69,
  grossTotal: 4357.0,
  taxRate: 22,
  insumo: {
    descripcion: 'Caja de Mantenimiento Epson F170',
    importeNeto: 1433.61,
  },
  lineFixes: [
    { match: /negro.*\bL\b/i, importe: 978.69 },
    { match: /negro.*\bM\b/i, importe: 489.34 },
    { match: /negro.*\bXL\b/i, importe: 489.34 },
    { match: /taza.*AA|jarro.*AA/i, importe: 180.33 },
  ],
};

const CARD_ID = 'brou_recompensa_master_loreley_rizzo';
const INSUMO_LINE_ID = 'repair_insumo_epson_f170';

function snapshotDir(): string {
  const dir = join(process.cwd(), 'scripts', 'snapshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function findPurchase(): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const col = db.collection(`negocios/${businessId}/compras`);
  const byLabel = await col.where('compraLabel', '==', TARGET_LABEL).limit(1).get();
  if (!byLabel.empty) {
    const doc = byLabel.docs[0]!;
    return { id: doc.id, data: doc.data() as Record<string, unknown> };
  }
  const all = await col.get();
  for (const doc of all.docs) {
    const label = resolvePurchaseLabel({ ...doc.data(), id: doc.id });
    if (label === TARGET_LABEL) return { id: doc.id, data: doc.data() as Record<string, unknown> };
  }
  return null;
}

async function collectSnapshot(compraId: string, data: Record<string, unknown>) {
  const [stockMov, cashMov, cuotas] = await Promise.all([
    db.collection(`negocios/${businessId}/movimientos_stock`).where('compraId', '==', compraId).get(),
    db.collection(`negocios/${businessId}/movimientos_caja`).where('compraId', '==', compraId).get(),
    db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).where('compraId', '==', compraId).get(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    compraId,
    compraLabel: resolvePurchaseLabel({ ...data, id: compraId }),
    purchase: data,
    stockMovements: stockMov.docs.map((d) => ({ id: d.id, ...d.data() })),
    cashMovements: cashMov.docs.map((d) => ({ id: d.id, ...d.data() })),
    cuotas: cuotas.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

function findInsumoLine(items: ParsedPurchaseLine[]): ParsedPurchaseLine | undefined {
  return items.find((line) => {
    const desc = `${line.descripcion} ${line.productoNombre ?? ''}`.toLowerCase();
    return desc.includes('mantenimiento') && desc.includes('epson');
  });
}

function fixStockLineImportes(items: ParsedPurchaseLine[]): ParsedPurchaseLine[] {
  return items.map((line) => {
    if (!line.afectaStock) return line;
    const name = `${line.productoNombre ?? ''} ${line.descripcion ?? ''}`;
    const fix = DOCUMENT.lineFixes.find((row) => row.match.test(name));
    if (!fix) return line;
    return { ...line, importe: fix.importe, subtotal: fix.importe } as ParsedPurchaseLine;
  });
}

async function findOrCreateNonStockProduct(
  descripcion: string
): Promise<{ id: string; name: string; created: boolean }> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const normalized = descripcion.toLowerCase();
  for (const doc of snap.docs) {
    const name = String(doc.data().nombre ?? '').trim();
    if (name.toLowerCase() === normalized || name.toLowerCase().includes('mantenimiento epson f170')) {
      return { id: doc.id, name, created: false };
    }
  }
  if (!APPLY) return { id: '__dry_run_new_product__', name: descripcion, created: true };
  const ref = db.collection(`negocios/${businessId}/stock`).doc();
  const grossCost = roundPurchaseMoney(DOCUMENT.insumo.importeNeto * (1 + DOCUMENT.taxRate / 100));
  await ref.set({
    nombre: descripcion,
    controlaStock: false,
    activo: true,
    costo: grossCost,
    stockActual: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origen: 'repair-compra-00018',
  });
  return { id: ref.id, name: descripcion, created: true };
}

function buildRepairedInput(
  parsed: ParsedPurchaseInput,
  insumoProduct: { id: string; name: string }
): ParsedPurchaseInput {
  let items = fixStockLineImportes(parsed.items);
  if (!findInsumoLine(items)) {
    items = [
      ...items,
      {
        id: INSUMO_LINE_ID,
        tipoLinea: 'insumo',
        ambito: 'negocio',
        descripcion: DOCUMENT.insumo.descripcion,
        productoId: insumoProduct.id.startsWith('__') ? undefined : insumoProduct.id,
        productoNombre: insumoProduct.name,
        cantidad: 0,
        costoUnitario: 0,
        importe: DOCUMENT.insumo.importeNeto,
        afectaStock: false,
        enOferta: false,
        descuentoOfertaPct: 0,
        ahorroOferta: 0,
      },
    ];
  }

  let totalNegocio = 0;
  for (const line of items) {
    if (line.ambito !== 'personal') totalNegocio += line.importe;
  }

  return {
    ...parsed,
    items,
    pago: {
      ...parsed.pago,
      medioPagoId: 'tarjeta_credito',
      tarjetaId: CARD_ID,
      tarjetaLabel: parsed.pago.tarjetaLabel ?? 'BROU RECOMPENSA MASTER Loreley Rizzo',
      cuotas: 3,
    },
    totalNegocio: roundPurchaseMoney(totalNegocio),
    totalPersonal: 0,
    total: DOCUMENT.grossTotal,
    documentNetTotal: DOCUMENT.netTotal,
    documentTaxTotal: DOCUMENT.taxTotal,
    documentGrossTotal: DOCUMENT.grossTotal,
    documentTaxRate: DOCUMENT.taxRate,
    priceTaxMode: 'net',
  };
}

function isAlreadyRepaired(data: Record<string, unknown>, items: ParsedPurchaseLine[]): boolean {
  const total = Number(data.total) || 0;
  const hasInsumo = Boolean(findInsumoLine(items));
  return total === DOCUMENT.grossTotal && hasInsumo;
}

async function main(): Promise<void> {
  console.log(`\n=== Reparación compra #${TARGET_LABEL} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const found = await findPurchase();
  if (!found) {
    console.log('PURCHASE FOUND: NO');
    process.exit(1);
  }

  const { id: compraId, data } = found;
  console.log(`PURCHASE FOUND: YES (${compraId})`);
  console.log(`CURRENT TOTAL: ${data.total}`);

  const snapshot = await collectSnapshot(compraId, data);
  const snapPath = join(snapshotDir(), `compra-${TARGET_LABEL}-${Date.now()}.json`);
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot: ${snapPath}`);

  const finanzas = await loadFinanzasConfig(businessId);
  const parsed = await parsePurchaseInput(businessId, data, { skipSupplierLookup: true, finanzas, relaxed: true });
  if (parsed.error || !parsed.input) throw new Error(parsed.error ?? 'parse failed');

  const stockLines = parsed.input.items.filter((l) => l.afectaStock);
  console.log(`ITEMS STOCK: ${stockLines.length}`);
  console.log(`NON-STOCK ITEM: ${findInsumoLine(parsed.input.items) ? 'OK' : 'MISSING'}`);

  const card = findTarjetaInConfig(finanzas.tarjetas, CARD_ID);
  if (!card) throw new Error('Tarjeta BROU no encontrada');
  console.log(`CARD: ${card.label}`);
  console.log(`CARD CONFIG: cierre=${card.diaCierre ?? '—'} venc=${card.diaVencimiento ?? '—'}`);

  const insumoProduct = await findOrCreateNonStockProduct(DOCUMENT.insumo.descripcion);
  const repaired = buildRepairedInput(parsed.input, insumoProduct);
  const netLines = roundPurchaseMoney(repaired.items.reduce((s, l) => s + l.importe, 0));
  console.log(`Net lines: ${netLines} (doc ${DOCUMENT.netTotal})`);
  console.log(`CORRECTED TOTAL: ${repaired.total}`);
  console.log(`PAYMENT METHOD: ${repaired.pago.medioPagoId}`);
  console.log(`INSTALLMENTS: ${repaired.pago.cuotas}`);
  console.log(
    `FIRST INSTALLMENT: ${repaired.pago.fechaPrimerVencimiento ?? 'PENDING (sin diaVencimiento en tarjeta)'}`
  );

  const installmentMontos = buildInstallmentMontos(repaired.total, repaired.pago.cuotas);
  console.log(`INSTALLMENT TOTAL: ${roundPurchaseMoney(installmentMontos.reduce((a, b) => a + b, 0))}`);
  console.log(`CASH MOVEMENTS: ${snapshot.cashMovements.length}`);

  if (isAlreadyRepaired(data, parsed.input.items)) {
    console.log('\nAlready repaired — idempotent skip.');
    return;
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to mutate.');
    return;
  }

  if (!repaired.pago.fechaPrimerVencimiento) {
    throw new Error('Falta fechaPrimerVencimiento: configurá diaVencimiento en la tarjeta o completá el schedule.');
  }

  await updateConfirmedPurchase(businessId, compraId, repaired);
  invalidatePayablesReconcileCache(businessId);

  const after = await db.doc(`negocios/${businessId}/compras/${compraId}`).get();
  const afterCuotas = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('compraId', '==', compraId)
    .get();
  const cuotaSum = roundPurchaseMoney(
    afterCuotas.docs.reduce((s, d) => s + (Number(d.data().monto) || 0), 0)
  );

  console.log(`\nAFTER TOTAL: ${after.data()?.total}`);
  console.log(`CUOTAS SUM: ${cuotaSum}`);
  console.log('STOCK REAPPLIED: NO');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
