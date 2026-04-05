import { randomUUID } from 'node:crypto';

import type { LockEvent, SubscriptionResponse, SubscriptionScope } from '../protocol/Types.js';

interface SubscriptionRecord {
  id: string;
  scope: SubscriptionScope;
  stream?: EventSink;
}

export interface EventSink {
  send(event: LockEvent): void;
  close(): void;
}

export class EventBus {
  private readonly subscriptions = new Map<string, SubscriptionRecord>();

  hasSubscription(subscriptionId: string): boolean {
    return this.subscriptions.has(subscriptionId);
  }

  createSubscription(scope: SubscriptionScope): SubscriptionResponse {
    const subscriptionId = randomUUID();

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      scope,
    });

    return {
      subscription_id: subscriptionId,
      stream_path: `/v1/subscriptions/${subscriptionId}/events`,
    };
  }

  attachSink(subscriptionId: string, sink: EventSink): SubscriptionRecord | undefined {
    const record = this.subscriptions.get(subscriptionId);

    if (record == null) {
      return undefined;
    }

    record.stream?.close();
    record.stream = sink;

    return record;
  }

  removeSubscription(subscriptionId: string): boolean {
    const record = this.subscriptions.get(subscriptionId);

    record?.stream?.close();

    return this.subscriptions.delete(subscriptionId);
  }

  emit(event: LockEvent): void {
    for (const record of this.subscriptions.values()) {
      if (matchesScope(record.scope, event.canonical_path)) {
        record.stream?.send(event);
      }
    }
  }
}

function matchesScope(scope: SubscriptionScope, canonicalPath: string): boolean {
  if (scope.kind === 'path') {
    return scope.path === canonicalPath;
  }

  return canonicalPath.startsWith(scope.prefix);
}
