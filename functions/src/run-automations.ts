import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runAutomationTick } from '../../backend/automation/automation-executor.ts';

const SCHEDULER_REGION = 'southamerica-east1';

/** Evalúa automatizaciones recurrentes y condition_watch cada 5 minutos. */
export const runAutomations = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    region: SCHEDULER_REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const result = await runAutomationTick();
    console.log('[runAutomations]', JSON.stringify(result));
  }
);
