import { randomUUID } from 'node:crypto';

import type { AcquireRequest } from './Protocol';

import { DaemonClient, DaemonClientError } from './DaemonClient';
import type { LeaseUx } from './Ux';

export interface LockableDocument {
  uri: string;
  scheme: string;
  fsPath: string;
  isDirty: boolean;
}

interface DocumentLeaseState {
  document: LockableDocument;
  token?: string;
  acquirePromise?: Promise<void>;
  retryTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
  failureShown: boolean;
}

export interface DocumentLeaseControllerOptions {
  client: DaemonClient;
  ux: LeaseUx;
  ttlMs?: number;
  heartbeatMs?: number;
  retryDelayMs?: number;
  ownerId?: string;
  sessionId?: string;
}

export class DocumentLeaseController {
  private readonly client: DaemonClient;
  private readonly ux: LeaseUx;
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  private readonly retryDelayMs: number;
  private readonly ownerId: string;
  private readonly sessionId: string;
  private readonly states = new Map<string, DocumentLeaseState>();

  constructor(options: DocumentLeaseControllerOptions) {
    this.client = options.client;
    this.ux = options.ux;
    this.ttlMs = options.ttlMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.min(Math.floor(this.ttlMs / 3), 10_000);
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
    this.ownerId = options.ownerId ?? `vscode-${process.pid}`;
    this.sessionId = options.sessionId ?? randomUUID();
  }

  trackDocument(document: LockableDocument): void {
    if (document.scheme !== 'file') {
      return;
    }

    const state = this.ensureState(document);
    state.document = document;
    this.syncState(document.uri);
  }

  onDocumentChange(document: LockableDocument): void {
    if (document.scheme !== 'file') {
      return;
    }

    const state = this.ensureState(document);
    state.document = document;
    this.syncState(document.uri);
  }

  onWillSaveDocument(document: LockableDocument): void {
    const state = this.states.get(document.uri);

    if (document.scheme !== 'file' || state == null) {
      return;
    }

    if (document.isDirty && state.token == null) {
      this.ux.markBlocked(document.uri, 'Cannot confirm a valid file lease before save.');
      this.ux.showSaveWarning(
        document.uri,
        'Save could not be validated against the file-lock daemon. Resolve the lock or wait for retry.'
      );
    }
  }

  async onDocumentSave(document: LockableDocument): Promise<void> {
    if (document.scheme !== 'file') {
      return;
    }

    const state = this.ensureState(document);
    state.document = document;

    if (!document.isDirty) {
      await this.releaseState(state);
    }
  }

  async onDocumentClose(document: LockableDocument): Promise<void> {
    const state = this.states.get(document.uri);

    if (state == null) {
      return;
    }

    await this.releaseState(state);
    this.clearRetry(state);
    this.states.delete(document.uri);
  }

  async dispose(): Promise<void> {
    await Promise.all(Array.from(this.states.values(), (state) => this.releaseState(state)));
    this.states.clear();
    this.ux.dispose();
  }

  private syncState(documentUri: string): void {
    const state = this.states.get(documentUri);

    if (state == null) {
      return;
    }

    if (!state.document.isDirty) {
      void this.releaseState(state);
      return;
    }

    if (state.token != null || state.acquirePromise != null) {
      return;
    }

    state.acquirePromise = this.acquireLease(state).finally(() => {
      state.acquirePromise = undefined;
    });
  }

  private async acquireLease(state: DocumentLeaseState): Promise<void> {
    const request: AcquireRequest = {
      path: state.document.fsPath,
      owner_type: 'vscode',
      owner_id: this.ownerId,
      session_id: this.sessionId,
      ttl_ms: this.ttlMs,
    };

    try {
      const response = await this.client.acquire(request);

      if (response.outcome === 'denied') {
        this.handleBlockedState(
          state,
          `Another writer holds this file until ${response.expires_at}.`
        );
        return;
      }

      state.token = response.token;
      state.failureShown = false;
      this.ux.clearBlocked(state.document.uri);
      this.clearRetry(state);
      this.startHeartbeat(state);
    } catch (error) {
      const message = describeClientError(error, 'The file-lock daemon is unavailable.');
      this.handleBlockedState(state, message);
    }
  }

  private startHeartbeat(state: DocumentLeaseState): void {
    this.stopHeartbeat(state);

    state.heartbeatTimer = setInterval(() => {
      void this.renewLease(state);
    }, this.heartbeatMs);
    state.heartbeatTimer.unref?.();
  }

  private async renewLease(state: DocumentLeaseState): Promise<void> {
    if (state.token == null || !state.document.isDirty) {
      return;
    }

    try {
      await this.client.renew(state.token);
    } catch (error) {
      this.stopHeartbeat(state);
      state.token = undefined;
      const message = describeClientError(error, 'The current file lease was lost.');
      this.ux.showLeaseLost(state.document.uri, message);
      this.handleBlockedState(state, message, false);
    }
  }

  private async releaseState(state: DocumentLeaseState): Promise<void> {
    this.stopHeartbeat(state);
    this.clearRetry(state);
    this.ux.clearBlocked(state.document.uri);
    state.failureShown = false;

    if (state.token == null) {
      return;
    }

    const token = state.token;
    state.token = undefined;

    try {
      await this.client.release(token);
    } catch {
      // Expiry is authoritative. A failed release should not leave the editor blocked.
    }
  }

  private handleBlockedState(
    state: DocumentLeaseState,
    message: string,
    showAcquireFailure = true
  ): void {
    this.stopHeartbeat(state);
    this.ux.markBlocked(state.document.uri, message);

    if (showAcquireFailure && !state.failureShown) {
      this.ux.showAcquireFailure(state.document.uri, message);
      state.failureShown = true;
    }

    this.scheduleRetry(state);
  }

  private scheduleRetry(state: DocumentLeaseState): void {
    if (state.retryTimer != null || !state.document.isDirty) {
      return;
    }

    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined;

      if (state.document.isDirty && state.token == null) {
        this.syncState(state.document.uri);
      }
    }, this.retryDelayMs);
    state.retryTimer.unref?.();
  }

  private clearRetry(state: DocumentLeaseState): void {
    if (state.retryTimer == null) {
      return;
    }

    clearTimeout(state.retryTimer);
    state.retryTimer = undefined;
  }

  private stopHeartbeat(state: DocumentLeaseState): void {
    if (state.heartbeatTimer == null) {
      return;
    }

    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = undefined;
  }

  private ensureState(document: LockableDocument): DocumentLeaseState {
    const existingState = this.states.get(document.uri);

    if (existingState != null) {
      return existingState;
    }

    const createdState: DocumentLeaseState = {
      document,
      failureShown: false,
    };

    this.states.set(document.uri, createdState);

    return createdState;
  }
}

function describeClientError(error: unknown, fallbackMessage: string): string {
  if (error instanceof DaemonClientError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}
