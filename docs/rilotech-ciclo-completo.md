# RiloTech — mapa de ciclo completo (antes de implementar)

**Fecha:** 2026-08-29  
**Estado:** entregable de análisis. **No hay código nuevo.**  
**Regla:** reutilizar. No segundo catálogo de planes. No tocar el motor conversacional.

Este documento responde los 16 puntos del primer entregable (sección 57).

---

## Respuesta corta

Hoy el ciclo comercial **existe a medias**:

Landing → registro (20 días) → cupos → checkout Mercado Pago **de un solo pago** → webhook activa cobertura (`paidUntil`) → Superadmin edita precios y la landing los refleja.

**No existe renovación automática.** No hay Preapproval / Subscriptions de Mercado Pago. No se guardan tarjetas. Cada mes el cliente tendría que volver a Checkout Pro.

Al vencer el trial **no se borra** la empresa. Offboard (Superadmin) pone `suspendida`, libera email/teléfono y desasocia WhatsApp **sin borrar ERP**.

El número **200** hoy **no** está en Superadmin: el default de Bot es **1000** acciones IA (`includedAi`) y el trial **150**. Hay que configurarlo en el catálogo, no hardcodear.

Hay **dos contadores de acciones** (legado `ai_usage_*` vs meter `usage_*`). El cupo usa el legado. Hay que unificar.

---

## 1. Auditoría Mercado Pago (actual)

### Qué API usa

| Pieza | API | Archivo |
|---|---|---|
| Crear checkout | `POST https://api.mercadopago.com/checkout/preferences` | `backend/billing/mercadopago.ts` |
| Consultar pago | `GET https://api.mercadopago.com/v1/payments/{id}` | mismo |
| Token | `MERCADOPAGO_ACCESS_TOKEN` o `_UY` / `_AR` | env |

**No hay:** Preapproval, `/authorized_payments`, Customers+Cards, Checkout Transparente con tokenización propia, SDK de suscripciones.

### Endpoints nuestros

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/billing/plans` | Catálogo + si MP está configurado |
| POST | `/api/billing/checkout` | Preference de **plan** (mes o año) |
| POST | `/api/billing/checkout-pack` | Preference de **pack** one-shot |
| POST | `/api/billing/webhooks/mercadopago` | Sin JWT. Si `status === approved` activa plan o pack |

Frontend: `/activar-suscripcion` (plan), `/plan` (packs). Query `status=success|failure|pending` es **solo UX**; la verdad es el webhook.

### Checkout actual

Checkout Pro (redirect a `init_point`). Items: 1 línea, `unit_price` del catálogo (con intro % si aplica, solo mensual).  
`external_reference`: `businessId\|productId\|country\|interval\|timestamp`.  
`metadata`: businessId, productId, country, billingInterval, coverageMonths, kind=`plan` o `usage_pack`.  
Sandbox: `MERCADOPAGO_USE_SANDBOX=true` usa `sandbox_init_point`.

**El monto NO incluye usuarios extra ni add-ons ERP.** Solo `amountMonthly` del producto comercial.

### Subscriptions / preapproval

**No existe.** Cero IDs de suscripción MP en Firestore.

### Webhooks

- URL: `{APP_URL}/api/billing/webhooks/mercadopago`
- Topic: ignora `merchant_order` si no hay `data.id`
- Solo actúa si `payment.status === 'approved'`
- Pending / rejected / cancelled: **200 y no guarda estado**
- **No verifica firma** (`x-signature` / secret): no hay `MERCADOPAGO_WEBHOOK_SECRET` en el repo
- Siempre responde 200 (también si falla la activación) → MP no reintenta; se puede perder un pago aprobado

### Idempotencia (sí, parcial)

- Plan: `pagos_suscripcion` where `mercadoPagoPaymentId == id` → no duplica cobertura
- Pack: `private/usage_pack_payments/{paymentId}` en transacción

### IDs que sí guardamos

En `billing` del negocio: `country`, `currency`, `productId`, `billingInterval`, `paidUntil`, `lastMercadoPagoPaymentId`, `source: mercadopago`.  
En cada pago: `mercadoPagoPaymentId`, monto, currency, productId, periodo.

**No guardamos:** merchant/customer MP, preapproval_id, fee, neto, card last4.

### Cancelación / retries / comisiones

No hay cancelar suscripción (no hay suscripción).  
No hay retry de cobro.  
Comisión MP no se persiste → rentabilidad neta incompleta.

### Seguridad

Token en env (Functions params). Webhook público sin firma. No PCI: el usuario paga en el sitio de MP.

---

## 2. Flujo real hoy

```
Registro /registro
  → trial 20 días (enPrueba, trialEndDate, platformAccess)
  → seed WhatsApp si Bot/Completo
  → claim email/teléfono (trial_contact_claims)

Durante trial
  → opera Bot y/o ERP
  → cupos trialAccionesIaMes / trialWhatsappMensajes
  → puede ir a /activar-suscripcion y pagar YA (no espera día 20)

Checkout
  → POST /billing/checkout
  → redirect MP
  → vuelve a /activar-suscripcion?status=*
  → webhook (si approved) → activatePaidSubscription
       merge platformAccess
       paidUntil = ahora + coverageMonths
       enPrueba=false, trialStatus=converted
       estadoSuscripcion=activa
       precioBaseOverride = lista del catálogo
       seed WhatsApp

Renovación
  → NO automática
  → cuando paidUntil vence, billingMode deja de ser paid
  → hay que pagar de nuevo a mano (otro Checkout Pro)

Cancelación
  → Superadmin “Dar de baja” (offboard):
       estadoSuscripcion=suspendida
       libera claims
       releaseBusinessWhatsappPhone
       NO borra pedidos/clientes/pagos
```

No hay job que el día 20 cobre solo. Si nadie paga, el trial vence por fecha (`resolveTrialState`).

---

## 3. Qué hay de pagos recurrentes

**Nada en MP.**  
Hay recurrencia **nuestra** por calendario: `paidUntil` + períodos en `pagos_suscripcion` (mes o 12 meses si pagó anual). Eso no cobra solo.

Packs son one-shot del mes (`purchasedAi` / `purchasedWhatsapp` en `usage_YYYY-MM`). Correcto: no mezclar con la cuota.

---

## 4. Qué falta para renovación automática

1. Confirmar en MP Uruguay/Argentina **Subscriptions / Preapproval** (o el producto vigente 2026).
2. Crear preapproval con `auto_recurring` = precio **efectivo** (plan + usuarios extra + add-ons − descuento).
3. Autorizar en trial **sin cobrar** hasta `trialEndDate` (`start_date` / primer cargo diferido, según API real).
4. Guardar `preapprovalId`, `status`, `nextPaymentDate`.
5. Webhook de `subscription_preapproval` / `authorized_payment`, no solo `payment`.
6. Verificar firma.
7. Al authorized+approved: mismo `activatePaidSubscription` / extender `paidUntil`.
8. UI “Activar / desactivar renovación” en `/plan` (pausar preapproval en MP).
9. Si Preapproval no está en UY: no inventar cobro con tarjetas nuestras; documentar Checkout Pro manual + recordatorio, o otro producto MP oficial.

Sin eso, **no se puede cumplir** “día 20 MP cobra solo”.

---

## 5. Webhooks que existen

Uno: `POST /api/billing/webhooks/mercadopago`  
WhatsApp (otro sistema): `POST /api/webhooks/whatsapp` — no mezclar.

---

## 6. Cómo evitar cobros duplicados

Ya: indexar por `mercadoPagoPaymentId`.  
Falta:

- Firma del webhook
- No responder 200 si la activación falló (o cola de retry interna)
- Idempotencia de preapproval payment id cuando existan cargos recurrentes
- Un solo preapproval activo por `businessId`

---

## 7. Cómo calcular precio (hoy vs objetivo)

**Hoy checkout:** `overlayProductsForCountry` → `amountMonthly` (+ intro % mensual). **Ignora** `calculateMonthlyFee`.

**Hoy Superadmin / cuota interna:** `calculateMonthlyFee` en `shared/subscription-modules.ts`:

- base (`precioBase` / override)
- admins extra
- operadores × `precioPorOperador` (`extraUserMonthlyUY` 190)
- WhatsApp extra
- módulos add-on
- `descuentoMensual`

**Objetivo:** un `getEffectiveSubscriptionPrice(businessId)` que use esa fee + producto comercial, y que **checkout y preapproval llamen lo mismo**. Packs siguen en `checkout-pack`.

Landing: `getPublicPlanPrice(planId)` = catálogo (sin extras de una empresa).

---

## 8. Archivos a reutilizar (no duplicar)

| Área | Archivos |
|---|---|
| Producto | `shared/platform-access.ts` |
| Catálogo / precios públicos | `shared/commercial-catalog.ts`, `backend/auth/commercial-catalog.ts` |
| Cuota con usuarios | `shared/subscription-modules.ts` `calculateMonthlyFee`, `backend/auth/subscription-entitlements.ts` |
| Trial | `shared/trial-state.ts` |
| MP one-shot | `backend/billing/mercadopago.ts`, `routes/billing.ts` |
| Activar pago | `activate-paid-subscription.ts`, `activate-usage-pack.ts` |
| Pagos / paidUntil | `subscription-payments.ts` |
| Historia comercial | `subscription-history.ts` |
| Cupos | `usage-meter.ts`, `usage-gates.ts` |
| Extra cortesía | `usageQuota.extraAi` / `extraWhatsapp` |
| Packs comprados | `purchasedAi` / `purchasedWhatsapp` |
| Baja / teléfono | `offboardBusiness`, `releaseBusinessWhatsappPhone`, `trial_contact_claims` |
| Resolver WA | `tenant-resolver.ts` (por `whatsapp_users.phone`, no por historial) |
| Home / plan | `homeRoute`, `PlanStatusCard`, `AccountComponent` |
| Landing | `ritotech-marketing.ts`, `RitotechVisualGuideComponent` |
| Costos est. | `shared/usage-cost.ts`, `/platform/gastos` |
| Guards | `erpWebGuard`, `trialActiveGuard`, `companyGuard` |

---

## 9. Campos que ya existen

### Catálogo comercial (`CommercialCatalog`)

`trialDays`, `trialAccionesIaMes`, `trialWhatsappMensajes`, `lite.*`, `extraUserMonthlyUY/AR`, `usagePacks`, `products.{whatsapp,erp,completo}.{amountMonthlyUY/AR, includedAi, includedWhatsapp}`, intro discount.

### Empresa (`negocios/{id}`)

`planId`, `estadoSuscripcion`: `activa` \| `suspendida` \| `vencida`  
`enPrueba`, `trialStartDate`, `trialEndDate`, `trialStatus` (`active|expired|converted|cancelled`)  
`platformAccess`, `usageQuota`, `suscripcion` (límites + overrides de precio)  
`billing.{paidUntil, productId, country, currency, billingInterval, lastMercadoPagoPaymentId, source}`  
`contactVerification`, `lifecycle`

### Usage

`private/usage_YYYY-MM`: `aiActions`, `waInbound/Outbound/Ops`, `purchasedAi/Whatsapp`, `tools`, `models`  
`private/ai_usage_YYYY-MM.count` **legado**  
`private/wa_ops_YYYY-MM` legado

### Pagos

`pagos_suscripcion/{autoId}`  
`private/usage_pack_payments/{mpPaymentId}`  
`subscription_history`

### WhatsApp

`whatsapp_users/{id}`: `phone`, `enabled`, `previousPhone`, `releasedAt`  
`whatsapp_config/default`  
`trial_contact_claims/{email_*|phone_*}`

### platformAccess

`erpWebEnabled`, `whatsappEnabled`, `aiEnabled`, paused flags, `trialProduct`

---

## 10. Campos nuevos (defaults seguros, sin reset)

Sobre **catálogo / producto**:

- `riloBotUsageMode`: `'limited' | 'unlimited'` (default `limited`)
- Copys de landing/CTA/beneficios/orden/visible (varios ya están en marketing hardcoded)

Sobre **empresa**:

- `billing.autoRenew` boolean
- `billing.mpPreapprovalId` string \| null
- `billing.mpPreapprovalStatus`
- `lifecycleStatus` o mapear: `trial | active | past_due | inactive | archived` **sin romper** `estadoSuscripcion` (capa de lectura)
- `archivedAt` opcional

Sobre **pagos**:

- `mpFee`, `mpNet`, `mpStatus` (approved/pending/rejected)
- `kind`: `subscription | pack | bonus`

Sobre **uso**:

- Dejar de escribir el legado; `aiActions` del meter = fuente comercial
- Opcional: `dailyUsage_YYYY-MM-DD` para el gráfico 7/30 días
- Leer `thoughtsTokenCount` / cached si Gemini los manda (hoy no)

No hardcodear 200: es `catalog.products.whatsapp.includedAi` (y el de completo). Superadmin lo cambia en tab Planes.

Copy al cliente: helper `formatWhatsappActionsLabel(limit)` → `"200 acciones por WhatsApp por mes"` o `"Uso libre por WhatsApp"`. Unlimited **sigue midiendo**.

---

## 11. Estados propuestos (mapear, no duplicar)

| Querido | Hoy | Acción |
|---|---|---|
| trial | `enPrueba` + trial activo | Igual |
| active | `estadoSuscripcion=activa` + `paidUntil` futuro | Igual |
| past_due | no hay; `vencida` / grace día 10 en pagos | Añadir al resolver |
| inactive | `suspendida` + offboard / trial vencido blocked | Unificar semántica: **no operar, datos quedan** |
| archived | no hay | Flag Superadmin; mismo tenant |

`BillingMode` hoy: `trial | paid | blocked` (`lite` quedó en tipos/UI pero `showLiteLimits=false` y el resolver **casi no emite lite**).

**Cambio de producto pedido:** al día 20 sin renovación → **inactive**, no “plan libre”. Alinear copy de `/activar-suscripcion` (aún menciona techos lite en el catálogo).

Job diario (Scheduler ya existe para fotos): si `trialEndsAt < now` y no `autoRenew` y no `paidUntil` → `inactive` + **no** `deleteBusiness`. Si `autoRenew` → esperar cargo MP.

---

## 12. Liberar teléfono sin borrar tenant

**Ya está** en offboard:

1. `releaseTrialContactClaim('phone', …)` borra el doc global del número.
2. `releaseBusinessWhatsappPhone` pone `enabled:false`, **borra `phone`**, deja `previousPhone` + `releasedAt`.
3. El resolver busca `whatsapp_users.phone == key`. Sin `phone`, el número queda libre.
4. Conversaciones / pedidos quedan en `negocios/{oldId}/…`.

Nueva empresa: claim nuevo + `seedBusinessWhatsappAccess` en **otro** `businessId`. No ve el historial anterior (está namespaced).

Mejora (etapa 7): botones Superadmin separados **Desactivar / Archivar / Liberar WhatsApp / Reactivar** en lugar de un solo “Dar de baja”. Reutilizar las mismas funciones.

---

## 13. Qué se conserva en inactive

Todo el documento `negocios/{id}` y subcolecciones: clientes, stock, pedidos, ventas, caja, pagos, usage, subscription_history, whatsapp_users (sin phone activo), config.

Se pierde solo: el **claim** del teléfono/email (para que otro alta pueda usarlos) y la **asignación activa** del número al bot.

---

## 14. Reactivar a los 6 meses

1. Superadmin busca empresa por nombre / email en `contactVerification` (sigue en el doc) / id.
2. `estadoSuscripcion=activa` (o cobro MP).
3. **No** crear tenant nuevo.
4. Precio: catálogo **actual**, no congelar el de hace 6 meses salvo override explícito. Mostrar comparación (precio viejo en history vs lista nueva).
5. Teléfono: el mismo u otro → `seedBusinessWhatsappAccess` + `bindContactClaimToBusiness`.
6. Conversación WhatsApp empieza limpia en el sentido de línea; el ERP histórico es el mismo.

Falta UI “Reactivar” (hoy se edita estado a mano). No hace falta otro modelo.

---

## 15. Migración

- Defaults: `riloBotUsageMode=limited`, `autoRenew=false`, `mpPreapprovalId=null`.
- No tocar `rilo`, `prueba`, `rilo-default` datos ERP.
- Unificar cupo: al leer, `aiActions = max(meter, legado)`; al escribir, **solo meter** + backfill.
- Poner `includedAi` Bot = 200 **en catálogo** (Superadmin o un default nuevo). Completo: definir (¿200+Gestión o otro número?).
- No borrar `lite` del JSON hasta que Superadmin no lo use; dejar de usarlo en el flujo de vencimiento.

---

## 16. Plan por etapas (igual al pedido, con anclas reales)

**Etapa 0 — este doc.** MP auditada.

**Etapa 1 — login + `/inicio` + redirects**  
`homeRoute`, `loginGuard`, logo, ocultar Ingresar. Reusa guards.  
Solo Bot / ambos → `/inicio`. Solo ERP → `/dashboard`. Superadmin → `/platform`.

**Etapa 2 — home visual + consumo**  
`PlanStatusCard` + anillo/barra. Label desde catálogo. Gráfico 7 días: **requiere** agregado diario (nuevo, chico) o “sin tendencia hasta tener dailyUsage”.

**Etapa 3 — onboarding**  
Reusar `RitotechVisualGuideComponent` + checklist. No tours en cada pantalla ERP.

**Etapa 4 — limited/unlimited + 200 + usuarios**  
Campos catálogo. Copy “acciones por WhatsApp por mes”. Unlimited no saltea meter. Extra users: ya está `calculateMonthlyFee`; **engancharlo al checkout**.

**Etapa 5 — pricing central + landing**  
`getPublicPlanPrice` / `getEffectiveSubscriptionPrice` sobre código existente. Hero: “Tu agente con IA por WhatsApp” **sin** renombrar RILO Bot. 200 dinámico.

**Etapa 6 — MP recurrent + trial**  
Preapproval o equivalente oficial. Firma webhook. No cobrar en trial. Primer cargo al terminar. Packs siguen one-shot.

**Etapa 7 — ciclo de vida / phone release**  
Mapear inactive. Separar botones. No delete. Job de vencimiento de trial.

**Etapa 8 — FinOps**  
Extender `/platform/gastos`: ingreso (`pagos_suscripcion`) − Gemini est. − WA est. − fee MP **si se guarda**. Firebase **prorrateado/estimado**, nunca fingir SKU por tenant.

**Etapa 9 — alertas**  
80/100% acciones (ya hay warning WA 80%). Trial 5 días / 1 día. Pago fallido. Unlimited caro.

---

## Copy de acciones (obligatorio)

Nunca solo “200 acciones IA” al cliente.

- Limited: **“{n} acciones por WhatsApp por mes”** (`n` = `includedAi` del plan, no literal 200).
- Unlimited: **“Uso libre por WhatsApp”** + “Acciones utilizadas este mes: {used}”.
- Superadmin puede seguir viendo “acciones IA” + Gemini calls.

Incluidas / pack / bonus / total:

```
max = included + purchasedAi + extraAi   // ya está
used = aiActions (meter unificado)
disponibles = max(0, max - used)
```

---

## Criterio de ciclo (cierre)

Landing → registro 20 días → Bot con cupo de catálogo → cliente ve consumo → puede pedir renovación automática (**hoy no**) → MP cobra precio efectivo → plan activo → packs/usuarios → Superadmin precios → landing live → costos/margen.

Si no paga: **inactive**, se puede **liberar teléfono**, **historial queda**.  
Si vuelve: **reactivar el mismo `businessId`**.

Dejar de pagar **≠** borrar.

---

## Confirmación para pasar a código

Cuando este mapa cierre, el primer PR es **etapa 1** (login + `/inicio`), no Mercado Pago. Etapa 6 espera decisión: Preapproval disponible en UY/AR o cobro manual hasta tenerlo.
