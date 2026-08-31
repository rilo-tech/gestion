# Arquitectura RiloBot — interpretación

Actualizado 28 ago 2026.

## Flujo canónico

```
mensaje WhatsApp (rawUserMessage, inmutable)
        ↓
ConversationState + memoria confirmada
        ↓
interpretTurn()  →  Gemini structured output  (única capa semántica)
        ↓
resolvers ERP (IDs, catálogo, saldo real)
        ↓
OperationPlan (inmutable)
        ↓
preguntar faltantes / confirmar
        ↓
ejecutar el plan  (no reinterpreta el mensaje)
```

Gemini interpreta. El backend valida, resuelve IDs, aplica reglas de negocio, persiste y presenta.

`parseWithRules` queda como fallback si Gemini no responde. No reescribe notas, ítems ni estado que Gemini ya interpretó.

## Capas

| Capa | Archivo |
|---|---|
| WhatsAppTransport | `routes/whatsapp-webhook.ts`, `meta-api.ts` |
| ConversationOrchestrator | `conversation-engine.ts` (`interpretTurn`), `message-handler.ts` |
| GeminiInterpreter | `ai-command-parser.ts` (`parseWithGemini`) |
| EntityResolvers | `lookups.ts`, `catalog-rank.ts` |
| BusinessRules | `order-finance.ts`, `required-fields.ts`, `order-config` |
| OperationPlanner | `operation-plan.ts` |
| ConfirmationManager | `askConfirmation` / `handlePendingConfirmation` |
| ERPDomainServices | `erp-writes.ts`, `erp-queries.ts` |
| FirestoreRepositories | `firestore-mappers.ts`, `conversation-state.ts` |
| WhatsappPresenter | `whatsapp-present.ts`, `shared/whatsapp-format.ts` |
