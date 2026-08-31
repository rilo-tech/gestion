# RiloBot engine v2 (`llm_first`)

29 ago 2026. Implementación etapa 1 de la auditoría conversacional.

Flag: `RILOBOT_CONVERSATION_ENGINE=llm_first` (default) | `legacy`.

---

## A. Interfaces nuevas

- `LanguageInterpreter.interpretTurn(input) → TurnInterpretation` (`language-interpreter.ts`)
- `GeminiInterpreter` / `OpenAIInterpreter` (stub) / `createLanguageInterpreter`
- `TurnInterpretation` (`turn-interpretation.ts`): intent, conversationAction, client, items[], payment, requestedStatus/orderStatus, dates, filters, corrections, missingFields, ambiguities, stockResolution, targetReference, help/howTo, cash, extraCosts
- `TargetReference`: `focused_order` | `focused_client` | `last_completed` | `{ clientHint, orderNumber, orderId }`

## B. Schema Gemini

`GEMINI_TURN_SCHEMA_V2` en `turn-interpretation.ts`. `entities` deja de ser un OBJECT libre. Cada propiedad del schema se copia en `normalizeTurnInterpretation`.

System instruction: `RILOBOT_SYSTEM_INSTRUCTION` (principios + 5 patrones). El user message es solo contexto del turno.

## C. Pipeline v2

```
webhook → tenant/cuota/media
  → bypass exacto: SÍ/NO de confirm:*  |  dígito de select_*
  → LanguageInterpreter (Gemini) con ConversationState
  → TurnInterpretation → ParsedWhatsappCommand (sin releer raw)
  → new_task limpia pending (conserva focus)
  → stock_resolution usa stockResolution del LLM
  → prepareOperation / queries / confirmación
  → execute OperationPlan en el SÍ (entities guardadas, no raw)
```

No corren en v2 (salvo bypass exacto): `parseWithRules` previo, `askIdleResume`, `handleResumeContext`, `isFreshTaskUtterance`, `holdPendingAndAnswer`, `extractProductHintFromText` post-LLM.

## D. Legacy que deja de ejecutarse en v2

Ver tabla de limpieza abajo. El archivo `ai-command-parser.ts` / `parseWithRules` sigue vivo para `legacy` y para tests del dataset anterior.

## E. Feature flag

`conversationEngineVersion()` / `isLlmFirstEngine()` (`engine-version.ts`).

Tests v2 inyectan `LanguageInterpreter` fake (`setLanguageInterpreter`). No dependen de Gemini ni de frases hardcodeadas en el prompt.

## F. Archivos

Nuevos: `engine-version.ts`, `turn-interpretation.ts`, `language-interpreter.ts`, `conversation-orchestrator-v2.ts`, `conversation-v2.test.ts`

Modificados: `message-handler.ts`, `gemini.ts`, `conversation-state.ts`, `conversation-log.ts`, `package.json`

## G. Tests

`backend/whatsapp/conversation-v2.test.ts` — dataset de conversaciones reales como **entradas esperadas de TurnInterpretation**, no como reglas.

Siguen corriendo los tests legacy (`parseWithRules`) para comparar.

---

## Limpieza (etapa 1)

| Código/regla | Se mantiene | Se elimina en v2 | Se mueve a ERP | Se convierte en test | Motivo |
|---|---|---|---|---|---|
| `parseWithRules` como classifier previo | solo `legacy` | del routing v2 | | cobertura existente | LLM decide intent |
| `extractProductHintFromText` post-LLM | `legacy` / `prepareOperation` | v2 no lo llama | | Machado/pasalo/desconta | no reconstruir producto desde raw |
| `extractNotesHintFromText` post-LLM | `legacy` | v2 no lo llama | | Ceibal | notes vienen del LLM |
| `enrichEntitiesFromText` | `legacy` mergeParsed | v2 no entra | | | segunda interpretación |
| `mergeParsed` | `legacy` | v2 no entra | | | |
| `coalesceOrderItems` / `ensureOrderItems` desde productName | `legacy` | v2 usa items[] + overlay por itemKey | | talle L | no duplicar |
| `isFreshTaskUtterance` | `legacy` | v2: `conversationAction=new_task` | | Machado | pending no clasifica |
| `doesFillCurrentSlot` | `legacy` + bypass número | v2 LLM ve awaiting | | | |
| `holdPendingAndAnswer` | `legacy` | no intercepta new_task | | Machado | |
| `handleResumeContext` / `askIdleResume` | `legacy` | no gate previo | | | resume es fallback |
| `looksLike*` de intent | `legacy` | no routing v2 | validación de IDs queda en resolvers | | EntityResolver no clasifica |
| Status/stock/ganancia | | | `order-status` / `order-config` | | negocio fuera del prompt |
| ~70 reglas del prompt | | reemplazadas por system corto | | dataset v2 | few-shot de patrones, no frases |
| Writers paralelos create_order/sale | siguen (etapa 3) | | extraer servicios del panel | | no en etapa 1 |

Etapa 2: partir `message-handler.ts`. Etapa 3: create pedido/venta/caja vía servicios del panel.
