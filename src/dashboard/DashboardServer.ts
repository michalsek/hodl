import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { URL } from 'node:url';

import type { LeaseManager } from '../daemon/LeaseManager.js';
import { SseSink } from '../ipc/SseServer.js';
import { renderDashboardHtml } from './DashboardHtml.js';

export interface DashboardServerOptions {
  leaseManager: LeaseManager;
  host?: string;
  port?: number;
}

export interface DashboardServer {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

export async function createDashboardServer(
  options: DashboardServerOptions
): Promise<DashboardServer> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4319;
  const leaseManager = options.leaseManager;
  const sockets = new Set<Socket>();

  const server = http.createServer(async (request, response) => {
    await routeDashboardRequest(request, response, leaseManager);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, resolve);
  });

  const address = server.address();

  if (address == null || typeof address === 'string') {
    throw new Error('Unable to resolve dashboard address.');
  }

  return {
    server,
    url: `http://${host}:${address.port}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error != null) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function routeDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  leaseManager: LeaseManager
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(renderDashboardHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/locks') {
    sendJson(response, 200, leaseManager.listActiveLocks());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    const subscription = await leaseManager.createSubscription({ prefix: '/' });
    const sink = new SseSink(response);
    const eventBus = leaseManager.getEventBus();
    eventBus.attachSink(subscription.subscription_id, sink);

    response.write(`event: snapshot\n`);
    response.write(
      `data: ${JSON.stringify({
        event_id: randomUUID(),
        event_type: 'LOCK_ACQUIRED',
        canonical_path: '/',
        generation: 0,
        occurred_at: new Date().toISOString(),
        daemon_epoch: leaseManager.daemonEpoch,
        reason: 'dashboard_connected',
      })}\n\n`
    );

    request.on('close', () => {
      leaseManager.removeSubscription(subscription.subscription_id);
    });
    return;
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('Not found\n');
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}
