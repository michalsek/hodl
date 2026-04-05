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

export interface LockHolderSummary extends OwnerIdentity {
  token: string;
  lease_id: string;
  canonical_path: string;
  generation: number;
  acquired_at: string;
  expires_at: string;
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
