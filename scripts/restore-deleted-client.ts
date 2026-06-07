import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const businessId = process.argv[2] ?? 'rilo';
const clientId = process.argv[3] ?? '';
const clientName = process.argv[4] ?? 'Sandra Debone';

async function main(): Promise<void> {
  if (!clientId) {
    console.error('Uso: npx tsx scripts/restore-deleted-client.ts <negocio> <clientId> [nombre]');
    process.exit(1);
  }

  const ref = db.doc(`negocios/${businessId}/clientes/${clientId}`);
  const existing = await ref.get();
  if (existing.exists) {
    console.log(`[restore-client] El cliente ${clientId} ya existe.`);
    console.log(JSON.stringify(existing.data(), null, 2));
    return;
  }

  const payload = {
    nombre: clientName,
    activo: true,
    createdAt: new Date().toISOString(),
    restoredAt: new Date().toISOString(),
    restoredFromDeletion: true,
  };

  await ref.set(payload);
  console.log(`[restore-client] Cliente restaurado: ${clientName} (${clientId})`);
}

main().catch((error) => {
  console.error('[restore-client] Error:', error);
  process.exit(1);
});
