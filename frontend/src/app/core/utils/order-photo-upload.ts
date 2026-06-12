const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;

export const MAX_ORDER_PHOTOS = 10;

const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;

export function isOrderPhotoFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_NAME_PATTERN.test(file.name);
}

export interface PreparedOrderPhotoUpload {
  data: string;
  contentType: string;
  name: string;
  previewUrl: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo comprimir la imagen.'));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo preparar la imagen.'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareOrderPhotoFile(file: File): Promise<PreparedOrderPhotoUpload> {
  if (!isOrderPhotoFile(file)) {
    throw new Error('Solo se pueden adjuntar imágenes (JPG, PNG, WebP).');
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo preparar la imagen.');
  }

  ctx.drawImage(image, 0, 0, width, height);

  const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const quality = contentType === 'image/jpeg' ? JPEG_QUALITY : undefined;
  const blob = await canvasToBlob(canvas, contentType, quality ?? 0.92);
  const dataUrl = await blobToDataUrl(blob);

  return {
    data: dataUrl,
    contentType,
    name: file.name.trim() || 'foto.jpg',
    previewUrl: dataUrl,
  };
}

export async function prepareOrderPhotoFiles(files: FileList | File[]): Promise<PreparedOrderPhotoUpload[]> {
  const list = Array.from(files).filter((file) => isOrderPhotoFile(file));
  if (!list.length) {
    throw new Error('Elegí al menos una imagen (JPG, PNG o WebP).');
  }
  return Promise.all(list.map((file) => prepareOrderPhotoFile(file)));
}
