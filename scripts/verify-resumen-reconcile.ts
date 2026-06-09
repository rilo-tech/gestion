import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { reconcilePayablesAndCashData } from '../backend/utils/payables.ts';

const businessId = 'rilo';
const movimientoId = '9CjY0XKfEPpT8xZ5Bemo';

async function readMonto(): Promise<number> {
  const snap = await db.doc(`negocios/${businessId}/movimientos_caja/${movimientoId}`).get();
  return Number(snap.data()?.monto) || 0;
}

async function main(): Promise<void> {
  const before = await readMonto();
  console.log(`Antes reconcile: $${before}`);

  await reconcilePayablesAndCashData(businessId, { force: true });

  const after = await readMonto();
  console.log(`Después reconcile: $${after}`);

  if (Math.abs(after - 8587.83) > 0.009) {
    console.error('ERROR: el monto no quedó en $8587.83');
    process.exit(1);
  }
  console.log('OK: monto persiste en $8587.83');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
