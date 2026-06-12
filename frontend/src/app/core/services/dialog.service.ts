import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type DialogVariant = 'danger' | 'default' | 'secondary';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

export interface AlertDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
}

export interface ChoiceDialogOption {
  id: string;
  label: string;
  variant?: DialogVariant;
}

export interface ChoiceDialogOptions {
  title?: string;
  message: string;
  options: ChoiceDialogOption[];
  cancelLabel?: string;
}

export type DialogRequest =
  | {
      type: 'confirm';
      options: ConfirmDialogOptions;
      result: Subject<boolean>;
    }
  | {
      type: 'alert';
      options: AlertDialogOptions;
      result: Subject<void>;
    }
  | {
      type: 'choice';
      options: ChoiceDialogOptions;
      result: Subject<string | null>;
    };

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private requestSubject = new Subject<DialogRequest | null>();
  readonly request$ = this.requestSubject.asObservable();

  confirm(options: ConfirmDialogOptions): Observable<boolean> {
    const result = new Subject<boolean>();
    this.requestSubject.next({ type: 'confirm', options, result });
    return result.asObservable();
  }

  alert(options: AlertDialogOptions): Observable<void> {
    const result = new Subject<void>();
    this.requestSubject.next({ type: 'alert', options, result });
    return result.asObservable();
  }

  /** Diálogo con varios botones de acción. Emite el id elegido o null si se cancela. */
  choose(options: ChoiceDialogOptions): Observable<string | null> {
    const result = new Subject<string | null>();
    this.requestSubject.next({ type: 'choice', options, result });
    return result.asObservable();
  }

  dismiss() {
    this.requestSubject.next(null);
  }
}
