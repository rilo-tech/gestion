import { getRedirectResult, type UserCredential } from 'firebase/auth';
import { firebaseAuth } from '../config/firebase';
import { GOOGLE_LOGIN_BUSINESS_KEY, GOOGLE_LOGIN_SCOPE_KEY } from '../constants/google-auth-storage';

let redirectResultPromise: Promise<UserCredential | null> | null = null;

/** Firebase solo permite consumir el resultado del redirect una vez por carga de página. */
export function getGoogleRedirectResultOnce(): Promise<UserCredential | null> {
  redirectResultPromise ??= firebaseAuth.authStateReady().then(() => getRedirectResult(firebaseAuth));
  return redirectResultPromise;
}

export function hasPendingGoogleLogin(): boolean {
  const scope = sessionStorage.getItem(GOOGLE_LOGIN_SCOPE_KEY);
  const businessId = sessionStorage.getItem(GOOGLE_LOGIN_BUSINESS_KEY)?.trim();
  return scope === 'platform' || !!businessId;
}
