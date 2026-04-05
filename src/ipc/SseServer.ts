import type { ServerResponse } from 'node:http';

import type { LockEvent } from '../protocol/Types.js';
import type { EventSink } from '../daemon/EventBus.js';

export class SseSink implements EventSink {
  private closed = false;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly response: ServerResponse) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');

    this.heartbeat = setInterval(() => {
      if (!this.closed) {
        response.write(': heartbeat\n\n');
      }
    }, 15_000);
    this.heartbeat.unref?.();
  }

  send(event: LockEvent): void {
    if (this.closed) {
      return;
    }

    this.response.write(`event: ${event.event_type}\n`);
    this.response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearInterval(this.heartbeat);
    this.response.end();
  }
}
