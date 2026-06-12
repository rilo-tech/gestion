import { onSchedule } from 'firebase-functions/v2/scheduler';
import { purgeExpiredOrderPhotosAllBusinesses } from '../../backend/utils/purge-order-photos.ts';

const SCHEDULER_REGION = 'southamerica-east1';

export const purgeOrderPhotos = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    region: SCHEDULER_REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const result = await purgeExpiredOrderPhotosAllBusinesses();
    console.log('[purgeOrderPhotos]', JSON.stringify(result));
  }
);
