---
name: whatsapp-operator
description: >-
  Guides changes to the RILO WhatsApp operator (backend/whatsapp). Use when
  editing WhatsApp parsing, catalog matching, conversation state, delivery
  dates, client/product confirmation, or when the bot loses chat context.
  For RILO Bot V4 follow docs/rilobot-v4-conversation-contract.md (regla maestra) — never
  add phrase-regex rules; use Agent + tools + ERP. Include mandatory delivery checklist.
---

# WhatsApp operator

The bot is a stateful operator in Firebase, not a Cursor MCP agent. Do not add MCP servers to “remember” WhatsApp chats.

## RILO Bot V4 (contrato definitivo)

**Canonical spec:** `docs/rilobot-v4-conversation-contract.md` (regla maestra + checklist de entrega)  
**Cursor rule:** `.cursor/rules/rilobot-v4-conversation.mdc`

```
Natural message → OpenAI Agent → structured tool call → validate/resolve → ERP → natural reply
```

### Non‑negotiables

- **IA interprets Spanish. Backend does NOT.** After the LLM, never re-parse `rawMessage` for intent/entities.
- **No new phrase regex** (`includes`, semantic regex, synonym lists, test phrases as prod rules).
- **Current turn > context > defaults** — explicit entity in this message wins over `focusEntities`.
- **Filter preservation** — unresolved filter → `ENTITY_NOT_FOUND` / `ENTITY_AMBIGUOUS`, never open global query.
- **Contextual entity resolution** — every entity lookup considers the requested operation; backend filters with domain rules; 0 → explain, 1 → auto-resolve, 2+ → relevant options only (`docs/rilobot-v4-conversation-contract.md` §Resolución contextual).
- **Deterministic UI only** when state is explicit:
  - `operationPlan` + exact sí/no → `v4-confirm.ts`
  - `awaiting:candidate_selection` + exact number → `v4-candidate-selection.ts`
  - number + extra text → pick then send remainder to Agent

### V4 files

| File | Role |
|------|------|
| `handle-v4-turn.ts` | Turn router (confirm → candidate pick → agent) |
| `v4-confirm.ts` | Frozen plan sí/no |
| `v4-candidate-selection.ts` | Numbered disambiguation state |
| `v4-resume-blocked-tool.ts` | Continue blocked read tool after pick |
| `v4-order-operation.ts` | Eligibility + evaluate actions for contextual resolution |
| `v4-compound-order-continuation.ts` | Auto-resolve find_order + writes same turn |
| `resolve-order-reference.ts` | Client→order resolution with `operationContext` |
| `v4-visual-draft.ts` | Temporary PurchaseDraft / OrderDraft from images |
| `agent/openai-agent.ts` | LLM + tool loop + Responses API `input_image` |
| `agent/agent-context.ts` | System + developer context |
| `agent/tools/read-tools.ts` | ERP reads + filter_blocked |
| `agent/tools/write-tools.ts` | Write → frozen OperationPlan |

Tests: `npm run test:v4` — test **capabilities**, not literal user strings.

Legacy engines (`llm_first`, `parseWithRules`) remain for non-V4 tenants; do not extend them when fixing V4 behavior.

## Conversation contract (legacy / shared state)

1. Persist the current step: `pendingIntent`, `activeTask`, `queuedTasks`, `lastQuery`, `listContext`. Multi-item orders use `entities.items[]`; each product is resolved independently. All ERP actions (not only pedidos) share this ConversationState.
2. On each inbound text, `isFreshTaskUtterance` first: a complete **other** operation (cash in/out, purchase, new order) drops pending. A status/payment tweak while confirming the **same** order (`confirm:…`, `order_action`) is not fresh: keep `targetOrderId` and re-ask SÍ/NO. Never jump to `lastOperation` of another client. A focused order (`resolved` + `active` via `applyOrderLock`) stays locked unless the owner names another # or another client.
3. After ~15 min of silence with a pending step or `focusOrder`, ask *¿Seguimos o empezamos de nuevo?* before applying the next line to the old pedido. A clearly new job (nuevo pedido, caja, lista) skips the ask. **NO** clears focus + turns so the bot does not mix clients.
4. Else `doesFillCurrentSlot` in `conversation-follow.ts` decides if the message answers that step. Short answers (`sí`, `el 1`, `ese no`) are interpreted **with** the awaiting slot, not as a new chat.
5. If it does not, `holdPendingAndAnswer`: reply to the aside, stash useful facts (date, amount), **re-ask the same step**. Never jump to another catalog search.
6. Gemini interprets natural language **with the chat thread**. It must return `items[]` for orders/sales (never one concatenated `productName` with two products). `client.raw` is the literal party name. Catalog ranking filters by type → size → primary color, then scores fabric/text. A clearly dominant SKU is auto-selected; a real tie shows at most 3 options plus *Ninguno de estos* (next page from ConversationState). Never assume `deliveryDate`. Confirmed client/product stay locked unless the user corrects them. WhatsApp copy goes through `formatWhatsappMessage` / `formatChoiceMessage` (no double blanks, no matcher internals).
7. Orphan payment («me llegó un pago») asks cobro vs ingreso suelto (`select_payment_kind`) before hunting orders. If the **same** utterance creates an order and says it is already paid/collected/settled, keep `create_order` with `paid=true` and a **related** cobro (Total / Pago / saldo on a compact card). Do not switch to `register_payment`. LISTO is not “today”.

## Typical bugs

| User said | Awaiting | Wrong | Right |
|---|---|---|---|
| `mañan` | delivery date | product search | tomorrow, keep product |
| `En el talle L soy el principe…` | description (notes) | new product named like the phrase | that text is the pedido description; keep the product already chosen |
| `¿hay un Danyelyn?` | client list | pick #1 or skip to product | answer + show the list again |
| `danyelyn` | new order | list similar names | unique match `Danyelyn`, then ask product if not exact |
| `cambialo a entregado y cobra todo el saldo` | status confirm | «No cobro nada ahora» | cobro of full saldo + estado entregado on the SÍ/NO card |
| `y el saldo de este pedido cuanto es?` | after talking about #00220 | new Pedido, Cliente: este | show saldo of #00220. Never create_order. Keep focus even if already entregado. |
| `Cómo quedó ese producto en el stock -1?` | after delivering #00236 / Canguro | full order card | `query_stock` + `focused_product`. ERP stock number. Never `query_status` / order details. |
| `pedido del cliente Ana-Rosa (local) un buzo` | new order | client = Ana-Rosa | `client.raw` keeps the full spoken name; lookup uses it first |
| `canguro XL rojo` with a dominant catalog hit | product | list of 7 options including other types/sizes | auto-select the dominant SKU; ask only a 2–3 way tie |
| `registrá un pedido … pagado $1550` without a date | new order | assume today, or re-ask client/product | keep everything; ask only `📅 ¿Para qué fecha es la entrega?` |
| `registrá un pedido … pagado $1550` | new order | only «Monto: $1550» or `register_payment` | create_order + related cobro; compact Total / Pago → saldo |

## Orders that move forward

`update_order_status` advances an order that already exists (`listo`, `en_produccion`, `entregado`).
«Pasalo a estado entregado» / «cambialo a entregado» must set `orderStatus=entregado` even if the order is already Listo.
Do not default that utterance to listo, and do not copy a previous amount as a cobro unless they said they paid / saldalo / cobra el saldo.
Gemini interprets the utterance (with chat thread). Then `looksLikeCollectFullBalance` in `lookups.ts` sets `paid` + `payFullBalance` from how they talk («cobra todo el saldo», «saldalo»). Confirmation copy must follow those flags: never «No cobro nada» if they asked to collect the balance.
Naming an order (even already entregado) must `rememberFocusOrder`. «este pedido» / «el saldo de este» is `query_status` of that focus, never `create_order`. If it is already entregado and they still asked to cobro, confirm the payment of the remaining saldo.
Never reimplement the stock/delivery machine: `order-status.ts` reuses the panel helpers exported
from `backend/routes/orders.ts`, so stock discount follows the business's configured trigger estado
and delivery creates the sale plus settles the balance. `payFullBalance` charges the whole pending
saldo when the owner says "ya pagó" / "cobra todo el saldo" without a number.

Regex boundaries in Spanish must use `(?<![\p{L}])…(?![\p{L}])` with the `u` flag: `\b` does not
match against accented endings like `entregué` or `pagó`.

## When unsure, ask

Never guess a write. `unknown` does not answer with the help menu: `clarify.ts` asks what the owner
meant, quoting their own words, and the answer is re-parsed together with the original message
(two tries, then the help hint). Same rule for targets: if a client or the chat has more than one
open order, list them and ask instead of taking the newest.

If a named client has no matching **open** order, search pedidos by the name on the order (not only `clienteId`). If the only hits are delivered, say so and list them. Never answer “no di con pedidos” when that client’s order exists. Never fall back to the last order of someone else.
Ask cobro de pedido vs ingreso suelto (`select_payment_kind`). A name or «buscá el pedido de X»
searches open orders (fuzzy on typos like Caedozo/Cardozo). Then list matches and wait for a number.
Listing defaults to **open** orders (not entregado). «que no esté entregado» / abiertos / pendientes
must not bring delivered rows, even if they are paid (`pago`). Show the estado in the list.
Delivered rows only if they ask for entregados / todos.
If they instead write an egreso/salida de caja, drop pending and register cash — do not keep asking which order.
After the pick, show a short order summary and ask *1* registrar un pago or *2* cambiar el estado.
A bare list number is the pick, never a cobro of that many pesos.
They can still say *listo*, *saldalo* or *pagó 500* in the same turn. Combined asks («listo y registrá el pago del total», stock if pending)
must appear **all** on the SÍ/NO card: estado, cobro a caja + saldo $0, and stock (descuento / ya estaba / no corresponde).
A cobro always uses `collectClientBalance`. After *listo* alone with saldo, ask *¿lo saldo?* like the ERP.

## Purchases from WhatsApp

A WhatsApp purchase **only** registers the compra and stock in. It does **not** create a cash egreso and does **not** change the catalog product cost.

- Cash in/out: separate `register_cash`. Colloquial: «hacé un egreso de caja por 4015 en personal», «registrá un egreso de la caja de rilo por $6000 motivo pago tarjeta». «de la caja» is the source caja, never a saldo query.
- If the business has more than one caja (ámbito) and the owner did not name one, ask `select_cash_ambito` (number or name). Never default WhatsApp cash to an unnamed extra caja.
- Catalog cost: separate `update_product_cost` («el costo de Taza AA es 147»).
- Order extra cost (estampado): `register_cost`, not catalog cost.

Write cash with `normalizeMovementAmbito` (`negocio` / extras like `personal`), never hardcoded `general`.

Keep every owner-facing WhatsApp bubble short: *bold* title, bullets, one question. Split long replies with `formatWhatsappResponse` / `splitWhatsappMessages` (`shared/whatsapp-format.ts`). Transaction summaries auto-send up to 2 pages; exploratory lists show ~6 and continue with «más». Never write «Leer más» / «Ver más». Do not rewrite with operator-voice. Interactive: explain one step, wait, then the next.

## Files

- `backend/whatsapp/order-status.ts` — estado change, stock and delivery
- `backend/whatsapp/clarify.ts` — asks when the intent is unclear
- `backend/whatsapp/message-handler.ts` — turn routing
- `backend/whatsapp/conversation-follow.ts` — stay/resume
- `backend/whatsapp/conversation-state.ts` — Firestore session
- Parser: `ai-command-parser.ts` — Gemini intent + `items[]`
- Contract: `conversation-contract.ts` — line items, schema, match policy
- Entity names: `entity-name.ts` — full `client.raw`, lookup variants as fallback
- Order finance: `order-finance.ts` — cobro related to a new order (Total / Pago → saldo)
- Interpreter: `turn-interpreter.ts` — merge, short answers, corrections
- Language memory: `language-memory.ts` — confirmed expressions per user
- `backend/whatsapp/lookups.ts` — exact vs similar catalog
- `backend/whatsapp/cash-ambito.ts` — which caja, if several
- `backend/utils/caja-ambitos.ts` — match spoken names (personal, negocio)
- `shared/whatsapp-format.ts` — `formatWhatsappMessage`, `formatChoiceMessage`, `formatTransactionSummary`, compact bubbles
- `backend/whatsapp/catalog-rank.ts` — filter then rank (type, size, color, fabric)

After behavior changes, `npm run build:functions` and deploy `functions` to `rilo-7eff4`.
