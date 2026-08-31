# Auditoría conversacional RiloBot

29 ago 2026 · solo lectura · trazas deterministas con `parseWithRules` + gates. Gemini no se invocó en esta auditoría.

Mapa visual (canvas, no es este archivo): `canvases/rilobot-conversation-audit.canvas.tsx`.

**El problema no es que Gemini no entienda.** El backend decide el acto de habla **antes** de que el modelo vea el mensaje, y **después** vuelve a extraer semántica del texto crudo. El flujo canónico de `docs/rilobot-arquitectura-interpretacion.md` no es el que corre.

El documento canónico describe: mensaje → `interpretTurn`/Gemini → resolvers → plan. El código real intercepta con regex, pending y resume **antes** de `interpretTurn`. Después de Gemini, `enrichEntitiesFromText` / `extractProductHintFromText` / `mergeParsed` vuelven a extraer semántica del raw. Gemini a menudo ni ve el mensaje; cuando lo ve, el backend puede sustituir A por B.

---

## 1. Pipeline real

Orden en `handleWhatsappTurn` (`message-handler.ts` ~5448). Cada paso puede hacer `return` y abortar el resto.

```
WhatsApp webhook
  routes/whatsapp-webhook.ts
  processWhatsappNotification → handleWhatsappMessage
    ↓
handleWhatsappTurn
  tenant / cuota / features / media
  [audio] interpretTurn solo para transcribir
    ↓
getConversationState                          conversation-state.ts
    ↓
help_topic / onboarding
    ↓
earlyParsed = parseWithRules                  ← REGEX, no Gemini
    ↓
how_to / capability con pending               answerUsageQuestion
    ↓
pending === resume_context                    handleResumeContext (rules)
    ↓
idle 15 min → askIdleResume                   SÍ/NO  «¿Seguimos?»
    ↓
continueQueryOrList                           lastQuery, sin Gemini
    ↓
isFreshTaskUtterance → dropea pending
    ↓
!doesFillCurrentSlot → holdPendingAndAnswer   aside + re-pregunta el slot
    ↓
handlers de slot:
  select_* / collect_order_items / stock_resolution /
  confirm:* / clarify / settle / payment kind
    ↓  ★ Gemini del turno, si nadie cortó
interpretTurn → parseWhatsappCommand
  parseWithRules
  [maybe] parseWithGemini
  mergeParsed → pinFocusOrderToParsed → adoptStockResolutionIfAwaiting
    ↓
prepareOperation                              IDs, missing, listas
  askConfirmation → buildOperationPlan        confirm:<intent>
    ↓  (consultas: execute inmediato)
SÍ → executeWhatsappCommand                   erp-integration.ts
  erp-writes / order-status / erp-queries
    ↓
presenter + appendConversationTurns           webhook, después de responder
```

Gemini del turno libre está en el **paso 14**. Todo lo de arriba puede secuestrar el mensaje.

| # | Qué | Archivo · función | ¿Gemini? |
|---|---|---|---|
| 1 | Webhook Meta + dedup | `whatsapp-webhook.ts` · `processWhatsappNotification` | No |
| 2 | `handleWhatsappMessage` → `handleWhatsappTurn` | `message-handler.ts`:5419 / 5448 | No |
| 3 | Tenant, cuota, features, media | `message-handler.ts`:5457–5558 | Audio: sí (transcripción) |
| 4 | Cargar ConversationState | `conversation-state.ts` · `getConversationState` | No |
| 5 | help_topic / onboarding pending | `help.ts` / onboarding | No |
| 6 | `earlyParsed = parseWithRules` | `ai-command-parser.ts`:1068 | No |
| 7 | how_to / capability con pending | `answerUsageQuestion` | No |
| 8 | `pendingIntent === resume_context` | `handleResumeContext` | No (solo rules) |
| 9 | Idle ~15 min → ¿Seguimos SÍ/NO? | `shouldAskIdleResume` → `askIdleResume` | No |
| 10 | Follow-up de consulta/lista | `continueQueryOrList` | No |
| 11 | `isFreshTaskUtterance` → dropea pending | `conversation-follow.ts`:764 | Luego sí, si llega a 14 |
| 12 | `!doesFillCurrentSlot` → `holdPendingAndAnswer` | `conversation-follow.ts` + operator-voice | Solo voz (aside) |
| 13 | Handlers de slot (select, stock, confirm, collect…) | `message-handler.ts`:5677–5852 | Algunos: `parsePendingFollowUp` |
| 14 | `interpretTurn` → `parseWhatsappCommand` | `conversation-engine.ts`:88 | Sí, salvo skip |
| 15 | `mergeParsed` + `pinFocus` + `adoptStock` | `ai-command-parser.ts`:2130+ | Post-Gemini |
| 16 | `prepareOperation` (IDs, missing, lists) | `message-handler.ts`:1059 | Catalog-AI aparte |
| 17 | `buildOperationPlan` + `confirm:*` | `operation-plan.ts`:69 · `askConfirmation` | No |
| 18 | SÍ → `executeWhatsappCommand` | `erp-integration.ts`:72 | No |
| 19 | ERP write / query | `erp-writes` / `order-status` / `erp-queries` | No |
| 20 | Presenter + `appendConversationTurns` | `whatsapp-present` + webhook | No |

---

## 2. Qué ocurre antes de Gemini

| Gate | Captura | ¿Gemini ve el mensaje? | ¿Intención nueva → pending viejo? |
|---|---|---|---|
| `askIdleResume` | ~15 min + pending/foco, si el texto no es “intención completa” | No. Stash + SÍ/NO | Sí: el siguiente turno se trata como resume, no como query/status |
| `resume_context` pending | Respuesta al SÍ/NO de idle | No (`parseWithRules` en `handleResumeContext`) | Sí, salvo `skipResumeGate` / `run_new` |
| `isFreshTaskUtterance` | Caja, pedido nuevo, compra. Status query **NO** es fresh si `pending=clarify` | Si dropea, el turno sigue a Gemini | Si es false, el mensaje queda atrapado en el pending |
| `holdPendingAndAnswer` | Texto que no llena el slot (preguntas, off-topic) | Solo operator-voice para el aside | Sí: re-pregunta el slot. Caso A con `pending=clarify` cae acá hoy |
| `doesFillCurrentSlot` + handler | números, SÍ/NO, fechas, stock, collect items | select/stock/confirm: `parsePendingFollowUp` sí llama `interpretTurn` | El handler asume que el texto es la respuesta al slot |
| `parseWithRules` (siempre primero) | Saludos, how_to, status, cash, pedido, stock awaiting… | Gemini corre después salvo `rulesKnowsRead` / chitchat | Puede fijar `intent=create_order` / `register_payment` antes del modelo |
| `continueQueryOrList` | «más» / «y Pedro?» / «y L?» sin pending | No | No (sigue `lastQuery`) |
| thanks / greeting / help | Dale. / menú | No si se detecta antes | No |

Skip de Gemini (`needsGemini` falso): chitchat trivial, o rules con ≥0.85 en `query_balance` / `help` / `how_to` / `capability_question` / `greeting` / `query_cash`.

**`query_status` y `update_order_status` no están en esa lista**: si llegan al paso 14, Gemini corre.

---

## 3. Prompt real de Gemini

No hay **system instruction**. `gemini.ts` manda un único `contents: [{ role: 'user', parts }]`. JSON + `responseSchema: GEMINI_TURN_SCHEMA`.

Contexto interpolado en el user prompt:

- últimos **8** turns, 280 chars
- `focusOrder` (id, label, client, status)
- `lastOperation`
- `pendingPrompt`
- si hay tarea: `originalIntent`, `awaiting`, `knownEntities` JSON, `missingKeys`, `candidates`
- bloque de stock si `awaiting === stock_resolution`
- memoria del negocio (`formatOperatorMemoryPrompt`)
- memoria de habla (`formatLanguageMemoryPrompt`, máx 20)
- ejemplo de producto del rubro
- `Mensaje: ${JSON.stringify(message)}`
- imagen/audio como `inlineData`

**No** manda el catálogo SKU en este turno. Eso va en `pickClientsWithAi` / `pickProductsWithAi` después.

Prompt literal (plantilla; `${…}` se interpola en `parseWithGemini`, `ai-command-parser.ts` ~1837–2050):

```
productRule =
  if copy.hasProductExamples:
    - items[]: cada producto es un renglón aparte (quantity, rawText, productHint, attributes). Ejemplo de un ítem: «${copy.exampleProduct}». No concatenes varios productos. No pongas fecha ni cliente dentro de rawText.
  else:
    - items[]: cada producto es un renglón aparte. Conservá talle/color/tela en attributes. No concatenes varios productos. No pongas fecha ni cliente dentro de rawText.

focusLine (si hay foco):
- Pedido EN FOCO (de ESTE chat, más importante que el último guardado): #${label} ${clientName} id=${id} estado=…. «ponelo», «movelo», … = ESTE pedido. Copiá targetOrderId, targetOrderLabel, clientName. referToLast=false. conversationAction=new_task si cambia estado/cobro. NUNCA create_order. NUNCA productName ni productHint a partir de «move», «el pedido», «estado» o «entregado».

idleFocusRule (foco y sin tarea):
- Sin tarea abierta, PERO hay pedido en foco. «move el pedido a estado entregado», … → intent=update_order_status … NO create_order. NO productName.

stockDecisionBlock (si awaiting stock):
DECISIÓN PENDIENTE DE STOCK (prioridad absoluta):
- TAREA ACTIVA: cambiar el estado del pedido en foco. NO es un pedido nuevo.
- conversationAction=answer_current. intent=update_order_status.
- «desconta el total del pedido» → stockResolution=discount_full_order
- NUNCA create_order. NUNCA productName/productHint a partir de «descontá», «total», «pedido», «stock».

conversationBlock =
ESTE ES UN CHAT CONTINUO…
- Últimos mensajes: ${thread}
${focusLine}
- Lo último que preguntó el bot: ${pendingPrompt}
${stockDecisionBlock}
[si inProgress:]
- Operación en curso / Esperábamos / Datos ya cargados JSON / Campos que faltaban / Opciones
- followUpAction / conversationAction / choiceIndex
- Si esperábamos notes: el mensaje ENTERO es notes. NUNCA productName.
[si no:]
- followUpAction: omitilo si es un mensaje nuevo…
${lastOpLine}
${idleFocusRule}

Eres el intérprete conversacional de RiloBot.

Tu función es comprender exactamente qué quiere hacer el usuario.

Los usuarios hablan español natural, especialmente español rioplatense,
pueden cometer errores de ortografía, usar abreviaciones, omitir palabras,
escribir varias instrucciones juntas y responder de forma contextual.

No exijas comandos exactos.

Interpretá el mensaje completo.

Primero determiná si el usuario está:
- ejecutando una acción,
- continuando una acción,
- corrigiendo,
- contestando una pregunta,
- preguntando cómo usar una función,
- preguntando si una función existe,
- cancelando,
- o iniciando una tarea nueva.

No confundas preguntas sobre cómo hacer algo con solicitudes para ejecutarlo.
No conviertas texto desconocido automáticamente en un producto.
Solo extraigas productos cuando el intent requiera productos.
Una instrucción explícita nueva puede reemplazar un contexto pendiente viejo.
Si el usuario utiliza una referencia implícita como «pasalo», «movelo», «ese pedido», resolvela primero contra el foco conversacional.
Si no hay certeza, intent=unknown. NUNCA asumas create_order porque no entendiste.

Una respuesta puede contestar la pregunta pendiente y aportar información adicional.

Nunca descartes partes del mensaje.

No inventes datos del ERP.

No inventes clientes, productos, precios, saldos, estados ni IDs.

Separá semánticamente cliente, items, atributos, descripción, fechas,
pagos, costos y estado.

Una frase puede contener múltiples productos y múltiples acciones.

Las correcciones modifican únicamente aquello que el usuario corrigió.

La información confirmada previamente debe conservarse.

La memoria del usuario es una ayuda, no una verdad absoluta.

Si una interpretación tiene varias posibilidades razonables, marcala como ambigua.

Si falta un dato obligatorio, indicá cuál falta.

No ejecutes ninguna acción.

Devolvé únicamente el structured output solicitado.

Si hay imagen, usala como referencia (pedido, venta o compra a proveedor).
Si hay audio, transcribilo al español (rioplatense) y clasificá lo que dijo. No inventes palabras que no se oigan.
Devolvé SOLO JSON válido con:
- intent: help|how_to|capability_question|greeting|create_order|create_sale|create_purchase|register_payment|query_balance|query_cash|query_status|query_stock|register_cash|create_client|register_cost|update_product_cost|update_order_status|unknown
- confidence: 0-1
- conversationAction: continue_current|new_task|correct_current|cancel_current|confirm_current|answer_current
- transcript: si hay audio, la transcripción literal. Si no se entiende, string vacío.
- followUpAction, choiceIndex, choiceIndexes (opcionales)
- items: ARRAY de renglones independientes para create_order, create_sale y create_purchase. Cada ítem: { quantity, rawText, productHint, attributes: { type, fabric, model, color, size } }. UNA frase con varios productos = VARIOS items. Nunca un solo productName con «1 X y 1 Y».
- entities: objeto opcional con clientName, clientPhone, supplierName, productName (solo si hay UN ítem; si hay varios usá items[]), quantity, amount, notes, paid, requestedStatus, imageSummary, cashType, cashConcept, cashAmbitoHint, orderDate, deliveryDate, invoiceNumber, purchaseLines, paymentMethod, paymentCuotas, paymentKind, seniaAmount, orderStatus, payFullBalance, listOrders, orderNumber, referToLast, extraCosts, stockResolution, descuentoFisicoAlcance

Reglas:  [~70 viñetas en el mismo string: greeting, help, how_to, create_order, «pásalo a entregado», notes Ceibal, paid vs estado, query_status, register_payment, update_order_status, register_cash, compras/e-Ticket, extraCosts, payFullBalance, requiresClarification…]

${conversationBlock}
${memoryBlock}

Mensaje: ${JSON.stringify(message)}
```

Las ~70 reglas literales están contiguas en `ai-command-parser.ts` líneas 1977–2047 (incluye el ejemplo «canguro XL rojo con diseño de ceibal ya está pago $1550» → `notes="Ceibal"`).

Catálogo (llamadas aparte, no van en el turno):

- `catalog-ai.ts` · `pickClientsWithAi` — catálogo de clientes id|nombre
- `catalog-ai.ts` · `pickProductsWithAi` — catálogo de SKUs id|nombre|color|talle|precio

---

## 4. Structured output

Schema real (`GEMINI_TURN_SCHEMA` en `conversation-contract.ts`):

- `intent`
- `confidence`
- `conversationAction`
- `followUpAction`
- `choiceIndex` / `choiceIndexes`
- `requiresClarification`
- `clarificationReason`
- `transcript`
- `client { raw, name, phone }`
- `items[]`
- `entities` (**OBJECT libre, sin propiedades tipadas en el schema**)

`normalizeGeminiResult` **no copia** `requiresClarification`, `clarificationReason`, `stockResolution`, `targetOrderId`, `listOrders`, `helpTopic`. El prompt los pide; el runtime a menudo los ignora y los rellena con rules / `pinFocus`.

Sigue dependiendo de **string libre `productName`**: `syncLegacyProductFields`, `ensureOrderItems`, `extractProductHintFromText`, `required-fields.ts`, `compactItem` del plan.

No hay tipos Gemini de `filters` / `corrections` / `missingFields` / `ambiguities` poblados por el modelo. Eso vive en `turn-interpreter` / `required-fields` post-parse.

Intents posibles:

`help | how_to | capability_question | greeting | create_order | create_sale | create_purchase | register_payment | query_balance | query_cash | query_status | query_stock | register_cash | create_client | register_cost | update_product_cost | update_order_status | unknown`

`conversationAction`:

`continue_current | new_task | correct_current | cancel_current | confirm_current | answer_current`

---

## 5. Qué modifica el backend después de Gemini

| Campo | Qué pasa |
|---|---|
| `intent` | `mergeParsed`: si Gemini=`unknown`, ganan rules. Si rules=`how_to`/`update_order_status` y Gemini=`create_order`, ganan **rules**. Si no, **gana Gemini**. Luego `pinFocus` puede forzar `update_order_status`. `adoptStockResolutionIfAwaiting` puede robar `create_order`→status. |
| `items` / `productName` | `enrichEntitiesFromText` re-extrae del raw. `coalesceOrderItems` mergea rules+Gemini. `ensureOrderItems` parte `productName`. Intents no-producto **borran** items. `prepareOperation` **vuelve a** `extractProductHintFromText(sourceText)` si falta nombre. |
| `notes` | `extractNotesHintFromText` + `sanitizeOrderNotes`. No hay `notes +=`, pero si Gemini puso el mensaje entero, sanitize puede dejar basura de pago. |
| `client` | `client.raw` → `clientName`. Lookup después. Lock de foco si no hay switch explícito. |
| `paid` / `payFullBalance` | Overlay regex `looksLikeCollectFullBalance` encima de Gemini. |
| `targetOrderId` | `applyOrderLock` / `pinFocus`. `looksLikeNewOrder` **borra** target. |
| `conversationAction` | Se toma de Gemini, o se pisa en stock (`answer_current`). |

Ahí está **Gemini entiende A → backend produce B**.

Cadena post-Gemini:

```
normalizeGeminiResult
  → enrichEntitiesFromText (regex de monto/fecha/producto/notas)
  → coalesceEntities / coalesceOrderItems
  → mergeParsed (matriz de preferencia)
  → pinFocusOrderToParsed
  → adoptStockResolutionIfAwaiting
  → wipe de productName si intent no es PRODUCT_INTENTS
  → prepareOperation (extractProductHint / extractNotesHint / missing fields)
```

El comentario de `interpretTurn` dice «el backend no reinterpreta». Es falso: hay reinterpretación regex en el parser y otra vez en `prepareOperation`.

---

## 6. Fallbacks

**No existe** `unknown → create_order`.

El salto a pedido es indirecto:

1. Intent mal puesto (`create_order` / `register_payment`) por **rules o Gemini**.
2. `extractProductHintFromText` convierte el resto de la frase en `productName`.
3. `prepareOperation` lo vuelve a hacer si el parser “limpió” el producto.

| Dónde | Qué hace | ¿unknown → pedido? |
|---|---|---|
| Prompt Gemini | «NUNCA asumas create_order porque no entendiste» | No (instrucción) |
| `mergeParsed` si Gemini=null | `newOrder && (register_cost\|query_status)` → `create_order` | No directo desde unknown |
| `preferGemini` | Gemini unknown → rules ganan. Gemini create_order vs rules how_to/status → rules ganan | No |
| `enrichEntitiesFromText` / `extractProductHintFromText` | Cualquier resto de frase → productName/items | Indirecto: si el intent queda create_order, el hint se vuelve ítem |
| `prepareOperation` ~1107 | Si `productParserAllowed(intent)` y no hay productName, re-extrae del sourceText | Indirecto |
| `turn-interpreter` `ensureOrderItems` | productName string → split → items[] | Duplica renglones si Gemini ya trajo items y legacy productName sigue |
| `clarify` / unknown | `askWhatYouMeant`; reparse con original. No fuerza create_order | No |

Funciones: `lookups.ts` `extractProductHintFromText`; `ai-command-parser.ts` `enrichEntitiesFromText`; `message-handler.ts` ~1107; `turn-interpreter.ts` `ensureOrderItems`.

`unknown` real → `clarify.ts` `askWhatYouMeant`.

«pasalo a entregado» y «desconta el total» se vuelven producto por esa vía, no porque unknown lo pida.

---

## 7. ConversationState

Interface real en `conversation-state.ts`. **No existe** `lastCompletedOperation`. **`awaiting` no es top-level**; se deriva de `activeTask` / `pendingIntent` al armar el parse context.

Persistido en: `negocios/{businessId}/whatsapp_conversations/{phone}`.

| Campo | Vive | Tras create_order SÍ | Por qué «movelo a entregado» falla |
|---|---|---|---|
| `pendingIntent` / payload / prompt | top-level | Se borra | Un pending viejo (`clarify`) sigue interceptando el próximo mensaje |
| `awaiting` | `activeTask.awaiting` (no top-level) | Se borra | Si se pierde, stock «desconta…» deja de ser slot y vira a producto |
| `focusOrder` | top-level | Se setea si `kind=order` + id | Si execute no devolvió kind/id, nunca hay foco |
| `focusEntities.order.locked` | top-level | `locked=true` | Gemini con otro clientName suelta el lock (`isExplicitOrderSwitch`) |
| `lastOperation` | top-level | `kind=order` | Un cobro posterior deja `kind=payment`; el foco del pedido debería quedar |
| `lastCompletedOperation` | no existe | — | El doc mental no coincide con el código |
| `turns` | máx 10 | Sobrevive | Gemini solo ve 8×280 chars |
| `activeTask` / `operationPlan` | con confirm | Se borra | El plan no se relee en el próximo turno libre |
| `dropConversationContext` | definido | Nunca se llama | NO de resume no borra foco (`clearConversationTask`) |

Tras un `create_order` confirmado, `rememberLastOperation` → `conversationFocusAfterOperation` **sí setea `focusOrder`**. «movelo a entregado» falla cuando: el write no devolvió `kind/id`; un pending viejo intercepta antes; Gemini nombra otro cliente y suelta el lock; hay varios pedidos abiertos del mismo teléfono.

`dropConversationContext` (borra foco) **nunca se llama**. Resume NO usa `clearConversationTask` (pending fuera, foco queda).

---

## 8. «desconta el total del pedido» → create_order

Con `pendingIntent=stock_resolution` (hoy):

1. Idle resume no aplica.
2. `isFreshTaskUtterance` = false (`looksLikeNewOrder` = false).
3. `doesFillCurrentSlot` = **true**.
4. `handleStockResolution` → `parsePendingFollowUp` → `interpretTurn` **con** `awaiting=stock_resolution`.
5. `parseWithRules` → `update_order_status` + `discount_full_order`.
6. Gemini igual corre. Si dice `create_order`, `adoptStockResolutionIfAwaiting` lo roba.

**Por qué se rompía:** si el awaiting **no** viajaba al parser (pending ya limpio, o `parseWithRules` sin conversation), `looksLikeOrderStatusUpdate` es **false**, `extractProductHint` = la frase entera, intent cae a pedido/producto. El log `[whatsapp:items]` sigue fabricando un ítem con esa frase incluso cuando el intent final es status.

---

## 9. “Proyecto RP”

No hay un repo hermano. **RP = el panel ERP de este mismo repo** (los tests dicen «RP: sin reservas» = flag de `order-config.ts`).

| Dominio | Panel | WhatsApp |
|---|---|---|
| Pedido create | `orders.ts` POST | **Writer paralelo** `createOrderFromWhatsapp` |
| Estado / entrega / ganancia | `orders.ts` helpers | **Reusa** en `order-status.ts` |
| Stock reserva/descuento | `order-stock-reservations.ts` | Status **reusa**; create WA **no** llama `applyOrderStockPreparation` |
| Venta | `sales.ts` | Paralelo, simplificado |
| Compra | `purchase-finance.ts` | **Reusa** persist |
| Cobro | `collectClientBalance` | **Reusa** |
| Caja | `cash.ts` | Paralelo para ingresos/egresos sueltos |

La máquina de estados de stock **no** está duplicada en el cambio de estado. El create de pedido sí.

---

## 10. Quién debería hacer qué vs hoy

| Capa | Quién debería | Quién pisa hoy |
|---|---|---|
| LLM | Gemini | `parseWithRules` + `looksLike*` deciden primero |
| Orchestrator | `message-handler` fino | El mismo archivo hace slots, ERP, present (~6000 líneas) |
| EntityResolver | `lookups` / `catalog-rank` | `lookups` también clasifica intents |
| ERP | `orders.ts` / `sales.ts` / `cash.ts` | `erp-writes` reimplementa create |
| Planner | `operation-plan` inmutable | El execute usa **entities**, no solo el plan |
| Presenter | `whatsapp-present` | Copy mezclada en handlers |

Archivos que mezclan responsabilidades:

| Archivo | Debería ser | Hoy también hace |
|---|---|---|
| `message-handler.ts` (~6000 líneas) | ConversationOrchestrator | Routing, slots, confirm, stock, collect, present, ERP glue |
| `ai-command-parser.ts` | GeminiInterpreter | Regex `parseWithRules`, merge, product hints, focus pin, stock steal |
| `lookups.ts` | EntityResolver | Clasificación de intención (`looksLike*`), notas, productos, cobros |
| `erp-writes.ts` | ERP Domain (reusar panel) | Create pedido/venta/caja en paralelo a `orders.ts` / `sales.ts` / `cash.ts` |
| `order-status.ts` | ERP Domain | Reusa helpers del panel (correcto). Resolución de cuál pedido es conversacional |

---

## 11. Trazas de los 5 casos

Ejecutado `parseWithRules` + gates **sin llamar a Gemini** (así no se gasta cuota). `geminiWouldRun` indica si el paso 14 lo invocaría.

Estado simulado: `focusOrder` #00236 Laissmachado. A con `pending=clarify` idle. C con `awaiting=stock_resolution`.

### A — `en que estado esta el pedido de machado?`

- **stateBefore:** `focusOrder` #00236 Laissmachado + `pendingIntent=clarify` (pending viejo).
- **Rules:** `query_status` 0.93, `conversationAction=new_task`, `clientName=machado`, lock → `#00236`.
- **Idle resume:** `shouldAskIdleResume=false` (intención completa). El SÍ/NO que viste era el gate **histórico** (antes de que las queries saltaran idle).
- **Hoy, con pending=clarify:** `isFreshTaskUtterance=false`, `doesFillCurrentSlot=false` → **`holdPendingAndAnswer`**. Gemini **no corre**. El bot puede re-preguntar el dato viejo en vez de consultar estado.
- **Veneno:** `extractProductHintFromText` = `"en que estado esta el"`.
- **Gemini input/output:** no hay: el handler corta antes. Si llegara al paso 14, Gemini sí vería foco + mensaje; rules ya tenían la respuesta correcta.

### B — `pasalo a estado entregado`

- **stateBefore:** foco #00236, sin pending.
- **Handler:** ninguno.
- **Rules:** `update_order_status`, `orderStatus=entregado`, `targetOrderId=ord-00236`. `productHint=null`.
- **Gemini:** **sí correría**. Si devolviera `create_order`, `mergeParsed` + `pinFocus` fuerzan status.
- **Sin foco:** el mismo texto puede terminar en `productName`.

### C — `desconta el total del pedido`

- **stateBefore:** `pendingIntent=stock_resolution`, foco #00236.
- **Handler:** `handleStockResolution` (slot filled).
- **Rules (con awaiting):** `update_order_status`, `stockResolution=discount_full_order`.
- **Gemini:** sí, vía `parsePendingFollowUp`. El steal de stock está pensado para si Gemini dice `create_order`.
- **Sin awaiting:** `hasExplicitCompleteIntent=false`, hint = frase entera → pedido/producto.

### D — `quiero registrar un pedido de 30 productos, cómo te paso la información?`

- **Rules:** `how_to` 0.94, `helpTopic=create_order`, `expectedItemCount=30`.
- **Gemini:** **no** (`rulesKnowsRead`).
- **Riesgo:** si `utteranceIsHowTo` no matchea, el resto del stack empuja a `create_order`.

### E — `un canguro XL rojo con diseño Ceibal ya está pago $1550`

- **Rules:** **`register_payment`** 0.88, `paid=true`, `$1550`, `notes=Ceibal`, ítem canguro. **No** `create_order`. `looksLikeNewOrder=false`.
- **Notes rules:** `extractNotesHint` + `sanitize` = `"Ceibal"` (bien).
- **Gemini:** **sí correría**. Si dice `create_order`, gana (`preferGemini`). Si Gemini falla/timeout, el backend deja un **cobro**, no un pedido.
- **Si Gemini pone notes = mensaje entero:** el backend puede no cortar «ya está pago $1550».

---

## 12. Diagnóstico

| Causa | Veredicto |
|---|---|
| **A. Gemini** | Secundario. El prompt ya prohíbe create_order / productName en estos casos. |
| **B. Prompt/schema** | Prompt enorme y desconectado del routing. `entities` untyped. `productName` legacy. Campos pedidos y no copiados. |
| **C. Routing** | **Primario.** Gemini está tarde. |
| **D. Pending/state** | **Primario en A.** `clarify` no trata una query completa como fresh. Idle resume fue el síntoma anterior. |
| **E. Merge/normalización** | **Primario en B/C/E.** `extractProductHint` corre demasiado pronto y otra vez en `prepareOperation`. |
| **F. Entity resolution** | El lock Machado↔#00236 **funciona** si se llega a aplicarlo. |
| **G. Business rules** | Status/stock alineados al panel. Create pedido/venta/caja duplicados. |
| **H. Persistencia** | Turns se guardan **después** de responder. `dropConversationContext` muerto. |

### Arquitectura objetivo (propuesta, no implementada)

1. **LLM:** único clasificador de lenguaje del mensaje actual + hilo + foco. Sin `parseWithRules` de intent.
2. **Orchestrator:** solo cuota, SÍ/NO de un `operationPlan` ya construido, y número de una lista ya mostrada. Pending no clasifica.
3. **EntityResolver:** IDs a partir del structured output (`items[]`, `client.raw`, `targetOrderId`). Cero `extractProductHint` fuera de `create_order|create_sale|create_purchase`.
4. **ERP Domain:** las mismas funciones que el panel (`orders.ts`, stock, caja). WhatsApp no escribe `pedidos` por un segundo camino.
5. **OperationPlanner:** el SÍ ejecuta el plan, no reinterpreta el raw.
6. **State:** `focusOrder` sobrevive; pending es `awaiting` del plan; un mensaje con `conversationAction=new_task` del LLM **siempre** gana a un pending stale.

Cuando se implemente: prioridad de routing — no más regex por frase.
