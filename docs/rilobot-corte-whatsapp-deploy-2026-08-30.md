# Corte de RILO Bot en WhatsApp — post deploy 30 ago 2026

Diagnóstico del **entorno desplegado** (`rilo-7eff4`). Sin corrección de código.

El bot no llega a Gemini ni al handler. El webhook desplegado **revienta al crear la app**.

---

## 1. Confirmación de deploy

| Dato | Valor |
|---|---|
| Proyecto | `rilo-7eff4` |
| Function | `api` v2 |
| Región | `southamerica-east1` |
| Revisión | `api-00188-sop` |
| URL Cloud Run | `https://api-akmf432gba-rj.a.run.app` |
| Hosting | `https://rilo-7eff4.web.app` |
| Emulator / local | No. Tráfico en producción. |
| Resultado CLI | Deploy **OK**. Startup probe **OK**. |

Functions desplegadas:

- `api` — HTTPS, 512MiB, nodejs20
- `purgeOrderPhotos` — scheduled, misma región

---

## Primer error de runtime

Hora: **00:01 ART** (2026-08-30T03:01:29Z), POST de Meta.

```
ReferenceError: billingRoutes is not defined
    at createApiApp (/workspace/lib/index.js:115501)
    at getApiApp
```

En `backend/create-app.ts` se hace `api.use('/billing', billingRoutes)` **sin importar** `billingRoutes`. Eso corre al primer request. Toda la API (incluido WhatsApp) devuelve **500**.

GET posteriores al diagnóstico:

- `https://api-akmf432gba-rj.a.run.app/api/health` → **500**
- `https://api-akmf432gba-rj.a.run.app/api/webhooks/whatsapp` (GET verify) → **500**

Cuerpo: `Internal Server Error`.

---

## Recorrido del mensaje

| ETAPA | ESTADO | EVIDENCIA |
|---|---|---|
| Meta → webhook | **Llega** | Log `[whatsapp] HTTP` `POST /api/webhooks/whatsapp` `hasMessages: true` (varios reintentos 03:01:29Z) |
| Webhook → handler | **Corta acá** | Crash en `getApiApp()` **antes** de Express. No hay `[whatsapp] POST recibido` ni `handleWhatsappMessage` |
| Tenant | No llega | — |
| Usage gate | No llega | — |
| LLM | No llega | — |
| Operation | No llega | — |
| Presenter | No llega | — |
| Meta outbound | No llega | — |

Recorrido de `"hola"` (y de cualquier mensaje):

- A. Meta nunca toca webhook — **no**
- B. webhook recibe — **sí**
- C–I (`handleWhatsappMessage` → Gemini → outbound) — **no**

Último punto: **B. webhook recibe**. HTTP final: **500**. Meta reintenta (varios POST en ~10 s).

---

## Webhook Meta

Endpoint que Meta está pegando (log real):

`POST /api/webhooks/whatsapp` sobre `https://api-akmf432gba-rj.a.run.app`

Ese es el callback de producción (`scripts/subscribe-whatsapp-webhook.ts`). No es emulator.

GET verification ahora también **500**, porque `createApiApp()` falla igual. La suscripción previa sigue mandando POST.

---

## Variables / secrets

El crash es **anterior** a leer secrets en el handler. En `functions/.env.rilo-7eff4` (inyectado al deploy):

| Variable | Desplegado |
|---|---|
| GEMINI_API_KEY | CONFIGURADA |
| WHATSAPP_ACCESS_TOKEN | CONFIGURADA |
| WHATSAPP_PHONE_NUMBER_ID | CONFIGURADA |
| WHATSAPP_WEBHOOK_VERIFY_TOKEN | CONFIGURADA (prod, distinta al default local `rilo-dev-verify`) |
| WHATSAPP_APP_SECRET | FALTANTE (vacía; hoy no es la causa: ni siquiera llega a verificar firma) |
| RILOBOT_CONVERSATION_ENGINE | FALTANTE → default `llm_first` |
| GEMINI_WHATSAPP_MODEL | CONFIGURADA |

Valores secretos omitidos a propósito.

---

## Cambios recientes (descartados como corte)

El refactor llm_first / caja **no es el corte**.

Archivos revisados y no responsables de este 500:

- `semantic-command.ts`
- `turn-interpretation.ts`
- `language-interpreter.ts`
- `conversation-orchestrator-v2.ts`
- `operation-plan.ts`
- `erp-writes.ts`
- `erp-integration.ts`
- `message-handler.ts`

El corte es `backend/create-app.ts` + ruta billing.

Gemini timeout / usage gate / tenant: **no aplican**; el proceso no llega ahí.

Si Gemini timeout-ea en un deploy sano: `generateGeminiJson` tiene timeout (~18 s texto), devuelve `null`, el interpreter arma `intent: unknown` / `interpreter_unavailable`. Eso **no** es lo que está pasando ahora.

---

## CAUSA RAÍZ

`ReferenceError: billingRoutes is not defined` en `createApiApp`.

Meta pega al webhook correcto; la function responde 500 y no ejecuta RILO Bot.
