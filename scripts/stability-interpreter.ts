import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';
process.env.GEMINI_WHATSAPP_MODEL = 'gemini-3.5-flash-lite';
delete process.env.GEMINI_INTERPRETER_MODEL;
delete process.env.GEMINI_WHATSAPP_FALLBACK_MODEL;
process.env.GEMINI_INTERPRETER_TIMEOUT_MS = '20000';
process.env.GEMINI_INTERPRETER_RETRY_TIMEOUT_MS = '15000';

import { GeminiInterpreter } from '../backend/whatsapp/language-interpreter.ts';
import { resolveSemanticTurn } from '../backend/whatsapp/semantic-command.ts';

const text = 'mostrame los pedidos de Acapella';
const n = Number(process.argv[2] || 10);
const rows: Array<Record<string, unknown>> = [];

for (let i = 0; i < n; i++) {
  const started = Date.now();
  const interpretation = await new GeminiInterpreter().interpretTurn({ text });
  const durationMs = Date.now() - started;
  const fail = interpretation.interpreterFailure;
  const resolved = fail ? null : resolveSemanticTurn(interpretation, null);
  const row = {
    i,
    durationMs,
    intent: interpretation.intent,
    failure: fail?.kind ?? null,
    retry: fail?.retry ?? false,
    fallbackUsed: fail?.fallbackUsed ?? false,
    query: interpretation.query ?? null,
    client: interpretation.client ?? null,
    ops: resolved?.command.operations.map((op) => op.intent) ?? [],
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const ok = rows.filter((row) => !row.failure && row.intent !== 'interpreter_unavailable');
const durations = ok.map((row) => Number(row.durationMs)).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    n,
    success: ok.length,
    timeout: rows.filter((row) => row.failure === 'INTERPRETER_TIMEOUT').length,
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / (durations.length || 1)),
    p95: durations[Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)] || 0,
    max: durations[durations.length - 1] || 0,
  })
);
