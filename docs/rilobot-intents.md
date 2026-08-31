# Inventario de intents de RiloBot

Fuente de verdad en código: `backend/whatsapp/operation-catalog.ts`.
Payloads discriminados: `backend/whatsapp/operation-payloads.ts`.

Todas las acciones usan el mismo `ConversationState` (`pendingIntent`, `activeTask`, `queuedTasks`, `lastQuery`, `listContext`).

## Tabla

| Intent | Acción | Payload | Requiere DB | Confirmación | Multi-item |
|---|---|---|---|---|---|
| help | Menú / cómo usar el bot | HelpPayload | no | no | no |
| greeting | Saludo / onboarding | GreetingPayload | no | no | no |
| create_order | Registrar pedido | CreateOrderPayload | sí | sí | sí |
| create_sale | Registrar venta | CreateSalePayload | sí | sí | sí |
| create_purchase | Registrar compra (stock in; no caja ni costo de catálogo) | CreatePurchasePayload | sí | sí | sí |
| register_payment | Registrar cobro / seña | RegisterPaymentPayload | sí | sí | no |
| register_cash | Ingreso o egreso de caja | RegisterCashPayload | sí | sí | no |
| create_client | Alta de cliente | CreateClientPayload | sí | sí | no |
| register_cost | Costo extra de un pedido existente | RegisterCostPayload | sí | sí | sí |
| update_product_cost | Cambiar costo de catálogo | UpdateProductCostPayload | sí | sí | no |
| update_order_status | Cambiar estado de pedido | UpdateOrderStatusPayload | sí | sí | no |
| query_balance | Saldo que debe un cliente | QueryBalancePayload | sí | no | no |
| query_cash | Saldo / resumen de caja | QueryCashPayload | sí | no | no |
| query_status | Consultar o listar pedido/venta | QueryStatusPayload | sí | no | sí |
| query_stock | Consultar stock por producto / color / talle | QueryStockPayload | sí | no | sí |
| unknown | No inventar: pedir aclaración | UnknownPayload | no | no | no |

No hay intents separados `create_expense`, `create_income` ni `create_supplier`:
caja = `register_cash`; alta de proveedor = `confirm_create_supplier` durante una compra.

`query_stock` se agregó para consultas de inventario conversacionales («cuántas negras XL tengo» → «y L?»).
