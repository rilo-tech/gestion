import dotenv from 'dotenv';
dotenv.config();
import { db } from '../backend/firebase.ts';
import { resolveSaleLabel } from '../backend/utils/sale-number.ts';

const businessId = process.argv[2] ?? 'rilo';
const ventaId = process.argv[3] ?? '';
const apply = process.argv.includes('--apply');

if (!ventaId) {
  console.error('Uso: npx tsx scripts/repair-duplicate-venta-cobros.ts <businessId> <ventaId> [--apply]');
  process.exit(1);
}

const ventaRef = db.doc(`negocios/${businessId}/ventas/${ventaId}`);
const ventaSnap = await ventaRef.get();
if (!ventaSnap.exists) {
  console.error('Venta no encontrada:', ventaId);
  process.exit(1);
}

const venta = ventaSnap.data() ?? {};
const label = resolveSaleLabel(venta);
const cobros = Array.isArray(venta.cobros) ? venta.cobros : [];
const linkedMovementIds = new Set<string>();

for (const cobro of cobros) {
  const movementId = String(cobro.movimientoCajaId ?? '').trim();
  if (movementId) linkedMovementIds.add(movementId);
}

const initialMovementId = String(venta.movimientoCajaId ?? '').trim();
if (initialMovementId) linkedMovementIds.add(initialMovementId);

const movSnap = await db
  .collection(`negocios/${businessId}/movimientos_caja`)
  .where('ventaId', '==', ventaId)
  .where('origenTipo', '==', 'venta_mostrador_cobro')
  .get();

const duplicates = movSnap.docs.filter((doc) => !linkedMovementIds.has(doc.id));

console.log(`Venta #${label} (${ventaId})`);
console.log('Movimientos vinculados:', [...linkedMovementIds]);
console.log('Duplicados a eliminar:', duplicates.length);

for (const doc of duplicates) {
  const m = doc.data();
  console.log(' -', doc.id, m.fecha, m.monto, m.concepto);
}

if (!apply) {
  console.log('\nDry-run. Pasá --apply para eliminar duplicados.');
  process.exit(0);
}

for (const doc of duplicates) {
  await doc.ref.delete();
  console.log('Eliminado:', doc.id);
}

console.log('Listo.');
