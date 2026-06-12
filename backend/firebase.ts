import dotenv from 'dotenv';

dotenv.config();

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  '';
const useEmulator = process.env.USE_FIRESTORE_EMULATOR === 'true';

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

if (!getApps().length) {
  const storageBucket = resolveStorageBucket(projectId);
  if (projectId) {
    initializeApp({ projectId, storageBucket });
  } else {
    initializeApp({ storageBucket });
  }
}

function resolveStorageBucket(id: string): string {
  const fromEnv = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (fromEnv) return fromEnv;
  if (id) return `${id}.firebasestorage.app`;
  return '';
}

export const firebaseStorageBucket = resolveStorageBucket(projectId);

export const db = getFirestore();
export const adminAuth = getAuth();
export const adminStorage = getStorage();

if (useEmulator) {
  console.log(
    `[firebase] Firestore emulator @ ${process.env.FIRESTORE_EMULATOR_HOST}`
  );
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    console.log(
      `[firebase] Storage emulator @ ${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`
    );
  }
}
