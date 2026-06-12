import { randomUUID } from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { firebaseStorageBucket } from '../firebase.ts';

export const MAX_ORDER_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OrderPhotoRecord = {
  id: string;
  name: string;
  storagePath: string;
  contentType: string;
  createdAt: string;
};

export type OrderPhotoWithUrl = OrderPhotoRecord & { url: string };

function storageBucket() {
  if (firebaseStorageBucket) {
    return getStorage().bucket(firebaseStorageBucket);
  }
  return getStorage().bucket();
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

export function normalizeOrderPhotos(raw: unknown): OrderPhotoRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const id = String(row.id ?? '').trim();
      const storagePath = String(row.storagePath ?? '').trim();
      if (!id || !storagePath) return null;
      return {
        id,
        name: String(row.name ?? 'Foto').trim() || 'Foto',
        storagePath,
        contentType: String(row.contentType ?? 'image/jpeg').trim() || 'image/jpeg',
        createdAt: String(row.createdAt ?? new Date().toISOString()),
      } satisfies OrderPhotoRecord;
    })
    .filter((photo): photo is OrderPhotoRecord => photo !== null);
}

export function parsePhotoUpload(body: {
  data?: unknown;
  contentType?: unknown;
  name?: unknown;
}): { buffer: Buffer; contentType: string; name: string } {
  const rawData = String(body.data ?? '').trim();
  if (!rawData) {
    throw new Error('Falta la imagen.');
  }

  const contentType = String(body.contentType ?? 'image/jpeg').trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('Formato no permitido. Usá JPG, PNG o WebP.');
  }

  const base64 = rawData.includes(',') ? rawData.split(',').pop() ?? '' : rawData;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('La imagen está vacía o corrupta.');
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('La imagen supera el tamaño máximo de 5 MB.');
  }

  const name = String(body.name ?? 'foto').trim() || 'foto';
  return { buffer, contentType, name };
}

export function buildOrderPhotoStoragePath(
  businessId: string,
  orderId: string,
  photoId: string,
  contentType: string
): string {
  const ext = extensionForContentType(contentType);
  return `negocios/${businessId}/pedidos/${orderId}/fotos/${photoId}.${ext}`;
}

export async function uploadOrderPhoto(
  businessId: string,
  orderId: string,
  buffer: Buffer,
  contentType: string,
  name: string
): Promise<OrderPhotoRecord> {
  const photoId = randomUUID();
  const storagePath = buildOrderPhotoStoragePath(businessId, orderId, photoId, contentType);
  const file = storageBucket().file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        businessId,
        orderId,
        photoId,
        originalName: name.slice(0, 180),
      },
    },
  });

  return {
    id: photoId,
    name: name.slice(0, 180),
    storagePath,
    contentType,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteOrderPhotoFile(storagePath: string): Promise<void> {
  const path = String(storagePath ?? '').trim();
  if (!path) return;
  try {
    await storageBucket().file(path).delete({ ignoreNotFound: true });
  } catch {
    // Si el archivo ya no existe, seguimos con la limpieza en Firestore.
  }
}

export async function resolveOrderPhotoUrls(
  photos: OrderPhotoRecord[]
): Promise<OrderPhotoWithUrl[]> {
  if (!photos.length) return [];

  const bucket = storageBucket();
  const expires = Date.now() + SIGNED_URL_TTL_MS;

  return Promise.all(
    photos.map(async (photo) => {
      const file = bucket.file(photo.storagePath);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires,
      });
      return { ...photo, url };
    })
  );
}
