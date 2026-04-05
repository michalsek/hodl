import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentLeaseController, type LockableDocument } from '../DocumentLeaseController';
import { DaemonClientError } from '../DaemonClient';

function createDocument(overrides: Partial<LockableDocument> = {}): LockableDocument {
  return {
    uri: 'file:///tmp/example.ts',
    scheme: 'file',
    fsPath: '/tmp/example.ts',
    isDirty: false,
    ...overrides,
  };
}

describe('DocumentLeaseController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires on first dirty transition and releases on save', async () => {
    const client = {
      acquire: vi.fn().mockResolvedValue({
        outcome: 'acquired',
        token: 'epoch:token-1',
      }),
      renew: vi.fn().mockResolvedValue({
        outcome: 'renewed',
      }),
      release: vi.fn().mockResolvedValue({
        outcome: 'released',
      }),
    };
    const ux = createUx();
    const controller = new DocumentLeaseController({
      client: client as never,
      ux,
      heartbeatMs: 1_000,
      retryDelayMs: 2_000,
      sessionId: 'session-1',
    });

    controller.trackDocument(createDocument());
    controller.onDocumentChange(createDocument({ isDirty: true }));
    await flushPromises();

    expect(client.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/tmp/example.ts',
        owner_type: 'vscode',
      })
    );

    await controller.onDocumentSave(createDocument({ isDirty: false }));
    await controller.dispose();

    expect(client.release).toHaveBeenCalledWith('epoch:token-1');
  });

  it('shows a blocking warning when acquire is denied', async () => {
    const client = {
      acquire: vi.fn().mockResolvedValue({
        outcome: 'denied',
        expires_at: '2026-04-05T12:00:00.000Z',
      }),
      renew: vi.fn(),
      release: vi.fn(),
    };
    const ux = createUx();
    const controller = new DocumentLeaseController({
      client: client as never,
      ux,
      retryDelayMs: 2_000,
      sessionId: 'session-1',
    });

    controller.onDocumentChange(createDocument({ isDirty: true }));
    await flushPromises();
    await controller.dispose();

    expect(ux.markBlocked).toHaveBeenCalled();
    expect(ux.showAcquireFailure).toHaveBeenCalled();
  });

  it('retries after heartbeat renewal fails', async () => {
    const client = {
      acquire: vi
        .fn()
        .mockResolvedValueOnce({
          outcome: 'acquired',
          token: 'epoch:token-1',
        })
        .mockResolvedValueOnce({
          outcome: 'acquired',
          token: 'epoch:token-2',
        }),
      renew: vi
        .fn()
        .mockRejectedValue(new DaemonClientError(409, 'lost_lease', 'The lease was lost.')),
      release: vi.fn(),
    };
    const ux = createUx();
    const controller = new DocumentLeaseController({
      client: client as never,
      ux,
      heartbeatMs: 1_000,
      retryDelayMs: 2_000,
      sessionId: 'session-1',
    });

    controller.onDocumentChange(createDocument({ isDirty: true }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    await controller.dispose();

    expect(ux.showLeaseLost).toHaveBeenCalled();
    expect(client.acquire).toHaveBeenCalledTimes(2);
  });
});

function createUx() {
  return {
    markBlocked: vi.fn(),
    clearBlocked: vi.fn(),
    showAcquireFailure: vi.fn(),
    showLeaseLost: vi.fn(),
    showSaveWarning: vi.fn(),
    dispose: vi.fn(),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
