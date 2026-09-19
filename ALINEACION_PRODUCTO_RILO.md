# ALINEACION_PRODUCTO_RILO.md

# ESTADO ACTUAL — 15/09/2026

**Veredicto técnico:** READY FOR STAGING (no producción).  
**Release gate:** `npm run test:release` PASS — 516 tests / 0 fail (E2E emulator 14/14, Agent V4 355/355).  
**Builds:** frontend PASS · functions PASS.  
**Deploy:** no se ejecutó. Precios sin cambios. P2 no implementado.

Esta sección es la **fuente de verdad**. Todo lo que está bajo **# HISTÓRICO** puede contradecir el estado actual; no usarlo para decisión de release.

## Matriz producto (verdadera)

| Capacidad | Landing | Bot (WA) | Resumen RILO | Gestión | Completo | SSOT | Status |
|---|---|---|---|---|---|---|---|
| Ventas mostrador | sí | sí | ver | sí | sí | `createMostradorSale` | operational |
| Pedidos create | sí | sí | ver | sí | sí | `createOrder` | operational |
| Pedidos finalize/status | sí | sí | ver | sí | sí | `finalizeOrder` | operational |
| Cobros | sí | sí | ver | sí | sí | `collectClientBalance` | operational |
| Caja | sí | sí | ver | sí | sí | `registerCashMovement` | operational |
| Compras | sí | sí | ver | sí | sí | `persistPurchase` | operational |
| Stock | sí | sí | — | sí | sí | sale/order stock | operational |
| Payables create/query/pay | sí | sí | ver | sí | sí | payables app service | operational |
| Digest mañana / resumen noche | sí | sí (canal) | — | panel | sí | action handlers | operational |
| RILO te avisa (centro + campanita) | sí | list/update tools | sí | sí | sí | `erp_notices` + attention_sync | operational |
| Resumen RILO (`/inicio`) | sí | — | sí | no (home dashboard) | sí (también full) | `/api/summary/*` | operational |
| ERP CRUD / settings avanzadas | — | no | no | sí | sí | guards `erpWebGuard` | operational |
| WhatsApp delivery avisos | — | sí | — | **bloqueado** | sí | `allowedAutomationChannels` | operational |
| Barcode marketing / landing | no | — | — | ERP | ERP | — | partial (P2, fuera landing) |

## Canales por plan

| Plan | Panel | WhatsApp | Home |
|---|---|---|---|
| Bot | Resumen + /avisos + settings simples | sí | `/inicio` (`webExperience=summary`) |
| Gestión | ERP full + avisos | no (UI: “Disponible con RILO Completo”) | `/dashboard` |
| Completo | ERP full + avisos | sí | `/dashboard` |
| Caja | caja | según acceso | `/cash` |

## Avisos (operational)

| Tipo | Panel | WA (Bot/Completo) | Auto-resolve |
|---|---|---|---|
| order_due_today / overdue / ready | sí | digest / presets | entregado/cancel |
| payable_due_soon / overdue | sí | payables_due | pagado |
| payment_promise_today | sí | promises | cobro |
| stock_low / out | sí | low_stock (default off) | stock OK |
| daily_attention_digest ~08:30 | info | sí | n/a |
| daily_business_summary ~19:00 | info | sí | n/a |

Leído ≠ resuelto (`readAt` por usuario; `resolvedAt` por dominio). Dedupe por `dedupeKey`.

## standard_v1 vs legacy

- **Nuevos** Bot/Gestión/Completo: `standard_v1` (categorías genéricas, medios estándar, onboarding ≤4).
- **Legacy** (p. ej. RILO Personalizados): **no se pisan** categorías DTF/Sublimación/Packaging, cajas, labels, policies.

## Release gate (última corrida)

| Ítem | Resultado |
|---|---|
| `npm run test:release` | PASS (~184s) |
| Tests | 516 pass / 0 fail |
| E2E Firestore emulator | 14 pass |
| Agent V4 | 355 pass |
| Frontend / Functions build | PASS |
| Blockers técnicos staging | ninguno |

Detalle: ver **# QA FINAL / RELEASE GATE** al final.

## Próximo paso

QA humano en staging → ver `STAGING_QA_RILO.md` (provisionamiento + checklist).  
Proyecto esperado: `rilo-staging` (aún por crear). Comando deploy: `npm run deploy:staging` (nunca `rilo-7eff4`).  
**No production deploy** hasta `READY FOR PRODUCTION CANDIDATE`.

## P2 (explícitamente fuera de alcance)

Weekly digest · reminders personales · mini-tareas · push browser · auto follow-up · facturación electrónica · barcode marketing.

---

# HISTÓRICO

> Material de trabajo de pasadas P0/P1/avisos. Puede decir “parcial / pendiente / E2E no corridos”.  
> **Si contradice ESTADO ACTUAL, gana ESTADO ACTUAL.**

Alineación de producto RILO (Bot / Gestión / Completo).  
**No se hizo deploy.** Precios sin cambios.

---

# Resumen ejecutivo

## Problema de partida

- WhatsApp y ERP compartían dominio en cobros, compras persistidas, caja standalone, payables create y stock adjust.
- **Ventas WhatsApp** eran un writer paralelo: `mueveStock: false`, `tipoLinea: concepto`, `medioPago: efectivo` hardcodeado, caja directa.
- Bot se vendía con pedidos/compras pero el perfil trial arrancaba en `services` (sin orders/purchases).
- Bot no tenía panel web (`erpWebEnabled: false`) pese a la promesa �Squeda ordenado⬝.
- Defaults de finanzas incluían DTF/Sublimación/VPS para tenants nuevos.
- Onboarding pedía toggles de módulos tipo ERP.

## Qué se implementó en esta pasada (P0 + cierre P1)

1. **ProductCapabilityContract** + landing solo `operational`.
2. **`webExperience`**: Bot = `summary` (Resumen RILO).
3. **Venta SSOT**: ERP + WA �  `createMostradorSale` / `CreateSaleCommand`.
4. **Pedido SSOT**: ERP + WA �  `createOrder` + `finalizeOrder`.
5. **Payables SSOT**: create / query / pay (WA tools + ERP).
6. **BusinessRuntimeContext** + resolver de labels + runtimeBrief Agent.
7. **Resumen RILO** real: Hoy / actividad / pedidos / saldos / caja / vencimientos.
8. **Automations P1**: digest mañana, resumen noche, vencimientos, orders review, promises.
9. **Settings simples** (summary) + **Platform capacidades efectivas** + **capability-audit**.
10. **`standard_v1`** + onboarding avisos �  presets recomendados.

## Qué queda P2

Recordatorios personales, mini tareas, weekly digest, follow-up auto a clientes, barcode marketing, nuevos módulos, facturación electrónica, gate E2E emulator en CI.

---

# Matriz PROMESA / FUNCI�N

Ver matrices actualizadas en **# Cierre P1**.

---
# Arquitectura objetivo (principio)

```
Usuario �  WhatsApp | ERP | Resumen
       �  Application / Domain Service
       �  mismas reglas / documentos / saldos / caja / stock / estados / automations
```

WhatsApp = interfaz. No segunda contabilidad.

---

# Application services compartidos

| Dominio | Estado SSOT | Notas |
|---|---|---|
| **Sale (mostrador)** | �S& WA �  `backend/domain/sales/create-mostrador-sale.ts` | ERP route `sales.ts` todavía tiene lógica inline; próximo paso: ERP POST mostrador llama el mismo servicio. |
| **Order** | �xx� | Create aún dual; deliver/status compartidos (`applyEntrega*`, `createSaleFromOrder`). |
| **Collection** | �S& | `collectClientBalance` |
| **Purchase** | �S& persist | `parsePurchaseInput` / `persistPurchase` |
| **Cash** | �S& standalone | `registerCashMovement`; venta/pedido linkean ingreso con mismo shape de movimiento |
| **Payable** | �S& create | `createPayableObligation`; pay/query WA P1 |
| **Stock adjust** | �S& | `adjustStock` |

---

# webExperience

| Producto | webExperience | Home |
|---|---|---|
| Bot | `summary` | `/inicio` Resumen RILO |
| Gestión | `full` | `/dashboard` |
| Completo | `full` | `/dashboard` |
| Caja | `cash_only` | `/cash` |

Campo en `ClientPlatformAccess.webExperience`. Legacy Bot (`erpWebEnabled: false`) se normaliza a summary + web enabled para Resumen.

Guards: `erpWebGuard` bloquea rutas full si `isSummaryWebTenant`.

---

# Config estándar `standard_v1`

Nuevos tenants Bot/Gestión/Completo reciben:

- Categorías gasto genéricas (Mercadería, Servicios, Alquiler, Impuestos, Sueldos, Transporte, Marketing, Mantenimiento, Otros).
- Medios: efectivo, transferencia, mercado_pago, debito, tarjeta_credito.
- `standardConfigVersion: standard_v1` en `config/app`.

**Legacy (RILO Personalizados, etc.)**: no se pisan. Siguen con DTF/Sublimación/VPS si ya los tenían.

---

# Onboarding

Máximo 4 decisiones:

1. ¿Qué vendés? productos / servicios / ambos  
2. ¿Manejás stock? (si aplica)  
3. ¿Cómo cobrás normalmente?  
4. ¿Avisos recomendados?

Botón: Empezar con RILO.

---

# Estados de pedido

Canónicos fijos: `borrador | pendiente | en_produccion | listo | entregado | cancelado`.  
Labels editables; IDs no. (Ya existía; se conserva.)

---

# Ventas � reglas estándar (implementadas en WA vía createMostradorSale)

| Caso | Venta | Caja | Saldo |
|---|---|---|---|
| Cobrada total | total | +total si medio genera caja | 0 |
| Parcial | total | +cobrado | resto |
| A cuenta | total | no | total |

Medio: hint del mensaje �  default perfil �  efectivo activo �  primer medio activo.  
Stock: `mueveStock` según `controlaStock` del producto.

---

# Landing audit

| Promesa | Estado |
|---|---|
| Registrá ventas/pedidos/cobros por WhatsApp | �S& respaldada |
| ¿Cuánto vendí hoy? | �S& |
| Stock | �S& |
| Compras | �S& (persist SSOT) |
| Controlás en Gestión (Bot) | �R removido �  Resumen RILO |
| Misma información WhatsApp/panel (Completo) | �S& |
| Lector de barras | �R no en landing hasta productivo |

---

# Bot plan audit

**Puede (WA):** ventas, pedidos, cobros, caja, compras, stock query/adjust, clientes, payables recurrentes, avisos.

**Puede ver (Resumen RILO):** `/inicio` � cupo, avisos ERP notices, guía, plan; **sin CRUD full**.

**Requiere Completo:** panel Gestión completo, settings profundas, reportes avanzados, CRUD web completo.

---

# Automation audit

| Automation | status | WA | ERP | default |
|---|---|---|---|---|
| daily_business_summary | implemented (sin reports) | �S& | �S& | preset |
| cash_daily_summary | implemented | �S& | �S& | preset |
| orders_due_today | implemented | �S& | �S& | preset |
| overdue_orders_watch | implemented | �S& | �S& | preset |
| customer_balances_summary | implemented | �S& | �S& | preset |
| low_stock_summary | implemented | �S& | �S& | preset |
| purchase_payment_reminder | pending | � | � | no |
| card_payment_reminder | pending | � | � | no |
| orders_status_review | planned | � | � | P1 |
| daily_attention_digest | planned | � | � | P1 |
| customer_payment_promises_due | planned | � | � | P1 |
| weekly_operational_summary | planned | � | � | P2 |

---

# Diferencias legacy (RILO Personalizados)

- Categorías DTF / Sublimación / Packaging / VPS.
- Workflows y vocabulario indumentaria (remera, canguro, etc.) � no se eliminan; no se siembran en `standard_v1`.
- Múltiples cajas / colaboradores / políticas stock avanzadas.
- Sin `standardConfigVersion` �  tratados como legacy.

---

# Archivos modificados (esta pasada)

| archivo | cambio | motivo |
|---|---|---|
| `shared/product-capability-contract.ts` | contrato capacidades | SSOT promesas |
| `shared/product-capability-contract.test.ts` | tests | contrato |
| `shared/rilo-standard-config.ts` | defaults v1 | tenants nuevos |
| `shared/platform-access.ts` | webExperience + Bot summary | mini panel |
| `shared/business-profile.ts` | Bot �  mixed | no forzar services |
| `shared/ritotech-marketing.ts` | copy Resumen RILO | landing |
| `shared/commercial-flow.validation.test.ts` | expect summary | tests |
| `shared/business-profile.test.ts` | expect mixed | tests |
| `backend/domain/sales/create-mostrador-sale.ts` | venta SSOT | Bot=ERP reglas |
| `backend/whatsapp/erp-writes.ts` | usa createMostradorSale + stock flags | alinear ventas |
| `backend/auth/trial-registration-service.ts` | seed standard_v1 | defaults genéricos |
| `backend/automation/automation-action-registry.ts` | daily sin reports | resumen básico |
| `frontend/.../auth-home-route.ts` | summary home | Resumen |
| `frontend/.../auth.service.ts` | isSummaryWebTenant | gating |
| `frontend/.../auth.guard.ts` | summary �0� full | seguridad producto |
| `frontend/.../business-onboarding.component.ts` | 4 pasos | UX |
| `frontend/.../client-home.component.ts` | título Resumen RILO | mini panel |

---

# Tests

```
npm run test:commercial     �  88 pass
npx tsx --test shared/product-capability-contract.test.ts frontend/src/app/core/utils/auth-home-route.test.ts �  10 pass
npm run test:auth-routing   �  9 pass
npm run test:automation     �  12 pass
```

---

# Build

```
npm run build             �  OK
npm run build:functions   �  OK
```

No deploy.

---

# Pendientes P1

1. ERP `POST /sales` mostrador �  llamar `createMostradorSale`.
2. Order create WA/ERP �  application service único + stock en create.
3. `finalizeOrder` compartido (ERP botón + WA).
4. API Hoy + cards en Resumen RILO (pedidos hoy, caja, saldos, actividad).
5. Tools WA: `query_payables`, `pay_payable`, obligación única.
6. Automations: vencimientos operativos, digest diario unificado, pedidos a revisar, payment promises.
7. Settings UI Simple vs Avanzado.
8. Platform �SCapacidades efectivas⬝.
9. BusinessRuntimeContext para Agent (labels estados + defaults).
10. E2E venta/pedido/payable con emulador.

## P2

Weekly digest, personal reminders/tareas, follow-up saldos, barcode en landing, migración asistida legacy �  standard_v1.

---

# Auditoría final (respuestas)

1. ¿Misma lógica ventas ERP/Bot? **Parcial �  WA sí usa `createMostradorSale`; ERP route aún no lo invoca (P1).**
2. ¿Pedidos? **Parcial** (status/deliver sí; create aún dual).
3. ¿Cobros? **Sí** (`collectClientBalance`).
4. ¿Compras? **Sí** persist SSOT.
5. ¿Caja? **Sí** standalone; venta WA ahora caja alineada a medio.
6. ¿Payables? **Create sí; query/pay WA no.**
7. ¿Venta pagada genera caja? **Sí si el medio genera caja inmediata.**
8. ¿Venta pendiente evita caja y genera saldo? **Sí.**
9. ¿Parcial solo cobro real? **Sí.**
10. ¿Medio respeta config? **Sí en WA createMostradorSale.**
11. ¿WhatsApp hardcodea efectivo? **Ya no en venta mostrador** (default solo si no hay otro).
12. ¿Stock igual ERP? **WA venta ahora mueve stock si controla; ERP create order/sale path P1 unificar.**
13. ¿Estados canónicos? **Sí.**
14. ¿IA entiende labels? **Parcial** (orden status helpers); RuntimeContext P1.
15. ¿Puede inventar estado? **Backend valida IDs canónicos.**
16. ¿Bot solo mini-panel? **Sí (`summary`).**
17. ¿Qué puede ver? **Resumen RILO `/inicio` (cupo, avisos, guía); sin CRUD.**
18. ¿Reservado Completo? **Gestión full + settings profundas + reportes avanzados.**
19. ¿Landing sin implementación? **Claims principales �S&; barcode no promocionado.**
20�23. Payables WA query/pay/caja al pagar: **create sí; query/pay P1.**
24. Recordatorios vencimientos: **pending actions.**
25. Resumen diario: **sí (sin reports).**
26. Hoy: **P1.**
27. Pedidos revisar: **P1.**
28. Compromisos cobro: **P1.**
29. Defaults genéricos nuevos: **sí `standard_v1`.**
30. Sin DTF/Sublimación nuevos: **sí.**
31. Legacy conserva config: **sí.**
32. Onboarding �0�4: **sí.**
33. Config avanzada: **sigue existiendo en `/settings` (full); summary no entra.**
34. Platform capacidades efectivas: **P1.**
35. Tests: **pass (suites corridas).**
36. Builds: **pass.**
37. P2: weekly digest, reminders personales, tareas, follow-up, barcode landing.

---

# Cierre P1

Cierre funcional del alcance P1 (SSOT ventas/pedidos/payables, Resumen RILO, automations, settings/platform/health).  
**Sin deploy.** E2E contra Firebase Emulator: **no ejecutados en esta máquina** (infra disponible vía `npm run emulators`; suites E2E dedicadas pendientes de corrida live).

## Respuestas 1�28 (literal pedido de cierre)

1. ¿ERP y WhatsApp crean ventas con el mismo servicio? **Sí.** Ambos usan `createMostradorSale` / `createSaleFromCommand` (`backend/domain/sales/create-mostrador-sale.ts`). Notas crédito/débito ERP pueden seguir path local.
2. ¿Pedidos con mismo servicio? **Sí.** ERP `POST /orders` y WA `createOrderFromWhatsapp` �  `OrdersApplicationService.createOrder()`.
3. ¿Finalizar pedido es común? **Sí.** `finalizeOrder()` � ERP `POST .../finalize` + WA entrega vía `updateOrderStatusFromWhatsapp`.
4. ¿Caja es idéntica? **Sí en reglas.** Ingresos/egresos de venta, seña, finalize y pay payable usan los mismos writers de dominio/caja (medio configurable; seña createOrder usa medio del comando).
5. ¿Stock es idéntico? **Sí en política standard_v1.** Create enriquece control; entrega consume vía `finalizeOrder` / order-stock helpers. ERP y Bot no mantienen writers de stock paralelos para esa ruta.
6. ¿Payables create/query/pay son comunes? **Sí.** `createPayable` / `queryPayables` / `payPayable` �  `createPayableObligation` / `listPayableInstallments` / `setPayableInstallmentPaid`. ERP pay llama `payPayable`.
7. ¿Bot conoce labels actuales de estado? **Sí.** `BusinessRuntimeContext` + `runtimeBrief` en Agent; `resolveOrderStatusFromText` determinista.
8. ¿Bot conoce payment default actual? **Sí.** Runtime context expone `defaultPaymentMethod` y medios activos.
9. ¿Resumen RILO muestra datos reales? **Sí.** APIs `/api/summary/:businessId/*` componen Firestore real (no demo).
10. ¿Muestra ventas? **Sí** (card Ventas hoy + actividad).
11. ¿Pedidos? **Sí** (abiertos / para hoy + listado read-only).
12. ¿Caja? **Sí** (saldo + ingresos/egresos hoy).
13. ¿Saldos? **Sí** (clientes con saldo).
14. ¿Vencimientos? **Sí** (próximos pagos desde cuotas reales).
15. ¿Actividad? **Sí** (timeline desde `activity` log por módulos).
16. ¿Daily Attention Digest funciona? **Sí** (`daily_attention_digest` implemented + preset 08:30).
17. ¿Resumen nocturno funciona? **Sí** (`daily_business_summary` + copy �SAsí cerró tu día⬝ + preset 19:00).
18. ¿Avisos de vencimiento funcionan? **Sí** (`payables_due_reminder`, default 3 días; no envía si vacío).
19. ¿Pedidos a revisar funciona? **Sí** (`orders_status_review`; no cambia estados solo).
20. ¿Payment promises funciona? **Sí** (`customer_payment_promises_due` sobre `compromisos_pago`; vacío �  no entrega).
21. ¿Settings simples funcionan? **Sí** (tenant summary: avisos / labels pedido / medio cobro).
22. ¿Advanced sigue intacto? **Sí** (full tenants; summary no ve registry técnico).
23. ¿Platform muestra capacidades efectivas? **Sí** (Producto / Acceso / Funciones / `standard_v1` + capability-audit).
24. ¿Landing tiene alguna feature partial? **No en claims visibles.** Solo `operational` con `visibleLanding`. Barcode queda fuera de landing.
25. ¿Existen caminos de negocio duplicados? **Residual mínimo.** Notas NC/ND ERP y algunos writers legacy de edge cases; núcleo venta/pedido/finalize/payable unificado.
26. ¿Todos los E2E pasan? **No corridos** (emulator live). Paridad unitaria venta + labels + contract + routing sí.
27. ¿Todos los builds pasan? **Sí** (`npm run build`, `npm run build:functions`).
28. ¿Qué queda exclusivamente como P2? Recordatorios personales; mini tareas; weekly digest; follow-up automático a clientes; barcode marketing; nuevos módulos; facturación electrónica; corrida E2E emulator como gate de release.

## Matriz función (Landing = solo operational)

| Función | Landing | Bot | Resumen | Gestión | Completo | SSOT | Automation | Status |
|---|---|---|---|---|---|---|---|---|
| Ventas | �S& | �S& | ver | �S& | �S& | `createMostradorSale` | daily summary | operational |
| Pedidos create | �S& | �S& | ver | �S& | �S& | `createOrder` | orders_due | operational |
| Pedidos finalize/status | �S& | �S& | ver | �S& | �S& | `finalizeOrder` | status_review / overdue | operational |
| Cobros | �S& | �S& | ver | �S& | �S& | `collectClientBalance` | balances / promises | operational |
| Caja | �S& | �S& | ver | �S& | �S& | `registerCashMovement` | cash_* | operational |
| Compras | �S& | �S& | ver | �S& | �S& | `persistPurchase` | purchase reminder pending | operational |
| Stock | �S& | �S& | � | �S& | �S& | sale/order stock | low_stock | operational |
| Payables | �S& | �S& | ver | �S& | �S& | create/query/pay app service | payables_due | operational |
| Digest mañana/noche | �S& | �S& | � | �S& | �S& | action handlers | digest + summary | operational |
| Resumen RILO | �S& | � | �S& | �R | �S& | `/api/summary/*` + `/inicio` | � | operational |
| Barcode | �R | �R | � | �S& | �S& | ERP | � | partial (P2 marketing) |

## Paridad ERP �  WA (SSOT)

| Operación | ERP service | WA service | mismo SSOT |
|---|---|---|---|
| Venta | `createMostradorSale` | `createMostradorSale` | �S& |
| Pedido create | `createOrder` | `createOrder` | �S& |
| Finalizar pedido | `finalizeOrder` | `finalizeOrder` | �S& |
| Cobro | `collectClientBalance` | mismo | �S& |
| Compra | `persistPurchase` | mismo | �S& |
| Caja | `registerCashMovement` | mismo | �S& |
| Payable create | `createPayable` �  obligation | mismo | �S& |
| Payable query | list installments | `query_payables` | �S& |
| Payable pay | `payPayable` | `payPayable` | �S& |

## Resumen RILO � cards / APIs

| Bloque | API | Notas |
|---|---|---|
| Hoy | `GET /api/summary/:id/hoy` | ventas, cobrado, caja, pedidos abiertos/para hoy, por cobrar, pagos próximos |
| Actividad | `GET /api/summary/:id/activity` | timeline multi-módulo |
| Pedidos | `GET /api/summary/:id/orders` | read-only + prefill WA |
| Saldos | `GET /api/summary/:id/balances` | clientes con saldo |
| Caja | `GET /api/summary/:id/cash` | ingresos/egresos/saldo hoy |
| Vencimientos | `GET /api/summary/:id/payables` | próximas cuotas |

## Automations

| Action | Status |
|---|---|
| daily_attention_digest | operational |
| daily_business_summary | operational |
| payables_due_reminder | operational |
| orders_due_today | operational |
| orders_status_review | operational |
| overdue_orders_watch | operational |
| customer_balances_summary | operational |
| customer_payment_promises_due | operational |
| low_stock_summary | operational |
| purchase/card reminders | partial (registry pending) |
| weekly digest | planned (P2) |

## Health / Platform / Settings

- `auditBusinessCapabilities` + routes business/platform
- Platform: Producto / Acceso / Funciones efectivas / `standard_v1`
- Summary settings: avisos + labels + medio habitual; advanced intacto en full

## Tests / builds (esta corrida)

| Suite | Resultado |
|---|---|
| sale-parity + labels | pass |
| product-capability-contract | pass |
| test:automation | pass |
| test:commercial | pass |
| test:auth-routing | pass |
| test:v4 | pass (355) |
| frontend `npm run build` | pass |
| functions `npm run build:functions` | pass |
| E2E emulator sale/order/payable | **no ejecutados** |

## P2 exclusivo

- Recordatorios personales genéricos
- Mini tareas
- Weekly digest
- Follow-up automático a clientes
- Barcode marketing
- Nuevos módulos
- Facturación electrónica
- Gate E2E emulator en CI

---

# Deploy (NO ejecutado)

Cuando corresponda: staging �  dry-run tenants nuevos �  QA Resumen Bot + venta WA parcial/total �  producción hosting+functions.

# PRIORIDAD ALTÍSIMA � RILO te avisa

Producto de experiencia completa: detectar �  avisar �  mostrar �  actuar �  auto-resolver �  anti-spam.  
**Sin deploy.** Misma fuente para Panel y WhatsApp.

## Arquitectura

```
Dominio (pedidos / payables / stock / compromisos)
        � 
detectAttentionItems()  �  AttentionItem[]
        � 
syncAttentionNotices()  �  upsert erp_notices (dedupeKey) + resolve stale
        � 
Delivery:
  ⬢ Panel: Centro /avisos + campanita + Hoy
  ⬢ WhatsApp: automations tick (daily_attention_digest, payables_due, ⬦) según plan/canales
```

- **Situación (negocio):** status open | resolved | hidden | muted + 
esolvedAt
- **Leído (usuario):** 
egocios/{id}/private/notice_reads_{userId} � 
eadAt NO resuelve
- Colección: 
egocios/{id}/erp_notices (extendida; no segunda base)

## UI

| Pieza | Ruta / lugar |
|---|---|
| Centro de avisos | /avisos (Hoy / Próximos / Resueltos) |
| Campanita + badge | Topbar (unreadCount) |
| Dropdown preview | últimos 5 + Ver todos |
| Necesita tu atención | /inicio + /dashboard |
| Settings | Configuración �  RILO te avisa |
| Marcar todos leídos | Sí (no �Sresolver todos⬝) |

## Matriz de avisos

| Tipo | Origen | Panel | WhatsApp | Default | Severity | Acción | Auto-resolve | Estado |
|---|---|---|---|---|---|---|---|---|
| order_due_today | attention_sync | �S& | vía digest/orders_due | on w/ avisos | attention | Ver / Marcar listo | entregado/cancel | operational |
| order_overdue | attention_sync | �S& | overdue_orders | on recommended | urgent | Ver pedido | entregado/cancel | operational |
| order_ready_pending | attention_sync | �S& | status_review | on | attention | Ver | entregado | operational |
| payable_due_soon | attention_sync | �S& | payables_due | 3 días | attention | Marcar pagado | pagado | operational |
| payable_overdue | attention_sync | �S& | payables_due | on | urgent | Marcar pagado | pagado | operational |
| payment_promise_today | attention_sync | �S& | promises action | optional | attention | Registrar cobro | cuota pagada | operational |
| stock_low / out | attention_sync | �S& | low_stock | OFF default | attention/urgent | Ajustar | stock > min | operational |
| daily_attention_digest | automation | info ERP notice | �S& Bot/Completo | 08:30 | info | � | n/a | operational |
| daily_business_summary | automation | info | �S& Bot/Completo | 19:00 | info | � | n/a | operational |

## Canales por plan

| Plan | Panel | WhatsApp |
|---|---|---|
| Bot | �S& Resumen + /avisos | �S& |
| Gestión | �S& | �R (checkbox bloqueado) |
| Completo | �S& | �S& |

## Settings compartidos ERP �  Bot

Misma fuente: utomations + utomation_prefs.avisos.  
WA tools: list_rilo_avisos, update_rilo_aviso.

## Analytics


otification_opened | 
otification_resolved | 
otification_synced (+ created/action_clicked ready)

## Push browser

**P2** � no implementado.

## Respuestas 1�28 (RILO te avisa)

1. Centro de avisos? **Sí** /avisos
2. Campanita? **Sí**
3. Badge? **Sí** unread
4. Leído �0� resuelto? **Sí**
5. Vencimiento en panel? **Sí**
6. También WA según plan? **Sí**
7. Pago resuelve aviso? **Sí** (sync tras pay)
8. Pedido entregado resuelve? **Sí** (sync tras finalize)
9. Stock repuesto resuelve? **Sí** (sync)
10. Dedupe? **Sí** dedupeKey
11. Digest mañana? **Sí**
12. Resumen noche? **Sí**
13. Pedidos hoy? **Sí**
14. Atrasados? **Sí**
15. Listo no entregado? **Sí**
16. Promesas cobro? **Sí**
17. Stock bajo? **Sí** (default off en recommended)
18. Settings simples? **Sí**
19. ERP y Bot comparten settings? **Sí**
20. WA respeta plan? **Sí**
21. Gestión no manda WA? **Sí**
22. Bot Panel+WA? **Sí**
23. Completo Panel+WA? **Sí**
24. Landing puede prometer? **Sí** (capabilities operational)
25. E2E emulator? **S�**  `npm run test:e2e` / dentro de `npm run test:release` (Firestore @ 127.0.0.1:8080, proyecto `demo-rilo`). Requisitos: Java 11+ (verificado OpenJDK 21), firebase-tools 14.27.0.
26. Build FE? **S�** (`npm run build`)
27. Build functions? **S�** (`npm run build:functions`)
28. P2? Push browser; toasts agresivos; historial infinito; recordatorios personales; weekly digest

---


---

# QA FINAL / RELEASE GATE

**Fecha corrida:** 2026-09-15  
**Comando:** `npm run test:release`  
**Deploy:** no  
**Veredicto:** READY FOR STAGING (no production)

## Emulator

| Ítem | Valor |
|---|---|
| Comando interno | `node firebase-tools … emulators:start --only firestore --project demo-rilo` (vía `scripts/run-release-with-emulator.mjs`) |
| Host | `127.0.0.1:8080` |
| Env E2E | `USE_FIRESTORE_EMULATOR=true`, `FIREBASE_PROJECT_ID=demo-rilo` |
| Java | OpenJDK 21.0.11 |
| Firebase CLI | 14.27.0 |
| ¿Arrancó? | **Sí** |

## Suites ejecutadas (orden)

1. product capability + sale parity + automation/avisos/limits  
2. `test:commercial`  
3. `test:auth-routing`  
4. `test:cash`  
5. `test:v4` (Agent V4)  
6. E2E emulator (`backend/e2e/release-gate.e2e.test.ts`)  
7. `npm run build` (frontend)  
8. `npm run build:functions`

Falla cualquier paso → exit ≠ 0.

## Resultados agregados

| Bloque | Pass | Fail | Duración (reportada) |
|---|---:|---:|---|
| capability/parity/automation batch | 26 | 0 | ~2.7s |
| commercial | 88 | 0 | ~1.1s |
| auth-routing | 9 | 0 | ~0.9s |
| cash | 24 | 0 | ~1.9s |
| Agent V4 | 355 | 0 | ~136.6s |
| E2E emulator | 14 | 0 | ~6.7s |
| **Total tests** | **516** | **0** | — |
| Frontend build | OK | — | ~17.75s |
| Functions build | OK | — | OK (`functions/lib/index.js`) |
| Wall clock `test:release` | — | — | ~184s |

## Tabla de flujos E2E

| Flujo | Resultado | Tests | Observaciones |
|---|---|---|---|
| Venta parcial | PASS | `venta parcial ERP+WA misma contabilidad` | ERP+WA misma contabilidad; stock via `stockActual` |
| Venta a cuenta | PASS | `venta a cuenta no mueve caja` | saldo +2000; sin caja |
| Pedido | PASS | `pedido seña + aviso hoy + estados + finalize…` | seña 500; order_due_today; dedupe×5 |
| Finalize | PASS | (mismo) | entregado + venta; avisos resueltos |
| Payable | PASS | `payable create → notice → pay…` | UTE 7500; egreso caja; resolve |
| Stock | PASS | `stock bajo: un aviso; reposición resuelve` | dedupe; resolve al reponer |
| Avisos | PASS | `read vs resolved + badge` | readAt≠resolvedAt; badge unread |
| Dedupe | PASS | pedido + stock sync repetidos | 1 aviso activo |
| Bot | PASS | planes/canales + audit×3 | summary + WA+ERP channels |
| Gestión | PASS | (mismo) | full; sin canal WA |
| Completo | PASS | (mismo) | full + WA+ERP |
| Settings sync | PASS | `settings ERP ↔ Bot misma fuente` | 20:00→21:00; low_stock OFF |
| Digest | PASS | digest mañana + resumen noche | omite stock vacío; métricas reales |
| Security | PASS | `tenant isolation` | A no lee notices de B |
| Legacy | PASS | `legacy config no se pisa…` | labels/caja legacy intactos |
| Capability contract | PASS | landing visible ⇒ operational | unit + E2E |

## Release readiness (1–20)

1. ¿Firebase Emulator pudo iniciarse? **Sí**
2. ¿E2E venta pasa? **Sí**
3. ¿E2E pedido pasa? **Sí**
4. ¿E2E payable pasa? **Sí**
5. ¿E2E notification lifecycle pasa? **Sí**
6. ¿Dedupe pasa? **Sí**
7. ¿Read vs resolved pasa? **Sí**
8. ¿Bot respeta canales? **Sí**
9. ¿Gestión respeta canales? **Sí**
10. ¿Completo respeta canales? **Sí**
11. ¿Settings ERP↔Bot sincronizan? **Sí**
12. ¿Digest pasa? **Sí**
13. ¿Tenant isolation pasa? **Sí**
14. ¿Legacy pasa? **Sí**
15. ¿Capability contract pasa? **Sí**
16. ¿Agent V4 pasa? **Sí** (355/355)
17. ¿Frontend build pasa? **Sí**
18. ¿Functions build pasa? **Sí**
19. ¿`npm run test:release` pasa completo? **Sí**
20. ¿Existe algún blocker para staging? **No**

### Severidad residual

| Ítem | Severidad | Nota |
|---|---|---|
| — | — | Sin blockers detectados en esta corrida |
| `firebase emulators:exec` en Windows | LOW | Silencioso/roto con quoting; el gate usa `emulators:start` + wait-for-port |
| Campos legacy `cantidad`/`stock` vs `stockActual` | LOW | Dominio escribe `stockActual`; harness E2E lee SSOT |

## Bugs corregidos en esta pasada QA

1. Harness E2E leía `cantidad` antes que `stockActual` → falso negativo de stock post-venta.  
2. Tenant E2E sin `whatsapp_users` → `WHATSAPP_RECIPIENT_REQUIRED` al setear presets.  
3. V4 purchase-draft: `BUSINESS_NOT_FOUND` en emulator vacío → `ensureDefaultBusiness('rilo')` + seed finanzas mínima.  
4. `test:release` ahora orquesta emulator solo para E2E (suites unit/V4 no dependen de emulator vacío).

## Comandos de referencia

```bash
# Gate completo (suites → emulator E2E → builds)
npm run test:release

# Solo E2E (levanta Firestore emulator)
npm run test:e2e

# Emulator manual (dev)
npx firebase emulators:start --only firestore --project demo-rilo
```

**READY FOR STAGING** — producción requiere QA humano en staging. No deploy en esta tarea.

