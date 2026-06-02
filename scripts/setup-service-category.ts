/**
 * Configura categoría de servicio y Estampado (stock por producto).
 * Uso: npx tsx scripts/setup-service-category.ts --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = 'rilo';
const SERVICE_CATEGORY = 'Personalización';

async function main(): Promise<void> {
  const configRef = db.doc(`negocios/${BUSINESS_ID}/config/app`);
  const configSnap = await configRef.get();
  const config = configSnap.data() ?? {};
  const productos = (config.productos ?? {}) as Record<string, unknown>;
  const categorias = Array.isArray(productos.categorias)
    ? [...new Set([...productos.categorias.map(String), SERVICE_CATEGORY])].sort((a, b) =>
        a.localeCompare(b, 'es')
      )
    : [SERVICE_CATEGORY];

  console.log('[setup] Categorías:', categorias.join(', '));

  const stockSnap = await db
    .collection(`negocios/${BUSINESS_ID}/stock`)
    .where('nombre', '==', 'Estampado')
    .get();

  if (APPLY) {
    await configRef.set(
      {
        productos: {
          ...productos,
          categorias,
        },
      },
      { merge: true }
    );

    for (const doc of stockSnap.docs) {
      await doc.ref.update({
        categoria: SERVICE_CATEGORY,
        controlaStock: false,
        permitirStockNegativo: false,
        stockActual: 0,
        stockReservado: 0,
        stockMinimo: 0,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[setup] Estampado (${doc.id}) → categoría ${SERVICE_CATEGORY}, sin control de stock`);
    }
  } else {
    console.log('[setup] Simulación. Usá --apply para persistir.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
