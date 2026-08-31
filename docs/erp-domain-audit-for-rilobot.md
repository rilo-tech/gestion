# Auditoría de dominio ERP para RILO Bot

Fecha: 29 ago 2026.  
Alcance: código vivo del repo. **No se modificó nada para este informe.**  
Fuentes: `backend/routes/*`, `backend/utils/*`, `backend/whatsapp/erp-*.ts`, `backend/whatsapp/order-status.ts`, `frontend/src/app/core/services/*`, `shared/subscription-modules.ts`, `shared/platform-access.ts`.

Motor conversacional (fuera de alcance de cambios): se asume el pipeline actual

`TurnInterpretation → SemanticCommand → OperationPlan → ERP`

y las deudas conocidas: confirmación aún ejecuta `ParsedWhatsappCommand` + entities; pedido/venta WhatsApp siguen siendo writers paralelos; caja ya tiene `RegisterCashMovementCommand`.

**Parte II** (al final de este archivo) completa campos de documentos, fuente de verdad, reglas por operación, writers exactos, domain services/commands/queries, errores, transacciones, capabilities, permisos WhatsApp, paridad, reportes, idempotencia y respuestas A–L. No reescribe las secciones 1–4.

---

## 1. Resumen ejecutivo

**PREPARACIÓN DEL ERP PARA RILO BOT: PARCIAL.**

El ERP web y RILO Bot **ya comparten Firestore y varias reglas de verdad** (cobros, máquina de stock/estados del pedido, persistencia de compras, helpers de entrega). No hay un segundo ledger. Un movimiento de caja o un pedido creado por WhatsApp **aparece en RILO Gestión** porque vive en `negocios/{businessId}/…`.

Lo que falta no es “otro ERP”, sino **un anillo de Domain Services** que hoy está mezclado con rutas HTTP. La web escribe desde handlers Express; WhatsApp reimplementa el alta de pedido, venta mostrador y caja manual. El Bot todavía **conoce Firestore** (`erp-writes.ts` hace `.add` / `.update`). Gemini no debería; el writer de WhatsApp sí lo hace.

| Pregunta | Respuesta corta |
|---|---|
| ¿Se puede mantener el ERP actual sin romper Rilo? | **Sí.** Extraer, no reescribir colecciones. |
| ¿Web y WhatsApp pueden escribir los mismos modelos? | **Sí**, y en cobros/stock/compras parcialmente ya lo hacen. Pedido, venta mostrador y caja manual todavía no. |
| ¿Hay un ERP paralelo? | **No de datos.** Sí de **código de escritura** (3–4 writers). |
| ¿El Bot puede operar sin Firestore? | **Hoy no.** Falta una capa de commands/queries de dominio. |

El mínimo refactor seguro es: extraer el write de caja que ya usa el panel, apuntar WhatsApp a ese mismo servicio, y recién después unificar pedido/venta. No tocar el LanguageInterpreter.

---

## 2. Arquitectura ERP actual

```
RILO Gestión (Angular)
  frontend/src/app/features/*          UI
  frontend/src/app/core/services/*     HTTP client (OrderService, CashService, …)
        ↓  JWT  /api/*
backend/create-app.ts
  /api/orders, /sales, /purchases, /stock, /clients, /cash, …
        ↓
backend/routes/*.ts                   HTTP + validación + (a menudo) persistencia
        ↓
backend/utils/*.ts                    dominio reutilizable (parcial)
        ↓
Firestore Admin  negocios/{businessId}/{colección}
```

**Canal WhatsApp (paralelo al HTTP, mismo tenant):**

```
Meta webhook → whatsapp-webhook.ts
  → message-handler.ts (conversación, confirmación)
  → executeWhatsappCommand (erp-integration.ts)
  → erp-writes.ts / order-status.ts / erp-queries.ts
        ↓
mismas colecciones Firestore
+ metadatos de canal: origenWhatsapp, whatsappPhone
+ estado de chat (NO es ERP): negocios/{id}/whatsapp_conversations
```

Qué hace cada capa:

| Capa | Responsabilidad real hoy |
|---|---|
| Frontend | Formularios, listados, preview de stock, no calcula saldo/stock de verdad (el backend es la fuente). |
| Rutas HTTP | Autenticación, módulos de suscripción, **y la mayor parte de los writes**. |
| `backend/utils` | Lo más cercano a dominio: stock reservado, cobro cliente, compra, caja egreso de payables, config de pedidos. |
| WhatsApp `erp-*` | Resolución de entidades habladas + writers propios + reuso puntual de utils/rutas. |
| Firestore | Documentos operativos. Sin schema versionado. Las reglas de cliente **deniegan todo**; solo Admin SDK escribe. |

Lógica compartida de verdad (importada por web y WhatsApp):

- `collectClientBalance` (`client-collections.ts`)
- `consumeOrderStockOnStatusChange` / delivery / restore (`order-stock-reservations.ts`)
- `applyEntregaCompletaPayment` / `applyEntregaConSaldoVenta` / `validateOrderEstadoTransition` (exportados desde `routes/orders.ts`)
- `createSaleFromOrder` (entrega)
- `parsePurchaseInput` + `persistPurchase` (`purchase-finance.ts`) — WhatsApp llama con `skipCash` y `skipProductCostUpdate`
- `enrichOrderItemsStockControl`, `allocateOrderNumber` / `allocateSaleNumber`
- `normalizeMovementAmbito` (`caja-ambitos.ts`)
- `resolveOrderGananciaForStorage`, `normalizeLineExtraCosts`

Lógica mezclada con HTTP: alta de pedido, alta de venta mostrador, alta de movimiento de caja **manual**, PATCH de pedido.

Lógica mezclada con conversación: `erp-writes.ts`, `lookups.ts` (fuzzy/AI), confirmación en `message-handler.ts`.

---

## 3. Mapa de módulos

Montaje: `backend/create-app.ts`. Nav web: `sidebar.component.ts`. Módulos comercializables: `shared/subscription-modules.ts`.

| Módulo | Web (ruta UI / API) | Gate suscripción | WhatsApp |
|---|---|---|---|
| Empresas / config | `/settings`, `/api/business`, `/api/config` | core | seed + `whatsapp_config` |
| Usuarios / roles | `/settings` usuarios, `/api/users` | core | `whatsapp_users` (teléfono → tenant), no usa permisos HTTP |
| Clientes | `/clients`, `/api/clients` | **core** (alwaysOn) | alta mínima + cobro |
| Proveedores | `/suppliers`, `/api/suppliers` | core | alta mínima |
| Productos / stock | `/stock`, `/api/stock` | core | alta mínima, update costo, query |
| Variantes | atributos en ítem de stock (tipo, talle, color, tela) | core | ranking conversacional, no API de variantes |
| Reservas / descuento | pedidos + `/api/stock/reservations` | pedidos + core | vía `order-status` → mismos utils |
| Pedidos | `/orders`, `/api/orders` | `pedidos` | writer paralelo de create; status reusa panel |
| Ventas | `/sales`, `/api/sales` | core | writer paralelo (venta “concepto”, sin stock) |
| Compras | `/purchases`, `/api/purchases` | `purchases.access` + core | **mismo persist**, sin caja ni costo catálogo |
| Caja | `/cash`, `/api/cash` | `caja` | writer paralelo `executeRegisterCashMovement` |
| Cobros | `POST /api/clients/:id/cobros` y pagos de pedido | `caja` / `cash.access` | **mismo** `collectClientBalance` |
| Pagos a proveedores | `/payables`, `/api/payables` | `payables` | no expuesto al Bot |
| Costos extra | config pedidos + líneas | `economics` / `orders.personalization` | `addOrderCostFromWhatsapp` (PATCH local) |
| Ganancia | campos `costoReal` / `gananciaEstimada` | `economics.view` | se calcula al crear pedido WA; venta WA deja costo 0 |
| Reportes | `/reports`, `/api/reports` | `reports` | no; lee las mismas ventas si el módulo está on |
| Facturación fiscal | no hay AFIP/factura electrónica operativa en el ERP de negocio | — | — |
| Colaboradores | `/collaborators` | `collaborators` | no |
| Catálogo de precios | `/price-catalog` | `price_catalog` | el Bot usa `precioVenta` del stock |
| Plataforma / billing | `/platform`, `/api/billing` | superadmin | no |
| Conversación Bot | — | `platformAccess.whatsappEnabled` | `whatsapp_conversations` |

### Por módulo (detalle compacto)

**Pedidos**  
Modelos: `Order` (frontend `order.service.ts`), `OrderRecord` (`routes/orders.ts`).  
Endpoints: GET/POST lista, GET/PATCH/DELETE uno, pagos, fotos, stock-preparation, consume, transfer, preview descuento.  
Colección: `pedidos`.  
Reglas: estados y trigger de stock en `config/app.pedidos`.  
Deps: clientes, stock, caja (seña), ventas (entrega).

**Caja**  
Modelo implícito en POST de `cash.ts` + `FirestoreCashMovement` (WhatsApp mapper, incompleto vs web).  
Colección: `movimientos_caja`.  
Ámbitos: `config/app.caja.ambitos`.  
Deps: cobros, ventas, compras, payables (otros `origenTipo`).

**Stock**  
Modelo: `StockItem` (`stock.service.ts`).  
Colección: `stock` + ledger `movimientos_stock`.  
Reglas: `controlaStock`, `permitirStockNegativo`, `stockActual` vs `stockReservado`.

**Clientes / cobros**  
Colección: `clientes`. Saldo **no** es un campo maestro: se deriva de pedidos/ventas con saldo.  
Cobro: `collectClientBalance`.

**Compras**  
Colección: `compras` + payables. Dominio: `purchase-finance.ts`.

**Ventas**  
Colección: `ventas`. Mostrador vs origen pedido (`createSaleFromOrder`).

**Core comercial** (`core` alwaysOn): clientes, proveedores, stock, compras, ventas. No se puede apagar en el catálogo actual.

---

## 4. Modelos y Firestore

### 4.1 No hay un modelo de dominio único

No existe `shared/order.ts` ni `CreateOrderCommand` (salvo caja WhatsApp). Cada superficie arma el documento:

| Concepto | Dónde vive el type | Comentario |
|---|---|---|
| Pedido | `frontend/.../order.service.ts` `Order` + `backend/routes/orders.ts` `OrderRecord` + `toFirestoreOrder` WhatsApp | Tres formas, campos solapados |
| Ítem | `OrderLineItem` / `OrderLineStock` / `FirestoreOrderItem` | extras + flags de stock |
| Venta | `sales.service.ts` `Sale` | WhatsApp no usa este type |
| Compra | `purchase.service.ts` `Purchase` | persist compartido |
| Stock | `stock.service.ts` `StockItem` | |
| Cliente | `client.service.ts` | |
| Caja | sin interface compartida | web POST vs `executeRegisterCashMovement` |
| Pago pedido | `OrderPayment` | seña / cuota / pago |
| Cobro | params de `collectClientBalance` | no es un doc propio; actualiza pedido/venta + caja |
| Extra cost | `costosExtra[]` en línea | `costoPersonalizacion` legacy |
| User | `backend/auth/users.ts` | roles supervisor/admin/staff |
| Business | `backend/auth/business.ts` `BusinessRecord` | plan, `platformAccess`, trial |
| Subscription | `subscription-entitlements.ts` | módulos + límites |

Campos calculados (se **guardan**, no solo se derivan al leer):

- Pedido: `total`, `saldo`, `totalPagado`, `costoReal`, `gananciaEstimada`, `estadoStock`
- Venta: `saldoPendiente`, `costoReal`
- Stock: `stockReservado` (también hay cálculo de disponible = actual − reservado)

Campos de canal (no cambian el modelo de negocio):

- `origenWhatsapp`, `whatsappPhone` en pedidos/ventas/caja/clientes/stock creados por Bot
- `descripcion: "Origen: WhatsApp RILO Bot"` en caja manual WA

Campos legacy: `costoPersonalizacion` (suma de extras), `entregado_con_saldo` vs `entregaModo`.

### 4.2 Árbol Firestore por `businessId`

```
negocios/{businessId}
  clientes
  proveedores
  stock
  pedidos
  ventas
  compras
  movimientos_caja
  movimientos_stock
  cuentas_pagar_obligaciones
  cuentas_pagar_cuotas
  compromisos_pago
  colaboradores
  actividad
  usuarios
  config/app                 ← caja, pedidos, stock, finanzas, colaboradores, comprobantes
  whatsapp_config
  whatsapp_users
  whatsapp_conversations     ← canal, no ERP
  whatsapp_product_aliases
  private/…                  ← usage
  subscription_history, pagos_suscripcion, mp_payments, commercial_events
  facturas_enviadas          ← plataforma, no AFIP del negocio
```

Raíz: `whatsapp_inbound_dedup/{messageId}` (idempotencia webhook).

`firestore.rules`: deny-all en cliente. El schema real es el que escriben las rutas.

### 4.3 Forma de documentos (operativos)

**`pedidos/{orderId}`** (campos que importan al Bot y al panel)

Obligatorios de facto: `clienteId`, `estado`, `fechaEntrega`, `items[]`, `total`, `saldo`, `negocioId`, `createdAt`.  
Ítems: `stockItemId`, `nombre`, `cantidad`, `precioVenta`, `costoUnitario`, `costosExtra`, flags de stock.  
Relaciones: `clienteId` → clientes; `stockItemId` → stock; `ventaId` tras entrega; `pagos[].movimientoCajaId` → caja.

**`movimientos_caja/{id}`**

`tipo` ingreso|egreso, `monto`, `medio`, `concepto`, `ambito`, `fecha`, `origenTipo`, `origenGrupo`, `negocioId`.  
Manual web: `caja_manual_ingreso|egreso`.  
Cobro: origen ligado a pedido/venta.  
WA manual: mismos origenTipo + `origenWhatsapp`.

**`stock/{itemId}`**

`nombre`, `stockActual`, `stockReservado`, `controlaStock`, `permitirStockNegativo`, `costo`, `precioSugerido`, atributos.

**`ventas/{id}`**

`origen` (`pedido` | mostrador), `pedidoId?`, `items`, `total`, `montoCobrado`, `saldoPendiente`.

**`clientes/{id}`** — ficha. El saldo se calcula.

---

## 5. Reglas de negocio

| Regla | Archivo / función | ¿Compartida? | Web | WhatsApp |
|---|---|---|---|---|
| Pedido requiere cliente + ítems + total | `POST orders`, `createOrderFromWhatsapp` | duplicada | sí | sí (además exige `deliveryDate`) |
| Fecha de entrega obligatoria | panel + WA throw | duplicada | sí (UI/API) | sí |
| Estados default | `order-config.ts` `DEFAULT_ORDER_ESTADOS` | **sí (config)** | sí | sí (vía mismos helpers de transición) |
| Transiciones válidas | `validateOrderEstadoTransition` | **sí** | PATCH | `updateOrderStatusFromWhatsapp` |
| Create pedido NO descuenta stock | `POST orders` (legacy `applyStockForOrder` no se llama) | **sí de hecho** | sí | sí |
| Reserva | `applyOrderStockPreparation` | **sí** | panel | no hay comando “preparar” en el Bot |
| Descuento físico | `consumeOrderStockOnStatusChange` según `estadoDescuentaStock` | **sí** | PATCH | status WA |
| Entrega crea venta | `applyEntregaCompletaPayment` / `con_saldo` → `createSaleFromOrder` | **sí** | PATCH | status WA |
| Entrega completa cobra saldo restante | `applyEntregaCompletaPayment` | **sí** | sí | sí si el estado es entregado completa |
| Saldo pedido | `shared/order-balance.ts` + campos persistidos | **sí** | sí | cobro vía `collectClientBalance` |
| Cobro cliente FIFO o target | `collectClientBalance` | **sí** | `POST .../cobros` | `registerPaymentFromWhatsapp` |
| Cobro escribe caja | `createCashIncome` privado en client-collections | **sí** | sí | sí |
| Seña al crear pedido | web `registerInitialSenia`; WA `planRelatedOrderFinance` + batch | **duplicada** | sí | sí (forma distinta) |
| Caja manual monto > 0 y concepto | `cash.ts` POST vs `executeRegisterCashMovement` | **duplicada** | concepto obligatorio | concepto puede caer a “Egreso” |
| Caja ámbitos | `normalizeMovementAmbito` | **sí** | sí | sí (pregunta si hay varias) |
| Compra WA no mueve caja ni costo catálogo | flags `skipCash`, `skipProductCostUpdate` | **intencional** | web sí mueve | WA no |
| Venta mostrador WA no mueve stock, costo 0 | `createSaleFromWhatsapp` | **paralela** | web `applyStockForVenta` | WA no |
| Stock negativo | `permitirStockNegativo` en ítem | config tenant | sí | consume usa mismos utils |
| Ganancia pedido | `resolveOrderGananciaForStorage` | **sí** | sí | create WA |

### Fuente de verdad

| Concepto | Fuente real |
|---|---|
| Stock físico | `stock.stockActual` |
| Disponible | `stockActual − stockReservado` (`getStockDisponible`) |
| Reserva | `stock.stockReservado` + líneas del pedido (`cantidadReservada`) |
| Saldo pedido | persistido `saldo` / `totalPagado` / `pagos[]` (reconciliar con `order-balance`) |
| Saldo cliente | **calculado** `getClientPendingDebts` (pedidos + ventas abiertas) |
| Ganancia pedido | persistida `gananciaEstimada` (total − costoReal, según estado) |
| Costo producto | `stock.costo` (catálogo). Compra web puede actualizarlo; WA no. |
| Estado pedido | `pedidos.estado` (slug configurable) |
| Caja | suma de `movimientos_caja` (no hay saldo maestro) |
| Precio venta | línea `precioVenta`; catálogo `precioSugerido` / price-catalog es sugerencia |

Gemini no debe escribir `stockActual` ni inventar saldos. Debe pedir commands/queries.

---

## 6. Flujo UI → ERP → BD

### Crear pedido (web)

Usuario confirma en `new-order.component`  
→ `OrderService.create` `POST /api/orders/:businessId`  
→ `routes/orders.ts` POST: enrich stock control, `allocateOrderNumber` si no es borrador, `pedidos.add` con `saldo = total`, `pagos: []`  
→ si seña > 0: `registerInitialSenia` (caja + pagos)  
→ **no** consume stock  
→ JSON del pedido

### Crear pedido (WhatsApp)

Confirmación SÍ → `executeWhatsappCommand` → `createOrderFromWhatsapp`  
→ resolve cliente/producto (lookups)  
→ `enrichOrderItemsStockControl`  
→ `planRelatedOrderFinance` (pago informado)  
→ **batch** `pedidos` + posible `movimientos_caja`  
→ foto opcional  
→ si pidió estado: `updateOrderStatusFromWhatsapp`  
**Writer distinto.** Mismo collection.

### Modificar pedido (web)

`PATCH /api/orders/:id` — ítems (reconcile reservas), estado (stock + entrega), descripción. WhatsApp no tiene update genérico; sí costos extra (`addOrderCostFromWhatsapp`) y status.

### Cambiar estado / entregar (web y WhatsApp)

Web: PATCH estado.  
WhatsApp: `updateOrderStatusFromWhatsapp`.  
Ambos: `validateOrderEstadoTransition` → consume/restore stock → si entregado, `createSaleFromOrder`.  
**Mejor paridad del ERP.**

### Registrar venta (web)

`POST /api/sales` → stock (`applyStockForVenta`) + caja si cobrado.  
WhatsApp: `createSaleFromWhatsapp` — línea concepto, `mueveStock: false`, `costoReal: 0`. **Paridad pobre.**

### Registrar compra (web)

`POST /api/purchases` → `persistPurchase` (stock in, opcional caja, opcional costo).  
WhatsApp: mismo persist **sin caja ni costo**. Stock sí entra. **Paridad parcial a propósito** (el skill del Bot lo documenta).

### Cobro (web)

Cuenta cliente o pedido: `POST /api/clients/:id/cobros` o `POST .../pedidos/:id/pagos`.  
WhatsApp: `registerPaymentFromWhatsapp` → `collectClientBalance`. **Mismo writer de cobro.**

### Ingreso / egreso caja (web)

`CashService.createMovement` → `POST /api/cash/:id` → `.add` inline en `cash.ts`.  
WhatsApp: `executeRegisterCashMovement` → `.add` paralelo, mismos `origenTipo` manual.  
**Misma colección, dos funciones.** Visible en Caja.

### Consultar caja

Web: `GET /api/cash/:id/summary`.  
WhatsApp: `queryCashTodayFromWhatsapp` (scan de la colección). **Query no reutilizada.**

### Stock: modificar / reservar / descontar

Web: PATCH stock; preparación y consume en `/api/orders/:id/stock-*`.  
WhatsApp: no expone ajuste manual de qty; descuenta al cambiar estado con los **mismos** `consumeOrderStock*`.

### Costos extra

Web: en el formulario de pedido / PATCH ítems.  
WhatsApp: al crear (presets) o `addOrderCostFromWhatsapp` (update local, no pasa por PATCH HTTP).

### Actualizar costo producto

Web: PUT/PATCH stock.  
WhatsApp: `updateProductCostFromWhatsapp` (solo campo `costo`).

---

## 7. Servicios reutilizables

Clasificación pedida:

| Función | Evaluación |
|---|---|
| `collectClientBalance` | **REUTILIZABLE TAL CUAL** |
| `getClientPendingDebts` / `buildClientHistorialPagos` | **REUTILIZABLE TAL CUAL** (query) |
| `consumeOrderStockOnStatusChange` y familia | **REUTILIZABLE TAL CUAL** |
| `applyEntregaCompletaPayment` / `applyEntregaConSaldoVenta` / `createSaleFromOrder` | **REUTILIZABLE CON REFACTOR MENOR** (viven en `routes/orders.ts`, ya las importa WhatsApp) |
| `validateOrderEstadoTransition` / `loadOrderPedidosConfig` | **REUTILIZABLE TAL CUAL** |
| `persistPurchase` / `parsePurchaseInput` | **REUTILIZABLE TAL CUAL** (WA ya las usa) |
| `createCashEgreso` | **REUTILIZABLE TAL CUAL** (payables; no es caja manual) |
| `enrichOrderItemsStockControl` | **REUTILIZABLE TAL CUAL** |
| `allocateOrderNumber` / `allocateSaleNumber` | **REUTILIZABLE TAL CUAL** |
| POST caja en `cash.ts` | **MEZCLADA CON HTTP** — extraer `createManualCashMovement` |
| POST pedido en `orders.ts` | **MEZCLADA CON HTTP** |
| POST venta en `sales.ts` | **MEZCLADA CON HTTP** |
| `executeRegisterCashMovement` | **MEZCLADA CON FIRESTORE** — debería llamar al servicio extraído |
| `createOrderFromWhatsapp` | **NO REUTILIZABLE** como dominio (orquesta lookups + doc WA) |
| `createSaleFromWhatsapp` | **NO REUTILIZABLE** — simplificado |
| `queryCashTodayFromWhatsapp` | **MEZCLADA** — reemplazar por `GET summary` logic extraída |
| `lookups.ts` resolve* | **Conversational EntityResolver**, no ERP |

Candidatos a Domain Service (nombres):

- `registerManualCashMovement` (nuevo, extraído de `cash.ts`)
- `createOrder` (extraído de POST orders)
- `changeOrderStatus` (ya casi: exports de orders + stock utils)
- `registerClientCollection` = `collectClientBalance`
- `createCounterSale` (extraído de POST sales)
- `createPurchase` = `persistPurchase`
- `applyOrderStockPreparation` (ya existe)

---

## 8. Writers paralelos WhatsApp

| Función | Colecciones | vs web | Riesgo | Reemplazo |
|---|---|---|---|---|
| `createOrderFromWhatsapp` | `pedidos`, caja opcional | POST orders + seña | **ALTO** | Domain `createOrder` + `registerCollection` |
| `createSaleFromWhatsapp` | `ventas`, caja | POST sales | **ALTO** (sin stock/costo) | Domain `createCounterSale` o no ofrecer venta mostrador hasta unificar |
| `executeRegisterCashMovement` / `registerCashFromWhatsapp` | `movimientos_caja` | POST cash | **MEDIO** (campos casi iguales) | Extraer write del panel |
| `createPurchaseFromWhatsapp` | `compras`, stock | persistPurchase | **BAJO** (flags explícitos) | Dejar adapter fino |
| `registerPaymentFromWhatsapp` | pedidos/ventas/caja | collectClientBalance | **BAJO** | Ya es el servicio |
| `updateOrderStatusFromWhatsapp` | pedidos, stock, ventas | PATCH orders | **MEDIO** (orquesta paid/stock ask) | Adapter sobre `changeOrderStatus` |
| `addOrderCostFromWhatsapp` | pedidos | PATCH items | **MEDIO** | PATCH dominio |
| `updateProductCostFromWhatsapp` | stock | PUT stock | **BAJO** | `updateProduct` |
| `createClientFromWhatsapp` | clientes | POST clients | **BAJO** | POST dominio mínimo |
| `createSupplierFromWhatsapp` | proveedores | POST suppliers | **BAJO** | igual |
| `createCatalogProductFromWhatsapp` | stock | POST stock | **MEDIO** (campos mínimos) | POST stock real |
| `queryCashTodayFromWhatsapp` | read caja | GET summary | **MEDIO** (agregación distinta) | extraer summary |

Visibilidad en ERP: **sí** para caja, pedidos, cobros, compras (stock).  
Excepción de **calidad de dato**: venta WA no alimenta costo/stock como el mostrador; reportes de márgenes pueden distorsionar si se usan esas ventas.

No hay colección `WhatsappOrder`. Hay flags de origen en el **mismo** doc.

Cuánto ERP paralelo hay: **~4 writes de negocio divergentes** (pedido, venta, caja, query caja) y **varios adapters finos**. No es un segundo producto de datos.

---

## 9. Queries disponibles / faltantes

| Query que el Bot necesita | Estado | Hoy |
|---|---|---|
| getProductStock | **PARCIAL** | `queryStockFromWhatsapp` scan + filtros; web `GET /stock` |
| findProducts | **PARCIAL** | lookups conversacionales, no servicio ERP |
| getClientBalance | **EXISTE** | `getClientPendingDebts` |
| getOrderBalance | **PARCIAL** | campos del pedido + query_status WA |
| getOrderStatus / details | **PARCIAL** | `queryStatusFromWhatsapp` |
| findClientOrders | **PARCIAL** | `listOpenOrdersForWhatsapp` (conversacional) |
| getCashBalance | **PARCIAL** | summary web vs scan WA |
| getCashMovements | **EXISTE** (web) | Bot no pagina como el panel |
| getSales / getPurchases | **FALTA** para el Bot | solo lastOperation en conversación |

Separación conceptual:

- **EntityResolver conversacional:** `resolveClientMatch`, `resolveProductMatch`, `listOpenOrdersForWhatsapp`, aliases, ranking. Puede seguir en `backend/whatsapp/lookups.ts`.
- **ERP Query Service:** getById, list by clientId, stock by productId, cash summary. Debe vivir en `backend/utils` o `backend/domain` y ser usado por HTTP GET y por el Bot **después** de resolver IDs.

---

## 10. Commands tipados disponibles / faltantes

| Command | Estado | Campos núcleo | Servicio destino |
|---|---|---|---|
| `RegisterCashMovementCommand` | **EXISTE** (WhatsApp) | businessId, type, amount, concept, scope?, date | extraer write panel |
| `CreateOrderCommand` | **FALTA** | clientId, items[], deliveryDate, notes?, payment?, status? | extraer POST orders |
| `UpdateOrderCommand` | **FALTA** | orderId, patch items/notes/date | PATCH |
| `ChangeOrderStatusCommand` | **FALTA** (implícito en entities) | orderId, estado, descuentoFisicoAlcance?, settle? | exports orders + stock |
| `RegisterClientCollectionCommand` | **FALTA** (params de collect) | clientId, monto, target?, tipo?, medio?, ambito? | `collectClientBalance` |
| `CreateSaleCommand` | **FALTA** | clientId, items, cobro | POST sales |
| `CreatePurchaseCommand` | **PARCIAL** | input de `parsePurchaseInput` + flags skipCash | `persistPurchase` |
| `UpdateProductCostCommand` | **FALTA** | productId, costo | PATCH stock |
| `PrepareOrderStockCommand` | **FALTA** | orderId, allocations | `applyOrderStockPreparation` |

Validaciones transversales: monto > 0, IDs resueltos (no hints), transiciones, módulos del tenant.

Confirmación actual (`askConfirmation`): guarda `pendingPayload = entities` y `operationPlan` solo para log/UI. El SÍ llama `executeWhatsappCommand({ intent, entities, raw })`. **Deuda 1 confirmada.** El plan ya tiene los payloads; el execute no es `execute(plan)`.

---

## 11. Errores

Hoy: `throw new Error('español…')` o códigos (`SUBSCRIPTION_INACTIVE`, `ORDER_WRITE_FAILED`, `OPS_LIMIT_REACHED`).  
`erp-integration.ts` traduce TypeError/Firebase a “No pude completar”.

Errores frecuentes (sin enum):

| Situación | String típico | DomainError sugerido |
|---|---|---|
| Monto caja 0 | Indicá el monto… | `INVALID_AMOUNT` |
| Sin concepto (web) | Ingresá un concepto | `MISSING_FIELD` field=concept |
| Cliente no encontrado | No encontré el cliente | `CLIENT_NOT_FOUND` |
| Producto ambiguo | (lista, no throw) | `AMBIGUOUS_PRODUCT` + candidates |
| Sin fecha entrega | Falta la fecha de entrega | `MISSING_DELIVERY_DATE` |
| Transición inválida | (order-status) | `INVALID_STATUS_TRANSITION` |
| Sin reservas | `isNoReservedUnitsStockError` | `INSUFFICIENT_STOCK` + `requiresUserDecision` |
| Cobro > saldo | El monto supera el saldo | `INVALID_AMOUNT` |
| Pedido cancelado | está cancelado | `INVALID_STATUS_TRANSITION` |

Conviene `DomainError { code, message, field?, requiresUserDecision?, allowedActions?, metadata? }` para que el Bot pregunte sin parsear español.

---

## 12. Transacciones / consistencia

| Operación | Mecánica | Hueco |
|---|---|---|
| Números pedido/venta/compra | `runTransaction` | bien |
| Ajuste `stockReservado` | `runTransaction` en stock doc | bien |
| Create pedido **web** | writes secuenciales; seña después | pedido sin seña si falla caja |
| Create pedido **WA** | **batch** pedido+caja | mejor atómico en el alta |
| Cobro `collectClientBalance` | secuencial; rollback delete en falla de venta | pedido cobrado / caja no, o viceversa |
| Caja manual | un `.add` | atómico trivial |
| Entrega | stock consume luego venta/caja | stock descontado si falla venta |
| Payables | `db.batch()` | mejor que cobros |
| WhatsApp SÍ doble | **no** idempotente en ERP; sí el webhook Meta (`whatsapp_inbound_dedup`) | SÍ reenviado a mano duplica |

Operaciones compuestas (“entregalo y cobrá”): el Bot encadena status + `collectClientBalance` o flags de pago en el mismo status. No hay saga ni compensation genérica. Riesgo: media operación si el segundo execute falla (`message-handler` puede hacer un segundo `executeWhatsappCommand` para cobro).

---

## 13. Capabilities

**Ya existe (canal + producto comercial):**

- `platformAccess`: `erpWebEnabled`, `whatsappEnabled`, pausas, `trialProduct`: `whatsapp` | `erp` | `completo` (`shared/platform-access.ts`)
- Módulos de plan: `core`, `pedidos`, `caja`, `payables`, `collaborators`, `price_catalog`, `reports`, `economics`, `order_photos`
- Packs: `negocio` (default), `equipo`, `analisis`
- `core` es **alwaysOn** e incluye clientes, stock, compras, ventas

**No existe:** capability matrix `cash.whatsapp` vs `orders.whatsapp`. El Bot **no** llama `requireBusinessModule`. Un tenant “solo Bot” con web apagada **igual puede crear pedidos por WhatsApp** si el modelo lo interpreta.

Propuesta (no implementar):

```
capabilities: {
  cash:    { web: true, whatsapp: true },
  orders:  { web: true, whatsapp: true },
  sales:   { web: true, whatsapp: false },
  stock:   { web: true, whatsapp: true },
  …
}
```

Compatibilidad: mapear `subscription modules` → capacidad de negocio; `platformAccess` → canal. Tenant Rilo = todo on. Tenant “Bot + Caja” = `whatsappEnabled`, `erpWeb` opcional, `caja` on, `pedidos` off, y **el interpreter schema se recorta** para no ofrecer `create_order`.

El `core` alwaysOn choca con “solo caja” si se interpreta como “siempre hay stock/ventas en el producto”. Habría que permitir `core` liviano o no exigir stock UI cuando `erpWeb` está off.

---

## 14. Configuraciones por tenant

Ubicación principal: `negocios/{id}/config/app` (`catalog-config.ts`).

| Clave | Default | Quién la usa |
|---|---|---|
| `caja.ambitos` | separación negocio/personal si está configurada | web caja + WA |
| `caja.origenes` / conceptos | defaults | web |
| `pedidos.estados` | borrador…cancelado | web + status WA |
| `pedidos.estadoDescuentaStock` | `en_produccion` | stock máquina **compartida** |
| `pedidos.descuentoFisicoPorEstado` | reservado vs completo | igual |
| `pedidos.costosExtraPredeterminados` | `[]` | web + WA presets |
| `pedidos.costosPersonalizacionDetallados` | true | extras |
| `finanzas.mediosPago` | efectivo, etc. | web cobros; WA suele efectivo |
| `stock.tipos` / origenes | | catálogo |
| `comprobantes` | | ventas/compras |

Negocio: `platformAccess`, `planId`, módulos efectivos, cupos WhatsApp/AI.

WhatsApp no lee módulos para recortar intents. Solo `assertCanRunWhatsappWrite` (cuota lite) y `assertWhatsappFeatures` (canal on).

---

## 15. Qué es específico de Rilo

`DEFAULT_BUSINESS_ID = 'rilo-default'`. El negocio real usa el ERP **completo**: pedidos con talles/colores, extras, dos cajas, trigger de stock, entrega → venta.

| Tema | Clasificación |
|---|---|
| Pedido + ítems + fecha entrega | **CORE GENÉRICO** |
| Estados de pedido | **CONFIGURABLE POR TENANT** (labels/slugs) |
| Reserva / descuento por estado | **CONFIGURABLE** (`modoStock`, trigger) |
| Costos extra / personalización | **CONFIGURABLE** (Rilo on; otro tenant lista vacía) |
| Cajas negocio / personal | **CONFIGURABLE** (`caja.ambitos`) |
| Rubro / copy WhatsApp | **CONFIGURABLE** (rubro) |
| Catálogo de precios aparte | **CONFIGURABLE** (módulo) |
| Colaboradores / reportes add-on | **CONFIGURABLE** |
| Ranking canguro XL rojo | **ESPECÍFICO DE RILO** como default de matching, no como regla financiera |
| Compra WA sin egreso | **política de canal** (documentada), no de Rilo-el-tenant |

No eliminar extras ni doble caja: dejarlos como config del perfil completo (default Rilo).

---

## 16. Qué puede hacerse genérico

- Extraer writers HTTP → funciones de dominio (caja, pedido, venta).
- Recortar schema Gemini por capabilities del tenant.
- `DomainError` para el Bot.
- Queries por ID compartidas con GET.
- Metadata `source: 'whatsapp' | 'web'` unificada (hoy flags sueltos + activity log solo en web).
- No reescribir documentos existentes.

---

## 17. Riesgos

| Módulo | Riesgo refactor | Por qué |
|---|---|---|
| Caja manual | **BAJO–MEDIO** | un doc, dos writers casi iguales, pocos tests de ruta |
| Cobros | **MEDIO** | financiero, ya compartido; no romper `collectClientBalance` |
| Status / stock pedido | **ALTO** | dinero + stock + venta; pero **ya compartido** — no reescribir la máquina |
| Create pedido | **ALTO** | seña/caja/pagos distintos web vs WA; datos reales de Rilo |
| Venta mostrador | **ALTO** | WA está simplificada; unificar cambia semántica del Bot |
| Compra | **MEDIO** | persist único; flags skip |
| Queries | **BAJO** | extraer summary |
| Capabilities Bot+Caja | **MEDIO** | choca con `core` alwaysOn y con el interpreter |

Tests ERP de rutas: **casi no hay**. Los tests actuales son conversacionales (`backend/whatsapp/*.test.ts`) y billing (`shared/*subscription*`). Un refactor de writers **no está cubierto** salvo paridad futura.

---

## 18. Recomendación de arquitectura objetivo

Sin Gemini dentro del ERP. Sin `WhatsappOrder`.

```
TurnInterpretation          (canal, ya existe)
  → SemanticCommand / OperationPlan
  → DomainCommandMapper     (nuevo, fino: IDs ya resueltos)
  → ERP Command
  → Domain Service          (único)
  → Firestore
```

EntityResolver (WhatsApp) corre **antes** del command: hint → id. El Domain Service solo acepta IDs.

Web: `route → mismo Domain Service`.

Confirmación: `execute(operationPlan)` cuyos payloads **son** commands (deuda 1).

Caja es el piloto: `RegisterCashMovementCommand` ya existe; falta que `cash.ts` POST lo use.

---

## 19. Orden de refactor (según código, no hipótesis)

La hipótesis “caja → cobros → pedidos → stock → ventas → compras” se **ajusta** así:

1. **Caja manual** — writer más chico, misma colección, command ya tipado. Extraer de `cash.ts`, WhatsApp llama eso. Query summary extraída. Tests de paridad A/B.
2. **Confirmación `execute(plan)`** — deja de re-leer entities/raw para writes. No cambia Firestore.
3. **Cobros** — ya compartidos; solo Command wrapper + DomainError. No tocar FIFO.
4. **Queries** (caja, saldo, stock by id, pedido by id) — el Bot deja de escanear a mano.
5. **Change order status** — mover exports de `routes/orders.ts` a `utils/order-lifecycle.ts` (o similar). WhatsApp ya depende de ellos; es un relocate, no nueva lógica.
6. **Create order** — el más riesgoso; unificar seña/pagos con el POST web. Aquí sí hay drift de datos.
7. **Create sale** — decidir si el Bot debe hacer mostrador real (stock+costo) o dejar de ofrecer `create_sale` hasta entonces.
8. **Create purchase** — adapter ya fino; opcional alinear skipCash como capability.
9. **Capabilities por canal** — cuando los commands existan, recortar schema. No al revés.

**No** empezar por stock: la máquina ya es compartida. **No** empezar por reescribir pedidos en Firestore.

---

## 20. Tabla final de gaps

Capacidad | Modelo ERP | Servicio web | Servicio WhatsApp | ¿Mismo writer? | Query reutilizable | Command tipado | ¿Regla duplicada? | Riesgo | Acción
---|---|---|---|---|---|---|---|---|---
Caja ingreso/egreso | `movimientos_caja` | POST `cash.ts` inline | `executeRegisterCashMovement` | **No** (misma colección) | Summary web ≠ scan WA | **Sí** (WA) | Validación monto/concepto | MEDIO | Extraer domain write
Query caja | suma movimientos | GET summary | `queryCashTodayFromWhatsapp` | No | **Falta** compartir | — | Agregación | BAJO | Extraer `getCashSummary`
Pedido create | `pedidos` | POST orders | `createOrderFromWhatsapp` | **No** | — | **Falta** | Seña/fecha/ítems | ALTO | Extraer `createOrder`
Update pedido | `pedidos` | PATCH orders | costos extra local | **No** | — | **Falta** | Parcial | MEDIO | Adapter PATCH
Status / entrega | `pedidos`+stock+ventas | PATCH + helpers exportados | `updateOrderStatusFromWhatsapp` | **Parcial (núcleo sí)** | preview stock | **Falta** wrapper | Orquestación paid | ALTO (lógica), BAJO si solo relocate | Wrapper Command
Cobro | pagos + caja | `collectClientBalance` | `registerPaymentFromWhatsapp` | **Sí** | deudas | **Falta** wrapper | Resolución target WA | MEDIO | Command + DomainError
Saldo | derivado | cuenta cliente | `queryBalanceFromWhatsapp` | **Sí** (deudas) | **Existe** | — | — | BAJO | Query service público
Stock descontar/reservar | `stock` + líneas | utils + rutas pedido | mismos utils vía status | **Sí** (máquina) | preview | preparación **Falta** en Bot | — | ALTO no tocar máquina | No reescribir
Venta mostrador | `ventas` | POST sales | `createSaleFromWhatsapp` | **No** | — | **Falta** | Stock/costo | ALTO | Unificar o deshabilitar en Bot
Compra | `compras` | `persistPurchase` | mismo + skipCash/cost | **Parcial** | — | **Parcial** | Caja/costo off en WA | MEDIO | Capability `purchase.cash`
Costos extra | líneas pedido | PATCH / form | create + `addOrderCostFromWhatsapp` | **No** | — | **Falta** | Attach presets | MEDIO | Usar PATCH dominio

---

## Respuestas A–J

**A. ¿Mantener el ERP actual sin romperlo?**  
Sí. No migrar colecciones. Extraer funciones. Tenant Rilo = perfil completo (módulos + extras + dos cajas).

**B. ¿Web + WhatsApp mismos modelos?**  
Sí, y ya ocurre en cobros, stock-on-status, compras persistidas, caja (mismo doc, distinto código). Falta unificar **quién escribe** pedido/venta/caja manual.

**C. ¿Qué writers WhatsApp deben desaparecer?**  
Como implementación: `createOrderFromWhatsapp`, `createSaleFromWhatsapp`, el `.add` de `executeRegisterCashMovement`, `queryCashTodayFromWhatsapp` (scan). Quedan **adapters** que resuelven hints y llaman dominio. `registerPaymentFromWhatsapp` y `createPurchaseFromWhatsapp` ya son adapters.

**D. Domain Services nuevos**  
`registerManualCashMovement`, `createOrder`, `changeOrderStatus` (relocate), `createCounterSale`, wrappers de collection/purchase. Stock consume **ya es** el servicio.

**E. Query Services**  
`getCashSummary`, `getClientDebts` (exportar), `getOrder`, `getStockItem`, `listOrdersByClient` (sin fuzzy).

**F. Commands**  
Los de la sección 10. Prioridad: caja (existe), cobro, change status, create order.

**G. Config genérica por tenant**  
Ya: estados, trigger stock, ámbitos, extras, medios. Falta: **qué intents puede ejecutar el Bot** (capabilities). No hace falta nueva config de “cómo es un pedido” para Rilo.

**H. ¿Tenant solo RILO Bot + Caja?**  
**Canal sí** (`platformAccess.whatsapp` sin web). **Módulo caja sí.** **Producto “sin pedidos/stock” aún no**: `core` alwaysOn y el Bot no filtra intents. Hace falta recortar schema + no ejecutar `create_order` si `pedidos` off. No hace falta cargar la UI del ERP si `erpWebEnabled` es false.

**I. ¿Gemini operar el ERP sin Firestore?**  
Gemini ya no debería. El hueco es el **mapper + domain**. Hoy `erp-writes` conoce paths. El interpreter no debe conocer `negocios/…/movimientos_caja`.

**J. Mínimo refactor seguro**  
1) Extraer write de caja del panel y usarlo desde WhatsApp.  
2) `execute(OperationPlan)` en la confirmación.  
3) Tests de paridad caja (mismo documento salvo metadata de canal).  
No tocar LanguageInterpreter, no regex, no reescribir pedidos.

---

## Tests actuales vs paridad

Cubierto: interpretación, contratos conversacionales, cobro/status **a nivel de parseo**, billing comercial.  
No cubierto: `cash.ts`, `client-collections.ts`, `orders.ts` POST/PATCH, paridad web/WA de documentos.

Paridad propuesta (no implementada): mismo `registerManualCashMovement` desde un test de panel y desde el adapter WA; comparar `tipo`, `monto`, `concepto`, `ambito`, `origenTipo`; permitir `origenWhatsapp` extra.

---

## Catálogo de capabilities (para schema futuro, no para el prompt actual)

El LanguageInterpreter debería conocer **solo**: intents habilitados, enums de estado del tenant, ámbitos de caja, si extras están on, que `cash` ≠ `payment`.  
No: paths Firestore, `stockReservado`, `origenGrupo`.

| Capability | Módulo | Confirmación | Servicio actual |
|---|---|---|---|
| register_cash / query_cash | caja | sí / no | WA command / scan |
| create_order / update_order / update_order_status | pedidos | sí | writers / PATCH helpers |
| query_order / status / balance | pedidos | no | erp-queries + deudas |
| register_collection | caja+clientes | sí | collectClientBalance |
| create_sale | core ventas | sí | paralelo WA |
| create_purchase | core compras | sí | persistPurchase |
| query_stock | core stock | no | erp-queries |
| update_product_cost | economics/stock | sí | PATCH local WA |

---

---

# Parte II — Compleción (campos, verdad, paridad, producto)

Fecha: 29 ago 2026. Misma base de código. **No se implementó nada.**  
Las secciones 1–4 de la Parte I siguen vigentes; acá se **detallan** documentos y se cubre lo que el prompt original pedía con evidencia de funciones.

---

## 4.4 Catálogo de campos (documentos reales)

No hay classes de dominio. Los types viven en el frontend y en writers. Lo que importa es **qué se persiste**.

### Pedido — `negocios/{id}/pedidos/{orderId}`

| Campo | Tipo | Obligatorio de facto | Default al crear (web) | Default WA | Calculado / persistido | Legacy |
|---|---|---|---|---|---|---|
| `clienteId` | string | sí | body | resuelto | persistido | |
| `clienteNombre` | string | no | enrich | copy | denormalizado | |
| `estado` | string slug | sí | pendiente / borrador | `pendiente` luego status | persistido (fuente de estado) | |
| `fechaEntrega` | ISO | sí (no draft) | body | entities | persistido | |
| `descripcion` | string | no | body | notes/diseño | persistido | |
| `items[]` | líneas | sí | body enrich | buildLineItems | persistido | un solo `stockItemId` en raíz = legacy print |
| `total` | number | sí | suma líneas | productTotal | **persistido**; UI también recalcula con `resolveOrderBalance` | |
| `costoReal` | number | sí | suma costos+extras | `computeItemsCostoReal` | persistido | |
| `gananciaEstimada` | number | sí | `resolveOrderGananciaForStorage` | igual | persistido según estado | |
| `senia` | number | no | 0 | plan cobro parcial | persistido | |
| `totalPagado` | number | sí | 0 luego seña | cobro en batch | persistido; fallback si no hay pagos | |
| `saldo` | number | sí | = total | total−cobro | **persistido**; fuente operativa de cobro | recalculable |
| `pagos[]` | `{id,tipo,monto,fecha,movimientoCajaId,notas}` | sí (array) | `[]` + seña | cobro en batch | persistido | `movimientoSeniaId` si array vacío |
| `numeroPedido` / `numeroPedidoLabel` | n / string | al confirmar | allocate | allocate | persistido | |
| `stockDescontado` / `stockPreparado` / `estadoStock` | flags | sí | false / `sin_preparar` | igual | persistido, actualizados por utils stock | |
| `cantidadReservada/Usada/Faltante` | en ítem | no | enrich | enrich | persistido en línea | |
| `ventaId` / `entregadoAt` / `entregaConSaldo` | | no | al entregar | al entregar (helpers panel) | persistido | `entregado_con_saldo` |
| `esDonacion` | bool | no | total 0 | false | persistido | |
| `fotos[]` | | no | storage | media | persistido | |
| `origenWhatsapp` / `whatsappPhone` | | no | ausente | true + phone | metadata canal | |
| `negocioId` / `createdAt` | | sí | sí | sí | persistido | |
| `costosExtra` en **raíz** | | no | a veces UI | attach a ítems | preferir línea `costosExtra[]` | raíz = listado viejo |
| `seniaBloqueada` | bool | no | tras seña | si cobró | persistido | |

**OrderItem (línea)** — `items[]`: `stockItemId`, `nombre`, `cantidad`, `precioVenta`, `costoUnitario`, `costosExtra[{nombre,costo}]`, `costoPersonalizacion` (legacy = suma extras×qty), `controlaStock`, `mueveStock`, `tipoLinea`, flags reserva.

**Qué guarda create:** ficha + líneas + totales + flags stock en cero + pagos vacíos o con seña. **No** mueve `stockActual`.

### Pago (no es colección)

Vive embebido en `pedidos.pagos[]` o `ventas.cobros[]`. Siempre debería tener `movimientoCajaId` si impactó caja. Tipos pedido: `seña` | `cuota` | `pago`.

### Caja — `movimientos_caja/{id}`

| Campo | Web POST manual | WA `executeRegisterCashMovement` | Cobro `createCashIncome` | Compra `createCashEgreso` |
|---|---|---|---|---|
| `tipo` | ingreso\|egreso | igual | ingreso | egreso |
| `monto` | body | command | cobro | total |
| `concepto` | **obligatorio** | trim o “Egreso/Ingreso” | generado | generado |
| `medio` | body (default efectivo) | siempre efectivo | medio param | label del medio |
| `categoriaId` | body | null | ausente | — |
| `descripcion` | body | `"Origen: WhatsApp RILO Bot"` | ausente | — |
| `ambito` | `normalizeMovementAmbito` | igual (scope) | igual | igual |
| `fecha` | `normalizeTransactionDateTimeToIso` | `YYYY-MM-DD` → 12:00−03 | `new Date()` | param |
| `origenTipo` | `caja_manual_*` | igual | pedido/venta cobro | `compra` / cuenta |
| `origenGrupo` | `manual` | `manual` | venta/pedido | compra |
| `pedidoId` / `ventaId` / `clienteId` | null | null | set | compraId |
| `origenWhatsapp` | **no** | true | **no** | no |
| `whatsappPhone` | no | phone | no | no |
| `negocioId` / `createdAt` | sí | sí | negocioId; createdAt no en cobro | |

**Fuente de saldo de caja:** no hay documento saldo. Es la suma de movimientos (GET summary).

### Venta — `ventas/{id}`

| Campo | Mostrador web | Entrega `createSaleFromOrder` | WA `createSaleFromWhatsapp` |
|---|---|---|---|
| `origen` | mostrador | `pedido` | mostrador |
| `items` | producto, `mueveStock` típ. true | copiados del pedido | `tipoLinea: concepto`, `mueveStock: false` |
| `costoReal` | de líneas | de pedido | **0** |
| `gananciaEstimada` | total−costo | de pedido | **= total** (inflada) |
| `montoCobrado` / `saldoPendiente` | body | según entrega | paid/seña |
| `ambito` | elegido | de caja | **`general`** (puede no existir como ámbito Rilo) |
| `origenWhatsapp` | no | no | true |
| Stock | `applyStockForVenta` | ya consumido en pedido | **no mueve** |

### Compra — `compras/{id}`

Campos UI: proveedor, items (producto o gasto), total, `pago` (medio, cuotas), fecha, comprobante.  
Persistencia: `persistPurchase`. Side effects web: stock in, egreso caja, opcional update `stock.costo`, payables.  
WA: mismos docs compra+stock; **skipCash + skipProductCostUpdate**.

### Stock — `stock/{itemId}`

Fuente física: `stockActual`. Reserva: `stockReservado`. Disponible **no se guarda** (`max(0, actual−reservado)`).  
`controlaStock` (default true), `permitirStockNegativo` (default true en UI).  
`costo`, `precioSugerido`. Atributos: tipo, talle, color, codigo.

### Movimiento de stock — `movimientos_stock/{id}`

`tipo` entrada|salida, `cantidad`, `productoId`, `fecha`, `origenTipo/Grupo`, `pedidoId`/`ventaId`/`compraId`. Ledger; no es el saldo.

### Cliente — `clientes/{id}`

Ficha: nombre, telefono, email, direccion, redes, etiquetas, activo.  
`saldoPendiente` / `debe` en **GET se calculan** (`balanceMap` de deudas) y **no se aceptan en POST/PATCH** (se strippean). **No son fuente de verdad.**

### Proveedor — `proveedores/{id}`

Ficha similar. `saldoPendiente` se **lee del documento** en GET pero el POST lo strippea: campo denormalizado/legacy. Deuda real: `cuentas_pagar_obligaciones` + `cuentas_pagar_cuotas` (módulo payables). WhatsApp no escribe deuda proveedor.

### Relacionales

```
cliente 1—* pedidos, ventas, movimientos_caja (clienteId)
pedido *—1 cliente; items *—1 stock; 1—0..1 venta (entrega)
pedido.pagos.movimientoCajaId → movimientos_caja
venta.cobros / movimientoCajaId → caja
compra → stock (entrada) + caja egreso (web) + payables
```

---

## 5. Fuente de verdad (tabla operativa)

Gemini **no** debe inventar ni recalcular estas cifras. Pedir query o dejar que el command las resuelva.

| Concepto | Fuente de verdad | Cómo se calcula | Quién lo modifica |
|---|---|---|---|
| Stock físico | `stock.stockActual` | persistido; ledger en `movimientos_stock` | consume/restore pedido, venta mostrador web, compra, PATCH stock, **no** create pedido, **no** venta WA |
| Stock reservado | `stock.stockReservado` + línea `cantidadReservada` | transacción `adjustGlobalStockReservation` | preparación, auto-reserve, reconcile, release |
| Stock disponible | **no persistido** | `max(0, stockActual − stockReservado)` | derivado |
| Saldo pedido | `pedidos.saldo` (+ `pagos[]`, `totalPagado`) | al escribir: total − pagado; lectura: `resolveOrderBalance` puede recomputar | create/PATCH, seña, `collectClientBalance`, entrega |
| Saldo cliente | **derivado** | `getClientPendingDebts`: pedidos con saldo>0 no cancelados + ventas mostrador con saldo (excluye `origen=pedido`) | nadie escribe ficha; cambian pedido/venta |
| Caja (saldo) | **derivado** | suma `movimientos_caja` (summary; por ámbito) | todo writer de caja |
| Precio venta (línea) | `items[].precioVenta` / venta `precioUnitario` | copiado del form o catálogo al crear | create/PATCH pedido, venta |
| Precio sugerido catálogo | `stock.precioSugerido` / price-catalog | no es el precio del pedido salvo que se copie | PUT stock, price-catalog |
| Costo producto | `stock.costo` | persistido | PUT stock, compra web (si no skip), `updateProductCostFromWhatsapp` |
| Costo extra | `items[].costosExtra[]` | suma en `costoReal` vía `sumLineExtraCosts` | form/PATCH, `addOrderCostFromWhatsapp` |
| `costoPersonalizacion` | legacy en línea | debería = extras×qty | writers que aún lo setean |
| Ganancia pedido | `gananciaEstimada` persistida | `resolveOrderGananciaForStorage(total, costoReal, estado)` | create/PATCH/status |
| Ganancia reportes | **ventas del período** | `buildBusinessReport` lee **solo** `ventas` (+ stock/clientes para agrupar) | no usa pedidos ni caja |
| Estado pedido | `pedidos.estado` | slug config | PATCH / `updateOrderStatusFromWhatsapp` |
| Pago | `pagos[]` / `cobros[]` + movimiento caja | monto en array | seña, collect, entrega |
| Deuda proveedor | cuotas payables (no ficha) | obligaciones/cuotas | compras web + payables; **WA no** |

---

## 6. Reglas de negocio (por operación)

Formato: regla · archivo/función · Web · WhatsApp · compartida o duplicada.

### Pedidos

| Regla | Dónde | Web | WA | |
|---|---|---|---|---|
| Cliente obligatorio | POST orders; `createOrderFromWhatsapp` | sí | sí | duplicada |
| Ítems con precio → total | POST; `buildLineItems` | sí | sí | duplicada |
| Fecha entrega si no borrador | POST; throw WA | sí | sí (siempre) | duplicada |
| No descontar stock al crear | POST no llama `applyStockForOrder` | sí | sí | compartida de hecho |
| Número al salir de borrador | `allocateOrderNumber` | sí | siempre numera | compartida fn |
| Seña → caja + pagos | `registerInitialSenia` vs batch WA + `planRelatedOrderFinance` | sí | sí | **duplicada** |
| Estados | `normalizeOrderPedidosConfig` | sí | sí | compartida config |
| Transición | `validateOrderEstadoTransition` | PATCH | `updateOrderStatusFromWhatsapp` | **compartida** |
| Trigger descuento | `estadoDescuentaStock` + `consumeOrderStockOnStatusChange` | PATCH | status WA | **compartida** |
| Entrega completa | `applyEntregaCompletaPayment` → venta + cobra resto | PATCH | status | **compartida** |
| Entrega con saldo | `applyEntregaConSaldoVenta` venta montoCobrado 0 | PATCH | status | **compartida** |
| Rollback estado | `restoreStockForOrderEstadoRollback` | PATCH | status | **compartida** |
| Extras | líneas + presets config | form | create attach / `addOrderCostFromWhatsapp` | duplicada attach |
| Ganancia | `resolveOrderGananciaForStorage` | sí | create | compartida fn |
| Update genérico ítems | PATCH + `reconcileOrderStockOnItemsChange` | sí | **no** (solo extras) | web only |
| Pedido entregado locked | PATCH bloquea salvo descripción | sí | status puede entregado | parcial |

### Caja

| Regla | Dónde | Web | WA | |
|---|---|---|---|---|
| Monto > 0 | POST cash; `executeRegisterCashMovement` | 400 | throw | duplicada |
| Concepto no vacío | POST cash | 400 | default “Egreso” | **distinta** |
| Ámbito válido | `normalizeMovementAmbito` | sí | sí + ask si varios | compartida fn |
| Manual `origenTipo` caja_manual_* | ambos writers | sí | sí | duplicada write |
| Saldo = suma | GET summary | sí | scan propio | **query duplicada** |
| Automáticos (cobro, venta, compra, payables) | `createCashIncome`, `createCashEgreso`, sales, orders | sí | cobro sí; compra WA skip; venta WA escribe caja propia | mixto |
| Editar/borrar solo manual | PUT/DELETE cash + `isManualMovement` | sí | Bot no edita | web only |

### Cobros

| Regla | Dónde | Web | WA | |
|---|---|---|---|---|
| Monto > 0 y ≤ saldo | `collectClientBalance` | sí | sí | **compartida** |
| FIFO o target pedido/venta | mismo | sí | target si hay order | **compartida** |
| Escribe pagos + caja | `applyPedidoPayment` / `applyVentaCobro` | sí | sí | **compartida** |
| No `origenWhatsapp` en caja del cobro | `createCashIncome` | n/a | **no marca canal** | gap metadata |
| Seña vs pago | param `tipo` | sí | paymentKind | wrapper WA |
| Ventas origen pedido no duplican deuda cliente | `getClientPendingDebts` skip `origen===pedido` | sí | sí | compartida |

### Stock

| Regla | Dónde | Web | WA | |
|---|---|---|---|---|
| Disponible = actual − reservado | `getStockDisponible` | sí | query usa stock docs | compartida |
| Reserva no baja `stockActual` | `applyOrderStockPreparation` | sí | Bot no prepara | compartida (web) |
| Consumo baja actual, suelta reserva, ledger | `consumeOrderStock*` | status/delivery | status | **compartida** |
| Negativo | `permitirStockNegativo` | sí | mismos utils | compartida |
| Restore al volver estado | `restoreStockForOrderEstadoRollback` | sí | sí | compartida |
| Venta mostrador descuenta | `applyStockForVenta` | sí | **no** | divergencia |
| Compra entra stock | `persistPurchase` | sí | sí | compartida |

### Ventas / compras / proveedores

| Regla | Dónde | Web | WA | |
|---|---|---|---|---|
| Mostrador mueve stock y costo | `routes/sales.ts` | sí | no | **duplicada/simplificada** |
| Entrega crea venta pedido | `createSaleFromOrder` | sí | vía status | compartida |
| Compra caja + costo catálogo | `persistPurchase` | default on | skip ambos | flags |
| Deuda proveedor payables | `purchase-finance` / payables | sí | no | web |

---

## 7. Writers paralelos (lista exacta)

| OPERACIÓN | WRITER WEB | WRITER WHATSAPP | ¿Misma lógica? | DIFERENCIAS | RIESGO | SERVICIO COMPARTIDO PROPUESTO |
|---|---|---|---|---|---|---|
| Caja ingreso/egreso manual | `POST cash.ts` `.add` | `executeRegisterCashMovement` `.add` | No (código) | WA: medio fijo, concepto default, fecha noon−03, `origenWhatsapp`; web: concepto obligatorio, categoria, activity log | MEDIO | `registerManualCashMovement` extraído de cash.ts |
| Query caja | `GET .../summary` | `queryCashTodayFromWhatsapp` scan | No | distinto filtro “hoy” / ámbitos | MEDIO | `getCashSummary(businessId, {day?})` |
| Create pedido | `POST orders.ts` | `createOrderFromWhatsapp` | No | WA batch+cobro; web create luego seña; WA siempre pendiente+flags origen | ALTO | `createOrder` extraído de POST |
| Update pedido | `PATCH orders.ts` | `addOrderCostFromWhatsapp` (solo extras) | No | Bot no edita fecha/ítems genérico (eso es corrección conversacional → re-prepare) | MEDIO | PATCH domain |
| Cambio estado / entrega | PATCH + exports | `updateOrderStatusFromWhatsapp` | **Núcleo sí** | WA orquesta paid/stock ask/copy | MEDIO | `changeOrderStatus` relocate |
| Cobro | `collectClientBalance` | `registerPaymentFromWhatsapp` → **mismo** | Sí | resolución cliente/pedido + notas; caja sin flag WA | BAJO | wrapper Command |
| Venta mostrador | `POST sales.ts` | `createSaleFromWhatsapp` | No | WA concepto, costo 0, no stock, ambito `general` | ALTO | `createCounterSale` o no ofrecer |
| Compra | `persistPurchase` | mismo + skipCash/cost | Parcial | intencional | MEDIO | flags = capability |
| Stock consume | utils | mismos vía status | Sí | — | — | no extraer de nuevo |
| Stock alta producto | `POST stock.ts` | `createCatalogProductFromWhatsapp` | No | WA campos mínimos | MEDIO | POST stock |
| Costo producto | PUT/PATCH stock | `updateProductCostFromWhatsapp` | No | solo `costo` | BAJO | `updateProductCost` |
| Cliente alta | POST clients | `createClientFromWhatsapp` | Parcial | phone en nombre, notes fijas | BAJO | POST clients |
| Proveedor alta | POST suppliers | `createSupplierFromWhatsapp` | Parcial | mínimo | BAJO | POST suppliers |
| Seña al crear pedido | `registerInitialSenia` | batch en create WA | No | timing/campos | ALTO | parte de `createOrder` |
| Caja de venta WA | `createCashIncome` en sales | `.add` inline en createSale WA | No | ambito general | ALTO | mismo que mostrador web |

Confirmación: `pendingPayload` = entities, no plan. SÍ → `executeWhatsappCommand(intent, entities, raw)`.

---

## 8. Domain services (mínimos, no artificiales)

No hace falta una clase por sustantivo. Cuatro servicios + wrappers.

### CashDomainService (nuevo por extracción)

- Extraer: cuerpo de `POST/GET summary` en `cash.ts`; WhatsApp deja de `.add`.
- Input: `{ businessId, tipo, monto, concepto, ambito?, fecha?, medio?, categoriaId?, actor }`.
- Output: `{ id }`.
- Regla: movimiento manual; saldo derivado.
- Web: POST/GET cash. WA: `registerCashFromWhatsapp`.

### CollectionDomainService (= `client-collections.ts` tal cual)

- Reutilizar: `collectClientBalance`, `getClientPendingDebts`.
- Input: `{ businessId, clientId, monto, target?, tipo?, medio?, ambito?, notas?, actor }`.
- Output: montos + allocations.
- Web: `POST /clients/.../cobros`. WA: `registerPaymentFromWhatsapp`.

### OrderLifecycleService (relocate, no reescribir)

- Mover de `routes/orders.ts`: `validateOrderEstadoTransition`, `applyEntrega*`, `loadOrderPedidosConfig`, y usar stock utils.
- Extraer POST create a `createOrder` (segunda etapa).
- Input status: `{ orderId, estado, alcanceStock?, actor }`.
- Web: PATCH. WA: `updateOrderStatusFromWhatsapp` orquesta copy y llama esto.

### PurchaseDomainService (= `purchase-finance.ts`)

- Ya es el servicio. WA adapter fino.

### SaleDomainService (etapa tardía)

- Extraer `POST sales` mostrador. WA hoy **no** es reutilizable.
- Hasta entonces: capability `sales.whatsapp=false` o aceptar venta-concepto como no-paridad.

### StockDomainService

- **No crear** un wrapper vacío. `order-stock-reservations.ts` ya es el servicio. Query `getStockItem` sí extraer de GET stock.

---

## 9. Domain commands (contratos internos, no docs nuevos)

### RegisterCashMovementCommand (ya existe en WA)

Required: `businessId`, `type` ingreso|egreso, `amount>0`, `concept` (web: no vacío; unificar a obligatorio).  
Optional: `scope`, `date`, `medio`, `categoriaId`, `actor`.  
Errors: `INVALID_AMOUNT`, `MISSING_FIELD` concept, `INVALID_SCOPE`.

### RegisterCollectionCommand

Required: `businessId`, `clientId`, `amount>0` **o** `payFullBalance`.  
Optional: `target {kind,id}`, `tipo` seña|pago, `medio`, `ambito`, `notas`, `actor`.  
Errors: `CLIENT_NOT_FOUND`, `INVALID_AMOUNT` (supera saldo), `ORDER_NOT_FOUND`.

### ChangeOrderStatusCommand

Required: `businessId`, `orderId`, `estado`.  
Optional: `descuentoFisicoAlcance`, `entregaModo`, `actor`.  
Errors: `INVALID_STATUS_TRANSITION`, `INSUFFICIENT_STOCK` + `requiresUserDecision`, `ORDER_CANCELLED`.

### CreateOrderCommand (etapa 2)

Required: `businessId`, `clientId`, `items[{stockItemId, qty, precioVenta}]`, `deliveryDate` si no draft.  
Optional: `notes`, `senia`/`collection`, `estadoInicial`, `extraCosts`, `actor`.  
Errors: `MISSING_DELIVERY_DATE`, `CLIENT_NOT_FOUND`, `INVALID_AMOUNT`, `MISSING_FIELD` items.

### CreateSaleCommand / CreatePurchaseCommand

Sale: posponer hasta paridad stock. Purchase: el input de `parsePurchaseInput` + `{ skipCash, skipProductCostUpdate, actor }`.

### UpdateOrderCommand / UpdateProductCostCommand

Patch parcial; costo: `productId` + `costo>0`.

---

## 10. Query services

| Query | Estado | Implementación hoy | Propuesta |
|---|---|---|---|
| `getCashBalance` / movements | PARCIAL | GET summary vs scan WA | extraer summary |
| `getClientBalance` | EXISTE | `getClientPendingDebts` | exportar como query |
| `getOrder` / status / balance | PARCIAL | GET order; WA `queryStatusFromWhatsapp` | GET by id compartido |
| `findOrders` (por clienteId, estado) | PARCIAL | GET list web; WA fuzzy `listOpenOrdersForWhatsapp` | query ERP determinista **después** de resolver cliente |
| `getProductStock` / `getStockItem` | PARCIAL | GET stock; WA scan+rank | GET by id |
| `findProducts` | CONVERSACIONAL | lookups | no meter fuzzy en ERP |
| `getSale` / `getPurchase` | WEB ONLY | GET routes | exponer al Bot si hay capability |
| `getSupplierDebt` | FALTA en Bot | payables | no hasta módulo |

El Bot: EntityResolver (hint→id) **luego** Query Service (id→datos). No al revés.

---

## 11. Domain errors (dónde aportan primero)

Hoy: strings en español o `SUBSCRIPTION_INACTIVE` / `ORDER_WRITE_FAILED`.

```
{ code, message, field?, requiresUserDecision?, allowedActions?, metadata? }
```

Prioridad (el Bot pregunta mal si parsea el string):

1. Caja `INVALID_AMOUNT` / `MISSING_FIELD` concept  
2. Cobro saldo insuficiente  
3. Stock `INSUFFICIENT_STOCK` + opciones descontar completo / cancelar (ya hay flujo `stock_resolution`)  
4. `CLIENT_NOT_FOUND` / `AMBIGUOUS_PRODUCT` (listas)  
5. `INVALID_STATUS_TRANSITION`

No reescribir 200 `throw` de una vez. Empezar en domain writes extraídos.

`erp-integration.ts` ya mapea errores técnicos a copy genérica: el DomainError debe **pasar** code al handler conversacional, no tragárselo.

---

## 12. Operaciones compuestas

| Frase | Hoy | Tx / batch | Riesgo | Forma correcta |
|---|---|---|---|---|
| Pedido + ya pagó | WA: un batch pedido+caja; web: create luego seña | WA batch; web secuencial | web: pedido sin caja | `createOrder` con collection atómica (batch/tx) |
| Entregado + cobrá todo | status (entrega completa ya cobra resto) **o** status + segundo `execute` cobro | secuencial | doble cobro si ambos caminos | un Command: status entregado completa **o** collection explícita, no los dos |
| Compra + pago | web persistPurchase caja; WA skipCash | batch payables; compra caja a veces `.add` | WA queda compra sin egreso (docu) | capability `purchase.paysCash` |
| Pedido + query saldo después | plan `operations[]` | query no escribe | ok | ejecutar writes luego query |

Idempotencia webhook ≠ idempotencia de negocio (ver §18).

Rollback: cobro venta intenta borrar movimiento si falla update. Pedido web no revierte create si falla seña. Entrega: stock puede quedar consumido si falla `createSaleFromOrder`.

---

## 13. Genericidad (Rilo intacto)

| Cosa | Clasificación |
|---|---|
| Cliente, movimiento caja, ítem con qty/precio | CORE UNIVERSAL |
| Pedido con entrega, estados, reserva | MÓDULO `pedidos` |
| Caja + cobros | MÓDULO `caja` |
| Stock físico / compras / ventas mostrador | hoy **core alwaysOn**; deberían poder ser MÓDULO o core-minimo |
| Payables, colaboradores, reports, price_catalog, economics, fotos | MÓDULO ya |
| Ámbitos negocio/personal, extras, trigger stock, labels estado | CONFIGURACIÓN POR TENANT |
| Ranking “canguro XL rojo”, rubro indumentaria | CONFIG (matching) / defaults Rilo |
| Compra WA sin egreso | política de **canal**, no de Rilo-tenant |

Perfil Rilo = Completo: todos los módulos on, extras on, 2 ámbitos. Eso es el **default de producto Completo**, no código hardcodeado a un businessId (salvo `DEFAULT_BUSINESS_ID` en auth).

---

## 14. RILO Bot + Caja solamente

**Hoy no.** Tres bloqueos:

1. `core` alwaysOn incluye clientes, proveedores, stock, compras, ventas (`subscription-modules.ts`).  
2. El Bot no llama `requireBusinessModule`; `create_order` / `create_sale` se ejecutan si Gemini los emite.  
3. `createSaleFromWhatsapp` y create pedido **exigen cliente** incluso para un gasto de caja (caja manual no).

Para permitirlo **sin borrar Rilo**:

- Introducir un pack `bot_cash`: `caja=on`, `pedidos=off`, y un **core mínimo** (solo `negocios` + `movimientos_caja` + opcional `whatsapp_*`). Stock/ventas/compras no se crean ni se muestran.  
- O: dejar `core` en Firestore vacío y **recortar schema + execute**: si `pedidos` off, `create_order` → error de capability, no write.  
- Canal: `platformAccess.whatsappEnabled=true`, `erpWebEnabled=false` **ya existe**.  
- UI Gestión no carga si web off.  
- Caja manual **no necesita** productos. “anotá gasto 500” → `register_cash` only.

No hace falta nueva colección. Hace falta **no ejecutar** intents apagados y no exigir onboarding de stock.

---

## 15. Capabilities (reutilizar, no JSON obligatorio)

Ya hay dos ejes:

| Eje | Dónde | Qué controla |
|---|---|---|
| Canal | `platformAccess.erpWebEnabled` / `whatsappEnabled` (+ pausas) | ¿existe la UI? ¿entra el webhook? |
| Módulo | `resolveEffectiveModules` plan + overrides | ¿HTTP `requireBusinessModule`? |

**No hace falta** un tercer JSON si se extiende el existente:

```
module caja:
  enabled: boolean          ← ya
  channels: { web, whatsapp }  ← NUEVO opcional; default: web=enabled, whatsapp=whatsappEnabled && enabled
```

Mientras tanto: `whatsapp && !erpWeb && caja` = Bot+Caja **si** se filtran intents.  
Rilo Completo: todos enabled, ambos canales.

El LanguageInterpreter recibe **lista de intents permitidos** derivada de módulos+canal, no paths Firestore.

---

## 16. Módulo vs canal

Sí conviene separarlos. Ejemplo de venta:

- Caja WhatsApp only: módulo `caja` on, `erpWeb` off, `whatsapp` on.  
- Caja ambos: `caja` on, ambos canales on.  
- Pedidos web + Bot: módulo `pedidos` on, ambos canales.

`ROUTE_MODULE_MAP` ya liga UI `/cash` → `caja`. Falta el análogo `WHATSAPP_INTENT_MODULE_MAP`: `register_cash` → `caja`, `create_order` → `pedidos`, etc.

---

## 17. Permisos WhatsApp

Hecho: `whatsapp_users`: `phone`, `role` supervisor|admin|operador, `enabled`, `erpUserId` opcional.  
`tenant-resolver` copia `role` al contexto.

**No hecho:** `executeWhatsappCommand` / `erp-integration` **no** llaman `userHasPermission`. `feature-guard` solo mira canal/AI/suscripción. Cualquier teléfono `enabled` puede caja, cobro, pedido, costo, stock.

`erpUserId` no se usa para cargar `usuarios.permisos`.

Reutilizar sin romper:

1. Si `erpUserId` está, resolver `usuarios/{id}` y aplicar `ASSIGNABLE_PERMISSIONS` (`cash.access`, `orders.changeStatus`, `sales.create`, `records.delete`, …).  
2. Si no hay vínculo: mapa `whatsapp role → permission set` (supervisor = admin web; operador = subset: p.ej. caja+consulta, no delete).  
3. Deny por default en writes sensibles (`records.delete` no existe en Bot hoy: tampoco hay DELETE pedido por WA).

No hace falta un sistema de ACL nuevo. Hace falta **un gate** en `executeWhatsappCommand` antes del writer.

---

## 18. Paridad Web / WhatsApp (resultado persistido)

Definición: mismos campos de negocio; extra permitido: `origenWhatsapp`, `whatsappPhone`, `descripcion` de canal, `createdBy` futuro.

| Acción | Web persistido | WhatsApp persistido | ¿Equivalente? |
|---|---|---|---|
| Egreso $370 UTE, ámbito negocio | `tipo=egreso`, monto 370, concepto UTE, ambito negocio, origen manual, medio elegido | igual origenTipo; medio efectivo; descripcion WA; concepto puede ser “garrafa”/UTE si el LLM lo puso | **Casi** (medio/concepto/fecha) |
| Ingreso caja | igual espejo | igual | casi |
| Query caja | summary all-time + mes | scan neto / hoy | **cifra puede diferir** |
| Create pedido | saldo=total, pagos=[], seña aparte | saldo ya neteado, pagos+caja en batch | **mismo ledger si seña equivalente; distinto orden** |
| Cobro saldo | collect: pagos+caja sin flag WA | mismo collect | **sí** (caja sin origenWhatsapp) |
| Entrega | venta origen pedido + stock | mismos helpers | **sí** |
| Venta mostrador | stock+costo+ambito real | concepto, costo 0, ambito general | **NO** |
| Compra | stock+caja+costo | stock only | **NO en caja/costo** (diseño) |
| Stock descuento por estado | utils | utils | **sí** |

---

## 19. Metadata de origen

Hoy: `origenWhatsapp?: boolean`, `whatsappPhone?: string` en algunos docs; cobros automáticos **sin** eso; web usa `actividad` (`logActivityFromRequest`) que el Bot **no** escribe.

Propuesta compatible:

- Seguir escribiendo los flags actuales (no migrar docs).  
- En domain write: `actor: { channel: 'web'|'whatsapp', userId?, phone? }`.  
- Persistir si el doc ya tiene campos: mapear a `origenWhatsapp` / `whatsappPhone`.  
- Opcional futuro: `source: 'whatsapp'` sin borrar flags.  
- Reportes **ignoran** estos campos (tratar como operación normal).  
- Auditoría: listar `where origenWhatsapp==true` o actividad.

---

## 20. Reportes — excepciones

`buildBusinessReport` lee **`ventas` + `stock` + `clientes`**. No lee `movimientos_caja` ni `pedidos`.

| Operación WA | ¿Caja UI? | ¿Saldo cliente? | ¿Stock? | ¿Ganancia reportes? | ¿Ventas listado? |
|---|---|---|---|---|---|
| Egreso UTE | **sí** | no | no | **no** (no es venta) | no |
| Cobro | sí (ingreso) | sí | no | no directo | no |
| Pedido (sin entregar) | si hubo seña | sí | reserva/descuento según estado | **no** hasta que haya venta | no |
| Entrega | sí vía createSaleFromOrder | sí | sí | **sí** (venta origen pedido, costos del pedido) | sí |
| Venta WA mostrador | sí | sí | **no** | **sí pero distorsionada** (costoReal 0, ganancia=total) | sí |
| Compra WA | **no** caja | no | **sí** entrada | no | no |

---

## 21. Idempotencia

| Capa | Qué cubre | Qué no |
|---|---|---|
| `whatsapp_inbound_dedup/{messageId}` + mapa 30m | reintento Meta del **mismo** message id | SÍ de confirmación repetido a mano; segundo mensaje distinto |
| Allocate number tx | no duplica número | no impide dos pedidos |
| Writers ERP | ninguno usa idempotency key | doble SÍ = doble pedido/caja/cobro |

Dónde debe vivir: **webhook** (ya) + **command id** opcional en confirmación (`operationPlan.id` guardado; segundo SÍ no-op). No en Gemini.

---

## 22. Arquitectura objetivo

```
RILO Gestión UI  →  HTTP  →  Domain Command + actor(channel=web)
RILO Bot         →  SemanticCommand / Plan  →  EntityResolver  →  mismo Command + actor(channel=whatsapp)
                              ↓
                         ERP Domain (utils extraídos)
                              ↓
                         Firestore (mismos docs)
```

Una lógica. Dos adapters. Gemini fuera del dominio.

---

## 23. Contrato con Gemini

**Debe conocer:** intents habilitados del tenant; `cash` vs `payment`; enums de estado **del tenant**; ámbitos de caja (labels); si extras existen; missingFields.

**No debe conocer:** paths `negocios/…`; `stockReservado`; cómo se calcula saldo; `origenGrupo`; `applyEntregaCompletaPayment`; reportes.

Gemini interpreta. ERP valida y escribe.

---

## 24. Orden de refactor (etapas, test, rollback)

| Etapa | Extraer | Test / paridad | Riesgo | Rollback |
|---|---|---|---|---|
| 1 Caja manual | función de `cash.ts` POST; WA la llama | mismo doc salvo metadata; monto/concepto/ambito/origenTipo | BAJO–MEDIO | feature flag writer WA viejo |
| 2 Query caja | summary compartido | GET vs Bot misma cifra | BAJO | — |
| 3 execute(plan) | confirmación usa payloads del plan | tests conversación existentes | MEDIO | pendingPayload entities sigue ahí |
| 4 Collection Command | wrapper + DomainError | cobro web inalterado | BAJO | collect intacto |
| 5 Relocate status | movers exports orders.ts | tests stock_resolution WA | MEDIO | import path |
| 6 Create order | extraer POST | comparar seña+saldo+pagos web vs WA | ALTO | no cambiar POST hasta tests |
| 7 Sale | extraer o deshabilitar WA | no unificar a ciegas | ALTO | `create_sale` off en Bot |
| 8 Capabilities + permisos WA | intent map + erpUserId | tenant Rilo todo on | MEDIO | default allow como hoy |
| 9 Core mínimo Bot+Caja | recortar schema execute | no tocar Rilo | MEDIO | Completo default |

---

## 25. Tabla final obligatoria

Capacidad | Web actual | WhatsApp actual | Domain Service actual | Writer duplicado | Command | Query | ¿Configurable? | Riesgo | Refactor
---|---|---|---|---|---|---|---|---|---
Caja ingreso | POST cash inline | executeRegisterCashMovement | no | **sí** | existe (WA) | — | módulo caja + canal | MEDIO | extraer write
Caja egreso | igual | igual | no | **sí** | igual | — | igual | MEDIO | igual
Query caja | GET summary | scan | no | query sí | — | **falta** compartir | — | BAJO | extraer summary
Pedido create | POST orders | createOrderFromWhatsapp | no | **sí** | falta | — | módulo pedidos | ALTO | extraer createOrder
Pedido update | PATCH | extras only | no | parcial | falta | — | pedidos | MEDIO | PATCH domain
Estado | PATCH + helpers | updateOrderStatusFromWhatsapp | **helpers sí** | orquesta | falta wrapper | preview stock | pedidos+config estados | ALTO lógica / BAJO relocate | wrapper
Cobro | collectClientBalance | mismo | **sí** | no | falta wrapper | deudas | caja | MEDIO | Command
Saldo | cuenta GET | queryBalance | getClientPendingDebts | no | — | **existe** | — | BAJO | export query
Stock | utils + rutas | mismos utils vía status | **sí** | no máquina | preparación no en Bot | GET parcial | core hoy | no reescribir | query by id
Venta | POST sales | createSaleFromWhatsapp | no | **sí** | falta | GET web | core hoy | ALTO | unificar o off
Compra | persistPurchase | mismo skip* | **sí** | flags | parcial | GET web | core hoy | MEDIO | capability cash
Costo extra | PATCH líneas | addOrderCostFromWhatsapp | no | **sí** | falta | — | config extras | MEDIO | PATCH
Costo producto | PUT stock | updateProductCost | no | **sí** (fino) | falta | GET | economics | BAJO | updateProductCost

---

## Respuestas A–L

**A. Extraer sin cambiar Rilo**  
Write de caja del panel, GET summary, relocate de helpers de estado/stock (imports), wrapper de `collectClientBalance`, `execute(plan)`. Tenant Completo sigue igual.

**B. Writers WA que deben desaparecer como implementación**  
`.add` de caja, `createOrderFromWhatsapp` (cuerpo), `createSaleFromWhatsapp` (cuerpo), scan de caja. Quedan adapters. Cobro y compra ya son adapters.

**C. Domain services mínimos**  
Cash (nuevo), Collection (existente), OrderLifecycle (relocate + más tarde create), Purchase (existente). No StockService nuevo. Sale tarde.

**D. Commands mínimos**  
`RegisterCashMovement` (ya), `RegisterCollection`, `ChangeOrderStatus`, luego `CreateOrder`. Sale/Purchase cuando toque.

**E. Queries mínimas**  
`getCashSummary`, `getClientPendingDebts`, `getOrder`, `getStockItem`. Fuzzy se queda en EntityResolver.

**F. Reglas duplicadas**  
Caja manual; seña al crear pedido; concepto obligatorio vs default; query caja; venta mostrador; extras attach; alta cliente/producto mínima.

**G. Específico Rilo → config**  
Extras, dos cajas, estados y trigger stock, ranking de catálogo. No hardcodear indumentaria en el dominio financiero.

**H. Bot + Caja**  
Canal whatsapp-only ya. Falta: filtrar intents, core mínimo o `pedidos` off + no execute, no onboarding de stock. Caja manual no requiere productos.

**I. Permisos WA**  
Usar `erpUserId` → `usuarios.permisos`; fallback mapa role WhatsApp → mismo set que staff/admin. Gate en `executeWhatsappCommand`. Hoy: teléfono enabled = superusuario operativo.

**J. Paridad**  
Mismo domain write; comparar campos de negocio; permitir metadata de canal. Tests A/B por operación. Venta/compra hoy **no** paridad.

**K. Orden**  
Caja write → query caja → execute(plan) → collection command → relocate status → create order → venta/capabilities/permisos.

**L. No tocar**  
LanguageInterpreter / regex / frases; máquina `order-stock-reservations`; `collectClientBalance` interno; schema Firestore masivo; UI por estética; tenant Rilo (default Completo); Gemini dentro del ERP.

---

*Parte II cierra la auditoría. Ningún código fue modificado.*

