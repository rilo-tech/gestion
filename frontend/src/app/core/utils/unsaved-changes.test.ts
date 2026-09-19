import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstValueFrom, of } from 'rxjs';
import {
  FormDirtyTracker,
  PersistWaiter,
  confirmUnsavedLeave,
  resolveUnsavedLeaveAction,
  stableFormFingerprint,
  type UnsavedChangesHost,
} from './unsaved-changes.ts';

describe('resolveUnsavedLeaveAction', () => {
  it('mapea guardar / descartar / quedarse', () => {
    assert.equal(resolveUnsavedLeaveAction('save'), 'save');
    assert.equal(resolveUnsavedLeaveAction('discard'), 'discard');
    assert.equal(resolveUnsavedLeaveAction(null), 'stay');
    assert.equal(resolveUnsavedLeaveAction('other'), 'stay');
  });
});

describe('stableFormFingerprint', () => {
  it('ignora el orden de claves', () => {
    assert.equal(
      stableFormFingerprint({ b: 1, a: 'x' }),
      stableFormFingerprint({ a: 'x', b: 1 })
    );
  });

  it('trata null y undefined igual', () => {
    assert.equal(stableFormFingerprint({ notas: null }), stableFormFingerprint({ notas: undefined }));
  });
});

describe('FormDirtyTracker', () => {
  it('detecta cambios y vuelve a limpio al recapturar', () => {
    const tracker = new FormDirtyTracker();
    tracker.capture({ descripcion: '' });
    assert.equal(tracker.isDirty({ descripcion: '' }), false);
    assert.equal(tracker.isDirty({ descripcion: 'bordado largo' }), true);
    tracker.capture({ descripcion: 'bordado largo' });
    assert.equal(tracker.isDirty({ descripcion: 'bordado largo' }), false);
  });
});

describe('PersistWaiter', () => {
  it('resuelve el pendiente y descarta uno anterior', async () => {
    const waiter = new PersistWaiter();
    const first = waiter.start();
    const second = waiter.start();
    waiter.finish(true);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(waiter.isPending, false);
  });
});

describe('confirmUnsavedLeave', () => {
  it('guardar persiste y deja salir', async () => {
    let persisted = false;
    const host: UnsavedChangesHost = {
      hasUnsavedChanges: () => true,
      persistUnsavedChanges: async () => {
        persisted = true;
        return true;
      },
    };
    const allowed = await firstValueFrom(
      confirmUnsavedLeave({ choose: () => of('save') } as never, host)
    );
    assert.equal(allowed, true);
    assert.equal(persisted, true);
  });

  it('si el guardado falla, se queda en la pantalla', async () => {
    const host: UnsavedChangesHost = {
      hasUnsavedChanges: () => true,
      persistUnsavedChanges: async () => false,
    };
    const allowed = await firstValueFrom(
      confirmUnsavedLeave({ choose: () => of('save') } as never, host)
    );
    assert.equal(allowed, false);
  });

  it('descartar sale sin persistir', async () => {
    let persisted = false;
    let acknowledged: 'save' | 'discard' | undefined;
    const host: UnsavedChangesHost = {
      hasUnsavedChanges: () => true,
      persistUnsavedChanges: async () => {
        persisted = true;
        return true;
      },
      acknowledgeUnsavedLeave: (action) => {
        acknowledged = action;
      },
    };
    const allowed = await firstValueFrom(
      confirmUnsavedLeave({ choose: () => of('discard') } as never, host)
    );
    assert.equal(allowed, true);
    assert.equal(persisted, false);
    assert.equal(acknowledged, 'discard');
  });

  it('seguir editando cancela la navegación', async () => {
    const host: UnsavedChangesHost = {
      hasUnsavedChanges: () => true,
      persistUnsavedChanges: async () => true,
    };
    const allowed = await firstValueFrom(
      confirmUnsavedLeave({ choose: () => of(null) } as never, host)
    );
    assert.equal(allowed, false);
  });
});
