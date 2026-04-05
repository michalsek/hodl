export type OwnerType = 'agent' | 'subagent' | 'vscode' | 'cli';

export interface OwnerIdentity {
  owner_type: OwnerType;
  owner_id: string;
  session_id: string;
}

export interface AcquireRequest extends OwnerIdentity {
  path: string;
  ttl_ms?: number;
}

export interface RenewRequest {
  token: string;
}

export interface ReleaseRequest {
  token: string;
}

export interface GetStatusRequest {
  path: string;
}

export interface ExactSubscriptionScope {
  kind: 'path';
  path: string;
}

export interface PrefixSubscriptionScope {
  kind: 'prefix';
  prefix: string;
}

export type SubscriptionScope = ExactSubscriptionScope | PrefixSubscriptionScope;

export interface SubscribeRequest {
  path?: string;
  prefix?: string;
}

export interface LockHolderSummary extends OwnerIdentity {
  token: string;
  lease_id: string;
  canonical_path: string;
  generation: number;
  acquired_at: string;
  expires_at: string;
}

export interface DaemonErrorPayload {
  code: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface AcquireSuccessPayload {
  outcome: 'acquired';
  canonical_path: string;
  token: string;
  lease_id: string;
  generation: number;
  acquired_at: string;
  expires_at: string;
  daemon_epoch: string;
}

export interface AcquireDeniedPayload {
  outcome: 'denied';
  canonical_path: string;
  holder: LockHolderSummary;
  generation: number;
  expires_at: string;
  retry_after_ms: number;
  daemon_epoch: string;
}

export type AcquireResponse = AcquireSuccessPayload | AcquireDeniedPayload;

export interface RenewSuccessPayload {
  outcome: 'renewed';
  token: string;
  canonical_path: string;
  generation: number;
  expires_at: string;
  daemon_epoch: string;
}

export interface ReleaseResponse {
  outcome: 'released' | 'already_released';
  canonical_path: string | null;
  generation: number | null;
  daemon_epoch: string;
}

export interface LockFreeStatus {
  canonical_path: string;
  state: 'free';
  daemon_epoch: string;
}

export interface LockHeldStatus {
  canonical_path: string;
  state: 'held';
  holder: LockHolderSummary;
  generation: number;
  expires_at: string;
  daemon_epoch: string;
}

export type GetStatusResponse = LockFreeStatus | LockHeldStatus;

export interface LiveLockRecord extends LockHolderSummary {
  remaining_ttl_ms: number;
}

export interface ListLocksResponse {
  locks: LiveLockRecord[];
  daemon_epoch: string;
  server_time: string;
}

export interface SubscriptionResponse {
  subscription_id: string;
  stream_path: string;
}

export type LockEventType =
  | 'LOCK_ACQUIRED'
  | 'LOCK_DENIED'
  | 'LOCK_RELEASED'
  | 'LOCK_EXPIRED'
  | 'LOCK_STOLEN';

export interface LockEvent {
  event_id: string;
  event_type: LockEventType;
  canonical_path: string;
  generation: number;
  occurred_at: string;
  daemon_epoch: string;
  owner?: OwnerIdentity;
  holder?: LockHolderSummary;
  reason?: string;
}

export interface HealthResponse {
  status: 'ok';
  daemon_epoch: string;
  socket_path: string;
}
