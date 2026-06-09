/**
 * Recalcula cuotas de Cuentas a pagar desde el documento de compra.
 * Incluye cuotas ya pagadas y alinea egresos de caja vinculados.
 *
 * Uso:
 *   npx tsx scripts/repair-purchase-payables.ts 00002
 *   npx tsx scripts/repair-purchase-payables.ts --all-compras
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolvePurchaseLabel } from '../backend/utils/purchase-number.ts';
import { loadFinanzasConfig } from '../backend/utils/finance-config.ts';
import { parsePurchaseInput } from '../backend/utils/purchase-finance.ts';
import {
  buildInstallmentMontos,
  syncPurchasePayablesForCompra,
} from '../backend/utils/card-statements.ts';
import { invalidatePayablesReconcileCache } from '../backend/utils/payables.ts';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const allCompras = process.argv.includes('--all-compras');
const businessId = args[0] && /^\d{5}$/.test(args[0]) ? 'rilo' : (args[0] ?? 'rilo');
const targetLabels = args
  .filter((arg) => arg !== businessId)
  .map((label) => label.trim().padStart(5, '0'));

function totalsByAmbito(items: Array<{ ambito?: string; importe?: number }>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of items) {
    const ambito = String(line.ambito ?? 'negocio').trim().toLowerCase();
    totals.set(ambito, Math.round(((totals.get(ambito) ?? 0) + (Number(line.importe) || 0)) * 100) / 100);
  }
  return totals;
}

async function repairPurchase(compraId: string, data: Record<string, unknown>): Promise<void> {
  const compraLabel = resolvePurchaseLabel({ ...data, id: compraId });
  const finanzas = await loadFinanzasConfig(businessId);
  const parsed = await parsePurchaseInput(businessId, data, {
    skipSupplierLookup: true,
    finanzas,
  });

  if (parsed.error || !parsed.input) {
    console.error(`  [skip] #${compraLabel}: ${parsed.error ?? 'datos inválidos'}`);
    return;
  }

  const { getMedioPagoById, getTarjetaById, medioPagoGeneratesPayables } = await import(
    '../backend/utils/finance-config.ts'
  );
  const medio = getMedioPagoById(finanzas.mediosPago, parsed.input.pago.medioPagoId);
  if (!medio || !medioPagoGeneratesPayables(medio)) {
    console.log(`  [skip] #${compraLabel}: medio no genera cuentas a pagar`);
    return;
  }

  const tarjeta = parsed.input.pago.tarjetaId
    ? getTarjetaById(finanzas.tarjetas, parsed.input.pago.tarjetaId)
    : undefined;

  const items = parsed.input.items;
  const totals = totalsByAmbito(items);
  const cuotas = parsed.input.pago.cuotas;

  for (const [ambito, montoTotal] of totals) {
    if (montoTotal === 0) continue;

    const montos = buildInstallmentMontos(montoTotal, cuotas);
    const ambitoLines = items.filter((line) => line.ambito === ambito);

    console.log(
      `  #${compraLabel} · ${ambito}: total $${montoTotal} / ${cuotas} → [${montos.join(', ')}]`
    );

    try {
      const result = await syncPurchasePayablesForCompra(
        businessId,
        {
          compraId,
          compraLabel,
          proveedor: parsed.input.proveedor,
          tarjetaId: tarjeta?.id ?? parsed.input.pago.tarjetaId ?? '',
          tarjetaLabel: tarjeta?.label ?? parsed.input.proveedor,
          medioPagoId: parsed.input.pago.medioPagoId,
          ambito,
          montoTotal,
          cuotas,
          fechaPrimerVencimiento: parsed.input.pago.fechaPrimerVencimiento!,
          lineDescriptions: ambitoLines.map(
            (line) => line.descripcion || line.categoriaLabel || line.tipoLinea
          ),
        },
        { allowPaid: true }
      );
      console.log(
        `    → ${result.cuotasUpdated || result.cuotasCreated} cuota(s) · ${result.cashMovementsFixed} mov. caja corregido(s)`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`    → ERROR: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/compras`).get();
  const targets = new Set(targetLabels);

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const label = resolvePurchaseLabel({ ...data, id: doc.id });
    if (data.estado === 'borrador') continue;

    if (!allCompras && targets.size > 0 && !targets.has(label)) continue;
    if (!allCompras && targets.size === 0) continue;

    console.log(`\nCompra #${label} (${doc.id}) · total documento: ${data.total}`);
    await repairPurchase(doc.id, data);
  }

  invalidatePayablesReconcileCache(businessId);
  console.log('\nListo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
