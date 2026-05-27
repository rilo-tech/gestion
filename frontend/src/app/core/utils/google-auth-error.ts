import { API_HTML_RESPONSE_MESSAGE, isHtmlInsteadOfJsonError } from './api-response-error';

export function mapGoogleAuthError(error: unknown): string {
  if (isHtmlInsteadOfJsonError(error)) {
    return API_HTML_RESPONSE_MESSAGE;
  }
  const err = error as {
    code?: string;
    message?: string;
    error?: { error?: string };
  };

  if (err?.error?.error) {
    return String(err.error.error);
  }

  switch (err?.code) {
    case 'auth/popup-closed-by-user':
      return 'Cancelaste el ingreso con Google.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana emergente. Permití popups o usá usuario y contraseña.';
    case 'auth/cancelled-popup-request':
      return 'Esperá a que termine el intento anterior con Google.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Google. Verificá tu conexión y que los emuladores estén corriendo.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'Google no está disponible en este navegador. Usá usuario y contraseña.';
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado para Google. Contactá al administrador.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return (
        'No se pudo conectar con Firebase Auth. Reiniciá npm run dev (para cargar el .env) ' +
        'y verificá VITE_FIREBASE_API_KEY en gestion/.env. Si la clave es correcta, revisá en Google Cloud ' +
        'que la API key permita localhost y que Identity Toolkit esté habilitada.'
      );
    default:
      break;
  }

  if (err?.message?.includes('No matching frame')) {
    return 'Error del emulador de auth. Recargá la página e intentá de nuevo con Google.';
  }

  if (err?.message?.includes('api-key-not-valid') || err?.message?.includes('invalid-api-key')) {
    return (
      'La clave de Firebase no es válida o no se cargó el archivo .env. ' +
      'Verificá VITE_FIREBASE_API_KEY en el .env de la raíz del proyecto y reiniciá npm run dev.'
    );
  }

  if (err?.message && err.message !== 'NO_REDIRECT') {
    return err.message;
  }

  return 'No se pudo ingresar con Google.';
}

export function prefersGoogleRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(max-width: 768px)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}
