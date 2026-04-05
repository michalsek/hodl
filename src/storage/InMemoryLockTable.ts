import type { OwnerIdentity } from '../protocol/Types.js';

export interface StoredLease extends OwnerIdentity {
  token: string;
  lease_id: string;
  canonical_path: string;
  generation: number;
  acquired_at_ms: number;
  expires_at_ms: number;
}

export class InMemoryLockTable {
  private readonly leasesByPath = new Map<string, StoredLease>();
  private readonly pathsByToken = new Map<string, string>();
  private readonly generationsByPath = new Map<string, number>();

  getByPath(canonicalPath: string): StoredLease | undefined {
    return this.leasesByPath.get(canonicalPath);
  }

  getByToken(token: string): StoredLease | undefined {
    const canonicalPath = this.pathsByToken.get(token);

    if (canonicalPath == null) {
      return undefined;
    }

    return this.leasesByPath.get(canonicalPath);
  }

  nextGeneration(canonicalPath: string): number {
    const nextGeneration = (this.generationsByPath.get(canonicalPath) ?? 0) + 1;
    this.generationsByPath.set(canonicalPath, nextGeneration);

    return nextGeneration;
  }

  set(lease: StoredLease): void {
    const previousLease = this.leasesByPath.get(lease.canonical_path);

    if (previousLease != null && previousLease.token !== lease.token) {
      this.pathsByToken.delete(previousLease.token);
    }

    this.leasesByPath.set(lease.canonical_path, lease);
    this.pathsByToken.set(lease.token, lease.canonical_path);
  }

  deleteByPath(canonicalPath: string): StoredLease | undefined {
    const lease = this.leasesByPath.get(canonicalPath);

    if (lease == null) {
      return undefined;
    }

    this.leasesByPath.delete(canonicalPath);
    this.pathsByToken.delete(lease.token);

    return lease;
  }

  values(): IterableIterator<StoredLease> {
    return this.leasesByPath.values();
  }
}
