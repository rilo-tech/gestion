# Deploy en Firebase (RILO Gestión)

## Qué pasaba con el login

La app en `https://rilo-7eff4.web.app` es **solo frontend** (archivos en `dist/`).

El login llama a `/api/auth/login`. Sin backend publicado, Hosting devolvía `index.html` y el navegador mostraba:

`SyntaxError: Unexpected token '<' ... is not valid JSON`

Google fallaba igual: elegís la cuenta, pero al validar con la API volvías al login.

## Solución incluida en el repo

La API Express vive en **Cloud Functions** (`functions/`) y Hosting reenvía `/api/**` a esa función.

**Requisito:** proyecto Firebase en plan **Blaze** (pago por uso; tiene cuota gratuita mensual).

1. Activar Blaze: https://console.firebase.google.com/project/rilo-7eff4/usage/details  
2. En la raíz del repo:

```bash
npm run deploy
```

Eso hace: build frontend → build functions → deploy hosting + functions + reglas Firestore.

## Variables de entorno en producción

En **Google Cloud Console → Cloud Functions → api → Variables de entorno** (o Secret Manager), configurá al menos:

| Variable | Uso |
|----------|-----|
| `JWT_SECRET` | Clave larga y aleatoria para sesiones |
| `FIREBASE_PROJECT_ID` | `rilo-7eff4` (suele inferirse solo) |

Opcional (bootstrap inicial):

| Variable | Uso |
|----------|-----|
| `PLATFORM_ADMIN_USER` | Superadmin plataforma |
| `PLATFORM_ADMIN_PASSWORD` | Contraseña inicial |
| `PLATFORM_ADMIN_EMAIL` | Email para Google (plataforma) |

Para datos iniciales en Firestore productivo:

```bash
# .env con GOOGLE_APPLICATION_CREDENTIALS y USE_FIRESTORE_EMULATOR=false
npm run bootstrap:production
```

## Google Sign-In en producción

En Firebase Console → Authentication → Settings → **Authorized domains**, agregá:

- `rilo-7eff4.web.app`
- `rilo-7eff4.firebaseapp.com`

En el build del frontend, el `.env` de la raíz debe tener la **API key real** (no `your-web-api-key`):

- `VITE_FIREBASE_API_KEY=...`
- `VITE_FIREBASE_AUTH_DOMAIN=rilo-7eff4.firebaseapp.com`
- `VITE_USE_FIREBASE_AUTH_EMULATOR=false`

Luego `npm run build` y deploy.

## Desarrollo local

```bash
npm run emulators   # terminal 1
npm run dev         # terminal 2
```

`npm run dev` sirve frontend + API en el mismo puerto (3000).
