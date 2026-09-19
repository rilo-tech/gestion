import { DestroyRef, Injectable, inject } from '@angular/core';
import { from, of, type Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DialogService } from '../services/dialog.service';

export const UNSAVED_CHANGES_COPY = {
  title: 'Cambios sin guardar',
  message:
    'Tenés cambios sin guardar. Si salís sin guardar, se pierde lo que editaste en esta pantalla.',
  saveLabel: 'Guardar y salir',
  discardLabel: 'Salir sin guardar',
  stayLabel: 'Seguir editando',
} as const;

export type UnsavedLeaveAction = 'save' | 'discard' | 'stay';

export interface UnsavedChangesHost {
  hasUnsavedChanges(): boolean;
  persistUnsavedChanges(): Promise<boolean>;
  skipUnsavedChangesPrompt?(): boolean;
  acknowledgeUnsavedLeave?(action: 'save' | 'discard'): void;
}

export function isUnsavedChangesHost(value: unknown): value is UnsavedChangesHost {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as UnsavedChangesHost;
  return (
    typeof candidate.hasUnsavedChanges === 'function' &&
    typeof candidate.persistUnsavedChanges === 'function'
  );
}

export function resolveUnsavedLeaveAction(choice: string | null): UnsavedLeaveAction {
  if (choice === 'save') return 'save';
  if (choice === 'discard') return 'discard';
  return 'stay';
}

export function stableFormFingerprint(value: unknown): string {
  return JSON.stringify(normalizeForFingerprint(value));
}

function normalizeForFingerprint(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (typeof value !== 'object') return String(value);

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const out: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    out[key] = normalizeForFingerprint(nested);
  }
  return out;
}

export class FormDirtyTracker {
  private baseline = '';

  capture(value: unknown): void {
    this.baseline = stableFormFingerprint(value);
  }

  isDirty(value: unknown): boolean {
    return stableFormFingerprint(value) !== this.baseline;
  }
}

export class PersistWaiter {
  private pending: ((ok: boolean) => void) | null = null;

  start(): Promise<boolean> {
    this.pending?.(false);
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  finish(ok: boolean): void {
    const pending = this.pending;
    this.pending = null;
    pending?.(ok);
  }

  get isPending(): boolean {
    return this.pending !== null;
  }
}

@Injectable({ providedIn: 'root' })
export class UnsavedChangesRegistry {
  private host: UnsavedChangesHost | null = null;
  private allowOnce = false;

  register(host: UnsavedChangesHost): void {
    this.host = host;
  }

  unregister(host: UnsavedChangesHost): void {
    if (this.host === host) this.host = null;
  }

  /** Próxima navegación del router no pide confirmación (subflujo con borrador local). */
  allowNextNavigation(): void {
    this.allowOnce = true;
  }

  consumeAllowNext(): boolean {
    if (!this.allowOnce) return false;
    this.allowOnce = false;
    return true;
  }

  isDirty(): boolean {
    return this.host?.hasUnsavedChanges() === true;
  }
}

export function bindUnsavedChangesHost(host: UnsavedChangesHost): void {
  const registry = inject(UnsavedChangesRegistry);
  const destroyRef = inject(DestroyRef);
  registry.register(host);
  destroyRef.onDestroy(() => registry.unregister(host));
}

export function confirmUnsavedLeave(
  dialog: DialogService,
  host: UnsavedChangesHost
): Observable<boolean> {
  return dialog
    .choose({
      title: UNSAVED_CHANGES_COPY.title,
      message: UNSAVED_CHANGES_COPY.message,
      options: [
        { id: 'save', label: UNSAVED_CHANGES_COPY.saveLabel },
        { id: 'discard', label: UNSAVED_CHANGES_COPY.discardLabel, variant: 'secondary' },
      ],
      cancelLabel: UNSAVED_CHANGES_COPY.stayLabel,
    })
    .pipe(
      switchMap((raw) => {
        const action = resolveUnsavedLeaveAction(raw);
        if (action === 'stay') return of(false);
        if (action === 'discard') {
          host.acknowledgeUnsavedLeave?.('discard');
          return of(true);
        }
        return from(Promise.resolve(host.persistUnsavedChanges())).pipe(
          map((ok) => {
            if (ok) host.acknowledgeUnsavedLeave?.('save');
            return ok;
          }),
          catchError(() => of(false))
        );
      })
    );
}
