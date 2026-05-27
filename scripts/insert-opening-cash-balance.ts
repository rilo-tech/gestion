/**
 * Inserta un ingreso manual de saldo inicial antes del primer movimiento existente
 * (o antes de un movimiento de pedido indicado).
 *
 * Uso:
 *   npx tsx scripts/insert-opening-cash-balance.ts [businessId] [monto] [--ambito=id] [--apply]
 *   npx tsx scripts/insert-opening-cash-balance.ts rilo 25420 --apply
 *   npx tsx scripts/insert-opening-cash-balance.ts rilo 13717 --ambito=personal --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import {
  getBusinessCashAmbitoId,
  normalizeCajaAmbitos,
  normalizeMovementAmbito,
} from '../backend/utils/caja-ambitos.ts';

const businessId = process.argv[2] ?? 'rilo';
const monto = Number(process.argv[3] ?? '25420');
const apply = process.argv.includes('--apply');
const ambitoArg =
  process.argv.find((arg) => arg.startsWith('--ambito='))?.split('=')[1]?.trim().toLowerCase() ??
  '';

function resolveTargetAmbitoId(
  requested: string,
  caja: Record<string, unknown>
): string {
  const ambitos = normalizeCajaAmbitos(caja);
  if (!requested) return getBusinessCashAmbitoId(caja);

  const byId = ambitos.find((entry) => entry.id === requested);
  if (byId) return byId.id;

  if (requested === 'personal') {
    const personal = ambitos.find(
      (entry) =>
        !entry.sistema &&
        entry.label.trim().toLowerCase() === 'personal'
    );
    if (personal) return personal.id;
  }

  return normalizeMovementAmbito(requested, caja);
}

if (!Number.isFinite(monto) || monto <= 0) {
  console.error('Monto inválido:', process.argv[3]);
  process.exit(1);
}

async function loadCaja(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return {};
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
}

const snap = await db
  .collection(`negocios/${businessId}/movimientos_caja`)
  .orderBy('fecha', 'asc')
  .get();

type MovementRow = { id: string; fecha?: string; ambito?: string; [key: string]: unknown };

const movements = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as MovementRow[];
const caja = await loadCaja(businessId);
const ambitos = normalizeCajaAmbitos(caja);
const targetAmbito = resolveTargetAmbitoId(ambitoArg, caja);

if (ambitoArg && !ambitos.some((entry) => entry.id === targetAmbito)) {
  console.error('Ámbito no configurado:', ambitoArg, '→', targetAmbito);
  console.error('Disponibles:', ambitos.map((entry) => entry.id).join(', '));
  process.exit(1);
}

console.log(`[${businessId}] movimientos de caja: ${movements.length} · ámbito objetivo: ${targetAmbito}`);
for (const row of movements) {
  console.log(
    ' -',
    row.id,
    row.fecha,
    row.ambito ?? '(sin)',
    row.tipo,
    row.monto,
    row.concepto,
    row.origenTipo,
    row.numeroPedidoLabel ?? ''
  );
}

const inAmbito = (row: MovementRow) =>
  normalizeMovementAmbito(row.ambito, caja) === targetAmbito;

const ambitMovements = movements.filter(inAmbito);

const anchor =
  ambitMovements.find((row) => {
    const tipo = String(row.origenTipo ?? '');
    return tipo.startsWith('pedido') || row.pedidoId;
  }) ??
  ambitMovements[0] ??
  movements[0];

let saldoFecha: string;
if (anchor?.fecha) {
  const anchorDate = new Date(String(anchor.fecha));
  if (Number.isNaN(anchorDate.getTime())) {
    console.error('Fecha inválida en movimiento ancla:', anchor.fecha);
    process.exit(1);
  }
  saldoFecha = new Date(anchorDate.getTime() - 60_000).toISOString();
} else if (movements[0]?.fecha) {
  const firstDate = new Date(String(movements[0].fecha));
  saldoFecha = new Date(firstDate.getTime() - 120_000).toISOString();
} else {
  saldoFecha = new Date().toISOString();
}

const ambito = targetAmbito;

const payload = {
  tipo: 'ingreso' as const,
  monto,
  medio: 'efectivo',
  concepto: 'Saldo inicial de caja',
  ambito,
  fecha: saldoFecha,
  origenTipo: 'caja_manual_ingreso',
  origenGrupo: 'manual',
  origenId: null,
  pedidoId: null,
  numeroPedido: null,
  numeroPedidoLabel: null,
  clienteId: null,
  negocioId: businessId,
};

console.log('\nPropuesta:');
if (anchor) {
  console.log('  Ancla:', anchor.id, anchor.concepto, anchor.fecha, `(ámbito ${anchor.ambito ?? '—'})`);
} else {
  console.log('  Ancla: (ninguno en este ámbito; fecha temprana)');
}
console.log('  Nuevo ingreso:', payload);

if (!apply) {
  console.log('\nDry-run. Ejecutá con --apply para guardar en Firestore.');
  process.exit(0);
}

const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add(payload);
console.log('\nCreado:', docRef.id);
