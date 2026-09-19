# STAGING_QA_RILO.md

Checklist de **staging + QA humano final**.  
No es deploy a producción. No agrega P2. Precios sin cambios.

**Fecha:** 15/09/2026  
**Release gate técnico:** PASS (`npm run test:release`, 516/0).  
**Producción:** `rilo-7eff4` — **NO tocada** en esta pasada.  
**Región Functions:** `southamerica-east1` (igual prod; ver `firebase.json` / `functions/src/index.ts`).

### Leyenda

| Marca | Significado |
|---|---|
| PASS | Verificado |
| FAIL | Falló |
| NOT TESTED | Requiere humano en staging vivo |
| BLOCKED | Falta entorno |

### Criterio `READY FOR PRODUCTION CANDIDATE`

0 BLOCKER · 0 HIGH · release PASS · builds PASS · funnel/Bot/Gestión/Completo/legacy/avisos PASS (humano).

---

# Provisionamiento staging

## Estado actual de servicios

| Pieza | Estado | Notas |
|---|---|---|
| Firebase project `rilo-staging` | **NO EXISTE** | Solo listados: `rilo-7eff4`, `gen-lang-client-…` |
| Hosting staging | pendiente | Tras crear proyecto + `npm run deploy:staging` |
| Functions (`southamerica-east1`) | pendiente | Mismas rules/código; env `functions/.env.rilo-staging` |
| Firestore | pendiente | Modo production; rules = mismas que prod |
| Auth | pendiente | Email/password + Google (como prod) |
| Storage | pendiente | Mismas storage rules |
| WhatsApp Meta QA | pendiente | Allowlist `WHATSAPP_STAGING_ALLOWLIST` |
| AI (OpenAI/Gemini) | pendiente | Secrets staging; Agent V4 |
| Email / OTP | listo en código | OTP dev **solo** staging/local (`allowDevOtpExposure`) |
| Billing sandbox | listo en código | Staging fuerza MP sandbox |
| Analytics | listo en código | `environment=staging`; Meta/GA4 off salvo `VITE_ANALYTICS_EXTERNAL=true` |
| Guard anti-prod | PASS | `shared/rilo-environment.ts` + tests (7/7) |
| Seed / reset QA | PASS (scripts) | Solo `rilo-staging` |
| Smoke | PASS (script) | Requiere `APP_URL` staging post-deploy |
| Repo aliases | PASS | `.firebaserc`: production→`rilo-7eff4`, staging→`rilo-staging` |

## ENV-01

| Campo | Valor |
|---|---|
| Severidad | **HIGH** (bloquea QA humano seguro) |
| Estado | **ABIERTO** — proyecto aún no creado |
| Repo | **READY** para usar `rilo-staging` apenas exista |
| Deploy ejecutado | **NO** |

## Paso humano — crear proyecto (exacto)

Firebase Console → [https://console.firebase.google.com/](https://console.firebase.google.com/)

1. **Add project** → nombre display `RILO Staging` → **Project ID = `rilo-staging`** (debe coincidir).
2. Google Analytics: opcional (preferible **desactivar** o propiedad separada).
3. **Billing:** plan **Blaze** (requerido para Cloud Functions v2).
4. Región preferida / location: alinear con prod — Functions ya fijas a **`southamerica-east1`**.
5. Activar:
   - **Authentication** → Email/Password + Google (dominios autorizados del hosting staging).
   - **Firestore** → Create database → **production mode** → location cercana/compatible (p. ej. `southamerica-east1` si disponible).
   - **Storage** → default bucket.
   - **Hosting**
   - **Functions**
6. Crear service account JSON Admin SDK → guardar local como `credentials/rilo-staging-firebase-adminsdk.json` (gitignore).
7. Web app config → completar `VITE_FIREBASE_*` en `.env.staging`.

**No crear el proyecto desde Cursor sin tu OK explícito.** CLI autenticado podría; esta tarea solo deja instrucciones.

## Después de crear el proyecto

```bash
# 1) Env (sin secretos en git)
cp .env.staging.example .env.staging
cp functions/.env.rilo-staging.example functions/.env.rilo-staging
# Completar JWT, Firebase web keys, WA QA, allowlist, MP sandbox, AI…

# 2) Confirmar alias
firebase use staging
# debe resolver rilo-staging — NUNCA rilo-7eff4

# 3) Deploy SOLO staging (cuando autorices)
npm run deploy:staging
# Abort automático si project == rilo-7eff4

# 4) Seed QA
npm run seed:staging:qa

# 5) Smoke
# Setear APP_URL real del hosting staging en .env.staging
npm run test:staging:smoke
```

## Comandos seguros (anti-producción)

| Comando | Efecto |
|---|---|
| `npm run deploy:staging` | Build + deploy **solo** `--project rilo-staging` |
| `npm run seed:staging:qa` | Tenants `qa-bot`, `qa-gestion`, `qa-completo`, `qa-legacy` |
| `npm run reset:staging:qa` | Borra solo ids `qa-*` |
| `npm run test:staging:smoke` | GET frontend/API health/commercial |
| `npm run test:staging:guards` | Unit guards |
| `npm run deploy` | **Producción** (`default` → `rilo-7eff4`) — no usar en QA |

## Tenants seed

| businessId | Producto | Datos |
|---|---|---|
| `qa-bot` | Bot | sparse (empty/onboarding) + `standard_v1` |
| `qa-gestion` | Gestión | Ana/Juan/María, Producto A/B/C, UTE payable |
| `qa-completo` | Completo | igual + WA owner si `WHATSAPP_QA_PHONE` |
| `qa-legacy` | Legacy | DTF/Sublimación/Packaging, cajas custom, labels; **sin** `standard_v1` |

Usuarios: `loginUsername` = businessId; password **no** en git — setear vía platform/trial.

WhatsApp: vincular número Meta de prueba a `qa-completo` / `qa-bot`; debe estar en `WHATSAPP_STAGING_ALLOWLIST`.

## URLs

Documentar solo cuando existan (post-deploy). Hoy:

| URL | Valor |
|---|---|
| Landing / ERP staging | *pendiente* |
| API staging | *pendiente* (`/api/health`) |

No inventar hostnames.

---

## Environment (checklist)

| Check | Resultado |
|---|---|
| Separación LOCAL / STAGING / PROD | PASS |
| `rilo-staging` existe | **FAIL** (ENV-01) |
| Alias firebaserc | PASS |
| Env examples | PASS |
| Emulator E2E | PASS |
| Guard anti-prod scripts | PASS (7 tests) |
| WA allowlist staging | PASS (código) |
| Analytics `environment` + externo off | PASS (código) |
| MP sandbox forced staging | PASS (código) |
| Hosting/Functions desplegados | BLOCKED |
| Smoke contra URL real | BLOCKED |

---

## Bot / Gestión / Completo / Avisos / WhatsApp / Mobile / Desktop / Legacy / Landing / Funnel / Analytics

Ítems de UI/WhatsApp manuales: **NOT TESTED** / **BLOCKED** hasta staging vivo.  
Paridad de dominio: cubierta por release gate previo (no repetir PASS de UI).

---

## Bugs encontrados

| ID | Descripción | Severidad | Estado |
|---|---|---|---|
| ENV-01 | No existe Firebase `rilo-staging` | HIGH | Abierto — repo listo |
| — | — | — | Sin BLOCKER de producto |

## Bugs corregidos / entregados en repo (esta pasada)

- Guards `assertStagingProjectOrThrow` / allowlist WA / OTP staging / MP sandbox / analytics env
- `deploy:staging`, `seed:staging:qa`, `reset:staging:qa`, `test:staging:smoke`
- Plantillas `.env.staging.example`, `functions/.env.rilo-staging.example`

## Pendientes

1. Humano: crear `rilo-staging` (pasos arriba).
2. Completar secretos `.env.staging`.
3. Autorizar y correr `npm run deploy:staging`.
4. `seed:staging:qa` + smoke + checklist humano.
5. Cerrar ENV-01 → re-evaluar PRODUCTION CANDIDATE.

## ROADMAP (no implementar)

Weekly digest · reminders · tasks · push · e-invoicing · barcode marketing.

---

## Veredicto

| Pregunta | Respuesta |
|---|---|
| ¿Existe `rilo-staging`? | **No** |
| ¿Repo listo para staging? | **Sí** |
| ¿Guard anti-production? | **Sí** |
| ¿Env staging listo? | **Plantillas sí** / secretos humano |
| ¿Seed QA listo? | **Sí** (script) |
| ¿WhatsApp staging protegido? | **Sí** (allowlist) |
| ¿Analytics separado? | **Sí** (proyecto + flag) |
| ¿MP sandbox? | **Sí** (forzado) |
| ¿Smoke listos? | **Sí** (post-URL) |
| ¿Paso manual? | **Crear proyecto `rilo-staging` + Blaze + servicios** |
| ¿Listo para ejecutar deploy staging? | **READY TO DEPLOY STAGING** cuando exista el proyecto y env — **no ejecutado** |
| ¿Se tocó producción? | **No** |
| `READY FOR PRODUCTION CANDIDATE` | **No** |
