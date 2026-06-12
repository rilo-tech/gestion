import { db } from '../firebase.ts';
import { normalizeOrderPedidosConfig } from './order-config.ts';
import {
  deleteOrderPhotoFile,
  normalizeOrderPhotos,
  type OrderPhotoRecord,
} from './order-photos.ts';

export type PurgeOrderPhotosResult = {
  businessesScanned: number;
  businessesPurged: number;
  ordersUpdated: number;
  photosDeleted: number;
  errors: number;
};

function photoCreatedAtMs(createdAt: string): number | null {
  const ms = Date.parse(String(createdAt ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

export function partitionExpiredOrderPhotos(
  photos: OrderPhotoRecord[],
  cutoffMs: number
): { expired: OrderPhotoRecord[]; kept: OrderPhotoRecord[] } {
  const expired: OrderPhotoRecord[] = [];
  const kept: OrderPhotoRecord[] = [];

  for (const photo of photos) {
    const createdMs = photoCreatedAtMs(photo.createdAt);
    if (createdMs === null) {
      kept.push(photo);
      continue;
    }
    if (createdMs < cutoffMs) {
      expired.push(photo);
    } else {
      kept.push(photo);
    }
  }

  return { expired, kept };
}

export async function purgeExpiredOrderPhotosForBusiness(
  businessId: string,
  retentionDays: number,
  nowMs = Date.now()
): Promise<{ ordersUpdated: number; photosDeleted: number; errors: number }> {
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  let ordersUpdated = 0;
  let photosDeleted = 0;
  let errors = 0;

  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();

  for (const doc of ordersSnap.docs) {
    const fotos = normalizeOrderPhotos(doc.data()?.fotos);
    if (!fotos.length) continue;

    const { expired, kept } = partitionExpiredOrderPhotos(fotos, cutoffMs);
    if (!expired.length) continue;

    const nextFotos = [...kept];

    for (const photo of expired) {
      try {
        await deleteOrderPhotoFile(photo.storagePath);
        photosDeleted += 1;
      } catch (error) {
        errors += 1;
        nextFotos.push(photo);
        console.error(
          `[purge-order-photos] No se pudo borrar ${photo.storagePath}:`,
          error
        );
      }
    }

    if (nextFotos.length === fotos.length) continue;

    await doc.ref.update({
      fotos: nextFotos,
      updatedAt: new Date(nowMs).toISOString(),
    });
    ordersUpdated += 1;
  }

  return { ordersUpdated, photosDeleted, errors };
}

export async function purgeExpiredOrderPhotosAllBusinesses(
  nowMs = Date.now()
): Promise<PurgeOrderPhotosResult> {
  const result: PurgeOrderPhotosResult = {
    businessesScanned: 0,
    businessesPurged: 0,
    ordersUpdated: 0,
    photosDeleted: 0,
    errors: 0,
  };

  const businessesSnap = await db.collection('negocios').get();

  for (const businessDoc of businessesSnap.docs) {
    result.businessesScanned += 1;
    const businessId = businessDoc.id;

    const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
    const pedidosRaw = appDoc.exists
      ? ((appDoc.data()?.pedidos as Record<string, unknown>) ?? {})
      : {};
    const pedidosConfig = normalizeOrderPedidosConfig(pedidosRaw);

    if (!pedidosConfig.fotosReferenciaHabilitadas) continue;
    if (!pedidosConfig.fotosEliminacionAutomatica) continue;

    const businessResult = await purgeExpiredOrderPhotosForBusiness(
      businessId,
      pedidosConfig.fotosRetencionDias,
      nowMs
    );

    if (
      businessResult.ordersUpdated > 0 ||
      businessResult.photosDeleted > 0 ||
      businessResult.errors > 0
    ) {
      result.businessesPurged += 1;
    }

    result.ordersUpdated += businessResult.ordersUpdated;
    result.photosDeleted += businessResult.photosDeleted;
    result.errors += businessResult.errors;
  }

  return result;
}
