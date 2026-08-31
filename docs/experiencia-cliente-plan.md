# Experiencia RILO — auditoría, gaps y plan

**Fecha:** 2026-08-29  
**Estado:** diagnóstico. Todavía no implementado.  
**Regla:** reutilizar lo que ya existe. No rehacer el ERP ni el bot.

---

## Respuesta corta

**Por qué con `rilo` entras al ERP:** `homeRoute` manda a `/dashboard` si el panel web está activo. Ese tenant es **completo** (Bot + Gestión). No hay un home para “ambos”; Completo = mismo ERP que solo Gestión. El login no está mal.

### Qué ya está bien (no rehacer)

- Landing vendedora, 3 productos, precios **vivos** desde Superadmin.
- Páginas `/whatsapp` y `/rilo-gestion`.
- Registro eligiendo Bot / Gestión / Completo.
- **Un login de cliente** (`/login` + código de empresa). Superadmin aparte (`/acceso-plataforma`) — conviene dejarlo así.
- `platformAccess` ya modela solo Bot, solo ERP o ambos.
- Cupos, packs extra, extra por Superadmin, trial, `paidUntil`, override de precio por empresa.
- `/plan` ya muestra usadas / tope / packs (`PlanStatusCard`).
- Solo Bot ya **no entra al ERP** (`erpWebGuard` → `/mi-cuenta`).
- Guía visual y chat demo en la landing.

### Huecos reales

| Falta | Hoy |
|---|---|
| Home para Bot+ERP | Caen en `/dashboard` |
| Home solo Bot de verdad | `/mi-cuenta` disfrazado de “Inicio” |
| Ocultar “Ingresar” en `/login` | El nav lo muestra igual |
| Logo centrado en login | Alineado a la izquierda (`-ml-3`) |
| Onboarding in-app | Solo marketing |
| “200 acciones” plan Bot | Default **1000** (trial **150**) |
| IA en el hero | Está en el FAQ, no en el título |

### Plan (reutilizar, no reescribir)

1. Nueva ruta **`/inicio`** (`ClientHomeComponent`) armada con `PlanStatusCard` + ayuda del bot + accesos.
2. Cambiar `homeRoute`: solo ERP → `/dashboard`; solo Bot o ambos → `/inicio`.
3. `/dashboard` sigue siendo el panel ERP.
4. `/mi-cuenta` vuelve a ser perfil.
5. Reusar `RitotechVisualGuideComponent` como onboarding con checklist.
6. Etapa 0 (UI): centrar logo; no mostrar Ingresar en `/login`.

Superadmin **ya puede** editar precios, planes, producto por empresa, acciones extra, trial y ver costo estimado. No hace falta un panel nuevo para eso. El default 200 acciones se puede poner en el tab Planes o en el catálogo cuando se confirme.

Detalle por sección abajo.

---

## 1. Auditoría actual

### A. Landing

| Ruta | Componente |
|---|---|
| `/` | `RitotechLandingComponent` |
| `/planes` | `RitotechPlansComponent` |
| `/whatsapp` | `RitotechProductPageComponent` (`product: whatsapp`) |
| `/rilo-gestion` | `RitotechProductPageComponent` (`product: erp`) |
| `/legal/terminos`, `/legal/privacidad` | `LegalDocumentPageComponent` |

**Shell:** `RitotechPublicShellComponent` — nav: RILO Bot, RILO Gestión, Cómo funciona, Precios, FAQ, Ingresar, Probar N días.

**Secciones de `/`:** hero vendedor (`RILOTECH_HERO`), demo WhatsApp + chat, beneficios, planes (3 cards), packs extra, cómo funciona (3 pasos), FAQ, CTA final, guía visual (modal).

**CTAs:** `Probar 20 días gratis` → `/registro?producto=completo`. Secundario: “Ver cómo funciona”. Link a `/planes`. Productos con CTA propio (`RitotechProductCtaComponent`).

**Precios:** no están hardcodeados en el HTML. Salen de `CommercialCatalogService` → catálogo que edita Superadmin (`shared/commercial-catalog.ts` + Firestore). Default: Bot UYU 690, Gestión 590, Completo 990. Acciones IA default: Bot 1000, Completo 2000, ERP 0. Trial: 20 días, 150 acciones IA, 400 mensajes WA.

**Bot vs Gestión por separado:** sí — páginas `/whatsapp` y `/rilo-gestion`, cards en landing, registro con 3 productos.

**IA:** está en FAQ (“¿Cómo usa inteligencia artificial?”) y en cupos. El hero **no** dice “IA” en el título; habla de WhatsApp/web y orden.

---

### B. Login / registro

| Ruta | Quién |
|---|---|
| `/login` | Cliente (empresa). `LoginComponent` + shell pública |
| `/acceso-plataforma` | Superadmin. `PlatformLoginComponent` (login **aparte**) |
| `/registro` (`/probar-gratis`, `/registro-prueba`) | Alta trial. `TrialRegisterComponent` |
| `/verificar-email` | Verificación mail |

**Auth:** JWT + código de empresa (`businessId`). Google opcional (email debe estar en la empresa). Tenant = `businessCode` en el form.

**Producto ERP/Bot/ambos:** `negocios/{id}.platformAccess` (`erpWebEnabled`, `whatsappEnabled`, `aiEnabled`, `trialProduct`). Helpers en `shared/platform-access.ts`.

**`loginGuard` hoy es no-op** (`() => true`): un usuario logueado puede volver a `/login`. El nav sigue mostrando “Ingresar” en `/login` si no hay sesión.

---

### C. Post-login — por qué `rilo` entra al ERP

```ts
// auth.service.ts
get homeRoute(): string {
  if (this.isPlatformAdmin) return '/platform';
  if (!this.canAccessErpWeb) return '/mi-cuenta';
  return '/dashboard';
}
```

- Superadmin → `/platform`
- Solo Bot (`erpWebEnabled` false o pausado) → `/mi-cuenta` (se titula “Inicio”)
- **Cualquier empresa con panel web operativo → `/dashboard`** (HomeComponent = KPIs de ventas/pedidos/stock)

`erpWebGuard` bloquea el resto del ERP si no hay panel; deja `/mi-cuenta`, `/plan`, `/apariencia`, `/activar-suscripcion`.

**No hay un home/centro de control para “ambos”.** Completo = mismo ERP que solo Gestión.

Por eso `rilo` (completo, WhatsApp + ERP) cae en `/dashboard`.

---

### D. Productos / planes (hay dos capas)

**Capa comercial (landing + trial + cupos IA/WA)**  
`shared/commercial-catalog.ts` persistido por Superadmin. Productos: `whatsapp` | `erp` | `completo`. Precio UY/AR, `includedAi`, `includedWhatsapp`, trial, lite, **packs extra** (500 IA / 500 WA).

**Capa ERP interno (módulos, asientos, override por empresa)**  
`backend/auth/plans.ts`: `plan_basico` (mapea Bot), `plan_intermedio` (Gestión), `plan_profesional`. Superadmin puede override de precio por empresa (`precioBaseOverride`, etc.).

**Asignación a empresa:** `platformAccess` + `trialProduct` + plan ERP. Trial: `enPrueba`, `trialEndDate`, `trialStatus`. Pago: `billing.paidUntil`, `estadoSuscripcion`.

**Add-on acciones:** sí. Packs de catálogo (compra Mercado Pago en `/plan`) + cortesía Superadmin `usageQuota.extraAi` / `extraWhatsapp`.

**Default comercial hoy ≠ regla de negocio pedida:** plan Bot incluye **1000** acciones, no 200. Trial incluye **150**.

---

### E. Superadmin (`/platform`)

Tabs: Empresas, Pruebas activas, Control de pagos, Planes (catálogo comercial + planes ERP).  
Detalle: `/platform/empresas/:id` — producto, canales, extra acciones, trial, marcar pago, override de precio.  
Gastos: `/platform/gastos` — costo estimado Gemini + Meta por empresa (no margen vs cuota cobrada).

Puede: editar precios de landing, included AI/WA, packs, asignar producto, extra acciones, trial, ver consumo.  
No hay: home “de producto” para el superadmin (el panel actual **es** ese home). Margen ingreso−costo: no.

---

### F. Onboarding / manuales

| Qué | Dónde | Tipo |
|---|---|---|
| Guía visual (viñetas Bot/ERP) | `RitotechVisualGuideComponent` | Marketing, modal |
| Chat demo | `RitotechChatDemoComponent` | Landing |
| Cómo usar el bot | `AccountComponent` + `riloBotManualLines` | Lista de texto |
| Settings ERP | `/settings` | Operativo, no tour |

No hay tour in-app, checklist persistido, progreso, ni onboarding distinto por producto **después** del login. El registro sí elige producto (intro de 3 cards).

---

### G. Diseño / UI

- **Público:** dark gray/teal, `RitotechPublicShell`, marca RiloTech + mark RILO Bot.
- **App:** layout claro (dark opcional `ThemeService` / `/apariencia`), sidebar, cards blancas.
- **Reutilizable:** shell pública, CTAs, plan-status-card, form-shell, searchable-select, layout/sidebar.
- **No tocar:** motor WhatsApp, formularios ERP, catálogo comercial (el modelo), `platformAccess`.
- **Ajuste rápido:** logo login (`object-left -ml-3`), ocultar Ingresar en `/login`, hero “IA”, `homeRoute`.

---

## 2. Gap analysis

| Funcionalidad deseada | Ya existe | Parcial | No existe | Archivo/ruta | Ajuste |
|---|---|---|---|---|---|
| Login único ERP/Bot | ✓ `/login` | | | `login.component.ts` | No fusionar con `/acceso-plataforma` |
| Login superadmin | ✓ | | | `/acceso-plataforma` | Dejar aparte |
| Alta ERP, Bot o ambos | ✓ | | | `/registro` | Ninguno de modelo |
| Home solo Bot | | ✓ `/mi-cuenta` como “Inicio” | | `account.component.ts` | Extraer hub, no mezclar con perfil |
| Home ERP+Bot | | | ✓ (va a `/dashboard`) | `homeRoute` | Nuevo `/inicio` hub |
| Home solo ERP | ✓ `/dashboard` | | | `home.component.ts` | OK entrar directo; opcional hub liviano |
| Home superadmin | ✓ `/platform` | | | `platform.component.ts` | OK |
| Ocultar Ingresar en `/login` | | | ✓ | `ritotech-public-shell` | `*ngIf` por URL |
| Logo centrado en login | | | ✓ (izq, `-ml-3`) | `login.component.ts` | `mx-auto object-center` |
| No abrir ERP si no corresponde | ✓ guard | ✓ homeRoute | | `erpWebGuard` + `homeRoute` | Completo no debe saltar el hub |
| Cupo acciones incluidas | ✓ | default 1000 | | `commercial-catalog.ts` | Bajar Bot a 200 si se confirma |
| Packs extra | ✓ | | | catálogo + `/plan` | OK |
| Extra por Superadmin | ✓ | | | `usageQuota.extraAi` | OK |
| Editar precios Superadmin | ✓ | | | tab Planes + detalle empresa | OK |
| Landing = precios reales | ✓ | | | `CommercialCatalogService` | OK |
| Cliente ve usadas/quedan | ✓ | en `/plan` | | `plan-status-card` | Mostrar también en home |
| Onboarding interactivo in-app | | guía landing | ✓ post-login | visual-guide | Reusar modal + checklist |
| Manuales visuales in-app | | texto bot | | `account` | Reusar viñetas + checklist |
| Branding Bot / Gestión | ✓ | hero sin “IA” | | marketing + páginas producto | Copy, no rediseño |

---

## 3. Propuesta funcional (incremental)

No crear un segundo producto. Encajar un **hub post-login** y ajustar redirección.

1. Seguir usando `platformAccess` + catálogo comercial.
2. Un solo login de cliente. Superadmin sigue en `/acceso-plataforma`.
3. Nueva ruta `/inicio` (`ClientHomeComponent`) que **compone** piezas existentes.
4. `/dashboard` queda como **panel ERP** (KPIs), no como puerta de todos.
5. `/mi-cuenta` vuelve a ser solo perfil (hoy es home del bot).
6. Onboarding = reusar `RitotechVisualGuideComponent` + checklist en `negocios/{id}/private/onboarding` o flag en usuario.

---

## 4. Mapa de pantallas / rutas

```
Público
  /                      landing
  /whatsapp              RILO Bot
  /rilo-gestion          RILO Gestión
  /planes                precios (catálogo live)
  /registro              alta 3 productos
  /login                 cliente
  /acceso-plataforma     superadmin

Cliente (auth + companyGuard)
  /inicio                NUEVO hub (Bot / ERP / ambos)
  /dashboard             ERP KPIs (como hoy)
  /plan                  contratado + cupos + packs
  /mi-cuenta             perfil (dejar de ser home del bot)
  /activar-suscripcion   trial vencido
  …resto ERP             igual, con erpWebGuard

Superadmin
  /platform              empresas / pruebas / pagos / planes
  /platform/gastos       costo estimado
  /platform/empresas/:id ficha comercial
```

---

## 5. Componentes a reutilizar

- `RitotechPublicShellComponent`, `RitotechProductCtaComponent`, `RitotechVisualGuideComponent`, `RitotechChatDemoComponent`
- `PlanStatusCardComponent` (cupos, packs, canales)
- `AccountComponent` (bloque “Cómo usar RILO Bot”)
- `HomeComponent` (KPIs ERP)
- `LayoutComponent` + `SidebarComponent` (`navItems` ya se achica si no hay ERP)
- `platformAccess` / `AuthService.canAccessErpWeb` / `canAccessWhatsapp`
- Catálogo comercial + `usageQuota` + packs
- `PlatformUsageComponent` (costo, no margen)

---

## 6. Componentes / piezas nuevas (pocas)

| Nuevo | Rol |
|---|---|
| `ClientHomeComponent` (`/inicio`) | Hub según producto |
| `OnboardingChecklistComponent` | Pasos + progreso; distinta lista Bot / ERP / ambos |
| Flag `onboarding.{bot,erp,completo}` | No repetir la guía |
| Ajuste `homeRoute` + `loginGuard` | Redirección |
| Copy landing (`RILOTECH_HERO` + eyebrow IA) | Sin rediseño |

No hace falta un layout nuevo ni un segundo sidebar.

---

## 7. Reglas de redirección post-login (objetivo)

Orden:

1. Superadmin → `/platform`
2. Trial/cuenta `blocked` o `lite` → `/activar-suscripcion` (ya `trialActiveGuard`)
3. Solo Bot → `/inicio` (hub bot; no ERP)
4. Solo Gestión → `/dashboard` (directo al ERP, como pedís)
5. Ambos → `/inicio` (centro de control: Bot + botón “Abrir RILO Gestión”)
6. Deep link a una ruta ERP con solo Bot → `erpWebGuard` sigue mandando a `/mi-cuenta` o a `/inicio`

```ts
// objetivo (no implementado aún)
if (isPlatformAdmin) return '/platform';
if (canAccessErpWeb && canAccessWhatsapp) return '/inicio';
if (canAccessErpWeb) return '/dashboard';
return '/inicio'; // solo bot
```

`loginGuard`: si ya hay sesión, `navigate` a `homeRoute` (hoy no lo hace).

---

## 8. Modelo de planes/productos (no reinventar)

Seguir con **tres productos comerciales** y flags de canal:

| Producto | `whatsappEnabled` | `erpWebEnabled` | `aiEnabled` |
|---|---|---|---|
| RILO Bot | sí | no | sí |
| RILO Gestión | no | sí | no |
| Completo | sí | sí | sí |

Cupos: `includedAi` / `includedWhatsapp` del catálogo + `purchased*` del mes + `usageQuota.extra*`.

**Cambio de número (cuando se implemente):** `products.whatsapp.includedAi` y el de completo (definir: ¿200+ERP o 200 total?). Hoy Bot=1000, Completo=2000, trial=150.

Capa `plan_basico|intermedio|profesional` se queda para módulos ERP y asientos. Superadmin ya mapea producto landing → plan ERP en ficha de empresa.

Precio por empresa: ya existe override en detalle. No hace falta otro modelo.

---

## 9. Propuesta de home

### Solo Bot (`/inicio`)
- Título: tu negocio en WhatsApp.
- `PlanStatusCard` (acciones usadas / tope / quedan).
- Número registrado + 3 ejemplos (`whatsapp-copy`).
- Checklist onboarding (vincular WA, primer pedido, consultar saldo).
- CTA: Mi plan, packs, perfil.
- Sidebar: un ítem Inicio (ya casi está).

### Solo ERP
- Seguir `/dashboard` (HomeComponent).
- Banner chico opcional: “RILO Gestión activo” + link a `/plan`.
- Onboarding: 3 pasos (clientes, producto, primer pedido/venta).

### Ambos (`/inicio`)
- Dos cards: RILO Bot | RILO Gestión (entrar al panel).
- Cupos IA/WA.
- Próximos pasos (onboarding combinado).
- Acceso rápido: `/dashboard`, `/orders`, `/plan`.

### Superadmin
- Sin cambio de concepto: `/platform` + Gastos.

---

## 10. Onboarding

Reusar la guía visual (tabs WhatsApp / panel). In-app:

1. Primera vez: modal o panel en `/inicio`.
2. Checklist 4–6 ítems, progreso visible, “marcar hecho” / auto si hay 1 pedido.
3. Listas distintas:
   - Bot: escribir al número, confirmar SÍ, consultar caja.
   - ERP: alta cliente, producto, pedido o venta.
   - Ambos: los dos, más “lo de WhatsApp aparece en el panel”.
4. Manual largo: no. El texto actual de Mi cuenta queda como “Ver ejemplos”.

---

## 11. Cambios de UI concretos (etapa 0)

1. Login: logo `mx-auto`, quitar `object-left -ml-3`; título/subtítulo centrados.
2. Shell: no mostrar “Ingresar” si `router.url` empieza con `/login`.
3. Landing: eyebrow tipo “IA que entiende WhatsApp”; hero que nombre Bot y Gestión; CTAs Probar 20 días / Ver cómo funciona / Ver planes (el tercero ya es link; subirlo al row de CTAs).
4. No cambiar paleta ni el ERP interno.

---

## 12. Plan de implementación por etapas

**Etapa 0 — UI (1 PR chico)**  
Login logo + ocultar Ingresar. Cero modelo.

**Etapa 1 — Puerta de entrada**  
`homeRoute` + `/inicio` + `loginGuard`. Mover copy de bot desde Mi cuenta al hub. Completo deja de caer en `/dashboard`. Sidebar: Inicio → `/inicio` si hay bot o ambos.

**Etapa 2 — Cupos en el home**  
Meter `PlanStatusCard` (o un extracto) en `/inicio`. Cliente ve usadas / quedan sin ir a Plan.

**Etapa 3 — Onboarding**  
Checklist + reusar visual-guide. Flags persistidos.

**Etapa 4 — Landing**  
Copy IA + CTAs. Seguir leyendo el catálogo live (no duplicar precios).

**Etapa 5 — Comercial**  
Si se confirma: Bot 200 acciones/mes en catálogo (y trial coherente). Completo: definir cupo. Superadmin ya puede editarlo a mano hoy en tab Planes, sin código.

**Etapa 6 — Superadmin (opcional)**  
Margen: cuota cobrada − Gemini/Meta de `/platform/gastos`. No bloquear el resto.

---

## Qué no hacer

- No unificar `/login` y `/acceso-plataforma`.
- No reescribir landing ni ERP.
- No un segundo sistema de planes.
- No tours tipo Shepherd en cada pantalla del ERP.
- No cambiar el motor conversacional en este trabajo.

Cuando se apruebe, el primer código es **etapa 0 + etapa 1** (login + `/inicio` + redirección).
