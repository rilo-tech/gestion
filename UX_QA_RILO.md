# UX_QA_RILO.md

QA humano simulado + heurísticas UX/UI automáticas (Playwright).  
**No es producción.** No agrega módulos ni cambia precios.

**Fecha:** 2026-09-19  
**Entorno:** LOCAL VERIFIED (vite preview / dist) — flujos autenticados = STAGING REQUIRED  
**Comando:** `npm run test:ux`  
**Veredicto:** **UX READY FOR STAGING**

## Resumen

- Escenarios registrados: **41** (viewports × flujos)
- Flujos únicos: **17**
- Findings **LOCALES** (únicos): BLOCKER **0** · HIGH **0** · MEDIUM **0** · LOW **0** · POLISH **0**
- STAGING_REQUIRED: **27** (sin score — falta sesión QA)
- Fórmula score (solo flujos ejecutables): taskSuccess 40 + pasos 15 + claridad 15 + errores 10 + responsive 10 + a11y 10 (objetivo ≥ 85)

## Personas

- **Ana** (No soy tecnológica) — plan any — goals: Registrarse; Registrar una venta; Saber cuánto vendió; Ver quién le debe; Saber qué tiene para hoy
- **Carla** (Trabajo por pedidos) — plan completo — goals: Crear pedido; Cobrar seña; Ver entrega; Estados: en proceso → listo → entregado; Cobrar saldo
- **Martín** (Comercio) — plan gestion — goals: Venta; Stock; Compra; Producto bajo; Aviso; Caja
- **Diego** (Solo quiero el Bot) — plan bot — goals: Operar por WhatsApp; Ver Resumen web; Sin módulos ERP a medias
- **Lucía** (Quiero administrar todo) — plan completo — goals: WhatsApp + ERP mismo sistema; Sin banners de upgrade

## LOCAL VERIFIED

Flujos públicos / smoke ejecutados contra vite preview (`dist/`).

| Flujo | Persona | Viewport | Task success | Pasos | Score | Estado |
|---|---|---|---|---:|---:|---|
| bot | diego_bot | n/a | yes | 1 | 100 | PASS |
| copy | ana | n/a | yes | 1 | 100 | PASS |
| landing | ana | desktop | yes | 2 | 100 | PASS |
| registro | ana | desktop | yes | 2 | 100 | PASS |
| planes | diego_bot | desktop | yes | 2 | 100 | PASS |
| shell-ux | martin | desktop | yes | 1 | 100 | PASS |
| shell-ux | martin | desktop | yes | 3 | 100 | PASS |

### Críticos locales

| Flujo | Score | Estado |
|---|---|---|
| registro | 100 | PASS |

## STAGING REQUIRED

Estos flujos **no se puntúan en local**. El redirect a login no es un fallo UX: falta tenant/sesión de staging.

| Flujo | Persona | Viewport | Score | Estado |
|---|---|---|---|---|
| onboarding | ana | desktop | N/A — requiere staging | STAGING_REQUIRED |
| primera-venta | ana | desktop | N/A — requiere staging | STAGING_REQUIRED |
| pedido | carla | desktop | N/A — requiere staging | STAGING_REQUIRED |
| finalizar-pedido | carla | desktop | N/A — requiere staging | STAGING_REQUIRED |
| payable | martin | desktop | N/A — requiere staging | STAGING_REQUIRED |
| avisos | martin | desktop | N/A — requiere staging | STAGING_REQUIRED |
| resumen-rilo | diego_bot | desktop | N/A — requiere staging | STAGING_REQUIRED |
| settings-avisos | lucia_completo | desktop | N/A — requiere staging | STAGING_REQUIRED |
| hoy | ana | desktop | N/A — requiere staging | STAGING_REQUIRED |

| Flujo crítico | Score | Estado |
|---|---|---|
| onboarding | N/A — requiere staging | STAGING_REQUIRED |
| primera-venta | N/A — requiere staging | STAGING_REQUIRED |
| pedido | N/A — requiere staging | STAGING_REQUIRED |
| finalizar-pedido | N/A — requiere staging | STAGING_REQUIRED |
| payable | N/A — requiere staging | STAGING_REQUIRED |
| avisos | N/A — requiere staging | STAGING_REQUIRED |
| resumen-rilo | N/A — requiere staging | STAGING_REQUIRED |
| settings-avisos | N/A — requiere staging | STAGING_REQUIRED |

## Scores (críticos)

| Flujo | Score | Estado |
|---|---|---|
| registro | 100 | PASS |
| onboarding | N/A — requiere staging | STAGING_REQUIRED |
| primera-venta | N/A — requiere staging | STAGING_REQUIRED |
| pedido | N/A — requiere staging | STAGING_REQUIRED |
| finalizar-pedido | N/A — requiere staging | STAGING_REQUIRED |
| payable | N/A — requiere staging | STAGING_REQUIRED |
| avisos | N/A — requiere staging | STAGING_REQUIRED |
| resumen-rilo | N/A — requiere staging | STAGING_REQUIRED |
| settings-avisos | N/A — requiere staging | STAGING_REQUIRED |

## Mobile / Tablet / Desktop

- mobile-375 (375×812)
- tablet-768 (768×1024)
- desktop-1366 (1366×768)

Screenshots en `qa-artifacts/ux/{persona}/{viewport}/`.

## Accessibility

axe-core + fallback DOM. Objetivo: **HIGH = 0** en páginas públicas locales.

## Copy

Scanner distingue **static source code** vs **visible user copy** (texto entre tags / placeholder / aria-label).  
No reporta `null`/`undefined`/`tenant` de TypeScript interno.

## Bot

Dataset `qa-human-simulated/bot-phrases.ts` — sin writes, sin Agent V4 live.  
`pagué 500` → `ambiguous`.

## Problemas locales encontrados

_Ningún finding local relevante en esta corrida._

## Corregidos (esta pasada)

- Contraste CTAs públicos: `bg-teal-600`+`text-white` → `bg-teal-700`+`text-white` (shell, pricing CTA, landing, registro, product page).
- Badge Completo: `text-teal-200`/`bg-teal-700` → `text-white`/`bg-teal-800`.
- Muted chat/landing: `text-gray-500` → `text-gray-400` donde fallaba AA.
- Densidad landing: progressive disclosure en ejemplos (“Ver más ejemplos”).
- Scanner UX: solo copy visible (no falsos positivos de código).

## Recomendaciones visuales

1. Completar sesión QA en staging para scores de onboarding/venta/pedido/avisos.
2. Revisar landmarks `main` en registro si axe lo marca MEDIUM.
3. Empty states ERP con CTA (staging).

## Staging required (detalle)

| Ítem | Motivo |
|---|---|
| Onboarding autenticado | Requiere tenant trial |
| Primera venta / pedido / finalizar | Requiere login + datos |
| Avisos / payables / settings | Requiere plan + módulos |
| Resumen Bot (/inicio) | Requiere producto Bot |
| Agent V4 live + typos | Requiere Meta/OpenAI staging |

## Screenshot index

- `qa-artifacts/ux/ana/desktop/onboarding-01.png`
- `qa-artifacts/ux/ana/desktop/primera-venta-01.png`
- `qa-artifacts/ux/carla/desktop/pedido-01.png`
- `qa-artifacts/ux/carla/desktop/finalizar-pedido-01.png`
- `qa-artifacts/ux/martin/desktop/payable-01.png`
- `qa-artifacts/ux/martin/desktop/avisos-01.png`
- `qa-artifacts/ux/diego_bot/desktop/resumen-rilo-01.png`
- `qa-artifacts/ux/lucia_completo/desktop/settings-avisos-01.png`
- `qa-artifacts/ux/ana/desktop/hoy-dashboard-01.png`
- `qa-artifacts/ux/ana/desktop/landing-01.png`
- `qa-artifacts/ux/ana/desktop/registro-01.png`
- `qa-artifacts/ux/diego_bot/desktop/planes-01.png`
- `qa-artifacts/ux-redesign/desktop-inicio-shell.png`
- `qa-artifacts/ux-redesign/desktop-sidebar-normal.png`
- `qa-artifacts/ux-redesign/desktop-herramientas-rail.png`
- `qa-artifacts/ux-redesign/desktop-campanita-dropdown.png`
- `qa-artifacts/ux-redesign/desktop-avisos-hoy.png`
- `qa-artifacts/ux-redesign/desktop-configurar-avisos.png`
- `qa-artifacts/ux-redesign/desktop-landing-a11y-ref.png`
- `qa-artifacts/ux/ana/mobile/onboarding-01.png`
- `qa-artifacts/ux/ana/mobile/primera-venta-01.png`
- `qa-artifacts/ux/carla/mobile/pedido-01.png`
- `qa-artifacts/ux/carla/mobile/finalizar-pedido-01.png`
- `qa-artifacts/ux/martin/mobile/payable-01.png`
- `qa-artifacts/ux/martin/mobile/avisos-01.png`
- `qa-artifacts/ux/diego_bot/mobile/resumen-rilo-01.png`
- `qa-artifacts/ux/lucia_completo/mobile/settings-avisos-01.png`
- `qa-artifacts/ux/ana/mobile/hoy-dashboard-01.png`
- `qa-artifacts/ux/ana/mobile/landing-01.png`
- `qa-artifacts/ux/ana/mobile/registro-01.png`
- `qa-artifacts/ux/diego_bot/mobile/planes-01.png`
- `qa-artifacts/ux-redesign/mobile-inicio.png`
- `qa-artifacts/ux-redesign/mobile-drawer.png`
- `qa-artifacts/ux-redesign/mobile-herramientas.png`
- `qa-artifacts/ux-redesign/mobile-campanita.png`
- `qa-artifacts/ux-redesign/mobile-avisos.png`
- `qa-artifacts/ux-redesign/mobile-configurar-avisos.png`
- `qa-artifacts/ux/ana/tablet/onboarding-01.png`
- `qa-artifacts/ux/ana/tablet/primera-venta-01.png`
- `qa-artifacts/ux/carla/tablet/pedido-01.png`
- `qa-artifacts/ux/carla/tablet/finalizar-pedido-01.png`
- `qa-artifacts/ux/martin/tablet/payable-01.png`
- `qa-artifacts/ux/martin/tablet/avisos-01.png`
- `qa-artifacts/ux/diego_bot/tablet/resumen-rilo-01.png`
- `qa-artifacts/ux/lucia_completo/tablet/settings-avisos-01.png`
- `qa-artifacts/ux/ana/tablet/hoy-dashboard-01.png`
- `qa-artifacts/ux/ana/tablet/landing-01.png`
- `qa-artifacts/ux/ana/tablet/registro-01.png`
- `qa-artifacts/ux/diego_bot/tablet/planes-01.png`

## Top 10 UX issues (locales)

_Ninguno._

## Top 5 quick wins

_Sin quick wins pendientes._

## ¿Se siente simple?

1. ¿Usuario no técnico entiende RILO? — **Parcial (landing LOCAL)**.
2. ¿Registro corto? — **Sí (score local)**.
3. ¿Onboarding corto? — **STAGING REQUIRED**.
4. ¿Primera acción obvia? — **STAGING REQUIRED**.
5. ¿Venta sencilla? — **STAGING REQUIRED**.
6. ¿Pedido sencillo? — **STAGING REQUIRED**.
7. ¿Cobrar/finalizar claro? — **STAGING REQUIRED**.
8. ¿Avisos ayudan o abruman? — **STAGING REQUIRED**.
9. ¿Centro de avisos intuitivo? — **STAGING REQUIRED**.
10. ¿Mobile cómodo? — **Heurística LOCAL**.
11. ¿Pantallas cargadas? — Landing con progressive disclosure en ejemplos.
12. ¿Terminología técnica? — Scanner visible-copy LOCAL.
13–18. Bot/ERP/planes — smoke LOCAL / staging pendiente.
19. ¿Blocker UX? — **NO**.
20. ¿Mostrarlo a un cliente real? — **Tras staging + validación humana**.

## Veredicto

**UX READY FOR STAGING**

No se declara “UX PERFECT”.

---

# UX SHELL / AVISOS REDESIGN

Pasada exclusiva UX/UI/responsive del shell ERP (sin cambios de negocio/SSOT).

## Sidebar antes / después

| Antes | Después |
|---|---|
| Lista larga de módulos + Avisos como ítem principal | Primary: Inicio, Clientes, Pedidos, Ventas, Caja + **Herramientas** |
| Scroll interno visible en desktop | Sin `overflow-y-auto` en nav principal |
| Flyout flotante “Más herramientas” tapando contenido | **Rail acoplado** `data-tools-rail` (empuja layout) / 2ª vista drawer en mobile |
| Configuración mezclada | Configuración fija abajo |

## Navegación Avisos

- Sacado del sidebar.
- Acceso principal: campanita del header (`data-avisos-bell`) con badge, preview corto + severity y **Ver todos los avisos** → `/avisos`.
- Misma fuente: `AutomationsService` (sin segundo sistema de notificaciones).

## Layout /avisos

- `PAGE_SHELL_CLASS` + `PAGE_CONTENT_MAX_CLASS` (`max-w-[1500px]`, width 100%).
- Header: título + **Configurar avisos** + “Marcar todos como leídos” / ⋮ mobile.
- Tabs Hoy | Próximos | Resueltos a ancho completo.
- Cards: severity badge + borde sutil, título corto, detalle, meta, **1 CTA primaria**, secundarias livianas.
- Empty: “Todo tranquilo por acá”.
- Próximos: orden por `dueAt` + grupos Hoy/Mañana/Esta semana (solo presentación).

## Coach Bot

- Copy identificado como **Consejo de RILO Bot**.
- Auto-dismiss ~8s + X; persistencia en `sessionStorage`.
- Gestión (solo ERP): sin tips de Bot; solo tip de campanita avisos.
- Completo/Bot: tips Bot ocasionales.
- Mobile: centrado abajo elevado / z-index menor para no tapar CTAs.

## Mobile

- Sidebar desktop oculto; hamburger + drawer.
- Header: ☰ · RILO · 🔔 (campanita siempre visible).
- Herramientas: segunda vista del drawer (Volver + lista), no caja flotante.
- Touch targets ~44px en hamburger/campanita/cerrar.

## Accessibility

- `main#main-content` en layout ERP y shell público.
- Nav con `aria-label`; campanita/hamburger con labels.
- Imágenes decorativas `alt=""` (evita alt redundante en logo).

## Screenshots

`qa-artifacts/ux-redesign/` (fixtures + live si `UX_QA_EMAIL`/`UX_QA_PASSWORD`).

## Tests

- `shell-ux-redesign.spec.ts` — contratos fuente + runtime desktop/mobile.
- Suite: `npm run test:ux` / `npm run test:release`.

---

# NAVIGATION / NOTIFICATIONS UX REDESIGN

## Por qué se cambió

La solución anterior de **“Más herramientas”** era un panel/flyout debajo (o a la derecha) del sidebar que:
- se sentía agendada “aparte”,
- tapaba contenido del main,
- no formaba parte del layout flex,
- en mobile ocupaba espacio de forma incómoda.

## Solución elegida

**Rail lateral acoplado + 2ª vista del drawer (mobile).**

- Sidebar normal: Inicio · Clientes · Pedidos · Ventas · Caja · **Herramientas** · (abajo) Configuración.
- Desktop: al tocar Herramientas se abre `data-tools-rail` (columna adyacente, anima width, empuja el contenido; Escape / ✕ cierra).
- Mobile: Herramientas abre una segunda vista dentro del drawer (Volver + Operación / Administración).
- Sin Avisos en el sidebar; sin flyout flotante legacy.

## Dónde quedaron los avisos

- Campanita del header (único acceso principal): badge, preview corto, severity, **Ver todos los avisos**.
- Ruta `/avisos` con ancho ERP unificado + botón **Configurar avisos** → `/settings?tab=avisos`.
- Configuración → **RILO te avisa** (preferencias, horario, panel/WhatsApp según plan).

## Criterio final (objetivo)

1–9: sidebar limpio, sin caja rara, avisos en campanita, /avisos ok, herramientas accesibles, parte del layout, mobile claro, sin flotantes molestos, config avisos fácil.
10–11: `test:ux` / `test:release` PASS.
