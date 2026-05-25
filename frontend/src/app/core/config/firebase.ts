import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';

const projectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'gen-lang-client-0481869353';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
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

const useAuthEmulator =
  import.meta.env.VITE_USE_FIREBASE_AUTH_EMULATOR === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_AUTH_EMULATOR !== 'false');

export const isAuthEmulatorEnabled = useAuthEmulator;

if (useAuthEmulator) {
  const host = resolveAuthEmulatorHost();
  connectAuthEmulator(firebaseAuth, `http://${host}:9099`, { disableWarnings: true });
}
