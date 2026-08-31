# Cálculo de costo real — RiloBot + Rilo Gestión

**Proyecto:** `rilo-7eff4` (Firebase Blaze)  
**Tenant medido:** `rilo` (RILO Personalizados)  
**Período de IA / WhatsApp / tokens:** agosto 2026 UTC (`usage_2026-08`)  
**Extraído:** 2026-08-29  

No hay `usage_2026-06` ni `usage_2026-07`. Los 30/60 días de Gemini y WhatsApp **no se pueden reconstruir**. Pedidos y caja sí, por `createdAt`.

Esto **no es la factura de Google Cloud**. Gemini se estima con las tarifas de `shared/usage-cost.ts`. Infra Firebase (Firestore, Functions, Hosting, Storage) no está en el medidor de la app: hay que leerla en Console.

---

## 1. Resultado del mes (tenant `rilo`)

| Concepto | Valor | Costo estimado |
|---|---:|---:|
| Llamadas Gemini (con tokens) | 39 | — |
| Input tokens | 220.280 | ver desglose |
| Output tokens | 2.800 | ver desglose |
| **Gemini (tarifas internas)** | | **US$ 0,081** |
| WhatsApp outbound (burbujas `text`) | 102 | **US$ 0,00** (hasta 2026-10-01) |
| WhatsApp inbound | 94 | no se cobra session inbound |
| **Total variable medible hoy** | | **US$ 0,08** |

Si el mismo volumen de outbound se repite **después del 1 oct 2026**, con el proxy de service/utility UY (US$ 0,0113 / burbuja):

| Concepto | Cálculo | Costo |
|---|---|---:|
| WhatsApp session | 102 × 0,0113 | US$ 1,15 |
| Gemini (mismo consumo) | | US$ 0,08 |
| **Total variable medible** | | **US$ 1,23 / mes** |

Firebase (reads, Functions, Hosting, Storage) queda **fuera** de estos US$ 0,08 / 1,23.

---

## 2. Cálculo Gemini (paso a paso)

Tarifas usadas (`shared/usage-cost.ts`), USD por 1 millón de tokens:

| Modelo | Input | Output |
|---|---:|---:|
| `gemini-3.1-flash-lite` | 0,25 | 1,50 |
| `gemini-flash-lite-latest` | 0,25 | 1,50 |
| `gemini-3.5-flash` | 1,50 | 9,00 |

Fórmula:

```
USD = (inputTokens / 1_000_000) × inputPerMillion
    + (outputTokens / 1_000_000) × outputPerMillion
```

### Por modelo (agosto, `rilo`)

| Modelo | Calls | Input | Output | USD input | USD output | USD total |
|---|---:|---:|---:|---:|---:|---:|
| `gemini-flash-lite-latest` | 21 | 146.169 | 1.586 | 146169/1e6 × 0,25 = **0,03654** | 1586/1e6 × 1,50 = **0,00238** | **0,03892** |
| `gemini-3.1-flash-lite` | 14 | 58.078 | 982 | 58078/1e6 × 0,25 = **0,01452** | 982/1e6 × 1,50 = **0,00147** | **0,01599** |
| `gemini-3.5-flash` | 4 | 16.033 | 232 | 16033/1e6 × 1,50 = **0,02405** | 232/1e6 × 9,00 = **0,00209** | **0,02614** |
| **Total** | **39** | **220.280** | **2.800** | **0,07511** | **0,00594** | **0,08105** |

Redondeo del medidor de plataforma: **US$ 0,08**.

### Por herramienta (mismo mes)

| Tool | Calls | Input | Output | Rol |
|---|---:|---:|---:|---|
| `parser` | 26 | 119.694 | 2.249 | interpretTurn v2 + parser legado |
| `catalog` | 12 | 100.286 | 503 | match cliente / producto |
| `voice` | 1 | 300 | 48 | pregunta al margen |
| `clarify` | 0 | 0 | 0 | — |

Promedios (solo agregados; no hay P50/P95):

| Métrica | Cálculo | Valor |
|---|---|---:|
| Input / llamada Gemini | 220.280 / 39 | 5.648 tokens |
| Output / llamada Gemini | 2.800 / 39 | 72 tokens |
| Gemini calls / acción (meter 37) | 39 / 37 | 1,05 |
| Gemini calls / acción (cupo legado 150) | 39 / 150 | 0,26 |

El cupo comercial **no es un SKU de Google**. En agosto el legado (`ai_usage_2026-08`) vale **150** y el meter unificado **37**. El bot corta con `max(150, 37) = 150`.

---

## 3. Cálculo WhatsApp

Integración: **Meta Cloud API directa** (`type: text` solamente). Sin templates.

| Momento | Tarifa | Cálculo | USD |
|---|---|---|---:|
| Hoy (hasta 2026-09-30) | US$ 0 / burbuja | 102 × 0 | **0,00** |
| Desde 2026-10-01 | US$ 0,0113 / outbound (proxy utility UY) | 102 × 0,0113 | **1,15** |

No hay costo de templates (utility / marketing / auth) porque el código no los envía.

---

## 4. Volumen de operación (no es costo, es uso)

| Métrica | 30 días | 60 días | Total histórico |
|---|---:|---:|---:|
| Pedidos (`createdAt`) | 68 | 142 | 238 |
| Ventas (`createdAt`) | 0 | 0 | 275 |
| Compras (`createdAt`) | 0 | 0 | — |
| Movimientos de caja | 43 | 70 | — |
| Clientes / SKUs | — | — | 204 / 379 |
| waOps (escrituras del bot) | 6 meter / 12 legado (solo ago) | — | — |

---

## 5. Tabla de conceptos (para planes)

| Concepto | Unidad | Uso actual | Precio unitario conocido | ¿Fijo o variable? | ¿Atribuible a `businessId`? |
|---|---|---|---|---|---|
| Gemini input flash-lite | 1M tokens | 204.247 tok | US$ 0,25 | Variable por uso | Sí |
| Gemini output flash-lite | 1M tokens | 2.568 tok | US$ 1,50 | Variable por uso | Sí |
| Gemini 3.5 Flash fallback | 1M in / out | 16.033 / 232 tok · 4 calls | US$ 1,50 / US$ 9,00 | Variable por uso | Sí |
| Acción IA (cupo comercial) | acción | 150 legado / 37 meter | no es SKU Google | Variable por evento de código | Sí, pero ≠ 1 Gemini |
| WhatsApp session | burbuja outbound `text` | 102 | US$ 0 hasta 2026-10-01; luego ~US$ 0,0113 | Variable por uso | Sí (`waOutbound`) |
| Templates WA | template | 0 | tarifa Meta por categoría | Variable | N/A hoy |
| Firestore R/W/delete | operación | no extraído | lista Blaze regional | Variable | No (billing de proyecto) |
| Cloud Functions / Cloud Run `api` | invocación + GB-s | 2 functions, 512 MiB, `southamerica-east1` | lista Blaze | Variable | No |
| Hosting | GB + bandwidth | `rilo-7eff4.web.app` | lista Blaze | Fijo bajo + variable | No |
| Storage (fotos) | GB + egress | bucket default | lista Blaze | Variable | Parcial |
| Auth | MAU | en uso | cuota gratis amplia | Casi fijo | No |
| Dominio custom | año | ninguno | — | Fijo si se compra | No |
| Resend | email | `onboarding@resend.dev` | free tier / pago si escala | Fijo plataforma | No |
| Mercado Pago | cobro de plan | checkout | comisión MP | Variable comercial | Sí (pago), no (infra) |

---

## 6. Tabla por `businessId`

| businessId | AI actions | Gemini calls | input tokens | output tokens | WhatsApp messages | Firestore R/W | imágenes | audios |
|---|---:|---:|---:|---:|---|---|---|---|
| `rilo` | cupo 150 / meter 37 | 39 | 220.280 | 2.800 | in 94 + out 102 | no medido | no medido | no medido |

Otros negocios en el proyecto (`prueba`, `rilo-default`): sin medidor de uso en agosto.

---

## 7. Lo que falta para un costo mensual completo

1. **Factura GCP 30/60 días** — [Billing reports](https://console.cloud.google.com/billing/reports?project=rilo-7eff4), filtro proyecto `rilo-7eff4`, Group by Service.  
2. **Factura Gemini** — puede estar en [AI Studio usage](https://aistudio.google.com/usage), no en el mismo billing de Firebase.  
3. **Log por llamada** — sin eso no hay P50/P95 ni costo por foto/audio.  
4. Alinear el cupo de 150 con el meter de 37: hoy el número comercial no refleja las llamadas Gemini reales.

Con el volumen de agosto de este tenant, el **costo variable medible (Gemini + WhatsApp) es despreciable frente a cualquier plan en UYU**: ~US$ 0,08 ahora y ~US$ 1,23/mes si Meta empieza a cobrar session el 1 oct con el mismo outbound.
