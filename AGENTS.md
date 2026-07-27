# AGENTS.md

## Cursor Cloud specific instructions

RILO Gestión is a single multi-tenant ERP/SaaS web app. In local dev it runs as one combined
Express API + Vite (Angular 21) server on `http://localhost:3000`, backed by the Firebase
emulators. Cloud Functions (`functions/`) only mirror the production deploy shape and are not used
for local dev. Standard commands live in `package.json` scripts and `DEPLOY.md`.

### Running the app (two long-lived services, use tmux)
1. `npm run emulators` — starts the Firebase emulators (Firestore 8080, Auth 9099, Functions 5001,
   UI 4000). Java is required and is preinstalled. The Firestore emulator is the **only hard
   dependency**: without it every `/api/**` route returns HTTP 503.
2. `npm run dev` — `tsx watch server.ts` serves the Angular frontend **and** the `/api` backend
   together at `http://localhost:3000`. The backend auto-bootstraps the default platform admin and
   plans on the first `/api` request (watch for `[api] Bootstrap listo`).

The root `.env` (copied from `.env.example`) must exist before `npm run dev`; it points the backend
at the emulator (`USE_FIRESTORE_EMULATOR=true`) and seeds `PLATFORM_ADMIN_USER/PASSWORD`. The `.env`
lives at the repo root, not in `frontend/`. Never set `NODE_ENV=production` for local dev — Vite can
emit an empty client bundle and serve a blank page.

### Logging in (non-obvious)
- **Platform/superadmin login is a separate route: `/acceso-plataforma`** (no UI toggle on the main
  page). Default credentials are `superadmin` / `superadmin` from `.env`. Via API, send
  `POST /api/auth/login` with `{"login":"superadmin","password":"superadmin","scope":"platform"}`.
- The main page (`/`) is the **company** login and requires a business code ("Empresa"). Company
  users only exist after a platform admin creates a business.

### Lint / test / build
- `npm run build` (Vite frontend) and `npm run build:functions` (esbuild) both work.
- `npm run lint` is **not usable as-is**: ESLint is not a declared dependency and there is no ESLint
  config in the repo, so the script fails with `eslint: not found`. There is no automated test suite.
- Health check: `curl http://localhost:3000/api/health` should return `{"status":"ok",...}`.
