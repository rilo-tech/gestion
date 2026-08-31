/**
 * Live Gemini probe (no WhatsApp). Prints model chain + TurnInterpretation.
 * Usage: npx tsx scripts/probe-interpreter-live.ts
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { GeminiInterpreter } from '../backend/whatsapp/language-interpreter.ts';
import { interpreterModelChain, interpreterTimeoutMs } from '../backend/whatsapp/interpreter-availability.ts';

const text = process.argv.slice(2).join(' ').trim() || 'mostrame los pedidos de Acapella';

async function main() {
  const chain = interpreterModelChain();
  console.log(
    JSON.stringify({
      chain,
      timeoutPrimaryMs: interpreterTimeoutMs('primary'),
      timeoutRetryMs: interpreterTimeoutMs('retry'),
      hasKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
    })
  );
  const started = Date.now();
  const interpretation = await new GeminiInterpreter().interpretTurn({ text });
  console.log(
    JSON.stringify({
      durationMs: Date.now() - started,
      intent: interpretation.intent,
      confidence: interpretation.confidence,
      query: interpretation.query ?? null,
      client: interpretation.client ?? null,
      interpreterFailure: interpretation.interpreterFailure ?? null,
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
