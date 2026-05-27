import dotenv from 'dotenv';
dotenv.config();
import { db } from '../backend/firebase.ts';

const [, , businessId, movementId] = process.argv;
if (!businessId || !movementId) {
  console.error('Uso: npx tsx scripts/delete-cash-movement.ts <businessId> <movementId>');
  process.exit(1);
}

await db.doc(`negocios/${businessId}/movimientos_caja/${movementId}`).delete();
console.log('Eliminado:', movementId);
