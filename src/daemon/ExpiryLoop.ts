import type { LeaseManager } from './LeaseManager.js';

export class ExpiryLoop {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly leaseManager: LeaseManager,
    private readonly intervalMs = 1_000
  ) {}

  start(): void {
    if (this.timer != null) {
      return;
    }

    this.timer = setInterval(() => {
      this.leaseManager.expireLeases();
    }, this.intervalMs);

    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer == null) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }
}
