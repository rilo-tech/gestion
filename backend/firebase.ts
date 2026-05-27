import dotenv from 'dotenv';

dotenv.config();

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  '';
const useEmulator = process.env.USE_FIRESTORE_EMULATOR === 'true';

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

if (!getApps().length) {
  // En Cloud Functions usamos automáticamente el proyecto del entorno.
  if (projectId) {
    initializeApp({ projectId });
  } else {
    initializeApp();
  }
}

export const db = getFirestore();
export const adminAuth = getAuth();

if (useEmulator) {
  console.log(
    `[firebase] Firestore emulator @ ${process.env.FIRESTORE_EMULATOR_HOST}`
  );
}
