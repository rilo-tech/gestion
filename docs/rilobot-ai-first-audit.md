# RiloBot — revisión AI-first (estabilización)

## Decisiones aprobadas (no tocar aún)

- NO reemplazar `catalog-rank` por selección libre del LLM
- NO eliminar confirmaciones para acciones sensibles
- NO reemplazar todo el workflow visual por Agent
- NO unificar stores de memoria en un solo sistema

## Confirmaciones naturales

`classifyConfirmReply` entiende confirmación/cancelación natural corta.
Ambiguo → `correct` (no ejecuta). Backend + `pendingIntent` siguen siendo autoridad.

## Aliases confirmados

Tras elegir 1–N:

| Entidad | Store |
|---------|--------|
| Cliente | `whatsapp_client_aliases` + languageMemory |
| Producto | `whatsapp_product_aliases` + languageMemory |
| Proveedor | `whatsapp_supplier_aliases` + languageMemory |

`resolveSupplierMatch` / client / product resuelven alias confirmado a ID si sigue válido.
No se guardan inferencias no confirmadas.

## recentOperation

IDs ordenados post-write/list. Follow-ups «cómo quedaron / el tercero / listamelos» → `list_recent_operation_records` / IDs, no re-búsqueda textual.

## Multipaso

Prompt: combinar tools existentes; si falta tool, decirlo; no inventar.

## Todavía rígido (a propósito)

- Protocolo confirm + menú 1–N + settle post-estado
- Máquina de borrador visual
- Lookups ERP / `catalog-rank`

## Gaps de tools (ejemplos)

- Ranking global «quién debe más» sin tool de deudores agregados
- «Poco stock + vendido por producto este mes» puede requerir N calls; no hay tool compuesto
