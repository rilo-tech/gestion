/**
 * Probe OpenAI Responses API against V4 tool registry.
 *
 * Uso:
 *   OPENAI_API_KEY=... tsx scripts/probe-openai-v4.ts
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { buildToolRegistry, getToolByName, openAiToolsFromRegistry } from '../backend/whatsapp/agent/tool-registry.ts';
import { probeOpenAiResponses } from '../backend/whatsapp/agent/openai-agent.ts';
import { validateStrictToolSchema } from '../backend/whatsapp/agent/strict-tool-schema.ts';

const PRIMARY = String(process.env.OPENAI_RILOBOT_MODEL ?? 'gpt-5.6-terra').trim();
const FALLBACK = String(process.env.OPENAI_RILOBOT_FALLBACK_MODEL ?? 'gpt-5.6-luna').trim();

type ProbeRow = {
  test: string;
  http: number | string;
  model: string;
  tool: string;
  errorCode: string;
  result: string;
};

const rows: ProbeRow[] = [];

function pushRow(row: ProbeRow): void {
  rows.push(row);
  console.log(`[probe] ${row.test} → HTTP ${row.http} | ${row.result}`);
}

function errFields(result: Awaited<ReturnType<typeof probeOpenAiResponses>>) {
  return {
    errorCode: result.errorCode ?? '',
    errorMessage: result.errorMessage ?? '',
  };
}

async function main() {
  const registry = buildToolRegistry();
  const allTools = openAiToolsFromRegistry(registry);
  const schemaIssues = registry.flatMap((tool) => validateStrictToolSchema(tool));

  console.log(
    JSON.stringify({
      toolsTotal: registry.length,
      validatorStrict: schemaIssues.length === 0 ? 'PASS' : 'FAIL',
      invalidRemaining: schemaIssues.length,
      issues: schemaIssues.slice(0, 5),
    })
  );

  if (schemaIssues.length) {
    console.error('[probe] Abortado: schemas locales inválidos.');
    process.exit(1);
  }

  const minimal = await probeOpenAiResponses({
    model: PRIMARY,
    userText: 'Respondé únicamente OK',
  });
  pushRow({
    test: 'A minimal sin tools',
    http: minimal.httpStatus,
    model: PRIMARY,
    tool: '-',
    errorCode: errFields(minimal).errorCode,
    result: minimal.httpStatus === 200 ? 'OK' : 'FAIL',
  });

  const fullRegistry = await probeOpenAiResponses({
    model: PRIMARY,
    userText: 'hola',
    tools: allTools,
    instructions: 'Sos RILO Bot. Respondé breve si no necesitás tools.',
  });
  pushRow({
    test: 'B registry completo',
    http: fullRegistry.httpStatus,
    model: PRIMARY,
    tool: '-',
    errorCode: errFields(fullRegistry).errorCode,
    result: fullRegistry.httpStatus === 200 ? 'OK' : 'FAIL',
  });

  const findClientTool = openAiToolsFromRegistry(registry).filter((row) => row.name === 'find_client');
  const findClient = await probeOpenAiResponses({
    model: PRIMARY,
    userText: 'buscame un cliente llamado Acapella',
    tools: findClientTool,
    instructions: 'Usá find_client para buscar clientes por nombre.',
  });
  pushRow({
    test: 'C find_client',
    http: findClient.httpStatus,
    model: PRIMARY,
    tool: 'find_client',
    errorCode: errFields(findClient).errorCode,
    result: findClient.httpStatus === 200 ? 'OK' : 'FAIL',
  });

  const listOrdersTool = openAiToolsFromRegistry(registry).filter((row) => row.name === 'list_orders');
  const listOrders = await probeOpenAiResponses({
    model: PRIMARY,
    userText: 'listame los últimos 5 pedidos del cliente abc123',
    tools: listOrdersTool,
    instructions: 'Usá list_orders con clientId cuando esté disponible.',
  });
  pushRow({
    test: 'D list_orders',
    http: listOrders.httpStatus,
    model: PRIMARY,
    tool: 'list_orders',
    errorCode: errFields(listOrders).errorCode,
    result: listOrders.httpStatus === 200 ? 'OK' : 'FAIL',
  });

  let acapellaResult = 'NOT TESTED';
  if (fullRegistry.httpStatus === 200 && process.env.OPENAI_API_KEY?.trim()) {
    process.env.RILOBOT_AI_PROVIDER = 'openai';
    const { createConversationAgent } = await import('../backend/whatsapp/agent/conversation-agent.ts');
    const agent = createConversationAgent();
    const tenant = {
      businessId: process.env.RILOBOT_EVAL_BUSINESS_ID ?? 'rilo',
      phone: process.env.RILOBOT_EVAL_PHONE ?? '+59899000000',
      rubro: 'indumentaria',
      platformAccess: {
        whatsappEnabled: true,
        aiEnabled: true,
        erpWebEnabled: true,
        whatsappOperationalStatus: 'active',
      },
    } as import('../backend/whatsapp/tenant-resolver.ts').WhatsappTenantContext;

    try {
      const result = await agent.runTurn({
        tenant,
        state: null,
        text: 'mostrame los pedidos de Acapella',
      });
      const toolNames = result.toolCalls?.map((row) => row.name) ?? [];
      const ok =
        result.provider === 'openai' &&
        toolNames.includes('find_client') &&
        (toolNames.includes('list_orders') || /acapella/i.test(result.reply));
      acapellaResult = ok ? 'OK' : 'FAIL';
      pushRow({
        test: 'E Acapella flujo',
        http: 200,
        model: PRIMARY,
        tool: toolNames.join(' → ') || '-',
        errorCode: '',
        result: acapellaResult,
      });
      console.log(
        '[probe:acapella-detail]',
        JSON.stringify({
          reply: result.reply.slice(0, 400),
          toolCalls: result.toolCalls?.map((row) => ({ name: row.name, args: row.arguments })),
        })
      );
    } catch (error) {
      acapellaResult = 'FAIL';
      const details =
        error instanceof Error && 'details' in error
          ? (error as { details?: Record<string, unknown> }).details
          : undefined;
      pushRow({
        test: 'E Acapella flujo',
        http: details?.httpStatus ?? 'ERR',
        model: PRIMARY,
        tool: '-',
        errorCode: String(details?.errorCode ?? ''),
        result: 'FAIL',
      });
    }
  }

  console.log('');
  console.log('TEST | HTTP | MODEL | TOOL | ERROR CODE | RESULT');
  console.log('--- | --- | --- | --- | --- | ---');
  for (const row of rows) {
    console.log(
      `${row.test} | ${row.http} | ${row.model} | ${row.tool} | ${row.errorCode || '-'} | ${row.result}`
    );
  }

  console.log('');
  console.log(`TOOLS TOTALES: ${registry.length}`);
  console.log(`TOOLS CON SCHEMA CORREGIDO: ${registry.length}`);
  console.log(`VALIDATOR STRICT: ${schemaIssues.length === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`SCHEMAS INVALIDOS RESTANTES: ${schemaIssues.length}`);
  console.log(`OPENAI MINIMAL: HTTP ${minimal.httpStatus}`);
  console.log(`OPENAI FULL REGISTRY: HTTP ${fullRegistry.httpStatus}`);
  console.log(`find_client: ${rows.find((r) => r.test.startsWith('C'))?.result ?? 'NOT TESTED'}`);
  console.log(`list_orders: ${rows.find((r) => r.test.startsWith('D'))?.result ?? 'NOT TESTED'}`);
  console.log(`CASO ACAPELLA: ${acapellaResult}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
