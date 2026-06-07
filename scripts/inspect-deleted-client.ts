import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const businessId = process.argv[2] ?? 'rilo';
const searchName = (process.argv[3] ?? 'debone').toLowerCase();

async function main(): Promise<void> {
  console.log(`[inspect-client] negocio=${businessId} buscar="${searchName}"`);

  const actSnap = await db
    .collection(`negocios/${businessId}/actividad`)
    .orderBy('createdAt', 'desc')
    .limit(800)
    .get();

  const relatedActs = actSnap.docs.filter((doc) => {
    const data = doc.data();
    const blob = JSON.stringify(data).toLowerCase();
    return blob.includes(searchName);
  });

  console.log(`\n=== Actividad (${relatedActs.length}) ===`);
  for (const doc of relatedActs) {
    const data = doc.data();
    console.log(
      data.createdAt,
      data.module,
      data.action,
      data.entityType,
      data.entityLabel,
      data.entityId,
      '|',
      data.summary
    );
  }

  const deleteAct = relatedActs.find((doc) => {
    const data = doc.data();
    return data.module === 'clients' && data.action === 'delete';
  });

  const clientId = deleteAct?.data().entityId
    ? String(deleteAct.data().entityId)
    : process.argv[4] ?? '';

  if (!clientId) {
    console.log('\nNo se encontró entityId de eliminación. Pasá el id como 4to argumento.');
    return;
  }

  console.log(`\n=== Cliente ${clientId} ===`);
  const clientSnap = await db.doc(`negocios/${businessId}/clientes/${clientId}`).get();
  console.log('Documento existe:', clientSnap.exists);
  if (clientSnap.exists) {
    console.log('Datos:', JSON.stringify(clientSnap.data(), null, 2));
  }

  const collections = [
    { name: 'ventas', field: 'clienteId' },
    { name: 'pedidos', field: 'clienteId' },
    { name: 'movimientos_caja', field: 'clienteId' },
    { name: 'compromisos_pago', field: 'clienteId' },
  ] as const;

  for (const { name, field } of collections) {
    const snap = await db
      .collection(`negocios/${businessId}/${name}`)
      .where(field, '==', clientId)
      .get();
    console.log(`\n=== ${name} (${snap.size}) ===`);
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (name === 'ventas') {
        console.log(
          doc.id,
          data.ventaLabel,
          'total:',
          data.total,
          'cobrado:',
          data.montoCobrado,
          'fecha:',
          data.fecha ?? data.createdAt,
          'items:',
          JSON.stringify((data.items as unknown[])?.slice(0, 3))
        );
      } else if (name === 'pedidos') {
        console.log(
          doc.id,
          data.numeroPedidoLabel,
          'total:',
          data.total,
          'estado:',
          data.estado,
          'descripcion:',
          String(data.descripcion ?? '').slice(0, 60)
        );
      } else if (name === 'movimientos_caja') {
        console.log(
          doc.id,
          data.tipo,
          data.monto,
          data.concepto,
          data.fecha,
          'ventaId:',
          data.ventaId,
          'pedidoId:',
          data.pedidoId
        );
      } else {
        console.log(doc.id, JSON.stringify(data));
      }
    }
  }

  const ventasSnap = await db.collection(`negocios/${businessId}/ventas`).get();
  const around320 = ventasSnap.docs.filter((doc) => {
    const total = Number(doc.data().total);
    return total >= 315 && total <= 325;
  });
  console.log(`\n=== Ventas con total ~320 (${around320.length}) ===`);
  for (const doc of around320) {
    const data = doc.data();
    console.log(
      doc.id,
      data.ventaLabel,
      'clienteId:',
      data.clienteId,
      'total:',
      data.total,
      'fecha:',
      data.fecha ?? data.createdAt
    );
  }
}

main().catch((error) => {
  console.error('[inspect-client] Error:', error);
  process.exit(1);
});
