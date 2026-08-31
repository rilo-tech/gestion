# RILO Bot V4 — Diagnóstico OpenAI en producción

**Proyecto:** `rilo-7eff4`  
**Function:** `api` (Gen2, `southamerica-east1`)  
**Revisión activa al momento del incidente:** `api-00200-ric` (secret `OPENAI_API_KEY` **v2**)  
**Fecha del incidente:** 30/08/2026, ~23:43–23:59 ART  
**Mensaje reportado:** `"mostrame los pedidos de acapella"`  
**Respuesta al usuario:** `"No pude procesar ese mensaje ahora. Probá de nuevo en unos segundos."`

> Diagnóstico solo. **No se modificó** backend auth, tools, semántica, prompts, modelos ni RiloBot V4.

---

## Resumen ejecutivo

Hay **dos causas distintas** con el **mismo texto** al usuario:

| Ventana ART | Intent en logs | ¿Llegó a OpenAI? | Causa |
|---|---|---|---|
| 23:43, 23:44 | `ai_quota` | **NO** | Cuota de acciones IA del mes agotada (`assertCanUseAi` → `AI_QUOTA_EXCEEDED`) |
| 23:49 (`hola`) | `v4_error` | **SÍ** | Fallo en Responses API (error HTTP **no logueado**) |
| 23:59 (`acapella`) | `v4_error` | **SÍ** | Fallo en Responses API (error HTTP **no logueado**) |

El caso **acapella** no es fallo de backend auth ni de routing V4: **V4 arranca, llama OpenAI, y OpenAI devuelve error** (~2,7 s después de `[whatsapp:v4:start]`).

---

## 1. Logs de producción (Firebase Functions)

Fuente: `firebase functions:log --only api`  
Timestamps en **UTC**; ART = UTC−3.

### 30/08/2026 ~23:43 ART (02:43 UTC)

```
[whatsapp] Inbound { from: '+59892918112', textLen: 32, ... }
[whatsapp] Tenant hallado { businessId: 'rilo', ms: 2511 }
[whatsapp] Respuesta { intent: 'ai_quota', executed: false }
```

- **NO** aparece `[whatsapp:v4:start]`.
- El turno **muere en usage gate** antes del agente OpenAI.
- Mismo mensaje genérico al usuario (`MODEL_UNAVAILABLE_REPLY`), pero intent distinto.

### 30/08/2026 ~23:44 ART (02:44 UTC)

```
[whatsapp] Inbound { textLen: 32, ... }
[whatsapp] Respuesta { intent: 'ai_quota', executed: false }
```

- Igual: **cuota IA**, sin V4/OpenAI.

### 30/08/2026 ~23:49 ART (02:49 UTC) — mensaje `"hola"`

```
[whatsapp:v4:start] {"businessId":"rilo","provider":"openai","model":"gpt-5.6-terra"}
[whatsapp:turn] {
  "rawMessage":"hola",
  "intent":"v4_error",
  "executed":false,
  "whyFallbackWasUsed":"No pude procesar ese mensaje ahora. Probá de nuevo en unos segundos.",
  "engine":"v4"
}
[whatsapp] Respuesta { intent: 'v4_error', executed: false }
```

| Campo | Valor |
|---|---|
| businessId | `rilo` |
| provider | `openai` |
| model | `gpt-5.6-terra` |
| Δ start → error | **~3,0 s** (02:49:15.767 → 02:49:18.773) |

### 30/08/2026 ~23:59 ART (02:59 UTC) — `"mostrame los pedidos de acapella"`

```
[whatsapp:v4:start] {"businessId":"rilo","provider":"openai","model":"gpt-5.6-terra"}
[whatsapp:turn] {
  "rawMessage":"mostrame los pedidos de acapella",
  "intent":"v4_error",
  "executed":false,
  "whyFallbackWasUsed":"No pude procesar ese mensaje ahora. Probá de nuevo en unos segundos.",
  "engine":"v4"
}
[whatsapp] Respuesta { intent: 'v4_error', executed: false }
```

| Campo | Valor |
|---|---|
| businessId | `rilo` |
| provider | `openai` |
| model | `gpt-5.6-terra` |
| Δ start → error | **~2,7 s** (02:59:32.192 → 02:59:34.926) |

### Logs OpenAI HTTP (attempt / status / error)

**No existen en producción hoy.**

El código en `backend/whatsapp/agent/openai-agent.ts` (`callOpenAiResponses`):

- Llama `POST https://api.openai.com/v1/responses`.
- Si falla, lanza `AgentError('MODEL_UNAVAILABLE', …)` con `details: { httpStatus, message }`.
- **Esos detalles no se escriben a consola**; solo el mensaje genérico llega a `[whatsapp:turn].whyFallbackWasUsed`.

Por eso **no se puede clasificar 401/403/429/400/404** desde logs actuales.

---

## 2. Secret `OPENAI_API_KEY` bound a Function `api`

**Código (`functions/src/index.ts`):**

```typescript
const openaiApiKey = defineSecret('OPENAI_API_KEY');

export const api = onRequest({
  secrets: [openaiApiKey],
  ...
}, ...);
```

**Auditoría Cloud Functions (logs de deploy):**

| Hora UTC | Evento |
|---|---|
| 02:34:06 | **Deploy FALLIDO:** `Secret environment variable overlaps non secret environment variable: OPENAI_API_KEY` |
| 02:35:53 | Deploy OK — revisión `api-00198-yix`, secret **v1** |
| 02:39:13 | Deploy OK — secret **v2** |
| 02:42:46 | Deploy OK — revisión **`api-00200-ric`**, secret **v2** |

El fallo de las 02:34 UTC indica que en algún momento coexistían:

- `OPENAI_API_KEY` como **Secret Manager** (correcto), y
- `OPENAI_API_KEY` como **variable de entorno plana** (p. ej. en `.env` de functions) — **conflicto**.

`.env.example` ya documenta: *«OPENAI_API_KEY → Secret Manager, no en .env»*.

---

## 3. Runtime: `OPENAI_API_KEY_PRESENT`

**No hay log explícito** `OPENAI_API_KEY_PRESENT=true/false` en el código desplegado.

**Inferencia por latencia:**

| Escenario | Tiempo esperado start → error |
|---|---|
| Key **ausente** (`!apiKey` antes del `fetch`) | ~50–200 ms |
| Key **presente**, HTTP a OpenAI falla | ~1–4 s (observado **~2,7–3,0 s**) |

Para `hola` y `acapella`, la latencia apunta a **key presente + request HTTP fallido**, no a secret ausente.

> Confirmación definitiva requeriría log `OPENAI_API_KEY_PRESENT` (pendiente; fuera de alcance de este informe).

---

## 4. Redeploy después de `secrets:set`

| Pregunta | Respuesta |
|---|---|
| ¿Se hizo `firebase functions:secrets:set OPENAI_API_KEY`? | **Sí** (evidencia: secret **v1** → **v2** en audit log) |
| ¿Se redeployó `functions:api` después? | **Sí** — varios deploys exitosos tras el fallo de overlap (02:35–02:42 UTC) |
| ¿Revisión activa durante el incidente? | **`api-00200-ric`** (02:42:46 UTC), **antes** de los turnos 23:43–23:59 ART |

El incidente **no** se explica por «secret seteado pero function nunca redeployada».

---

## 5. Endpoint y payload V4

Confirmado en código (`openai-agent.ts`):

| Item | Valor |
|---|---|
| URL | `POST https://api.openai.com/v1/responses` |
| Auth | `Authorization: Bearer <OPENAI_API_KEY>` |
| Content-Type | `application/json` |
| Modelo primario | `gpt-5.6-terra` (`OPENAI_RILOBOT_MODEL`) |
| Fallback | `gpt-5.6-luna` (`OPENAI_RILOBOT_FALLBACK_MODEL`) |
| Tools | Sí (registry completo V4) |
| Reasoning | `{ effort: 'low' \| 'medium' }` según env |
| Timeout | 25 s por intento |

No usa Gemini ni Chat Completions en V4.

---

## 6. Fallback primario / secundario

Lógica en `OpenAIConversationAgent.runTurn`:

1. Intenta `gpt-5.6-terra`.
2. Si falla y hay fallback distinto → intenta `gpt-5.6-luna`.

**Logs:** no hay líneas separadas por attempt/model/HTTP.

Con **~3 s** totales, es plausible que **ambos intentos hayan fallado rápido** (p. ej. mismo 401/404 en primary y fallback).

---

## 7. Tests mínimos (§8–§9)

| Test | Estado |
|---|---|
| Minimal Responses (`input: "Respondé OK"`, sin tools) desde runtime prod | **NO EJECUTADO** — no hay endpoint de probe en prod |
| Responses + tool `find_client` | **NO EJECUTADO** |
| Local con `OPENAI_API_KEY` | Fuera de alcance (secret en Secret Manager; `secrets:access` falló por EPERM en esta máquina) |

Sin log HTTP, **no se puede separar** auth/modelo vs tool schema solo con evidencia actual.

---

## 8. Billing / 429

**No hay evidencia en logs** de `insufficient_quota`, `billing_not_active`, ni HTTP 429.

Si OpenAI devolviera 429/quota, hoy quedaría oculto tras `MODEL_UNAVAILABLE`.

---

## Resultado solicitado (§12)

```
V4 START:                    SÍ  (23:49 y 23:59 ART; businessId=rilo, model=gpt-5.6-terra)

OPENAI KEY PRESENT IN RUNTIME: PROBABLE SÍ  (latencia ~3s; no hay log explícito)

SECRET BOUND TO api:          SÍ  (defineSecret + secrets:[openaiApiKey]; audit api-00200-ric v2)

FUNCTION REDEPLOYED AFTER SECRET: SÍ  (deploys 02:35–02:42 UTC tras secrets:set v1→v2)

PRIMARY MODEL:               gpt-5.6-terra

PRIMARY HTTP:                DESCONOCIDO  (no logueado en prod)

PRIMARY ERROR:               AgentError MODEL_UNAVAILABLE  (mensaje genérico al usuario)

FALLBACK HTTP:               DESCONOCIDO  (no logueado; posible segundo intento ~3s total)

MINIMAL RESPONSES TEST:        NO EJECUTADO  (sin probe en runtime prod)

CAUSA RAÍZ (acapella 23:59):
  V4 operativo hasta OpenAI Responses API.
  La API rechaza o falla la request (~2,7 s).
  El código actual oculta httpStatus/message real.
  NO es fallo de login, JWT, Firestore auth, ni routing WhatsApp.
  NO es secret sin bind (hubo redeploy exitoso con secret v2).
  Casos 23:43–23:44: causa distinta → AI_QUOTA_EXCEEDED (sin llegar a OpenAI).

PRÓXIMO PASO RECOMENDADO (sin cambiar semántica):
  Agregar SOLO logs en callOpenAiResponses:
  attempt, model, durationMs, httpStatus, error.type, error.code, error.message (sanitizado).
  + log OPENAI_API_KEY_PRESENT=true/false al inicio de turno V4.
  Redeploy functions:api y repetir "mostrame los pedidos de acapella".
```

---

## Anexo: por qué el usuario ve siempre el mismo texto

`handle-v4-turn.ts` devuelve `MODEL_UNAVAILABLE_REPLY` tanto para:

- `AI_QUOTA_EXCEEDED` (`intent: 'ai_quota'`), como
- `AgentError MODEL_UNAVAILABLE` (`intent: 'v4_error'`).

Por eso **el síntoma es idéntico** aunque la causa subyacente cambie (cuota vs OpenAI).

---

## Archivos revisados (solo lectura)

- `functions/src/index.ts`
- `backend/whatsapp/agent/openai-agent.ts`
- `backend/whatsapp/handle-v4-turn.ts`
- `backend/whatsapp/agent/agent-errors.ts`
- `backend/auth/usage-gates.ts`
- Logs Firebase `api` (2026-08-31T02:34–02:59Z)

**BUILD / DEPLOY de este informe:** ninguno (documento only).
