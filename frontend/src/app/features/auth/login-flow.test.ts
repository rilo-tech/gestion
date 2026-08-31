import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstValueFrom, of, throwError } from 'rxjs';
import { createAuthenticatedLoginPipeline, isLoginNavigationFailure } from './login-flow.ts';

describe('createAuthenticatedLoginPipeline', () => {
  it('HTTP 200 → navigateByUrl once → target correcto → completes', async () => {
    let navigateCalls = 0;
    let navigateTarget = '';
    let finallyCalled = false;

    const result = await firstValueFrom(
      createAuthenticatedLoginPipeline(of({ token: 'x' }), {
        homeRoute: () => '/dashboard',
        navigateByUrl: async (url) => {
          navigateCalls += 1;
          navigateTarget = url;
          return true;
        },
        onFinally: () => {
          finallyCalled = true;
        },
      })
    );

    assert.equal(result, true);
    assert.equal(navigateCalls, 1);
    assert.equal(navigateTarget, '/dashboard');
    assert.equal(finallyCalled, true);
  });

  it('navigation false → error → finally', async () => {
    let finallyCalled = false;
    await assert.rejects(
      () =>
        firstValueFrom(
          createAuthenticatedLoginPipeline(of({ token: 'x' }), {
            homeRoute: () => '/inicio',
            navigateByUrl: async () => false,
            onFinally: () => {
              finallyCalled = true;
            },
          })
        ),
      (err: unknown) => isLoginNavigationFailure(err) && err.code === 'NAVIGATION_FALSE'
    );
    assert.equal(finallyCalled, true);
  });

  it('HTTP error → finally', async () => {
    let finallyCalled = false;
    await assert.rejects(
      () =>
        firstValueFrom(
          createAuthenticatedLoginPipeline(throwError(() => new Error('401')), {
            homeRoute: () => '/dashboard',
            navigateByUrl: async () => true,
            onFinally: () => {
              finallyCalled = true;
            },
          })
        )
    );
    assert.equal(finallyCalled, true);
  });
});
