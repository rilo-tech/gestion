import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { DialogService } from '../services/dialog.service';
import {
  confirmUnsavedLeave,
  isUnsavedChangesHost,
  UnsavedChangesRegistry,
  type UnsavedChangesHost,
} from '../utils/unsaved-changes';

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesHost> = (component) => {
  const registry = inject(UnsavedChangesRegistry);
  if (registry.consumeAllowNext()) return true;
  if (!isUnsavedChangesHost(component)) return true;
  if (component.skipUnsavedChangesPrompt?.()) return true;
  if (!component.hasUnsavedChanges()) return true;
  return confirmUnsavedLeave(inject(DialogService), component);
};
