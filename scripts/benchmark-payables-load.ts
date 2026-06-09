import dotenv from 'dotenv';

dotenv.config();

import { listPayableInstallments } from '../backend/utils/payables.ts';

const businessId = process.argv[2] ?? 'rilo';
const mes = process.argv[3] ?? new Date().toISOString().slice(0, 7);

async function timed(label: string, fn: () => Promise<unknown>): Promise<void> {
  const start = Date.now();
  const result = await fn();
  const count = Array.isArray(result) ? result.length : 0;
  console.log(`${label}: ${Date.now() - start}ms (${count} rows)`);
}

await timed(`month ${mes}`, () =>
  listPayableInstallments(businessId, { mes, scope: 'month' })
);
await timed('all (no reconcile)', () =>
  listPayableInstallments(businessId, { scope: 'all' })
);
await timed('all + reconcile', () =>
  listPayableInstallments(businessId, { scope: 'all', reconcile: true })
);
