export function mapGoogleAuthError(error: unknown): string {
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
    default:
      break;
  }

  if (err?.message?.includes('No matching frame')) {
    return 'Error del emulador de auth. Recargá la página e intentá de nuevo con Google.';
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
