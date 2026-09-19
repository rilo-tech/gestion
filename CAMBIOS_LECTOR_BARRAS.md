# CAMBIOS_LECTOR_BARRAS.md

Entrega del lector de códigos de barras del ERP web (RiloGestión).  
**No se hizo deploy.** WhatsApp / foto de barcode / QR de pagos quedan fuera de alcance.

---

# Resumen

## Qué ya estaba hecho

- Modal y botón de cámara con `html5-qrcode` (EAN/UPC/Code39/128/ITF/Codabar).
- Integración en ventas, pedidos, compras, alta/edición de producto y panel “Ajuste por código”.
- Búsqueda por barcode / código interno, check de disponibilidad, query `codigoBarras` en alta.
- Feature flag beta hardcodeado a negocio `rilo`.
- Dependencias `@zxing/*` instaladas pero **sin uso** en el código.

## Qué se terminó / corrigió

- Lookup indexado por `codigoBarrasKey` (+ fallback legacy `codigoBarras`), sin full-scan de stock.
- Locks de unicidad `barcode_locks` para create/update concurrentes.
- Ajuste de stock **atómico** (Firestore transaction) + validación de negativo / sin control.
- `usuarioId` del movimiento desde sesión autenticada (ya no `admin` desde el FE).
- Idempotencia técnica con `scanOperationId` (colección `scan_ops`).
- Modos cámara **single** y **continuous** con lock por ausencia (no solo debounce 500ms).
- Torch y cambio de cámara solo si el dispositivo lo permite.
- UX código desconocido: crear / asociar / cancelar.
- Feature flag: beta `rilo` + `erpWebEnabled` + kill-switch `BARCODE_SCANNER_DISABLED` / `BARCODE_SCANNER_KILL_SWITCH`.
- FE usa `newStock` del backend; invalida caché de búsqueda.
- Script `scripts/backfill-product-barcodes.ts` (dry-run por defecto).
- Eliminadas dependencias `@zxing/browser` y `@zxing/library`.
- Tests + builds OK (ver secciones finales).

---

# Arquitectura

```
Cámara / USB / manual
    → normalizeBarcodeKey / sanitizeScannedBarcode (shared/barcode.ts)
    → GET /api/stock/:biz/by-barcode
         1) where codigoBarrasKey == key
         2) where codigoBarras == key (legacy)
         3) fallback código interno exacto
    → producto
    → acción de contexto:
         venta/pedido/compra: addOrIncrement (+ feedback continuo)
         stock: PATCH adjust atómico + scanOperationId
         producto: completar campo + check duplicado
```

---

# Archivos modificados

| archivo | cambio | motivo |
|---|---|---|
| `shared/barcode.ts` | normalización + fields write | SSOT barcode |
| `shared/barcode.test.ts` | tests | cobertura |
| `shared/feature-flags.ts` | ERP + kill-switch | dejar de depender solo de `rilo` |
| `shared/feature-flags.test.ts` | tests | cobertura flag |
| `backend/utils/product-code.ts` | query indexada + locks | performance + unicidad |
| `backend/domain/stock/stock-domain-service.ts` | adjust atómico + actor + idem | race + auditoría |
| `backend/domain/stock/stock-adjust-logic.ts` | validación pura | tests + reuso |
| `backend/domain/stock/stock-adjust-logic.test.ts` | tests concurrente/idem | obligatorio |
| `backend/domain/stock/index.ts` | export `AdjustStockResult` | tipos |
| `backend/routes/stock.ts` | create/update/patch/delete barcode | key, locks, actor, 404 UX |
| `scripts/backfill-product-barcodes.ts` | backfill idempotente | legacy |
| `frontend/.../barcode-scanner-modal.component.ts` | continuous, torch, cams, errores | UX cámara |
| `frontend/.../barcode-scan-lock.ts` (+test) | lock por ausencia | anti multi-frame |
| `frontend/.../barcode-scan-button.component.ts` | mode continuous/single + flag ERP | wiring |
| `frontend/.../barcode-key.ts` | reexport shared | una sola normalización |
| `frontend/.../stock.service.ts` | adjust sin usuarioId; scanOpId; newStock | seguridad + cache |
| `frontend/.../stock-barcode-adjust-panel.component.ts` | continuous + newStock + unknown | stock UX |
| `frontend/.../transaction-product-search.component.ts` | continuous, feedback, unknown/associate | venta/pedido/compra |
| `frontend/.../scan-increment.test.ts` | +1 / +2 | ventas/pedidos/compras |
| `frontend/.../sale-counter-form-panel.component.ts` | returnTo create | unknown barcode |
| `frontend/.../new-order.component.ts` | returnTo create | idem |
| `frontend/.../purchase-form-panel.component.ts` | scanMode manualQuantity | cajas |
| `frontend/.../new-product.component.ts` | alfanumérico + hints ✓/⚠ | producto |
| `frontend/.../stock.component.ts` | flag con erpWebEnabled | gate |
| `frontend/.../app.config.ts` | icons flashlight/switch-camera | UI |
| `package.json` | `test:barcode`; remove zxing | CI local |
| `.env.example` | `BARCODE_SCANNER_DISABLED` | ops |

---

# Flujos

## Producto

Campo Código de barras + Escanear (single). Al leer: completa, chequea disponibilidad (`✓` / `⚠`). Create/Update backend validan duplicado + claim lock. Query `?codigoBarras=` precompleta el alta.

## Venta

Buscador + Escanear (continuous). Match → `addOrIncrementProductFromSearch`. Feedback inline `✓ nombre`. USB/Enter en el campo de búsqueda. Código desconocido → crear / asociar / cancelar.

## Pedido

Igual criterio que venta; respeta read-only del pedido.

## Compra

Mismo buscador con `scanMode="manualQuantity"` (escaneo → cantidad → Agregar) además de agregar unitario por búsqueda.

## Stock

Panel “Ajuste por código”: Uno por uno (continuous +1/−1) o Cantidad manual (single). Mensajes `+1 · Producto · Stock: N` con stock real del backend. Sin control de stock / sin negativo respetan reglas ERP.

---

# Cámara

- **Librería:** `html5-qrcode` (se mantiene; ZXing eliminado por no usarse).
- **Single:** detecta → auto-aplica ~2s o “Usar”; cierra.
- **Continuous:** no cierra; emite cada lectura deliberada.
- **Deduplicación:** lock del código mientras se ve; liberar tras ~900ms sin verlo (`barcode-scan-lock`).
- **Torch:** botón solo si `getCapabilities().torch`.
- **Cámaras:** preferencia `environment`/trasera; selector solo si hay >1.

---

# USB

Lectores HID escriben en el input enfocado + Enter. En venta/pedido/compra el buscador resuelve barcode; en stock el input del panel. Tras agregar se reenfoca el campo.

---

# Backend barcode lookup

`findStockItemByCodigoBarras`:

1. `where('codigoBarrasKey','==',key).limit(5)`
2. si vacío: `where('codigoBarras','==',key).limit(5)` (legacy)

`findStockItemByBarcode` además cae a código interno exacto si no hay barcode.

Resolución documentada:

1. barcode key  
2. código interno  
3. 404 `BARCODE_UNKNOWN`

---

# Compatibilidad legacy

- Lectura funciona sin `codigoBarrasKey`.
- Altas/ediciones nuevas escriben ambos campos.
- Backfill:

```bash
npx tsx scripts/backfill-product-barcodes.ts --businessId=<id> --dry-run
npx tsx scripts/backfill-product-barcodes.ts --businessId=<id> --apply
```

No se ejecutó en producción.

---

# Duplicados

- FE: aviso previo (`barcode-check`).
- BE: query + `claimBarcodeLock` en `negocios/{id}/barcode_locks/{key}`.
- Create/Update 409 si otro producto ya tiene la key.

---

# Stock atomic

`adjustStock` corre en `db.runTransaction`:

1. si hay `scanOperationId` y existe `scan_ops/{id}` → return stock previo (`duplicate`)
2. leer producto
3. validar control / negativo (`assertCanApplyStockDelta`)
4. `stockActual = current + qty`
5. crear movimiento
6. escribir idem doc

Dos escaneos rápidos ya no pueden ambos leer el mismo stock y escribir 11: la transaction serializa.

---

# Idempotencia

FE genera UUID `scanOperationId` por request de ajuste. Retry/callback duplicado con el mismo id no crea segundo movimiento. Dos lecturas físicas deliberadas = dos UUIDs = dos movimientos.

---

# Usuario / auditoría

PATCH ya **no** acepta `usuarioId` del body. Actor = `req.user.userId` (auth). Motivo / negocio / producto / fecha / tipo / cantidad / origen se mantienen; opcionalmente `scanOperationId` en el movimiento.

---

# Unknown barcode

404 amigable. Diálogo: Crear producto (`/stock/new?codigoBarras=…&returnTo=…`) / Asociar (buscar producto y PUT) / Cancelar. Auto-add a la venta tras crear queda como pendiente seguro (returnTo documentado).

---

# Feature flag

`isBarcodeScannerEnabledForBusiness(businessId, { erpWebEnabled })`:

- kill-switch código o env `BARCODE_SCANNER_DISABLED`
- siempre on para beta `rilo` (compat)
- on si `erpWebEnabled === true` (Gestión/Completo con ERP)
- Bot-only sin ERP: sin botón

---

# Tests

```text
npm run test:barcode
→ 17 pass (normalización, flag, stock atomic/idem, lock continuo, scan increment)

npm run test:cash
→ 24 pass

npm run test:commercial
→ 88 pass
```

---

# Build

```text
npm run build          → OK (Vite)
npm run build:functions → OK
```

No deploy.

---

# Pendientes

1. Auto-agregar el producto recién creado a la venta/pedido abierta (hoy: returnTo seguro).
2. Índice compuesto Firestore solo si la consola lo pide (equality single-field suele bastar).
3. Backfill por negocio en staging antes de abrir a todos.
4. Tests unitarios del modal Angular con mock completo de `html5-qrcode` (la lógica crítica de continuous está cubierta en `barcode-scan-lock.test.ts`).
5. WhatsApp barcode (explícitamente fuera de esta tarea).

---

# Deploy

Cuando se decida (NO hecho ahora):

1. Dry-run backfill en staging.
2. `npm run build && npm run build:functions`
3. Deploy hosting + functions (y rules si aplica).
4. QA checklist abajo en un negocio de prueba con ERP.
5. Confirmar kill-switch env vacío / false.
6. Abrir a clientes con ERP (ya gated por `erpWebEnabled`); mantener `rilo` beta intacto.

### QA manual post-deploy

- Android Chrome: trasera, EAN13, poca luz, continuo.
- iPhone Safari: permisos, cerrar/reabrir modal, varios scans.
- Desktop Chrome: webcam o manual.
- USB: venta, pedido, compra, stock.

---

# Auditoría final

1. ¿Puedo escanear desde cámara? **Sí** (`html5-qrcode`).
2. ¿Puedo usar lector USB/Bluetooth? **Sí** (input + Enter).
3. ¿Funciona en venta? **Sí** (continuous + increment).
4. ¿Funciona en pedido? **Sí**.
5. ¿Funciona en compra? **Sí** (también cantidad manual).
6. ¿Funciona para ajustar stock? **Sí** (atómico).
7. ¿Escanear dos veces el mismo producto incrementa correctamente? **Sí** (IDs distintos / addOrIncrement).
8. ¿Un código quieto puede sumar varias veces? **No** (lock por ausencia ~900ms).
9. ¿Dos ajustes simultáneos pueden perder stock? **No** (transaction).
10. ¿Los movimientos usan el usuario autenticado real? **Sí**.
11. ¿Buscar barcode sigue recorriendo toda la colección? **No** (query indexada + legacy puntual).
12. ¿Qué ocurre con productos legacy? **Siguen encontrándose** por `codigoBarras`; backfill opcional agrega key.
13. ¿Puede haber dos productos con el mismo barcode? **No** (BE + lock).
14. ¿Qué ocurre con un barcode desconocido? **Diálogo crear/asociar/cancelar**.
15. ¿Se puede crear producto con ese código precompletado? **Sí**.
16. ¿Se puede asociar a producto existente? **Sí** (en buscador de transacciones; stock sugiere edición).
17. ¿Existe scanner continuo? **Sí**.
18. ¿Funciona linterna si el dispositivo lo soporta? **Sí** (botón condicional).
19. ¿Se puede cambiar cámara? **Sí** si hay más de una.
20. ¿Sigue hardcodeado solamente para `rilo`? **No** — `rilo` sigue habilitado; además ERP web + kill-switch.
21. ¿Todos los tests (barcode/cash/commercial) pasan? **Sí**.
22. ¿Frontend compila? **Sí**.
23. ¿Functions compila? **Sí**.
24. ¿Qué queda pendiente antes de habilitarlo a todos? Backfill staging + QA dispositivos + decidir política comercial si algún plan ERP no debe verlo; kill-switch listo ante incidentes.
