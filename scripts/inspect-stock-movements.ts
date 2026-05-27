import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const businessId = process.argv[2] ?? 'rilo';

async function main(): Promise<void> {
  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  const movSnap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();

  const stockById = new Map(stockSnap.docs.map((doc) => [doc.id, doc.data()]));

  console.log('=== STOCK ITEMS ===');
  for (const doc of stockSnap.docs.sort((a, b) =>
    String(a.data().nombre).localeCompare(String(b.data().nombre))
  )) {
    const d = doc.data();
    console.log(
      JSON.stringify({
        id: doc.id,
        nombre: d.nombre,
        stockActual: d.stockActual,
        stockReservado: d.stockReservado,
      })
    );
  }

  console.log('\n=== MOVIMIENTOS ===');
  const movs = movSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  movs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  for (const m of movs) {
    const prod = m.productoId ? stockById.get(String(m.productoId))?.nombre : null;
    console.log(
      JSON.stringify({
        id: m.id,
        fecha: m.fecha,
        productoId: m.productoId ?? null,
        productoNombre: prod ?? null,
        tipo: m.tipo,
        cantidad: m.cantidad,
        motivo: m.motivo,
        origenTipo: m.origenTipo ?? null,
      })
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
