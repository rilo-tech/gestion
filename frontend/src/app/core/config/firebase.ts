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

const useAuthEmulator = import.meta.env.VITE_USE_FIREBASE_AUTH_EMULATOR === 'true';
if (useAuthEmulator) {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
