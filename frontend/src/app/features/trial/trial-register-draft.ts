type TrialRegisterStep = 'intro' | 'form' | 'email' | 'creating' | 'done';

export interface TrialRegisterDraft {
  step: TrialRegisterStep;
  form: {
    businessName: string;
    rubro: string;
    pais: string;
    ciudad: string;
    ownerName: string;
    email: string;
    phoneCountryCode: string;
    phone: string;
    password: string;
    acceptTerms: boolean;
    whatsappOptIn: boolean;
    marketingEmailOptIn: boolean;
    website: string;
  };
  registrationId: string;
  otpCode: string;
  savedAt: number;
}

const DRAFT_KEY = 'rilo.trial-register.draft';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadTrialRegisterDraft(): TrialRegisterDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as TrialRegisterDraft;
    if (!draft?.form || Date.now() - (draft.savedAt ?? 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveTrialRegisterDraft(draft: Omit<TrialRegisterDraft, 'savedAt'>): void {
  try {
    const payload: TrialRegisterDraft = { ...draft, savedAt: Date.now() };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage lleno o no disponible
  }
}

export function clearTrialRegisterDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
