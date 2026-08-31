/**
 * Benchmark live Gemini 3.1 vs 3.5 flash-lite. No cambia el prompt de producción.
 * Uso: npx tsx scripts/benchmark-interpreter-models.ts
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';
process.env.GEMINI_INTERPRETER_MAX_ATTEMPTS = '1';
process.env.GEMINI_INTERPRETER_TIMEOUT_MS = '30000';
process.env.GEMINI_INTERPRETER_RETRY_TIMEOUT_MS = '30000';
delete process.env.GEMINI_WHATSAPP_FALLBACK_MODEL;
delete process.env.GEMINI_INTERPRETER_FALLBACK_MODEL;
delete process.env.GEMINI_INTERPRETER_MODEL;

import { generateInterpreterJson } from '../backend/whatsapp/gemini.ts';
import {
  GEMINI_TURN_SCHEMA_V2,
  isValidTurnInterpretationJson,
  normalizeTurnInterpretation,
} from '../backend/whatsapp/turn-interpretation.ts';
import {
  RILOBOT_SYSTEM_INSTRUCTION,
  buildTurnContextPrompt,
} from '../backend/whatsapp/language-interpreter.ts';
import { resolveSemanticTurn } from '../backend/whatsapp/semantic-command.ts';

const MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'] as const;

const CASES: Array<{ id: string; text: string; expect: string[] }> = [
  { id: 'query_orders', text: 'mostrame los pedidos de Acapella', expect: ['query_status'] },
  { id: 'cash', text: 'registrá un egreso de caja de 500 motivo flete', expect: ['register_cash'] },
  {
    id: 'payment_status',
    text: 'pasalo a entregado y cobra el saldo',
    expect: ['update_order_status', 'register_payment'],
  },
  { id: 'stock', text: 'cómo está el stock de ese producto', expect: ['query_stock'] },
  { id: 'create_client', text: 'dale de alta al cliente Juan Pérez', expect: ['create_client'] },
];

type Row = {
  model: string;
  caseId: string;
  durationMs: number;
  success: boolean;
  timeout: boolean;
  jsonValid: boolean;
  structuredValid: boolean;
  semanticOk: boolean;
  intent: string | null;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function semanticOk(text: string, json: Record<string, unknown> | null, expect: string[]): boolean {
  if (!json) return false;
  const interpretation = normalizeTurnInterpretation(json, text);
  const resolved = resolveSemanticTurn(interpretation, null);
  const intents = resolved.command.operations.map((op) => op.intent);
  if (!intents.length) intents.push(interpretation.intent);
  return expect.some((wanted) => intents.includes(wanted as (typeof intents)[number]));
}

async function runOne(model: string, text: string, expect: string[]): Promise<Row> {
  process.env.GEMINI_WHATSAPP_MODEL = model;
  const userText = buildTurnContextPrompt({ text });
  const started = Date.now();
  const result = await generateInterpreterJson({
    parts: [{ text: userText }],
    label: 'rilobot-interpreter-bench',
    responseSchema: GEMINI_TURN_SCHEMA_V2 as unknown as Record<string, unknown>,
    systemInstruction: RILOBOT_SYSTEM_INSTRUCTION,
    validate: isValidTurnInterpretationJson,
  });
  const durationMs = Date.now() - started;
  const jsonValid = Boolean(result.json);
  const structuredValid = jsonValid && isValidTurnInterpretationJson(result.json as Record<string, unknown>);
  return {
    model,
    caseId: text.slice(0, 24),
    durationMs,
    success: Boolean(result.json) && !result.failure,
    timeout: result.failure?.kind === 'INTERPRETER_TIMEOUT',
    jsonValid,
    structuredValid,
    semanticOk: semanticOk(text, result.json, expect),
    intent: result.json ? String(result.json.intent ?? '') : result.failure?.kind ?? null,
  };
}

async function main() {
  const schemaChars = JSON.stringify(GEMINI_TURN_SCHEMA_V2).length;
  const systemChars = RILOBOT_SYSTEM_INSTRUCTION.length;
  const sampleContext = buildTurnContextPrompt({ text: CASES[0].text });
  const totalChars = systemChars + schemaChars + sampleContext.length;
  console.log(
    JSON.stringify({
      inputSize: {
        systemChars,
        schemaChars,
        contextChars: sampleContext.length,
        totalChars,
        approxTokens: Math.round(totalChars / 4),
      },
      timeoutMs: 30000,
      attempts: 1,
    })
  );

  const rows: Row[] = [];
  for (const model of MODELS) {
    for (let round = 0; round < 2; round++) {
      for (const item of CASES) {
        const row = await runOne(model, item.text, item.expect);
        rows.push({ ...row, caseId: item.id });
        console.log(JSON.stringify(row));
      }
    }
  }

  for (const model of MODELS) {
    const subset = rows.filter((row) => row.model === model);
    const durations = subset.map((row) => row.durationMs).sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
    console.log(
      JSON.stringify({
        summary: true,
        model,
        n: subset.length,
        success: subset.filter((row) => row.success).length,
        timeout: subset.filter((row) => row.timeout).length,
        avg: Math.round(avg),
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        max: durations[durations.length - 1] ?? 0,
        jsonValid: subset.filter((row) => row.jsonValid).length,
        structuredValid: subset.filter((row) => row.structuredValid).length,
        semanticOk: subset.filter((row) => row.semanticOk).length,
      })
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
