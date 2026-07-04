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

  if (suggestDeactivate) {
    dialogService.alert({ title: 'No se puede eliminar', message });
    return;
  }

  dialogService.alert({ title: 'Error', message });
}

export function confirmClientDeletion(
  clientId: string,
  clientName: string,
  clientService: ClientService,
  dialogService: DialogService,
  onSuccess: () => void
): void {
  clientService.getClientDeletionGuard(clientId).subscribe({
    next: (guard) => {
      if (!guard.canDelete) {
        dialogService.alert({
          title: 'No se puede eliminar',
          message:
            guard.message?.trim() ||
            'Este cliente tiene transacciones asociadas. No se puede eliminar del sistema.',
        });
        return;
      }

      dialogService
        .confirm({
          title: 'Eliminar cliente',
          message: `¿Eliminar a ${clientName}? Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar',
          variant: 'danger',
        })
        .subscribe((confirmed) => {
          if (!confirmed) return;

          clientService.deleteClient(clientId).subscribe({
            next: () => onSuccess(),
            error: (err) =>
              handleClientDeleteError(
                err,
                clientId,
                clientName,
                clientService,
                dialogService,
                onSuccess
              ),
          });
        });
    },
    error: () =>
      dialogService.alert({
        title: 'Error',
        message: 'No se pudo verificar si el cliente se puede eliminar.',
      }),
  });
}

