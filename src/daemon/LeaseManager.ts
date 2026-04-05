import { randomUUID } from 'node:crypto';

import type {
  AcquireDeniedPayload,
  AcquireRequest,
  AcquireSuccessPayload,
  GetStatusResponse,
  LockEvent,
  LockEventType,
  LockHolderSummary,
  ListLocksResponse,
  LiveLockRecord,
  OwnerIdentity,
  ReleaseResponse,
  RenewSuccessPayload,
  SubscribeRequest,
  SubscriptionResponse,
  SubscriptionScope,
} from '../protocol/Types.js';
import { EventBus } from './EventBus.js';
import { DaemonError } from './Errors.js';
import {
  canonicalizeAbsoluteFilePath,
  canonicalizeAbsolutePathPrefix,
} from './PathCanonicalizer.js';
import { InMemoryLockTable, type StoredLease } from '../storage/InMemoryLockTable.js';

export interface LeaseManagerOptions {
  daemonEpoch: string;
  defaultTtlMs?: number;
  minTtlMs?: number;
  maxTtlMs?: number;
  now?: () => number;
  eventBus?: EventBus;
  lockTable?: InMemoryLockTable;
}

export interface ExpiredLeaseSummary {
  canonical_path: string;
  generation: number;
}

export class LeaseManager {
  readonly daemonEpoch: string;
  private readonly defaultTtlMs: number;
  private readonly minTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly now: () => number;
  private readonly eventBus: EventBus;
  private readonly lockTable: InMemoryLockTable;

  constructor(options: LeaseManagerOptions) {
    this.daemonEpoch = options.daemonEpoch;
    this.defaultTtlMs = options.defaultTtlMs ?? 30_000;
    this.minTtlMs = options.minTtlMs ?? 5_000;
    this.maxTtlMs = options.maxTtlMs ?? 120_000;
    this.now = options.now ?? Date.now;
    this.eventBus = options.eventBus ?? new EventBus();
    this.lockTable = options.lockTable ?? new InMemoryLockTable();
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  async acquire(request: AcquireRequest): Promise<AcquireSuccessPayload | AcquireDeniedPayload> {
    const canonicalPath = await canonicalizeAbsoluteFilePath(request.path);
    const now = this.now();
    const ttlMs = this.normalizeTtl(request.ttl_ms);

    this.expireLeaseIfNeeded(canonicalPath, now);

    const existingLease = this.lockTable.getByPath(canonicalPath);

    if (existingLease != null) {
      if (sameOwner(existingLease, request)) {
        existingLease.expires_at_ms = now + ttlMs;
        this.lockTable.set(existingLease);

        return this.toAcquireSuccess(existingLease);
      }

      const deniedResponse: AcquireDeniedPayload = {
        outcome: 'denied',
        canonical_path: canonicalPath,
        holder: this.toHolderSummary(existingLease),
        generation: existingLease.generation,
        expires_at: this.toIso(existingLease.expires_at_ms),
        retry_after_ms: Math.max(existingLease.expires_at_ms - now, 250),
        daemon_epoch: this.daemonEpoch,
      };

      this.emitEvent('LOCK_DENIED', canonicalPath, existingLease.generation, {
        owner: this.toOwnerIdentity(request),
        holder: deniedResponse.holder,
        reason: 'lock_held',
      });

      return deniedResponse;
    }

    const lease = this.createLease(request, canonicalPath, now, ttlMs);
    this.lockTable.set(lease);
    this.emitEvent('LOCK_ACQUIRED', canonicalPath, lease.generation, {
      owner: this.toOwnerIdentity(lease),
    });

    return this.toAcquireSuccess(lease);
  }

  renew(token: string): RenewSuccessPayload {
    this.assertTokenEpoch(token);

    const lease = this.lockTable.getByToken(token);

    if (lease == null) {
      throw new DaemonError(409, 'lost_lease', 'The lease token is no longer valid.');
    }

    const now = this.now();

    if (lease.expires_at_ms <= now) {
      this.lockTable.deleteByPath(lease.canonical_path);
      throw new DaemonError(409, 'lost_lease', 'The lease has already expired.');
    }

    lease.expires_at_ms = now + this.defaultTtlMs;
    this.lockTable.set(lease);

    return {
      outcome: 'renewed',
      token: lease.token,
      canonical_path: lease.canonical_path,
      generation: lease.generation,
      expires_at: this.toIso(lease.expires_at_ms),
      daemon_epoch: this.daemonEpoch,
    };
  }

  release(token: string): ReleaseResponse {
    this.assertTokenEpoch(token);

    const lease = this.lockTable.getByToken(token);

    if (lease == null) {
      return {
        outcome: 'already_released',
        canonical_path: null,
        generation: null,
        daemon_epoch: this.daemonEpoch,
      };
    }

    this.lockTable.deleteByPath(lease.canonical_path);
    this.emitEvent('LOCK_RELEASED', lease.canonical_path, lease.generation, {
      owner: this.toOwnerIdentity(lease),
    });

    return {
      outcome: 'released',
      canonical_path: lease.canonical_path,
      generation: lease.generation,
      daemon_epoch: this.daemonEpoch,
    };
  }

  async getStatus(path: string): Promise<GetStatusResponse> {
    const canonicalPath = await canonicalizeAbsoluteFilePath(path);
    const now = this.now();

    this.expireLeaseIfNeeded(canonicalPath, now);

    const lease = this.lockTable.getByPath(canonicalPath);

    if (lease == null) {
      return {
        canonical_path: canonicalPath,
        state: 'free',
        daemon_epoch: this.daemonEpoch,
      };
    }

    return {
      canonical_path: canonicalPath,
      state: 'held',
      holder: this.toHolderSummary(lease),
      generation: lease.generation,
      expires_at: this.toIso(lease.expires_at_ms),
      daemon_epoch: this.daemonEpoch,
    };
  }

  async createSubscription(request: SubscribeRequest): Promise<SubscriptionResponse> {
    const scope = await this.normalizeScope(request);

    return this.eventBus.createSubscription(scope);
  }

  removeSubscription(subscriptionId: string): boolean {
    return this.eventBus.removeSubscription(subscriptionId);
  }

  expireLeases(): ExpiredLeaseSummary[] {
    const now = this.now();
    const expired: ExpiredLeaseSummary[] = [];

    for (const lease of this.lockTable.values()) {
      if (lease.expires_at_ms <= now) {
        this.lockTable.deleteByPath(lease.canonical_path);
        this.emitEvent('LOCK_EXPIRED', lease.canonical_path, lease.generation, {
          owner: this.toOwnerIdentity(lease),
        });
        expired.push({
          canonical_path: lease.canonical_path,
          generation: lease.generation,
        });
      }
    }

    return expired;
  }

  listActiveLocks(): ListLocksResponse {
    this.expireLeases();
    const now = this.now();
    const locks: LiveLockRecord[] = [];

    for (const lease of this.lockTable.values()) {
      if (lease.expires_at_ms <= now) {
        continue;
      }

      locks.push({
        ...this.toHolderSummary(lease),
        remaining_ttl_ms: Math.max(lease.expires_at_ms - now, 0),
      });
    }

    locks.sort((left, right) => left.canonical_path.localeCompare(right.canonical_path));

    return {
      locks,
      daemon_epoch: this.daemonEpoch,
      server_time: this.toIso(now),
    };
  }

  private createLease(
    request: AcquireRequest,
    canonicalPath: string,
    now: number,
    ttlMs: number
  ): StoredLease {
    const generation = this.lockTable.nextGeneration(canonicalPath);

    return {
      owner_type: request.owner_type,
      owner_id: request.owner_id,
      session_id: request.session_id,
      token: `${this.daemonEpoch}:${randomUUID()}`,
      lease_id: randomUUID(),
      canonical_path: canonicalPath,
      generation,
      acquired_at_ms: now,
      expires_at_ms: now + ttlMs,
    };
  }

  private expireLeaseIfNeeded(canonicalPath: string, now: number): void {
    const lease = this.lockTable.getByPath(canonicalPath);

    if (lease == null || lease.expires_at_ms > now) {
      return;
    }

    this.lockTable.deleteByPath(canonicalPath);
    this.emitEvent('LOCK_EXPIRED', canonicalPath, lease.generation, {
      owner: this.toOwnerIdentity(lease),
    });
  }

  private async normalizeScope(request: SubscribeRequest): Promise<SubscriptionScope> {
    if (request.path != null) {
      return {
        kind: 'path',
        path: await canonicalizeAbsoluteFilePath(request.path),
      };
    }

    if (request.prefix != null) {
      return {
        kind: 'prefix',
        prefix: await canonicalizeAbsolutePathPrefix(request.prefix),
      };
    }

    throw new DaemonError(
      400,
      'invalid_subscription_scope',
      'Exactly one of `path` or `prefix` must be provided.'
    );
  }

  private normalizeTtl(requestedTtlMs: number | undefined): number {
    if (requestedTtlMs == null) {
      return this.defaultTtlMs;
    }

    return Math.max(this.minTtlMs, Math.min(this.maxTtlMs, requestedTtlMs));
  }

  private assertTokenEpoch(token: string): void {
    const [tokenEpoch] = token.split(':', 1);

    if (tokenEpoch !== this.daemonEpoch) {
      throw new DaemonError(
        410,
        'daemon_epoch_mismatch',
        'The daemon epoch has changed. Reacquire the lock.'
      );
    }
  }

  private toAcquireSuccess(lease: StoredLease): AcquireSuccessPayload {
    return {
      outcome: 'acquired',
      canonical_path: lease.canonical_path,
      token: lease.token,
      lease_id: lease.lease_id,
      generation: lease.generation,
      acquired_at: this.toIso(lease.acquired_at_ms),
      expires_at: this.toIso(lease.expires_at_ms),
      daemon_epoch: this.daemonEpoch,
    };
  }

  private toHolderSummary(lease: StoredLease): LockHolderSummary {
    return {
      owner_type: lease.owner_type,
      owner_id: lease.owner_id,
      session_id: lease.session_id,
      token: lease.token,
      lease_id: lease.lease_id,
      canonical_path: lease.canonical_path,
      generation: lease.generation,
      acquired_at: this.toIso(lease.acquired_at_ms),
      expires_at: this.toIso(lease.expires_at_ms),
    };
  }

  private toOwnerIdentity(owner: OwnerIdentity): OwnerIdentity {
    return {
      owner_type: owner.owner_type,
      owner_id: owner.owner_id,
      session_id: owner.session_id,
    };
  }

  private emitEvent(
    eventType: LockEventType,
    canonicalPath: string,
    generation: number,
    extras: Pick<LockEvent, 'owner' | 'holder' | 'reason'>
  ): void {
    this.eventBus.emit({
      event_id: randomUUID(),
      event_type: eventType,
      canonical_path: canonicalPath,
      generation,
      occurred_at: this.toIso(this.now()),
      daemon_epoch: this.daemonEpoch,
      ...extras,
    });
  }

  private toIso(timestampMs: number): string {
    return new Date(timestampMs).toISOString();
  }
}

function sameOwner(lease: StoredLease, request: OwnerIdentity): boolean {
  return (
    lease.owner_type === request.owner_type &&
    lease.owner_id === request.owner_id &&
    lease.session_id === request.session_id
  );
}
