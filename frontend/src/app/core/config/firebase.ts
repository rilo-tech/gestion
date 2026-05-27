import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';

const PLACEHOLDER_API_KEYS = new Set([
  'demo-api-key',
  'your-web-api-key',
  'your_api_key',
  'missing-api-key',
]);

function isPlaceholderApiKey(key: string | undefined): boolean {
  if (!key?.trim()) return true;
  const normalized = key.trim().toLowerCase();
  return PLACEHOLDER_API_KEYS.has(normalized) || normalized.startsWith('your-');
}

const projectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || 'rilo-7eff4';

/** Solo activo si está explícitamente en true (no por defecto en dev). */
export const isAuthEmulatorEnabled =
  import.meta.env.VITE_USE_FIREBASE_AUTH_EMULATOR === 'true';

const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();

const apiKey = (() => {
  if (isAuthEmulatorEnabled) {
    if (envApiKey && !isPlaceholderApiKey(envApiKey)) return envApiKey;
    return 'demo-api-key';
  }
  if (envApiKey && !isPlaceholderApiKey(envApiKey)) return envApiKey;
  return '';
})();

export const isFirebaseClientConfigured = !!apiKey;

const firebaseConfig = {
  apiKey: apiKey || 'missing-api-key',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    `${projectId}.firebaseapp.com`,
  projectId,
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

function resolveAuthEmulatorHost(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return '127.0.0.1';
}

if (isAuthEmulatorEnabled) {
  const host = resolveAuthEmulatorHost();
  connectAuthEmulator(firebaseAuth, `http://${host}:9099`, { disableWarnings: true });
}

if (import.meta.env.DEV && !isAuthEmulatorEnabled && !isFirebaseClientConfigured) {
  console.warn(
    '[RILO] Falta VITE_FIREBASE_API_KEY en gestion/.env. Reiniciá npm run dev después de guardar el archivo.'
  );
}
