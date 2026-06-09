/**
 * Corrige montos de cuotas de compra (incl. pagadas) y desvincula egresos
 * de resumen de tarjeta que marcaron cuotas por error.
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

const businessId = process.argv[2] ?? 'rilo';

function totalsByAmbito(items: Array<{ ambito?: string; importe?: number }>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of items) {
    const ambito = String(line.ambito ?? 'negocio').trim().toLowerCase();
    totals.set(ambito, Math.round(((totals.get(ambito) ?? 0) + (Number(line.importe) || 0)) * 100) / 100);
  }
  return totals;
}

async function restoreCardSummaryPayment(): Promise<void> {
  const movId = 'otommcGUIv6XN0sFXmlr';
  const movRef = db.doc(`negocios/${businessId}/movimientos_caja/${movId}`);
  const movSnap = await movRef.get();
  if (!movSnap.exists) return;

  const mov = movSnap.data() ?? {};
  if (String(mov.origenTipo ?? '') !== 'tarjeta_resumen') return;

  const originalMonto = 765;
  if (Math.abs((Number(mov.monto) || 0) - originalMonto) > 0.009) {
    await movRef.update({ monto: originalMonto });
    console.log(`  [caja] resumen tarjeta restaurado a $${originalMonto}`);
  }

  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  const candidates = cuotasSnap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter(
      (row) =>
        row.origenTipo === 'compra' &&
        row.compraLabel === '00004' &&
        row.numeroCuota === 1 &&
        Math.abs((Number(row.monto) || 0) - originalMonto) < 0.009
    );

  for (const cuota of cuotasSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))) {
    if (cuota.movimientoCajaId === movId && cuota.id !== candidates[0]?.id) {
      await cuota.ref.update({ estado: 'pendiente', fechaPago: null, movimientoCajaId: null });
    }
  }

  const match = candidates[0];
  if (match) {
    await match.ref.update({
      estado: 'pagada',
      fechaPago: mov.fecha ?? new Date().toISOString(),
      movimientoCajaId: movId,
      monto: originalMonto,
    });
    console.log(`  [pagada] compra #00004 cuota 1/3 · $${originalMonto} (resumen tarjeta)`);
  }
}

async function unlinkWrongCardSummaryLinks(): Promise<number> {
  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  let fixes = 0;

  for (const doc of cuotasSnap.docs) {
    const data = doc.data();
    const movId = String(data.movimientoCajaId ?? '').trim();
    if (!movId || data.origenTipo !== 'compra') continue;

    const movSnap = await db.doc(`negocios/${businessId}/movimientos_caja/${movId}`).get();
    if (!movSnap.exists) continue;
    const mov = movSnap.data() ?? {};
    if (String(mov.origenTipo ?? '') !== 'tarjeta_resumen') continue;

    const cuotaMonto = Math.round((Number(data.monto) || 0) * 100) / 100;
    const movMonto = Math.round((Number(mov.monto) || 0) * 100) / 100;
    if (Math.abs(cuotaMonto - movMonto) < 0.009) continue;

    await doc.ref.update({
      estado: 'pendiente',
      fechaPago: null,
      movimientoCajaId: null,
    });
    fixes += 1;
    console.log(
      `  [desvinculada] compra #${data.compraLabel} cuota ${data.numeroCuota}/${data.cuotaTotal}: $${cuotaMonto} ≠ resumen $${movMonto}`
    );
  }

  return fixes;
}

async function main(): Promise<void> {
  console.log(`Negocio: ${businessId}\n`);

  const snap = await db.collection(`negocios/${businessId}/compras`).get();
  const finanzas = await loadFinanzasConfig(businessId);
  const { getMedioPagoById, getTarjetaById, medioPagoGeneratesPayables } = await import(
    '../backend/utils/finance-config.ts'
  );

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.estado === 'borrador') continue;

    const compraLabel = resolvePurchaseLabel({ ...data, id: doc.id });
    const parsed = await parsePurchaseInput(businessId, data, {
      skipSupplierLookup: true,
      finanzas,
    });
    if (parsed.error || !parsed.input) continue;

    const medio = getMedioPagoById(finanzas.mediosPago, parsed.input.pago.medioPagoId);
    if (!medio || !medioPagoGeneratesPayables(medio)) continue;

    const tarjeta = parsed.input.pago.tarjetaId
      ? getTarjetaById(finanzas.tarjetas, parsed.input.pago.tarjetaId)
      : undefined;

    for (const [ambito, montoTotal] of totalsByAmbito(parsed.input.items)) {
      if (montoTotal === 0) continue;
      const montos = buildInstallmentMontos(montoTotal, parsed.input.pago.cuotas);
      const ambitoLines = parsed.input.items.filter((line) => line.ambito === ambito);

      console.log(`Compra #${compraLabel}: [${montos.join(', ')}]`);
      await syncPurchasePayablesForCompra(
        businessId,
        {
          compraId: doc.id,
          compraLabel,
          proveedor: parsed.input.proveedor,
          tarjetaId: tarjeta?.id ?? parsed.input.pago.tarjetaId ?? '',
          tarjetaLabel: tarjeta?.label ?? parsed.input.proveedor,
          medioPagoId: parsed.input.pago.medioPagoId,
          ambito,
          montoTotal,
          cuotas: parsed.input.pago.cuotas,
          fechaPrimerVencimiento: parsed.input.pago.fechaPrimerVencimiento!,
          lineDescriptions: ambitoLines.map(
            (line) => line.descripcion || line.categoriaLabel || line.tipoLinea
          ),
        },
        { allowPaid: true, skipCashSync: true }
      );
    }
  }

  console.log('\nDesvinculando cuotas mal marcadas por resumen de tarjeta...');
  const unlinked = await unlinkWrongCardSummaryLinks();
  console.log(`  ${unlinked} cuota(s) repuestas en pendiente`);

  console.log('\nRestaurando pago real del resumen de tarjeta ($765)...');
  await restoreCardSummaryPayment();

  invalidatePayablesReconcileCache(businessId);

  const paid = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('origenTipo', '==', 'compra')
    .where('estado', '==', 'pagada')
    .get();

  console.log('Cuotas pagadas restantes:');
  for (const doc of paid.docs) {
    const d = doc.data();
    console.log(
      `  #${d.compraLabel} ${d.numeroCuota}/${d.cuotaTotal} · $${d.monto} · ${String(d.beneficiario ?? '').slice(0, 35)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
