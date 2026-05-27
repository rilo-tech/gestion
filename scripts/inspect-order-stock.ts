import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const businessId = process.argv[2] ?? 'rilo';
const targetLabel = (process.argv[3] ?? '00002').padStart(5, '0');

const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
for (const doc of snap.docs) {
  const data = doc.data();
  const label = resolveOrderLabel(data);
  if (label !== targetLabel) continue;

  console.log('ORDER', doc.id, label, data.estado);
  console.log('estadoStock', data.estadoStock, 'stockPreparado', data.stockPreparado, 'stockDescontado', data.stockDescontado);
  for (const [i, line] of (data.items ?? []).entries()) {
    console.log(
      i,
      line.nombre,
      JSON.stringify({
        cantidad: line.cantidad,
        cantidadReservada: line.cantidadReservada,
        cantidadUsada: line.cantidadUsada,
        cantidadFaltante: line.cantidadFaltante,
        cantidadFaltanteCompra: line.cantidadFaltanteCompra,
        controlaStock: line.controlaStock,
        estadoStockItem: line.estadoStockItem,
      })
    );
  }
}
