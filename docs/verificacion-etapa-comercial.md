# Verificación final (solo lectura) — etapa comercial / planes / add-ons

**Fecha:** 29 ago 2026  
**Alcance:** landing, login, redirecciones, `/inicio`, planes, Superadmin, onboarding, add-ons de usuarios/números, compatibilidad.  
**Método:** revisión de código. No se modificó nada para este informe. No se hicieron pruebas manuales de login ni de cobro Mercado Pago.

---

## 1. Landing

**Estado general: OK**

- **Estética y estructura:** se conserva el shell público (fondo oscuro, header sticky, hero, demo WhatsApp, beneficios, 3 cards de producto, cómo funciona, FAQ, CTA). No hay rediseño de layout ni de marca.
- **Lo que sí cambió (incremental, no radical):** las cards de producto y `/planes` muestran líneas de cupo/extras (acciones, números, usuarios, precios extra). La tabla comparativa de `/planes` ganó filas (números incluidos, usuarios, extras). El FAQ sumó “¿Puedo agregar usuarios o números de WhatsApp?”.
- **RILO Bot como agente con IA por WhatsApp:** sí. Tagline `TRIAL_PRODUCT_TAGLINES.whatsapp`, pill del hero (“RILO Bot · tu agente con IA por WhatsApp”), copy del demo (“Tu agente con IA”).
- **Precios desde Superadmin:** sí. Landing y `/planes` leen `GET /api/public/commercial` (`CommercialCatalogService`). Fallback local = `DEFAULT_COMMERCIAL_CATALOG` si el API falla.
- **Copy de acciones:** `whatsappActionsLabel` → `"{n} acciones por WhatsApp por mes"` o “Uso libre…” si unlimited. No se muestra “acciones IA” al cliente.
- **Límite no hardcodeado en componentes:** las vistas usan `catalog.products.*.includedAi`. El **200** vive como **default del catálogo** (`DEFAULT_COMMERCIAL_CATALOG`) y en tests que asertan ese default. Si Superadmin publica otro número, landing/checkout lo muestran. No hay `200` literal en templates de landing.

---

## 2. Login

**Estado general: OK**

- **Logo centrado:** `/login` usa `RitotechPublicShell` + lockup `rilotech-lockup-on-dark.png` con `mx-auto`.
- **“Ingresar” oculto en `/login`:** `RitotechPublicShellComponent.isLoginPage` oculta el link Ingresar cuando la URL es `/login`.
- **Cliente vs Superadmin separados:** cliente = `/login` (código de empresa). Superadmin = `/acceso-plataforma` (`platformLoginGuard`). Footer público sigue teniendo “Acceso plataforma”; no se unificó el formulario.

---

## 3. Redirecciones

**Estado general: OK**

`AuthService.homeRoute`:

| Caso | Destino |
|---|---|
| Superadmin plataforma | `/platform` |
| WhatsApp operativo (solo Bot **o** Completo) | `/inicio` |
| Solo panel ERP operativo | `/dashboard` |
| Sin canales | `/inicio` (fallback) |

Además: si alguien con **solo Gestión** entra a `/inicio`, el componente redirige a `/dashboard`.

Login (`login.component.ts`) navega a `auth.homeRoute` tras autenticar.

---

## 4. `/inicio`

**Estado general: PARCIAL**

- **Home real para solo Bot:** sí. Saludo, anillo de cupo, líneas WhatsApp (supervisor), usuarios extra (supervisor sin ERP), checklist, guía visual, manual corto, Mi plan / facturación / cuenta.
- **Home combinado Bot + Gestión:** sí. Mismo `/inicio` con subtítulo “Cargás por WhatsApp o en el panel…” y botón “Entrar a RILO Gestión” → `/dashboard`.
- **Producto/plan contratado:** visible en `PlanStatusCard` (nombre comercial RILO Bot / Gestión / Completo, extras, total). **Solo supervisor.** Un operador en `/inicio` ve el anillo de cupo, no la ficha de plan.
- **Acciones usadas / disponibles / límite:** sí, si hay WhatsApp. Anillo + “X de Y · quedan Z”. Unlimited: “usadas · sin tope mensual”.
- **Gráficos visuales:** hay **anillo (donut) de %** en `/inicio` y **barras horizontales** en Mi plan. **No hay gráfico de tendencia 7/30 días** (`dailyUsage` no está implementado).
- **Unlimited:** sí, si el plan (o override Superadmin) es `usageMode === 'unlimited'` **y** la empresa está en modo pago. En prueba no se trata como unlimited.
- **Desde Completo a Gestión:** sí, CTA a `/dashboard`.

**Gestión sola** no usa `/inicio`; su “home” sigue siendo el dashboard ERP, sin este chrome de cupo/onboarding.

---

## 5. Planes

**Estado general: OK** (con matices)

- **Acciones desde configuración:** `includedAi` / `monthlyActionLimit` del catálogo; override por empresa `includedAiOverride`.
- **Default 200:** Bot y Completo en `DEFAULT_COMMERCIAL_CATALOG`. Gestión = 0. Si Firestore todavía tenía 1000/2000, `applyWhatsappActionsSeedIfUnchanged` lo pasa a 200 al leer el catálogo.
- **Superadmin puede modificarlo:** Plataforma → Planes (columna acciones + tope limited/unlimited) y override por empresa.
- **Limited/unlimited:** funciona. Unlimited se mide igual; no corta el bot. Copy de cliente distinto.
- **Packs extra:** siguen en catálogo, landing, `/plan` (Checkout Pro one-shot), cortesía Superadmin `extraAi` / `extraWhatsapp`.
- **No hay un segundo billing:** un `CommercialPricingService` (`shared/commercial-pricing.ts`), un checkout Mercado Pago, una suscripción. **Siguen existiendo dos capas internas:** productos comerciales (`whatsapp` / `erp` / `completo`) y plantillas ERP (`plan_basico` / `intermedio` / `profesional`) para módulos/asientos, mapeadas 1:1 y sincronizadas al publicar el catálogo. No es un segundo cobro.

---

## 6. Superadmin

**Estado general: PARCIAL** (rentabilidad)

- **Panel reutilizado:** `/platform` (tabs Empresas, Pruebas, Pagos, Planes) + ficha `/platform/empresas/:id` + `/platform/gastos`. No hay un panel nuevo.
- **Precios editables:** sí. UYU/ARS por producto, extras por plan (UYU y ARS), packs, trial, intro.
- **Landing:** al “Guardar y publicar” se escribe `plataforma/comercial` y se llama `syncPlanTemplatesFromLandingCatalog`. La landing pública lee ese doc.
- **Acciones:** editables por producto y override por empresa.
- **Costos/rentabilidad:** `/platform/gastos` muestra costo **estimado** Meta + Gemini, **ingreso esperado** (plan + extras) y desglose por teléfono (inbound/outbound). **No** modela comisión Mercado Pago, hosting Firebase prorrateado, ni margen neto real. Los dólares de Meta/Gemini son estimación, no factura.

---

## 7. Onboarding

**Estado general: PARCIAL**

- **Existe in-app:** checklist en `/inicio` (localStorage `rilo-onboarding-v1-{businessId}`) + modal `RitotechVisualGuideComponent` (viñetas, tabs Bot/Gestión).
- **Reutiliza componentes:** sí (guía visual de landing, no tours nuevos por pantalla ERP).
- **Visual e interactivo:** la guía sí (modal, tabs, viñetas). El checklist es **tildes locales**, no un wizard guiado ni progreso de servidor.
- **No solo manuales:** hay guía + checklist; también queda una lista corta “Cómo usar RILO Bot”.
- **Cambia según producto:** Bot = 3 ítems WhatsApp; Completo = esos + “Entrá a RILO Gestión”; Gestión sola **no ve este onboarding** (no pasa por `/inicio`).

No hay tour persistido en el ERP ni checklist distinto post-login para solo panel.

---

## 8. Compatibilidad

**Estado general: OK** para esta etapa (con nota de repo)

- **No hay scripts en esta etapa que borren** tenants `rilo`, `prueba`, `rilo-default` ni datos ERP.
- **Semillas de catálogo** (días de prueba 30→20, precios MVP, cupo 1000/2000→200) **sí escriben** `plataforma/comercial` si detectan valores viejos. No tocan pedidos/stock/clientes.
- **ERP:** no se reescribió el flujo de pedidos/ventas/caja. Sí se tocó alta/baja de **usuarios** (confirmación de billing, soft-deactivate).
- **Motor conversacional:** esta etapa **no** cambió `conversation-engine`, parser ni orchestrator. El workspace puede tener **otros** cambios de WhatsApp sin commitear de chats anteriores; no forman parte de landing/planes/add-ons.
- **Verificación runtime de los tres tenants:** no ejecutada aquí (solo código). Hay que probarla a mano.

---

## 9. Código

### Archivos creados (esta etapa add-ons / pricing)

| Archivo | Rol |
|---|---|
| `shared/commercial-pricing.ts` | Calculadora única (plan + extras) |
| `shared/commercial-pricing.test.ts` | Tests A–N y extras |
| `backend/auth/commercial-pricing.ts` | Carga contexto empresa + cotizaciones |
| `backend/auth/commercial-events.ts` | Historial `negocios/{id}/commercial_events` |
| `backend/auth/whatsapp-extra-otp.ts` | OTP de líneas extra (no roba el claim de contacto) |
| `backend/routes/addons.ts` | API add-ons bajo `/api/business/:id/addons` |
| `frontend/src/app/core/services/addons.service.ts` | Cliente HTTP add-ons |

### Archivos modificados (principales)

**Shared / catálogo:** `shared/commercial-catalog.ts`, `shared/commercial-catalog.test.ts`, `shared/ritotech-marketing.ts`, `shared/billing-catalog.ts` (ya tenía extras de usuario).

**Backend:** `create-app.ts`, `auth/plans.ts`, `auth/subscription-entitlements.ts`, `auth/business.ts`, `auth/middleware.ts`, `auth/usage-gates.ts`, `auth/usage-meter.ts`, `auth/commercial-catalog.ts` (semillas), `routes/billing.ts`, `routes/public-commercial.ts`, `routes/users.ts`, `routes/platform.ts`, `whatsapp/whatsapp-users.ts` (kind/status de líneas), `whatsapp/seed-access.ts` (ya no pisa `limiteWhatsapp` a 1 si hay extras).

**Frontend:** landing, `/planes`, `activate-subscription`, `client-home`, `plan-status-card`, `platform.component`, `platform-subscription-editor`, `platform.service`, `platform-usage`, `commercial-catalog.service`, `settings-users-panel`, `login` / `public-shell` (login ya tenía logo y hide Ingresar).

**No creado en esta etapa:** motor WhatsApp, nuevo panel Superadmin, Preapproval MP.

### Migraciones / seeds (al leer o publicar catálogo)

- Trial 30 → 20 días si el doc sigue en 30.
- Precios legacy 1490/2490/3490 + intro 70% → MVP (690/590/990, sin intro).
- Acciones Bot 1000 / Completo 2000 → 200 si coinciden esos valores viejos.
- `syncPlanTemplatesFromLandingCatalog`: plantillas ERP toman precio, extra usuario e `includedErpUsers` del catálogo.
- `migratePremiumIntoProfesional`: preexistente (`plan_premium` inactivo).

**No hay migración Firestore de datos de clientes/pedidos.**

### Campos nuevos (suscripción / catálogo / uso)

**Catálogo producto:** `includedErpUsers`, `extraErpUserPriceUY/AR`, `includedWhatsappNumbers`, `extraWhatsappNumberPriceUY/AR`, `maxWhatsappNumbers`, `usageMode` (alias comercial `riloBotUsageMode`). Catálogo: `extraWhatsappNumberMonthlyUY/AR`.

**Empresa `suscripcion`:** `includedErpUsersOverride`, `extraErpUserPriceOverride`, `includedWhatsappNumbersOverride`, `extraWhatsappNumberPriceOverride`, `includedAiOverride`, `usageModeOverride`, `maxWhatsappNumbersOverride`, `precioFinalOverride`.

**WhatsApp user:** `kind` (`primary` \| `extra`), `status` (`active` \| `pending` \| `disconnected`).

**Uso:** `phones.{digits}.{aiActions,waInbound,waOutbound}` (desglose; el corte de IA sigue siendo **por empresa**).

**Colección:** `negocios/{id}/commercial_events`.

**Usuarios:** `addedAt`, `addedBy`, `removedAt`, `removedBy`, `activo: false` en baja.

### TODO / deudas conocidas (sin corregir)

- Reemplazar número principal: `window.prompt` (no el mismo diálogo OTP que las líneas extra).
- Índice Firestore `commercial_events` `date` desc: puede hacer falta al listar historial.
- Router add-ons montado como segundo `/api/business` (debería andar por fall-through; si 404, hay que mover las rutas).
- AI **por teléfono** no corta el bot; solo se registra desglose. Cupo compartido de empresa.
- Reactivar extra usuario desde frontend no siempre muestra cotización (alta sí).
- `precioBaseOverride` al pagar Checkout Pro congela el precio de lista de ese pago.
- Catálogo `lite` sigue en Superadmin; el flujo de vencimiento **no** lo usa como plan permanente (`showLiteLimits = false` en activar suscripción).
- Sin gráfico diario de consumo.
- Mercado Pago: **solo Checkout Pro**; no hay Preapproval / renovación automática.

---

## 10. Riesgos (parcial / simulado / pendiente / legacy)

| Tema | Qué es |
|---|---|
| Renovación automática MP | **No existe.** El extra se habilita ya; el nuevo total se cobra en el **próximo** Checkout Pro. Copy: “Se suma a tu próxima renovación. Este período ya está pago.” |
| Prorrateo | **No hay.** Decisión consciente (no cobro casero). |
| Margen Superadmin | **Estimado** (Meta + Gemini). No es P&L real. |
| Gráfico 7/30 días en `/inicio` | **Pendiente.** Solo anillo + barras. |
| Onboarding Gestión sola | **Pendiente** en dashboard. |
| Replace primary UX | **Parcial** (`prompt`). |
| Índice `commercial_events` | **Pendiente** hasta el primer listado en prod. |
| Dual router `/business` | **Riesgo** de 404 de add-ons si Express no cae al segundo router. |
| Dos capas plan comercial vs plantilla ERP | **Legacy útil**, mapeado; Superadmin aún ve ambas. |
| Plan `lite` en catálogo | **Legacy** de UI Superadmin; no es el destino post-trial. |
| Semillas de catálogo | **Datos reales** en `plataforma/comercial` si pegan el seed; no son tenants ERP. |
| Deploy | Código local; **producción no verificada** en este informe. |
| Motor WhatsApp | Fuera de esta etapa; no validado aquí. |

---

## Tabla de requisitos

| Requisito | Estado |
|---|---|
| Landing: estética/estructura anterior | OK |
| Landing: sin rediseño radical | OK |
| Landing: RILO Bot = agente con IA por WhatsApp | OK |
| Landing: precios desde Superadmin | OK |
| Landing: “acciones por WhatsApp por mes” | OK |
| Landing: límite no hardcodeado en componentes | OK |
| Login: logo centrado | OK |
| Login: no “Ingresar” en navbar en `/login` | OK |
| Login cliente ≠ acceso Superadmin | OK |
| Redirect solo Gestión → `/dashboard` | OK |
| Redirect solo Bot → `/inicio` | OK |
| Redirect Bot + Gestión → `/inicio` | OK |
| Redirect Superadmin → panel Superadmin | OK |
| `/inicio` home real solo Bot | OK |
| `/inicio` home combinado Completo | OK |
| `/inicio` muestra producto/plan contratado | PARCIAL (supervisor / `PlanStatusCard`; no el staff) |
| `/inicio` usadas / disponibles / límite | OK |
| `/inicio` gráficos visuales | PARCIAL (anillo + barras; no tendencia 7/30) |
| `/inicio` unlimited | OK |
| Completo: entrar a RILO Gestión | OK |
| Acciones desde configuración | OK |
| Default 200 configurable | OK |
| Superadmin modifica acciones | OK |
| Limited / unlimited | OK |
| Packs extra siguen | OK |
| Un solo sistema de billing | OK |
| Plantillas ERP aparte (módulos) | PARCIAL (capa legacy mapeada, no segundo cobro) |
| Superadmin: panel existente | OK |
| Superadmin: precios editables → landing | OK |
| Superadmin: ver/configurar acciones | OK |
| Superadmin: costos/rentabilidad | PARCIAL (estimado; sin margen neto) |
| Onboarding in-app | PARCIAL |
| Onboarding reutiliza componentes | OK |
| Onboarding visual e interactivo | PARCIAL (guía sí; checklist local) |
| Onboarding según Bot / Gestión / ambos | PARCIAL (Gestión sola no tiene `/inicio`) |
| Tenants rilo / prueba / rilo-default no reseteados | OK (código; runtime a mano) |
| Datos ERP no borrados | OK |
| ERP operativo no reescrito | OK |
| Motor conversacional no tocado por esta etapa | OK |
| Add-ons usuarios + números extra | OK (con deudas UX listadas) |
| Mercado Pago recurrente | PENDIENTE |
| Gráfico consumo 7/30 días | PENDIENTE |
| Índice Firestore historial comercial | PENDIENTE (hasta primer uso) |

---

## Qué probar a mano primero

1. Landing y `/planes`: tres productos, cupos y extras, sin “200” si cambiás el catálogo.
2. `/login` vs `/acceso-plataforma`; navbar sin Ingresar en login.
3. Login Bot → `/inicio`; Gestión → `/dashboard`; Completo → `/inicio` + CTA al panel; Superadmin → `/platform`.
4. Superadmin → Planes: cambiar `includedAi` y verificar landing.
5. Add-on usuario (Gestión/Completo) y número WhatsApp (Bot/Completo) con confirmación de precio.
6. No esperar renovación automática de Mercado Pago: solo Checkout Pro.
