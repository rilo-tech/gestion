import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type DialogVariant = 'danger' | 'default';

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

  dismiss() {
    this.requestSubject.next(null);
  }
}
