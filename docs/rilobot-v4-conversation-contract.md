# RILO Bot V4 — Contrato conversacional definitivo

Este documento es la **regla de producción** para interpretación, ejecución y contexto conversacional de RILO Bot V4.

No se arreglan frases caso por caso. El usuario habla natural; la IA interpreta; el ERP responde con datos reales.

## Arquitectura obligatoria

```
MENSAJE NATURAL
  → Conversation Agent (OpenAI)
  → tool call estructurada
  → backend valida argumentos
  → backend resuelve entidades reales (IDs)
  → Domain / Query Service ERP
  → resultado real
  → respuesta natural compacta
```

### Implementación en código

| Capa | Archivos |
|------|----------|
| Turn routing | `backend/whatsapp/handle-v4-turn.ts` |
| Confirmación congelada | `backend/whatsapp/v4-confirm.ts` |
| Selección numérica | `backend/whatsapp/v4-candidate-selection.ts` |
| Resume post-selección | `backend/whatsapp/v4-resume-blocked-tool.ts` |
| Agent + tools | `backend/whatsapp/agent/*` |
| Estado | `backend/whatsapp/conversation-state.ts` |

Activación: `RILOBOT_CONVERSATION_ENGINE=v4` o `RILOBOT_V4_TENANTS`.

---

## 1. Principio central

**La IA interpreta lenguaje. El backend NO interpreta español.**

El backend solamente:

- valida argumentos de tools
- resuelve IDs contra Firestore/ERP
- verifica permisos y capabilities
- aplica reglas de dominio
- consulta datos reales
- ejecuta Domain Services
- mantiene `ConversationState` estructurado
- maneja confirmaciones e idempotencia
- pagina listados
- resuelve selección numérica cuando hay `awaiting:candidate_selection`

---

## 2. Prohibido hardcodear frases

No agregar reglas del estilo:

- `if (text.includes(...))`
- `startsWith` / `endsWith` para descubrir intent
- regex semánticas sobre el mensaje del usuario
- listas de frases, sinónimos o nombres de prueba como reglas de producción

Los ejemplos usados en tests de aceptación **no son reglas de negocio**.

---

## 3. Raw message después del LLM

Tras la interpretación del Agent, **no** se relee `rawMessage` para decidir:

intent, cliente, producto, proveedor, pedido, monto, pago, estado, fecha, scope, filtros, correcciones.

Las capas posteriores solo: **VALIDAR · RESOLVER · NORMALIZAR · EJECUTAR**.

---

## 4. Current turn > context > defaults

Datos explícitos del mensaje actual **>** contexto conversacional **>** defaults.

Ejemplo: `focusClient=A`, usuario dice "pedidos de B" → **B**. El contexto solo completa lo omitido.

---

## 5. Filter preservation

Filtros explícitos (cliente, producto, estado, fecha…) **no desaparecen**.

Si `clientQuery=Acapella` no se resuelve → `ENTITY_NOT_FOUND` o `ENTITY_AMBIGUOUS`.  
**Nunca** `list_orders({})` mostrando todo.

---

## 6–7. IA + tools + entidades

- La IA elige la tool.
- Pasa hints (`clientQuery`, `productQuery`, `orderNumber`…).
- Resolvers consultan ERP y devuelven IDs reales.
- **Prohibido** que el modelo invente IDs.

Flujo típico: `find_client("Acapella")` → `clientId` → `list_orders(clientId, limit=10)`.

---

## 8. ConversationState

Conservar solo estado estructurado útil:

- `focusEntities`
- `lastQuery` + `listContext`
- `operationPlan` (plan congelado = pendingPlan)
- `activeTask.awaiting`
- `lastCompletedOperation`

No convertir el estado en un segundo parser de español.

---

## 9–10. Follow-up y cambio de entidad

Follow-up conserva filtros previos: "solo pendientes", "de agosto", "el primero cuánto debe", "cobrá 500 y ponelo listo".

Cambio explícito de entidad **reemplaza** la anterior: "ahora los de María" → María, no arrastrar Acapella.

---

## 11–13. Consultas y listados

| Intención | Tool/metric |
|-----------|-------------|
| listar | `list_*`, metric=list |
| uno / último | query one |
| cuántos | count |
| cuánto vendimos | aggregate/sum |

Política de listados sin cantidad: **limit=10**, más recientes primero.  
"todos" → paginar de a 10. "más" → siguiente página del mismo `queryContext`.

Respuestas compactas numeradas; footer "Mostrando X de Y".

---

## 14–24. Selección numérica (determinística)

Cuando hay ambigüedad, el bot **numera** opciones (3–5) y guarda:

```typescript
pendingIntent: 'awaiting:candidate_selection'
pendingPayload.candidateSelection: {
  type: 'candidate_selection',
  entityType: 'client' | 'product' | 'supplier' | 'order',
  options: [{ index, entityId, label }],
  resume: { originalUserText, blockedTool, blockedArgs }
}
```

Copy obligatorio: **"Respondeme con el número de la opción."**

| Entrada | Comportamiento |
|---------|----------------|
| `2` con awaiting | Selección directa, sin LLM |
| `7` fuera de rango | Error determinístico |
| `2` sin awaiting | Va al Agent (no asumir elección) |
| `2, solo pendientes` | Selecciona #2 + resto al Agent |

---

## 25–30. Confirmación de writes

Writes sensibles → `OperationPlan` congelado → "¿Confirmo?" → sí/no determinístico.

| Entrada con plan pendiente | Comportamiento |
|----------------------------|----------------|
| `sí` / `si` / `s` exacto | Ejecutar plan, sin LLM |
| `no` exacto | Cancelar, sin LLM |
| `sí, pero…` | Volver al Agent |

Pipeline write: Agent → tool → resolve → validate → OperationPlan → confirm → Domain Service.

---

## 31–40. Dominios soportados

Pedidos, clientes, productos, caja, cobros, stock, proveedores, ventas/compras — según capabilities reales del tenant.

Reglas clave:

- **Pago ≠ estado** ("ya está pago" vs "ponelo listo"; pueden ser dos operaciones)
- Stock: query vs delta vs set absoluto
- Cobros: seña / parcial / saldo completo — ERP calcula saldo real

---

## 41–47. Datos ERP y errores

El modelo **nunca inventa** precio, saldo, stock, estado, total, fechas.

Errores tipados:

- `ENTITY_NOT_FOUND` / `ENTITY_AMBIGUOUS`
- `CAPABILITY_NOT_ENABLED`
- `PERMISSION_DENIED`
- Errores de dominio (transición inválida, stock insuficiente…)

`unknown` solo cuando la IA genuinamente no puede determinar la intención.

Modelo caído: "No pude procesar ese mensaje ahora…" — **sin fallback regex**.

---

## 48–52. Idempotencia y query context

Writes: `messageId`, plan id, `idempotencyKey`.

Tras listados guardar `lastQuery`, filtros, cursor, ids — habilita "más", "el segundo", "cuánto debe ese".

---

## 53–60. Tests y UX

Tests verifican **capacidades**, no frases literales.

Casos obligatorios:

- explicit client B pisa focus A
- awaiting + `"2"` → LLM=0, selected correcto
- awaiting + `"2, solo pendientes"` → selected + Agent con resto
- pendingPlan + `"si"` → execute, LLM=0
- pendingPlan + `"no"` → cancel, writes=0
- pendingPlan + `"si, pero cobrá 300"` → Agent, no execute directo

El usuario responde `"1"`, no copia el texto completo de la opción.

---

## 61. Criterio de aprobación

| Métrica | Objetivo |
|---------|----------|
| Regex semánticas nuevas | 0 |
| Frases hardcodeadas nuevas | 0 |
| Raw message parsing post-LLM | 0 |
| Cliente/producto/pedido explícito pisado por contexto | 0 |
| Query abierta por filtro no resuelto | 0 |

---

## 63. Principio final

RILO Bot **no conoce mensajes**. Conoce:

**CAPACIDADES · TOOLS · ESTADO · ENTIDADES · REGLAS ERP.**

Los únicos shortcuts determinísticos:

1. sí/no exactos con `operationPlan` pendiente
2. número exacto con `awaiting:candidate_selection`
3. número + texto → seleccionar + mandar resto al Agent

**Todo lo demás: IA → tools → ERP.**
