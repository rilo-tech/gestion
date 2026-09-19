# qa-human-simulated

Suite Playwright de **QA humano simulado + UX/UI** para RiloTech.

## Comando

```bash
npm run test:ux
```

Opcional staging:

```bash
UX_BASE_URL=https://tu-staging.example npm run test:ux
```

Solo un viewport (más rápido):

```bash
UX_PROJECT=desktop-1366 npm run test:ux
```

## Qué hace

1. Usa `dist/` (build si falta) + `vite preview` en `:4173` (local).
2. Corre escenarios por persona/viewport.
3. Guarda screenshots en `qa-artifacts/ux/`.
4. Genera `UX_QA_RILO.md` en la raíz.

## No hace

- Deploy a producción
- Cambios de precios
- Nuevos módulos de producto

## Personas

Ver `personas.ts`.
