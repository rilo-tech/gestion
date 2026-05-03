import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';

// Since we are in AI Studio, we try to use default credentials or project ID
const projectId = 'gen-lang-client-0481869353'; // From firebase-applet-config.json

if (!getApps().length) {
  initializeApp({
    projectId: projectId
  });
}

export const db = getFirestore();
