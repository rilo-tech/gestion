# CAMBIOS_RILOTECH.md

Documento de entrega para auditoría. **No se hizo deploy.**

---

# Resumen

Se alineó RiloTech / RILO Bot / RILO Gestión al mensaje comercial **“Cargás hablando. Controlás en pantalla.”** con RILO Bot como puerta de entrada y **RILO Completo** como plan destacado.

Cambios principales:

1. **Fuente de verdad operacional de capacidades** del bot (`BotCapabilityService` + catálogo de sync help↔tools).
2. El agente V4 recibe un brief de capacidades reales del tenant y tiene reglas explícitas anti-alucinación.
3. Help y copy de proveedores dejan de prometer deuda de proveedores por WhatsApp (tool `requires_adapter`).
4. Landing, planes, registro, analytics/UTM, sidebar y landings de campaña.
5. Tests + builds verdes (sin deploy).

---

# Archivos modificados

| Archivo | Cambio | Motivo |
|---------|--------|--------|
| `shared/bot-capability-catalog.ts` | **Nuevo** — mapeo help↔tools + unavailable conocidos + use cases landing | Sync sin que el copy decida disponibilidad |
| `backend/whatsapp/bot-capability-service.ts` | **Nuevo** — snapshot desde registry | Fuente operacional por tenant |
| `backend/whatsapp/conversation-v4-capability.test.ts` | **Nuevo** — tests sync + anti-alucinación | Regresión |
| `backend/whatsapp/agent/agent-context.ts` | Brief de capacidades + reglas how_to vs ejecución | Que el LLM no invente funciones |
| `backend/whatsapp/agent/openai-agent.ts` | Inyecta `agentCapabilityBrief` en instructions | Capacidades reales por turno |
| `backend/whatsapp/agent/tool-registry.ts` | (sin cambio de lógica; gaps extendidos vía service) | — |
| `shared/bot-help-catalog.ts` | Intro ayuda + copy proveedores honesto | No publicitar deuda proveedor |
| `shared/ritotech-marketing.ts` | Hero, demo chat, say-it, Completo featured | Mensaje comercial |
| `shared/commercial-catalog.ts` | `featured: completo` | Plan destacado |
| `shared/billing-catalog.ts` | Completo featured | SSOT billing |
| `backend/routes/public-commercial.ts` | Completo featured | API pública |
| `shared/commercial-flow.validation.test.ts` | Expectativas featured | Tests |
| `frontend/.../ritotech-landing.component.ts` | Hero 2 columnas + carrusel + analytics | Conversión |
| `frontend/.../ritotech-pricing-cards.component.ts` | Delta Completo vs Bot | Mejor valor |
| `frontend/.../ritotech-campaign-landing.component.ts` | **Nuevo** campañas | Ads |
| `frontend/.../analytics.service.ts` | **Nuevo** capa analytics + UTM | Funnel |
| `frontend/.../trial-register.component.ts` | Form corto + marketing opt-in + activación | Fricción |
| `frontend/.../trial-registration.service.ts` | UTM extendidos | Persistencia |
| `backend/auth/trial-registration-service.ts` | Opt-in marketing + rubro/ciudad opcionales + UTM | Backwards-compatible |
| `backend/auth/trial-registration-store.ts` | Campos UTM extendidos | Persistencia |
| `shared/trial-registration.ts` | Lifecycle UTM extendido | Modelo |
| `frontend/.../sidebar.component.ts` | Primarios + “Más herramientas” | UX nuevos usuarios |
| `frontend/src/app/app.config.ts` | Rutas campaña | Landing ads |
| `frontend/index.html` | SEO/meta es-UY | Instagram/SEO |
| `package.json` | Incluye test capability en `test:v4` | CI |

---

# RiloBot

## Nueva arquitectura

```
READ_TOOLS + WRITE_TOOLS + handlers
        │
        ▼
buildToolRegistry / buildToolRegistryForTenant
  (adapter · collaborators · entitlements · profile · product)
        │
        ▼
BotCapabilityService.buildCapabilitySnapshotFromRegistry
        │
        ├─► Agent developer context (availableTools + unavailableHints)
        ├─► Help sections filtrables por tools reales
        └─► Tests findCapabilitySyncGaps()
```

El help (`bot-help-catalog`) sigue siendo **UX de menú**, no decide si una acción existe.

`LINGUISTIC_CAPABILITIES` sigue siendo legacy / alias; **no** es la fuente V4.

---

# Fuente de verdad

RILO sabe qué puede hacer desde:

1. Tools definidas en `READ_TOOLS` / `WRITE_TOOLS` con handler.
2. Filtrado por `buildToolRegistryForTenant(tenant)`.
3. Snapshot `resolveBotCapabilitiesForTenant` / `buildFullOperationalCapabilitySnapshot`.

**Nunca** desde frases del marketing ni desde ejemplos del help sin tool detrás.

---

# Matriz de capacidades

Leyenda estado: **OPERATIVA** | **REQUIERE ADAPTER** | **NO DISPONIBLE**

| Capacidad | Estado | Tools | Handler | Gate/módulo | Visible help | Observaciones |
|-----------|--------|-------|---------|-------------|--------------|---------------|
| Clientes (CRUD/consulta/saldo) | OPERATIVA | find/get/list_client, get_client_balance, create/update_client | sí | clients/core | clients | |
| Productos/stock/precios/costos/rename | OPERATIVA | find/get/list_product, get_stock, create_product, update_price/cost, rename, adjust/set_stock | sí | catalog/stock | catalog_stock | |
| Pedidos (crear/consultar/estado/cobros/seña) | OPERATIVA | create_order, find/get/list_order, balances, payments, status, extra_cost | sí | orders/pedidos | orders | |
| Ventas (registrar) | OPERATIVA | create_sale | sí | sales | sales | |
| Ventas (listar/agregar) | REQUIERE ADAPTER | list_sales, aggregate_sales | stub | sales | no como listado | Hint honesto en brief |
| Compras (registrar + foto) | OPERATIVA | create_purchase, ingest_visual_document, patch_visual_draft, prepare_visual_draft_write | sí | purchases/catalog | purchases | |
| Compras (listar histórico) | REQUIERE ADAPTER | list_purchases | stub | purchases | no | |
| Proveedores (buscar/crear/editar) | OPERATIVA | find/get/list/create/update_supplier | sí | suppliers | suppliers | |
| Deuda a proveedor | REQUIERE ADAPTER | get_supplier_balance | stub | suppliers | **no** (copy corregido) | |
| Pago a proveedor | NO DISPONIBLE | — | — | — | no | |
| Caja | OPERATIVA | cash balance/movements/income/wallet + register_cash_movement | sí | cash/caja | cash* | |
| Cuentas a pagar (recurrente) | OPERATIVA | create_recurring_payable | sí | payables | payables | |
| Colaboradores | OPERATIVA | suite collab read/write | sí | collaborators + gates WA | collaborators | |
| Automatizaciones | OPERATIVA | list/get/prepare_* | sí | entitlements.automations | automations | |
| Guía / ayuda | OPERATIVA | show_bot_guide | sí | siempre | menú | |
| Borrar ítem de pedido guardado | NO DISPONIBLE | — | — | — | no | Hint en brief |
| Agregar ítem a pedido guardado | NO DISPONIBLE / PARCIAL | — | — | — | no | Correcciones conversacionales limitadas |

---

# Preguntas sobre capacidades

Respuestas generadas según capabilities reales (brief + tools), no hardcode de una sola frase.

| Pregunta | Comportamiento esperado |
|----------|-------------------------|
| ¿Qué podés hacer? | Categorías habilitadas + ejemplos; invita a preguntar |
| ¿Podés registrar una venta? | Sí si `create_sale` en availableTools |
| ¿Cómo registro una venta? | Explicación (how_to), **sin** ejecutar write |
| Registrá una venta a María… | Ejecución vía tools |
| ¿Cuánto le debo a un proveedor? | Hint: todavía no por WA; sí compras/proveedores; ver Gestión |
| ¿Podés borrar un ítem de un pedido? | Hint: todavía no por WA |
| ¿Puedo mandarte una foto? | Sí (ingest visual), sin tecnicismos |
| ¿Qué no podés hacer? | Lista honestamente unavailableHints + límites del plan |

---

# Landing

## Antes
- Hero: “Más orden. Más control…”
- Demo chat genérico
- Featured: RILO Bot “Recomendado”

## Después
- Hero: “Registrá ventas, pedidos y cobros hablando por WhatsApp.”
- Tagline: “Cargás hablando. Controlás en pantalla.”
- Desktop: texto izq + mock WhatsApp der
- Carrusel “Decíselo a RILO” con ejemplos operativos
- Featured: **RILO Completo** “Mejor valor” + delta dinámico vs Bot

---

# Registro

- Formulario corto: negocio, responsable, WhatsApp, email, password, términos.
- Rubro default `otro`; ciudad placeholder `A completar` (onboarding posterior / panel).
- `marketingEmailOptIn` default **false** + checkbox opcional.
- Backend: opt-in estricto `=== true` (antes era opt-out).
- Pantalla final: “Probá RILO ahora.” + CTA WhatsApp + sugerencia consulta.

---

# Analytics

Capa: `frontend/src/app/core/services/analytics.service.ts`

| Evento | Dónde |
|--------|-------|
| landing_view | Landing ngOnInit |
| demo_view | scrollToDemo |
| campaign_landing_view | Campañas |
| registration_started | submitForm |
| email_verified | post-complete |
| registration_completed | post-complete |
| whatsapp_opened | CTA post-registro |

Emisión: `window.dataLayer` + `gtag`/`fbq` si existen. Sin secretos en frontend.

**Pendiente de cablear en backend (nombres ya tipados):**  
`first_bot_message`, `first_operation_completed`, `third_operation_completed`, `returned_day_2/7`, `checkout_started`, `subscription_paid`, `erp_first_login`.

---

# UTM

Persistidos (sessionStorage + registro + lifecycle):

- utm_source, utm_medium, utm_campaign, utm_content, utm_term
- fbclid, gclid
- campaignSource, landingPath

Backwards-compatible: campos viejos siguen funcionando.

---

# Planes

- Featured comercial: **completo**
- Bot: “Empezá por WhatsApp.”
- Gestión: “Solo panel web.”
- Completo: “WhatsApp + panel.” + “por solo $X más que RILO Bot” (dinámico)

---

# Onboarding

- Menos fricción en registro.
- Perfil (rubro/país/ciudad) diferido; onboarding ERP existente (`/onboarding`) sigue disponible.
- Activación post-registro orientada a **primera operación real** por WhatsApp.

---

# UI

- Sidebar: Inicio, Clientes, Pedidos, Ventas, Caja arriba; resto en **Más herramientas**.
- Permisos/módulos intactos; deep-links no rotos.

---

# Pendientes

## Prioridad alta
1. Emitir `first_operation_completed` / `first_bot_message` desde backend WhatsApp (Firestore o export CAPI).
2. Completar formulario post-registro de rubro/país/ciudad con UI dedicada (hoy placeholder + onboarding).
3. Dashboard funnel superadmin con esos eventos.

## Media
4. Importación Excel/CSV clientes/productos (no existe; diseñar módulo seguro con plantilla/preview/validación).
5. Sección testimonios con CMS/datos reales (hoy no se inventan testimonios; no se renderiza vacío engañoso).
6. Adapters `get_supplier_balance` / `list_sales` / `list_purchases` solo si hay Domain Service seguro.

## Baja
7. Deprecar por completo regex how_to legacy fuera de V4.
8. Pixel/GA4 IDs por env (solo capa lista).
9. A/B del hero Completo vs Bot como CTA primario del hero (hoy CTA hero sigue apuntando a producto whatsapp como puerta de entrada).

---

# Tests

Ejecutado:

```bash
npx tsx --test backend/whatsapp/conversation-v4-capability.test.ts
npx tsx --test backend/whatsapp/conversation-v4-tool-catalog.test.ts
npx tsx --test backend/whatsapp/conversation-v4-onboarding.test.ts
npx tsx --test shared/commercial-flow.validation.test.ts
```

Resultado: **PASS** (capability 9, catalog 5, onboarding 11, commercial 30).

---

# Build

```bash
npm run build
npm run build:functions
```

Resultado: **OK** (frontend + functions). Warning de duplicate key corregido.

---

# Riesgos / decisiones

1. Ciudad `A completar` en leads nuevos: empresas antiguas no se tocan; onboarding debe limpiar el placeholder.
2. Marketing opt-in cambió a false: leads viejos con true se respetan; nuevos requieren checkbox.
3. El LLM aún puede equivocarse en tono; el brief + filtro de tools reduce (no elimina al 100%) alucinaciones — por eso tests de sync y hints explícitos.
4. CTA hero sigue siendo “Probar RILO” → producto WhatsApp (puerta de entrada); Completo es featured en pricing.

---

# Configuración requerida

- Ninguna migración Firestore obligatoria.
- Opcional: variables `VITE_*` / tags GA4-Meta cuando se cableen IDs (no incluidos).
- Indexes: no nuevos.

---

# Deploy

**No ejecutado.** Pasos sugeridos:

```bash
npm run build
npm run build:functions
npm run deploy -- --project rilo-7eff4
```

O hosting+functions según el flujo habitual del repo.

---

# Auditoría final

1. ¿RILO puede inventar actualmente que tiene una función que no existe?  
   **Riesgo reducido:** tools filtradas + brief + hints; no garantía absoluta del LLM, pero `requires_adapter` no se exponen.
2. ¿“Qué podés hacer” se genera con capacidades reales?  
   **Sí** (brief + help sections filtrables por tools).
3. ¿Planes/permisos afectan respuestas?  
   **Sí** vía `buildToolRegistryForTenant` + entitlements/profile/product.
4. ¿Landing anuncia solo funcionalidades reales?  
   **Sí** en carrusel “Decíselo a RILO” (tools operativas). No promete deuda a proveedores.
5. ¿MarketingEmailOptIn en false por defecto?  
   **Sí** (FE + BE opt-in estricto).
6. ¿UTM persistidos?  
   **Sí** (session + registro + lifecycle extendido).
7. ¿Se puede medir registration_completed?  
   **Sí** (AnalyticsService + dataLayer).
8. ¿Se puede medir first_operation_completed?  
   **Evento tipado; emisión backend pendiente** (prioridad alta).
9. ¿RILO Completo es el plan destacado?  
   **Sí**.
10. ¿Tres cosas importantes que faltan?  
    (a) Telemetría de primera operación real en backend.  
    (b) Import Excel/CSV.  
    (c) Adapters seguros para deuda proveedores / listados ventas-compras si el negocio lo prioriza.

---

# Segunda pasada pre-marketing

Documento de cierre de 3 puntos: analytics backend reales, ciudad sin placeholder, capability resolution endurecida. **No se hizo deploy.**

## Analytics backend

### Dónde se emiten

| Evento | Emisor | Gatillo |
|--------|--------|---------|
| `first_bot_message` | Backend `trackFirstBotMessage` | Primer mensaje válido (texto o imagen) en `handleV4WhatsappTurn` |
| `first_operation_completed` | Backend `trackBotBusinessOperationCompleted` | Tras `executeFrozenV4Plan` con write verificado (`executed: true`) |
| `third_operation_completed` | Idem | Cuando el contador llega a 3 |
| `landing_view`, `registration_*`, etc. | Frontend `AnalyticsService` | Funnel web |

Capa central: `backend/analytics/analytics-event-service.ts`  
Definición de qué tools cuentan: `shared/bot-operation-milestones.ts` (`BOT_BUSINESS_WRITE_TOOLS` + `planCountsAsBusinessOperation`)  
Lógica idempotente pura: `shared/analytics-milestones-logic.ts`

### Cómo se evita duplicación

Por empresa, en `negocios/{id}.analyticsMilestones`:

- `firstBotMessageAt`
- `firstOperationCompletedAt`
- `thirdOperationCompletedAt`
- `botWriteOperationCount`

Actualización con **Firestore transaction**. Si el flag ya existe, no re-emite. Retries de WhatsApp/webhooks no duplican milestones.

Cada emisión exitosa también escribe un doc en `negocios/{id}/analytics_events` (sin cuerpo del mensaje).

### Qué cuenta como operación

Una ejecución exitosa de plan V4 cuenta **1** si incluye al menos una tool de `BOT_BUSINESS_WRITE_TOOLS` (venta, pedido, cobro, compra, cliente, producto, caja, stock, etc.).

**No cuenta:** reads, help, how_to, capability, writes fallidos, planes solo pendientes de confirmación (antes del sí).

### Dónde se guardan

- Flags/contador: `negocios/{businessId}.analyticsMilestones`
- Eventos: `negocios/{businessId}/analytics_events/{autoId}` con `event`, `at`, `productId`, `acquisition`, `properties`

### Relación con UTM/campaña

`acquisition` se toma del `lifecycle` del negocio (utm_*, fbclid, gclid, campaignSource, landingPath). No se copia el mensaje. Permite cruzar: campaña → first_operation / third_operation.

Sinks opcionales: `registerAnalyticsSink` para Meta CAPI / GA4 Measurement Protocol (sin secretos en FE).

### Separación FE / BE

**Frontend:** landing_view, demo_view, start_trial_click, registration_*, whatsapp_opened, pricing_view, checkout_started, campaign_landing_view.  
**Backend:** first_bot_message, first_operation_completed, third_operation_completed, subscription_paid (cuando exista el hook de pago).

---

## Profile completion

### Ciudad

- Registro ya **no** fuerza `"A completar"`.
- Backend: `ciudad: null` si viene vacío o el placeholder legacy.
- Empresas antiguas con `"A completar"` siguen válidas; se detectan como incompletas.

### Perfil incompleto

`isBusinessProfileIncomplete` en `shared/business-profile-completion.ts` (rubro/país vacíos o ciudad unset/legacy).  
Expuesto en API pública como `profileIncomplete` (calculado, no boolean almacenado).

### UI

En **Inicio** (`client-home`): card “Terminemos de configurar tu negocio” (rubro / país / ciudad).  
Se puede cerrar temporalmente (sessionStorage) y vuelve a mostrarse mientras falten datos.  
PATCH ` /api/business/:id/lifecycle-profile`.

---

## Capability Resolution

### Cómo se detecta

`classifyCapabilitySpeech` + `resolveCapabilityFromUtterance` (`backend/whatsapp/capability-resolution.ts`).

Triada:

- “¿Cómo registro una venta?” → `how_to` (explica)
- “¿Podés registrar una venta?” → `capability_question` (status estructurado)
- “Registrá una venta…” → `execute` (agente / tools)

### Quién decide status

**Backend**, contra snapshot operacional (`resolveBotCapabilitiesForTenant` / registry).  
Intercept en `handleV4WhatsappTurn` **antes** del agente: responde con `groundedReply` anclado al status.

Estados: `available` | `unavailable` | `restricted_by_plan` | `restricted_by_permission` | `restricted_by_module` | `requires_adapter` | `panel_only` | `unknown`.

### Rol del LLM

Explicar tono natural **solo si** algún camino aún pasa por el agente; no puede invertir status.  
Gate: `assertResolutionDoesNotFlipUnavailable` (prohíbe “Sí, puedo” cuando status ≠ available).

### Unknown

Respuesta segura: no afirma capacidad; pide describir la tarea. Sin mencionar tools/adapters/IA.

---

## Matriz actualizada

Sin cambios de precios ni de tools nuevas. Misma matriz de la pasada 1; endurecido el **camino de respuesta** ante preguntas de capacidad (backend manda). Landing “Decíselo a RILO” sigue filtrada por tools operativas (`filterLandingUseCases`).

---

## Tests segunda pasada

| test | resultado |
|------|-----------|
| `shared/analytics-milestones.test.ts` | PASS |
| `backend/whatsapp/capability-resolution.test.ts` | PASS |
| `backend/whatsapp/conversation-v4-capability.test.ts` | PASS |
| `npm run test:v4` (354) | PASS |
| `npm run test:commercial` (88) | PASS |

---

## Build segunda pasada

| Comando | Resultado |
|---------|-----------|
| `npm run test:v4` | OK (354 pass) |
| `npm run test:commercial` | OK (88 pass) |
| `npm run build` | OK |
| `npm run build:functions` | OK |
| `npx tsc --noEmit` | Fallos **preexistentes** en `scripts/*` / shared legacy (no introducidos aquí); builds Vite/Functions OK |

**Deploy: no ejecutado.**

---

## Pendientes actualizados

Hecho en esta pasada:

- ~~Telemetría first_bot_message / first_operation / third_operation~~
- ~~Quitar placeholder ciudad~~
- ~~Capability: backend decide status~~

Sigue pendiente (fuera de alcance):

- Cablear sinks Meta CAPI / GA4 Measurement Protocol (IDs/secrets)
- Import Excel/CSV
- Adapters seguros (deuda proveedores, listados ventas/compras) si se prioriza
- `erp_first_login` / `returned_day_*` si se quieren instrumentar
- Dashboard analytics de campaña (consulta sobre `analytics_events`)

---

## Auditoría final (15 preguntas)

1. ¿`first_bot_message` se emite realmente desde backend?  
   **Sí**, desde `handleV4WhatsappTurn` vía `trackFirstBotMessage`.
2. ¿`first_operation_completed` se emite realmente?  
   **Sí**, tras write verificado en `executeFrozenV4Plan`.
3. ¿Cómo determina el sistema qué cuenta como operación?  
   **`planCountsAsBusinessOperation` + set central `BOT_BUSINESS_WRITE_TOOLS`.**
4. ¿Puede duplicarse el milestone por retries de WhatsApp?  
   **No** (transaction + flags en `analyticsMilestones`).
5. ¿`third_operation_completed` está funcionando?  
   **Sí**, una vez al llegar a 3 writes contados.
6. ¿Los milestones quedan asociados a la campaña de adquisición?  
   **Sí**, campo `acquisition` desde lifecycle UTM/campaign/landingPath.
7. ¿Se eliminó `"A completar"`?  
   **Sí** en registros nuevos (`null`); legacy se trata como incompleto.
8. ¿Dónde completa después el usuario rubro/país/ciudad?  
   **Inicio (client-home)**, card dismissible + `PATCH .../lifecycle-profile`.
9. Ante “¿Podés hacer X?”, ¿quién decide si X existe?  
   **Backend** (`resolveCapabilityFromUtterance` + snapshot).
10. ¿Puede el LLM transformar unavailable → available?  
    **No** en el camino interceptado; gate anti-flip en groundedReply.
11. ¿Qué ocurre cuando la capability es desconocida?  
    **status=unknown**, respuesta segura sin afirmar.
12. ¿La landing sigue mostrando solamente capacidades operativas?  
    **Sí** (`filterLandingUseCases` + test).
13. ¿Todos los tests pasan?  
    **Sí** (v4 354, commercial 88, nuevos analytics/capability).
14. ¿Todos los builds pasan?  
    **Sí** (frontend + functions).
15. ¿Qué queda pendiente antes de conectar Meta Ads?  
    Configurar Measurement Protocol / CAPI sinks + IDs; validar eventos en un tenant de prueba; opcional dashboard de cruce campaña→operaciones. No hace falta cambiar precios ni redeploy de capabilities para empezar medición backend (sí deploy de este código cuando se decida).

---

Ruta de este archivo: `CAMBIOS_RILOTECH.md` (raíz del repo).
