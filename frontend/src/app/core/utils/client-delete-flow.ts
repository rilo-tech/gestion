import { HttpErrorResponse } from '@angular/common/http';
import { ClientService } from '../services/client.service';
import { DialogService } from '../services/dialog.service';

export function handleClientDeleteError(
  err: unknown,
  clientId: string,
  clientName: string,
  clientService: ClientService,
  dialogService: DialogService,
  onSuccess: () => void
): void {
  const httpErr = err as HttpErrorResponse;
  const message =
    typeof httpErr.error?.error === 'string'
      ? httpErr.error.error
      : 'No se pudo eliminar el cliente.';
  const suggestDeactivate =
    httpErr.status === 409 && httpErr.error?.suggestDeactivate === true;

  if (!suggestDeactivate) {
    dialogService.alert({ title: 'Error', message });
    return;
  }

  dialogService
    .confirm({
      title: 'No se puede eliminar',
      message: `${message} ¿Marcar a ${clientName} como inactivo?`,
      confirmLabel: 'Marcar inactivo',
      variant: 'danger',
    })
    .subscribe((confirmed) => {
      if (!confirmed) return;
      clientService.setClientActive(clientId, false).subscribe({
        next: () => onSuccess(),
        error: () =>
          dialogService.alert({
            title: 'Error',
            message: 'No se pudo desactivar el cliente.',
          }),
      });
    });
}
