---
name: whatsapp-operator
description: >-
  Guides changes to the RILO WhatsApp operator (backend/whatsapp). Use when
  editing WhatsApp parsing, catalog matching, conversation state, delivery
  dates, client/product confirmation, or when the bot loses chat context.
---

# WhatsApp operator

The bot is a stateful operator in Firebase, not a Cursor MCP agent. Do not add MCP servers to “remember” WhatsApp chats.

## Conversation contract

1. Persist the current step: `pendingIntent`, `pendingPayload`, `pendingPrompt`.
2. On each inbound text, `isFreshTaskUtterance` first: a complete other operation (cash in/out, purchase, new order) **drops** pending and is parsed as a new turn. The owner must not have to cancel.
3. Else `doesFillCurrentSlot` in `conversation-follow.ts` decides if the message answers that step.
4. If it does not, `holdPendingAndAnswer`: reply to the aside, stash useful facts (date, amount), **re-ask the same step**. Never jump to another catalog search.
5. Gemini interprets natural language. Code does not score clients/products when `preferChoices` is on, except **exact name** (case-insensitive).
6. Orphan payment («me llegó un pago») asks cobro vs ingreso suelto (`select_payment_kind`) before hunting orders. «Buscá el pedido de X» fills that slot as a search (typos included). An egreso/salida de caja is a gasto: never stash that amount onto an order cobro.

## Typical bugs

| User said | Awaiting | Wrong | Right |
|---|---|---|---|
| `mañan` | delivery date | product search | tomorrow, keep product |
| `¿hay un Danyelyn?` | client list | pick #1 or skip to product | answer + show the list again |
| `danyelyn` | new order | list similar names | unique match `Danyelyn`, then ask product if not exact |

## Orders that move forward

`update_order_status` advances an order that already exists (`listo`, `en_produccion`, `entregado`).
«Pasalo a estado entregado» must set `orderStatus=entregado` even if the order is already Listo.
Do not default that utterance to listo, and do not copy a previous amount as a cobro unless they said they paid.
Never reimplement the stock/delivery machine: `order-status.ts` reuses the panel helpers exported
from `backend/routes/orders.ts`, so stock discount follows the business's configured trigger estado
and delivery creates the sale plus settles the balance. `payFullBalance` charges the whole pending
saldo when the owner says "ya pagó" without a number.

Regex boundaries in Spanish must use `(?<![\p{L}])…(?![\p{L}])` with the `u` flag: `\b` does not
match against accented endings like `entregué` or `pagó`.

## When unsure, ask

Never guess a write. `unknown` does not answer with the help menu: `clarify.ts` asks what the owner
meant, quoting their own words, and the answer is re-parsed together with the original message
(two tries, then the help hint). Same rule for targets: if a client or the chat has more than one
open order, list them and ask instead of taking the newest.

If a named client has no matching order, ask for product, amount, estado or #. Never fall back to the last order of someone else.
Ask cobro de pedido vs ingreso suelto (`select_payment_kind`). A name or «buscá el pedido de X»
searches open orders (fuzzy on typos like Caedozo/Cardozo). Then list matches and wait for a number.
If they instead write an egreso/salida de caja, drop pending and register cash — do not keep asking which order.
After the pick they can say *listo*, *saldalo* or *pagó 500*. Combined asks («listo y registrá el pago del total», stock if pending)
must appear **all** on the SÍ/NO card: estado, cobro a caja + saldo $0, and stock (descuento / ya estaba / no corresponde).
A cobro always uses `collectClientBalance`. After *listo* alone with saldo, ask *¿lo saldo?* like the ERP.

## Purchases from WhatsApp

A WhatsApp purchase **only** registers the compra and stock in. It does **not** create a cash egreso and does **not** change the catalog product cost.

- Cash in/out: separate `register_cash`. Colloquial: «hacé un egreso de caja por 4015 en personal», «ingreso 2000 a caja del negocio».
- If the business has more than one caja (ámbito) and the owner did not name one, ask `select_cash_ambito` (number or name). Never default WhatsApp cash to an unnamed extra caja.
- Catalog cost: separate `update_product_cost` («el costo de Taza AA es 147»).
- Order extra cost (estampado): `register_cost`, not catalog cost.

Write cash with `normalizeMovementAmbito` (`negocio` / extras like `personal`), never hardcoded `general`.

Keep every owner-facing WhatsApp bubble short: *bold* title, bullets, one question. Split long replies (`splitWaBubbles`). Do not rewrite with operator-voice. Interactive: explain one step, wait, then the next.

## Files

- `backend/whatsapp/order-status.ts` — estado change, stock and delivery
- `backend/whatsapp/clarify.ts` — asks when the intent is unclear
- `backend/whatsapp/message-handler.ts` — turn routing
- `backend/whatsapp/conversation-follow.ts` — stay/resume
- `backend/whatsapp/conversation-state.ts` — Firestore session
- `backend/whatsapp/ai-command-parser.ts` — Gemini intent
- `backend/whatsapp/lookups.ts` — exact vs similar catalog
- `backend/whatsapp/cash-ambito.ts` — which caja, if several
- `backend/utils/caja-ambitos.ts` — match spoken names (personal, negocio)
- `shared/whatsapp-format.ts` — *bold*, cards, short bubbles

After behavior changes, `npm run build:functions` and deploy `functions` to `rilo-7eff4`.
