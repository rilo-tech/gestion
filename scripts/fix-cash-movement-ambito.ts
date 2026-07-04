/**
 * Actualiza el ámbito de un movimiento de caja.
 *
 * Uso:
 *   npx tsx scripts/fix-cash-movement-ambito.ts <movimientoId> <ambitoId> [--apply]
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { normalizeCajaAmbitos, parseCashAmbitoOrNull } from '../backend/utils/caja-ambitos.ts';

const businessId = process.argv[2]?.trim() || 'rilo';
const movimientoId = process.argv[3]?.trim();
const ambitoId = process.argv[4]?.trim();
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  if (!movimientoId || !ambitoId) {
    console.error('Uso: npx tsx scripts/fix-cash-movement-ambito.ts [businessId] <movimientoId> <ambitoId> [--apply]');
    process.exit(1);
  }

  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  const ambitos = normalizeCajaAmbitos(caja);
  const parsed = parseCashAmbitoOrNull(ambitoId, caja);

  if (!parsed) {
    console.error('Ámbito inválido. Disponibles:', ambitos.map((a) => a.id).join(', '));
    process.exit(1);
  }

  const movRef = db.doc(`negocios/${businessId}/movimientos_caja/${movimientoId}`);
  const movSnap = await movRef.get();
  if (!movSnap.exists) {
    console.error('Movimiento no encontrado.');
    process.exit(1);
  }

  const before = movSnap.data() ?? {};
  console.log('Movimiento:', before.concepto);
  console.log('Ámbito actual:', before.ambito ?? '(sin ámbito)');
  console.log('Ámbito nuevo:', parsed);

  if (!apply) {
    console.log('\nDry-run. Repetí con --apply para guardar.');
    return;
  }

  await movRef.update({ ambito: parsed });
  console.log('\nActualizado.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
