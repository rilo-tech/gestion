import dotenv from 'dotenv';

dotenv.config();

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId =
  process.env.FIREBASE_PROJECT_ID ?? 'gen-lang-client-0481869353';
const useEmulator = process.env.USE_FIRESTORE_EMULATOR === 'true';

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
}

if (!getApps().length) {
  initializeApp({ projectId });
}

export const db = getFirestore();

if (useEmulator) {
  console.log(
    `[firebase] Firestore emulator @ ${process.env.FIRESTORE_EMULATOR_HOST}`
  );
}
