# Validación del motor conversacional de RILO Bot

Fecha: 29 ago 2026.  
Alcance: código que corre hoy en este repo (`llm_first` por default). **No se modificó el motor para este informe.**  
Fuente: `backend/whatsapp/*`, `backend/routes/whatsapp-webhook.ts`, `functions/src/index.ts`.  
Prueba de frases nuevas: `interpretLlmFirstTurn` → `GeminiInterpreter` con `GEMINI_API_KEY` local (mismo intérprete que Cloud Functions). No se agregaron esas frases al prompt ni a tests.

---

## 1. Pregunta principal

**¿HOY RILO BOT FUNCIONA REALMENTE ASÍ?**

### PARCIAL

El camino de texto libre **sí** entra a Gemini **antes** de `parseWithRules` / pending handlers (salvo SÍ/NO exacto o un dígito de lista). Gemini **sí** devuelve un JSON tipado (`TurnInterpretation`). El ERP **sí** se consulta/escribe **después**.

No es todavía:

> usuario escribe libremente → la IA interpreta TODO → estructura fiel → ERP ejecuta ese significado

porque:

1. El JSON del modelo se aplasta a `WhatsappCommandEntities` (bolsa legacy: `productName`, `cashType`, `sourceText`, `paid`…).
2. Varias funciones **siguen leyendo el texto** después del LLM y pueden cambiar pago, caja, segundo intent, o el monto efectivo.
3. El modelo acierta a menudo el **intent** en frases nunca vistas y **pierde slots** (monto en `payment` en vez de `cash`, concepto vacío, `intent: unknown` con correcciones adentro).
4. `registerCashFromWhatsapp` usa `entities.amount`, no `collectionAmount`. Si Gemini pone 430 en `payment.amount`, el plan queda en **$0** y el write **falla**.

Eso no es “un bot de frases” puro (el regex de caja **no** matcheó “sacame 275…” ni “pagamos 430 de la garrafa…”). Tampoco es un asistente semántico cerrado. Es un **híbrido**: Gemini primero, heurísticas y writers WhatsApp después.

---

## 2. Quién decide el significado del mensaje

**Gemini no es la única capa.** Es la principal para texto libre en `llm_first`. Otras capas todavía interpretan español.

### Qué corre hoy (texto, engine default)

```
Meta POST
  backend/routes/whatsapp-webhook.ts → handleWhatsappMessage
  backend/whatsapp/message-handler.ts → handleWhatsappTurn
    [help_topic / onboarding: ANTES del LLM]
    matchDeterministicBypass          conversation-orchestrator-v2.ts
    si no hay bypass:
      interpretLlmFirstTurn           conversation-orchestrator-v2.ts
        GeminiInterpreter             language-interpreter.ts
        normalizeTurnInterpretation   turn-interpretation.ts
        turnInterpretationToParsed
        overlayKnownEntities
      skipPendingGates = true         ← no corre parseWithRules ni holdPending
    greeting / setup / unknown / help / query_* / prepareOperation
    takeDualIntent(text)              task-queue.ts  ← regex sobre el mensaje
    executeWhatsappCommand            erp-integration.ts
```

Default: `conversationEngineVersion()` en `engine-version.ts` → `llm_first` salvo `RILOBOT_CONVERSATION_ENGINE=legacy|v1`.

### Lo que SÍ decide el LLM (si no hay bypass)

Intención, `conversationAction`, cliente (`client.raw`), `items[]`, cantidades/atributos (si los pone en el schema), concepto/importe de caja **si los pone en `cash.*`**, pago **si los pone en `payment.*`**, estado, fechas, filtros, `targetReference`, `query`, `ambiguities` / `missingFields`.

### Lo que todavía interpreta lenguaje FUERA del LLM

| Capa | Archivo | Función | ¿Corre en `llm_first` texto? | Qué decide |
|---|---|---|---|---|
| Bypass SÍ/NO / dígito | `conversation-orchestrator-v2.ts` | `matchDeterministicBypass` | Sí, **antes** del LLM | Si el turno es confirmación/elección exacta |
| Confirmación exacta | `turn-interpreter.ts` | `classifyConfirmReply` | Sí (vía bypass) | `sí`/`no` de cuerpo entero |
| Help / onboarding | `message-handler.ts` ~5608–5631 | `handleHelpTurn`, `handleOnboardingPending` | Sí, **antes** del LLM | Secuestra el turno |
| Audio sin texto | `message-handler.ts` ~5587–5604 | `interpretTurn` → `parseWhatsappCommand` | Sí | Transcript + **merge legacy** (Gemini v1 + rules) |
| Alias cash inglés | `turn-interpretation.ts` | `parseGeminiCash` / `asCashType` | Sí, post-JSON | `expense`→`egreso`, `business`→`negocio` (no es regex de utterance; es coerce de campos) |
| Default caja | `message-handler.ts` ~1578 | `if (register_cash && !cashType) cashType='egreso'` | Sí | Asume egreso si Gemini no mandó tipo |
| Ámbito / concepto | `cash-ambito.ts` | `resolveSpokenCashAmbito`, `cleanCashConcept` | Sí | Tokeniza `sourceText` + concepto contra cajas |
| Pago vs estado | `message-handler.ts` ~1701–1770 | `ORDER_PAY_HINT`, `SETTLE_TURN`, `looksLikeCollectFullBalance` | Sí, en `prepareOperation` | Puede **poner o borrar** `paid` / `payFullBalance` según el texto |
| Copy de confirmación | `lookups.ts` ~2879–2886 | `formatOperationSummary` | Sí | “No cobro nada” vs cobro **releen** `sourceText` |
| Pedido + pagado | `order-finance.ts` | `looksLikeRelatedOrderPayment` | Sí, al crear pedido | Prepaid desde el utterance |
| Dos operaciones | `task-queue.ts` | `takeDualIntent`, `guessQueuedIntent` | Sí, **siempre** en writes | Parte el texto por `y también anotá/registrá…` |
| Multi-ítem UI | `conversation-speech.ts` | `shouldOpenItemCollection`, `looksLikeLargeOrderDraft` | Sí | Abre recolección si el texto “parece” pedido grande |
| “Sin descripción” | `message-handler.ts` ~1102–1108 | regex `sin descripción` | Sí | Borra notas |
| How-to | `conversation-speech.ts` | `utteranceIsHowTo`, `utteranceIsCapabilityQuestion` | En pending gates (saltadas) y en `shouldOpenItemCollection` | Pregunta de uso vs ejecutar |
| Setup / gracias | `message-handler.ts` ~6001–6019 | `isThanksText`, `matchSetupLoad` | Sí, **después** del LLM | Puede desviar el turno |
| Intent router completo | `ai-command-parser.ts` | `parseWithRules`, `enrichEntitiesFromText`, `mergeParsed` | **No** en texto `llm_first` sin bypass. **Sí** en `legacy`, audio, y si `parsed` queda null | Intent + entidades desde regex |
| Extractores | `lookups.ts` | `extractProductHintFromText`, `extractNotesHintFromText`, `extractAmountFromText`, `looksLikeNewOrder`, `looksLikeStatusQuery`, … | Gates `!isLlmFirstEngine()` en `prepareOperation`. Siguen vivos en pending handlers y `parseWithRules` | Producto/notas/fechas/intent |
| Slot pending | `conversation-follow.ts` | `isFreshTaskUtterance`, `doesFillCurrentSlot` | **No** si `skipPendingGates`. **Sí** en bypass SÍ/NO | Si el pending secuestra |
| Follow-up de ítems | `turn-interpreter.ts` | `applyFollowUpToEntities`, `extractSpokenColor/Size` | Pending path | Correcciones por palabras de color/talle |
| Stock compuesto | `stock-resolution.ts` | `interpretStockResolutionFromText` | Si pending stock + remap | Descuento de stock desde texto |
| Caja “gasto” en pending | `message-handler.ts` ~2129 | `looksLikeCashMovement` + `CASH_OUT_HINT` | Pending handlers (saltados en NL `llm_first`) | Fuerza `register_cash` |

`parseWithRules` **no** es el router del mensaje WhatsApp de texto en producción default. **Sigue existiendo** y **sigue usándose** en tests, `legacy`, audio y cualquier reentrada a pending gates.

---

## 3. Después de Gemini: ¿X puede terminar en Y?

**Sí. Hoy puede.** Por eso el motor **no** está terminado.

Caso que pediste:

```json
{
  "intent": "register_cash",
  "cash": {
    "movementType": "expense",
    "amount": 370,
    "concept": "Nuñez"
  }
}
```

En **este workspace**, `parseGeminiCash` mapea `movementType: expense` → `cash.type = egreso` y deja `concept` / `amount`. `turnInterpretationToParsed` copia a `cashType` / `cashConcept` / `entities.amount`. **No** hay `enrichEntitiesFromText` ni `mergeParsed` en `interpretLlmFirstTurn`.

Eso **no** cierra el caso. Después, con `sourceText = "Anota salida de caja nuñez por $370"`:

| Función | ¿Puede cambiar el significado? |
|---|---|
| `enrichEntitiesFromText` / `mergeParsed` / `parseWithRules` | No en este path |
| `extractProductHintFromText` en `prepareOperation` | No (`!isLlmFirstEngine()`) |
| `takeDualIntent` | No en esta frase |
| `ensureCashAmbito` + `resolveSpokenCashAmbito` | Sí: busca ámbito en `cashAmbitoHint` **y** `cashConcept` **y** `sourceText`. Con varias cajas, si no hay hint, **pregunta** aunque Gemini ya entendió el egreso |
| `polishCashConcept` / `cleanCashConcept` | Sí: recorta el string con regex de “egreso/gasto/caja/motivo” |
| Default `cashType = 'egreso'` | Irrelevante si el alias ya setea tipo |
| `looksLikeCollectFullBalance` | No aplica a caja (rama de estado de pedido) |

Ejemplo **demostrado en vivo** (frase A, Gemini real):

- LLM: `intent=register_cash`, `cash.type=egreso`, monto en **`payment.amount=430`**, `cash.amount` vacío, `amount` raíz **0**.
- Post-LLM: `entities.amount = 0`, `collectionAmount = 430`, `paid = true`.
- Plan: caja de **$0** + “Pago informado”.
- ERP: `registerCashFromWhatsapp` hace `Number(entities.amount) || 0` → **0** → throw *Indicá el monto*.

**LLM output = register_cash $430 garrafa negocio. Final = caja $0 / no ejecuta.**  
Eso es X → Y.

Otras vías X→Y:

- `looksLikeCollectFullBalance(sourceText)` puede **inventar** cobro total o, al revés, `if (!wantsPay) { paid = undefined }` **borra** un `payment` del modelo si el regex no ve “cobra/saldo”.
- `takeDualIntent` puede recortar `sourceText` y encolar un segundo intent por regex.
- Gemini `intent: unknown` con `requestedStatus: listo` y foco Natalia → `askUnknownIntent`, **no** cambia estado (frase C, corrida 2).

---

## 4. `rawMessage` después del LLM

`freezeRawMessage` no reescribe el string. El problema no es mutar el texto: es **volver a interpretarlo**.

| Uso | Archivo | Clasificación |
|---|---|---|
| Copiar a `entities.rawUserMessage` / `sourceText` / `parsed.raw` | `turn-interpretation.ts` | SEGURO (proveniencia) |
| Log `[whatsapp:turn]` | `conversation-log.ts` | SEGURO |
| Hilo `turns` al próximo Gemini | webhook `appendConversationTurns` | SEGURO (contexto futuro) |
| Card / `buildOperationPlan.rawUserMessage` | `operation-plan.ts` | SEGURO (display) |
| `looksLikeCollectFullBalance(sourceText)` | `message-handler.ts`, `lookups.ts` | **PELIGROSO** |
| `ORDER_PAY_HINT` / `SETTLE_TURN` sobre `source` | `message-handler.ts` | **PELIGROSO** |
| `looksLikeRelatedOrderPayment(sourceText)` | `order-finance.ts` | **PELIGROSO** |
| `takeDualIntent(text)` | `message-handler.ts` ~6077 | **PELIGROSO** |
| `shouldOpenItemCollection(source)` | `conversation-speech.ts` | **PELIGROSO** (ruteo) |
| `resolveSpokenCashAmbito` incluye `sourceText` | `cash-ambito.ts` | **PELIGROSO** (ámbito) |
| `cleanCashConcept` sobre concepto o texto | `cash-ambito.ts` | PELIGROSO leve |
| regex `sin descripción` | `prepareOperation` | PELIGROSO leve |
| Catalog rank `utterance` | lookups / catalog-rank | SEGURO-ish (match de SKU, no flip de intent) |

Comentario en código (`turnInterpretationToParsed`): *“No lee rawMessage para reconstruir producto, notas, cliente ni pago.”*  
Eso es cierto **dentro de esa función**. Es **falso** para el turno completo: `prepareOperation` y confirmación **sí** releen `sourceText`.

---

## 5. Ejemplos de desarrollo: ¿tests o código?

**Las frases de dataset son tests** (`conversation-v2.test.ts`, `conversation-coverage.test.ts`, `conversation-regression.test.ts`).

**Equivalentes siguen en código de producción**, no solo en tests:

Prompt (`language-interpreter.ts` `RILOBOT_SYSTEM_INSTRUCTION`), no es un router, pero **sí** mete ejemplos:

- «ese», «el pedido», «ese producto», «el canguro», «movelo»
- “cómo quedó ese producto / quedó en -1”
- «ya está pago»
- patrón 5–6: foco pedido / pedido nuevo + pago + diseño

Regex / listas usadas como **decisión**, no como test:

```ts
// lookups.ts — looksLikeCollectFullBalance
saldalo | cobra todo el saldo | todo lo que falta | ya pagó | está pago ...

// lookups.ts — looksLikeNewOrder
registrá un pedido | pedido para | camiseta|remera|buzo|canguro via product lists elsewhere

// ai-command-parser.ts — CASH_OUT_PATTERNS
gasto | egreso | salida de caja | saca … caja | anotá un gasto ...

// message-handler.ts — ORDER_PAY_HINT
pagó | cobra | seña | saldalo | ya pagó
```

Ejemplos concretos que **no** son few-shot de test:

- `looksLikeCollectFullBalance('cobra todo el saldo')` → true, y eso **setea flags** en `prepareOperation`.
- `parseWithRules('egreso de caja 4015 en personal')` → `register_cash` (coverage test **y** función live).
- `CASH_OUT_PATTERNS` **no** matchea `"sacame 275 de la caja por el flete de hoy"` ni `"pagamos 430 de la garrafa con plata del negocio"` (medido en la sonda). El LLM sí dijo `register_cash`. Eso prueba que **el intent nuevo no depende de esas frases**; también prueba que **el router regex sigue ahí** para las frases “viejas”.

---

## 6–7. Frases nuevas (nunca en código) — trazas

Motor: `interpretLlmFirstTurn` + `buildOperationPlan`. Sin tenant ERP (no se escribió Firestore).  
Corrida 1: Gemini respondió las 7. Corrida 2: timeouts → C y D cayeron a `unknown` (fallback `interpreter_unavailable` / JSON inválido). Eso también es evidencia: **el pipeline no es estable**.

Heurística legacy en paralelo (`looksLikeCashMovement` / `parseWithRules`) **no** se aplicó al resultado `llm_first`; se midió aparte.

### A. `"pagamos 430 de la garrafa con plata del negocio"`

| Campo | Valor |
|---|---|
| stateBefore | vacío |
| context → LLM | `mensaje: "pagamos 430…"` solamente |
| LLM | `intent=register_cash`, `cash.type=egreso`, `payment.amount=430`, **sin** `cash.concept`, **sin** `cash.ambitoHint`, `amount=0` |
| postLlm / entities | `cashType=egreso`, `amount=0`, `collectionAmount=430`, `paid=true` |
| operationPlan | `register_cash` payload amount **0**, “Pago informado” |
| ERP que se generaría | `executeWhatsappCommand` → `registerCashFromWhatsapp` → **error monto ≤ 0** |
| Regex legacy | `looksLikeCashMovement=false`. `parseWithRules` → **`register_payment`** $430 producto=la frase |
| SEMÁNTICA CONSERVADA | **NO** (intent caja sí; monto/concepto/caja negocio no llegan al write) |

### B. `"sacame 275 de la caja por el flete de hoy"`

| Campo | Valor |
|---|---|
| LLM (corrida 2) | `intent=register_cash`, **sin** `cash.type`, **sin** concepto; `payment.amount=275`, `amount=0` |
| entities | `amount=0`, `collectionAmount=275`, `paid=true`, **sin cashType** → `prepareOperation` pondría `cashType=egreso` por default |
| Plan | caja $0 + “Pago informado” |
| ERP | otra vez `registerCashFromWhatsapp` con amount 0 |
| Regex | `looksLikeCashMovement=false`. `parseWithRules=unknown` (sí extrae 275 y trata “hoy” como **fecha de entrega**) |
| SEMÁNTICA CONSERVADA | **NO** |

El regex de caja **no conoce** “sacame”. Gemini **sí** entendió caja. El backend **igual** perdió el 275 al mapear `payment` ≠ `cash`.

### C. `"a Natalia dejale el pedido pronto para pasado mañana y cobrale lo que falta"`

Contexto inyectado: `focusOrder #00401 Natalia pendiente`.

| Corrida | LLM | Conservada |
|---|---|---|
| 1 | `update_order_status` (log) | Parcial: no se serializó el JSON completo; el intent era el correcto |
| 2 (timeout) | `intent=unknown`, `requestedStatus=listo`, `targetReference=focused_order` → entities `targetOrderId=ord-natalia-demo`, **sin** `orderStatus`, **sin** `payment.full`, **sin** `dates.delivery` | **NO**: handler de `unknown` **no ejecuta** estado ni cobro |

`looksLikeCollectFullBalance` de **esta** frase = **false** (“cobrale lo que falta” no entra al regex de “todo el saldo”).  
`parseWithRules` → `update_order_status`, `orderStatus=listo`, `deliveryDate=2026-08-31`, cliente mal parseado (`"pasado mañana y"`).

ERP si intent fuera `update_order_status`: `updateOrderStatusFromWhatsapp` (`order-status.ts`, helpers de `routes/orders.ts`) y, en confirmación, posible segundo `registerPaymentFromWhatsapp` / `collectClientBalance` si `paid`/`payFullBalance`. Con el JSON de la corrida 2: **ningún write**.

SEMÁNTICA CONSERVADA: **NO** (corrida usable) / **PARCIAL** (corrida 1, solo intent).

### D. `"los dos primeros son M, el otro dejalo XL"`

stateBefore: `pendingIntent=confirm:create_order`, 3 ítems L, turns del pedido de Ana.  
Prompt **sí** mandó `knownEntities.items[]` con `itemKey`.

| Corrida | LLM |
|---|---|
| 1 | `intent=unknown` **pero** `itemQueries=["canguro negro M","canguro rojo M","buzo gris XL"]` |
| 2 | `intent=unknown`, `conversationAction=new_task`, **sin items**, `targetReference=focused_order` |

`shouldClearPendingForTurn` con `new_task` → **borra la confirmación del pedido**.  
Handler: `askUnknownIntent`. Las talles no se aplican.

SEMÁNTICA CONSERVADA: **NO**

### E. `"ese que vimos recién cuánto queda?"`

Contexto: foco pedido entregado + `focusProduct` Canguro felpa Rojo XL.

| LLM | `query_stock`, `targetReference=focused_product` |
| entities | `productId=sku-canguro-rojo-xl`, `referToFocusedProduct=true` |
| ERP | `queryStockFromWhatsapp` (`erp-queries.ts`) |
| `parseWithRules` | también `query_stock` pero **producto = la frase entera** (sin foco) |
| SEMÁNTICA CONSERVADA | **SÍ** (consulta contextual). El `amount: 0` basura no cambia el read |

### F. `"ayer entraron 900 a caja por un trabajo"`

| LLM | `register_cash`, `cash.type=ingreso`, `payment.amount=900`, `amount=0`, `notes=trabajo`, `client.name=caja`, **sin** `dates.order` |
| Plan | ingreso $0, cliente “caja”, diseño “trabajo”, “Pago informado” |
| ERP | `registerCashFromWhatsapp` amount 0; **fecha = `new Date()`**, ignora “ayer” (`erp-writes.ts` ~1211) |
| Regex | `looksLikeCashMovement=false`. `parseWithRules=unknown` (extrae 900) |
| SEMÁNTICA CONSERVADA | **NO** |

### Extra §8. `"un gasto"` después de caja Nuñez $370

Prompt real (sonda):

```
pendingIntent: confirm:register_cash
knownEntities: {"amount":370}    ← cashType/concept/ámbito NO viajan
turns: dueño anota salida… / bot ¿Confirmo egreso $370…?
```

En **producción**, `parseConversationFromState` para un confirm de caja **suele no mandar `knownEntities`**: el payload no tiene `clientName`/`targetOrderId`/`entities` anidado (`message-handler.ts` ~390–425). Solo turns + pendingIntent.

| Corrida | conversationAction | Resultado |
|---|---|---|
| 1 | `new_task` | otro `register_cash` amount 0, **sin** Nuñez/370 |
| 2 | `confirm_current` | overlay podría mezclar, pero `knownEntities` en prod a menudo **vacío**; el handler **no** entra a `handlePendingConfirmation` porque `skipPendingGates=true` |

SEMÁNTICA CONSERVADA: **NO**. El segundo mensaje **no** se procesa aislado del prompt (el hilo **sí** se envía), pero el modelo **no** reutilizó de forma fiable el gasto anterior, y el compactador de contexto **omite caja**.

---

## 8. Contexto que recibe el modelo

`buildTurnContextPrompt` (`language-interpreter.ts` ~82–137):

- `mensaje` (texto actual)
- `awaiting`, `pendingIntent`, `lastQuestion` (pendingPrompt ≤280)
- `originalIntent`
- `focusOrder` (`#label clientName id estado`)
- `focusProduct` / `focusProducts`
- `lastQuery` (intent + slots JSON)
- `lastCompleted` (`lastOperation`)
- `knownEntities` **recortado a:** `clientName, items, amount, notes, deliveryDate, orderStatus, requestedStatus, targetOrderId, paid`  
  **No manda:** `cashType`, `cashConcept`, `cashAmbitoHint`, `payment`, `extraCosts`, …
- `candidates` de lista
- `missingFields`
- `turns`: últimos **8** del estado (Firestore guarda 10 en `appendConversationTurns`)
- opcional: `formatOperatorMemoryPrompt`, `formatLanguageMemoryPrompt`

No manda catálogo, stock, ni saldos. El ERP se resuelve **después**.

**¿“un gasto” puede usar el mensaje anterior?**  
Arquitectura: el hilo **puede**. En la práctica: **casi aislado** para caja, porque `knownEntities` no incluye el movimiento y Gemini no rellenó concepto/monto desde turns de forma fiable.

---

## 9. Schema actual

Hay **dos capas**:

1. **Gemini v2** `GEMINI_TURN_SCHEMA_V2` + `TurnInterpretation` (`turn-interpretation.ts`): objetos tipados `cash`, `payment`, `items[]`, `corrections`, `query`, `filters`, `targetReference`, `dates`, `requestedStatus`, `ambiguities`, `missingFields`.
2. **Comando ERP** `WhatsappCommandEntities` (`ai-command-parser.ts` ~113+): Record amplio con strings legacy (`productName`, `cashType`, `sourceText`, `paid`, `payFullBalance`, `collectionAmount`, …).

El puente `turnInterpretationToParsed` **tira** campos si Gemini los pone en el lugar “inglés” o en `payment` en vez de `cash`.  
`GEMINI_TURN_SCHEMA` viejo (`conversation-contract.ts`) sigue para `parseWhatsappCommand` / audio / legacy, con `entities: OBJECT` libre.

Schema cash v2 (actual):

```ts
cash: { type, movementType, concept, ambitoHint, scope, amount }
payment: { full, amount, kind, method }
```

No hay `cash.date`. “Ayer” no tiene campo de primer nivel salvo `dates.order`, que **caja no usa** al persistir.

---

## 10. Pending

| Pregunta | Hecho |
|---|---|
| ¿Pending se pasa al LLM? | Sí: `pendingIntent`, `awaiting`, `lastQuestion`, a veces `knownEntities`, turns |
| ¿Puede interceptar ANTES del LLM? | **Sí:** help_topic, onboarding. **Sí:** SÍ/NO exacto o dígito (`matchDeterministicBypass`) |
| ¿Pending secuestra NL en `llm_first`? | **No** para texto libre: `skipPendingGates=true`. Gemini `new_task` **limpia** pending (`clearConversationTask`) |
| `"anotá un gasto de 500"` con awaiting viejo | Va a Gemini. Si `conversationAction=new_task`, suelta el pending y sigue caja. Eso es lo pedido. Si Gemini se equivoca y dice `unknown`+`new_task`, **también** suelta el pedido que estabas confirmando (frase D) |

`handlePendingClarify` / `parsePendingFollowUp` usan `interpretTurn` **legacy** y `looksLikeCashMovement(text)`. En texto `llm_first` **no** se entra ahí salvo bypass/choiceIndex.

---

## 11. Bypass determinístico permitido

Código: `matchDeterministicBypass` + tests en `conversation-v2.test.ts`.

| Utterance | ¿LLM? |
|---|---|
| `sí` / `no` con `confirm:*` | No. Confirma o cancela el **plan guardado** (`handlePendingConfirmation` ejecuta `entities`/`operationPlan` persistidos, no reparsea) |
| `2` con `select_*` | No. Elige índice |
| `sí, pero ponelo para mañana` | **Sí, va al modelo** (`classifyConfirmReply` exige string entero) |
| `2 y agregame otro` | **Sí, va al modelo** (no es `/^\d{1,2}$/`) |

Cumple el criterio de bypass **en esas pruebas**.  
Hueco: un `new_task` alucinado **no** vuelve al pending; lo **tira**.

---

## 12. ERP: ¿mismos servicios?

`executeWhatsappCommand` (`erp-integration.ts`) despacha a writers WhatsApp, no a HTTP `/api/orders`.

| Operación | ¿Mismas reglas que el panel? |
|---|---|
| Estado / entrega / descuento stock | **Sí, reusa** exports de `backend/routes/orders.ts` vía `order-status.ts` |
| Cobro | `collectClientBalance` (`utils/client-collections.ts`) — misma utilidad, no el router Express |
| Alta pedido | **Writer paralelo** `createOrderFromWhatsapp` → Firestore `pedidos` |
| Venta | **Paralelo** `createSaleFromWhatsapp` |
| Caja | **Paralelo** `movimientos_caja.add` (`registerCashFromWhatsapp`). Ámbito vía `normalizeMovementAmbito` (utils de caja). **Fecha siempre now.** Medio fijo `efectivo` |
| Compra | `parsePurchaseInput` / `persistPurchase` (`utils/purchase-finance.ts`) |
| Stock consulta | `erp-queries.ts` sobre el catálogo del negocio |

Objetivo “IA interpreta, ERP decide y guarda”: **PARCIAL**. Estado/stock de pedido alineados al panel. Caja/pedido/venta tienen orquestación WhatsApp propia.

---

## 13. Lo que no alcanza como “soporte de frase”

No se aprueba porque “agregamos gasto/egreso/salida”.  
La sonda muestra lo contrario:

- Frases **sin** esas keywords (`pagamos… garrafa`, `sacame… flete`, `entraron 900… trabajo`) → Gemini **a veces** pone `register_cash`.
- El **regex** de caja **no** las reconoce.
- El **backend** igual **rompe** el monto al copiar `payment`→`collectionAmount` y escribir `entities.amount`.

Eso es comprensión del modelo **más** un contrato de slots **roto**, no un diccionario de frases.

---

## 14. Criterio de aprobación (evaluación)

| # | Criterio | Estado | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | LLM interpreta lenguaje libre | **PARCIAL** | `interpretLlmFirstTurn` + schema v2; A/B/F intent caja; E stock con foco | Slots fiables; no `unknown` en correcciones/comandos compuestos |
| 2 | No hay intent router regex **antes** del modelo | **PARCIAL** | Texto: Gemini primero. Help/onboarding/bypass/audio sí interceptan. `parseWithRules` vive | Quitar interceptos no determinísticos; audio al mismo intérprete v2 |
| 3 | Backend no reinterpreta `rawMessage` | **NO** | `looksLikeCollectFullBalance`, `ORDER_PAY_HINT`, `takeDualIntent`, `resolveSpokenCashAmbito(sourceText)`, `formatOperationSummary` | Pago/caja/dual-intent solo desde `TurnInterpretation` |
| 4 | Pending es contexto, no secuestrador | **PARCIAL** | NL salta gates; SÍ/NO OK; help/onboarding secuestran; `new_task` borra confirmaciones | Pending solo bypass exacto; `correct_current` no limpia el plan |
| 5 | Modelo usa conversación/foco | **PARCIAL** | E SÍ. knownEntities **sin cash**. D/FOLLOWUP NO | Mandar `cash`/`items`/`payment` completos; foco de ítems en correcciones |
| 6 | Structured output = operaciones | **PARCIAL** | Schema tipado existe; se aplasta a `WhatsappCommandEntities` | Plan = `TurnInterpretation` (o payload 1:1), no bolsa legacy |
| 7 | Ejemplos = tests, no código | **NO** | `CASH_OUT_PATTERNS`, `looksLike*`, listas de productos en `looksLikeNewOrder` | Dejar regex solo en tests / bypass exacto / match de catálogo |
| 8 | Frases no vistas funcionan | **NO** | A/B/F/C/D fallan el plan o el write. Solo E aprueba | Contrato cash/payment + correcciones multi-ítem |
| 9 | ERP datos y reglas reales | **PARCIAL** | Queries y estado de pedido sí; caja/pedido write paralelo; caja ignora fecha | Writes por los mismos servicios que el panel; fecha de movimiento |
| 10 | OperationPlan conserva el LLM | **NO** | Plan A/B/F amount 0; C unknown; D unknown+clearPending | Mapear `cash.amount`/`payment` sin pisarse; no ejecutar `unknown` |

---

## 15. Resultado

### ARQUITECTURA ACTUAL: **NO APROBADA**

(equivalente operativo: **PARCIAL** en dirección, **no** apta para dejar de corregir casos)

No es un bot que solo dispara frases hardcodeadas. Tampoco es el pipeline que describiste. Es **LLM-first con un segundo cerebro regex/legacy** y un **write de caja que no consume el JSON del modelo**.

### Capas a eliminar / refactorizar (sin parches de frases)

Orden sugerido. **No implementar en este documento.**

1. **Contrato post-LLM (bloquea caja y cobros)**  
   - Un solo lugar para dinero: `cash.amount` vs `payment.amount`.  
   - `registerCashFromWhatsapp` debe usar el monto de caja, no `entities.amount` pisado por `0`.  
   - No default silencioso `amount: 0` desde schema Gemini.  
   - Fecha de caja desde `dates.order` si el dominio la admite.

2. **Dejar de releer `sourceText` para semántica**  
   - Sacar de `prepareOperation` / `formatOperationSummary` / `order-finance`: `looksLikeCollectFullBalance`, `ORDER_PAY_HINT`, `SETTLE_TURN` sobre el utterance.  
   - Cobro total = `interpretation.payment.full` / `payFullBalance` del modelo.  
   - `resolveSpokenCashAmbito`: solo `cashAmbitoHint` (y id ya resuelto), no el mensaje crudo.  
   - `takeDualIntent`: o lo hace Gemini (`operations[]`) o se elimina el split por regex.

3. **Pending**  
   - Intercepto pre-LLM: únicamente bypass exacto (SÍ/NO / dígito) + onboarding técnico si hace falta.  
   - Help no debe comerse un turno operativo.  
   - `conversationAction=new_task` no debe borrar un `confirm:*` si el JSON trae `correct_current` / items con `itemKey`.  
   - `knownEntities` debe incluir cash/items/payment reales del payload de confirmación (hoy el confirm de caja a menudo **no** manda knownEntities).

4. **Una sola interpretación**  
   - Audio: mismo `GeminiInterpreter` v2, no `parseWhatsappCommand` + `mergeParsed`.  
   - `parseWithRules` / `enrichEntitiesFromText`: tests + flag `legacy` solamente.  
   - Clarify pending: no llamar `interpretTurn` v1.

5. **OperationPlan = output del LLM validado contra ERP**  
   - Confirmación SÍ ya ejecuta el plan guardado (bien).  
   - El plan hay que **armarlo desde slots del schema**, no desde entities contaminadas.  
   - ERP: caja/pedido/venta deberían pasar por las mismas funciones que el panel (o extraer un módulo compartido); WhatsApp no debería tener fecha/medio hardcodeados distintos.

6. **Prompt**  
   - Puede seguir con principios. **No** agregar las frases A–F.  
   - Sí hace falta (en un cambio futuro, no ahora) un contrato explícito: *egreso de caja → `cash`, nunca `payment`*. Eso es schema/instrucción, no un diccionario de “garrafa”.

Hasta que 1–3 estén hechos, **seguir parcheando casos con regex o sinónimos empeora el objetivo**. El fallo de “garrafa / sacame / ayer” no fue “faltó la frase”: fue **mapeo y writers**.
