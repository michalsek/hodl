import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { URL } from 'node:url';

import {
  acquireRequestSchema,
  releaseRequestSchema,
  renewRequestSchema,
  subscribeRequestSchema,
} from '../protocol/Schemas.js';
import type { DaemonErrorPayload, HealthResponse } from '../protocol/Types.js';
import { LeaseManager } from '../daemon/LeaseManager.js';
import { DaemonError } from '../daemon/Errors.js';
import { SseSink } from './SseServer.js';
import { ZodError } from 'zod';

export interface FileLockHttpServerOptions {
  leaseManager: LeaseManager;
  socketPath: string;
}

export interface FileLockHttpServer {
  server: http.Server;
  close(): Promise<void>;
}

export function createFileLockHttpServer(options: FileLockHttpServerOptions): FileLockHttpServer {
  const { leaseManager, socketPath } = options;
  const sockets = new Set<Socket>();

  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response, leaseManager, socketPath);
    } catch (error) {
      const daemonError =
        error instanceof DaemonError
          ? error
          : error instanceof ZodError
            ? new DaemonError(
                400,
                'invalid_request',
                error.issues.map((issue) => issue.message).join('; ')
              )
            : new DaemonError(500, 'internal_error', 'The daemon failed to handle the request.');

      sendJson(response, daemonError.statusCode, {
        error: {
          code: daemonError.code,
          message: daemonError.message,
          details: daemonError.details,
        } satisfies DaemonErrorPayload,
      });
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  return {
    server,
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

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  leaseManager: LeaseManager,
  socketPath: string
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      status: 'ok',
      daemon_epoch: leaseManager.daemonEpoch,
      socket_path: socketPath,
    } satisfies HealthResponse);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/locks/acquire') {
    const body = acquireRequestSchema.parse(await readJsonBody(request));
    sendJson(response, 200, await leaseManager.acquire(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/locks/renew') {
    const body = renewRequestSchema.parse(await readJsonBody(request));
    sendJson(response, 200, leaseManager.renew(body.token));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/locks/release') {
    const body = releaseRequestSchema.parse(await readJsonBody(request));
    sendJson(response, 200, leaseManager.release(body.token));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/locks/status') {
    const requestedPath = url.searchParams.get('path');

    if (requestedPath == null || requestedPath.length === 0) {
      throw new DaemonError(400, 'missing_path', 'The `path` query parameter is required.');
    }

    sendJson(response, 200, await leaseManager.getStatus(requestedPath));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/subscriptions') {
    const body = subscribeRequestSchema.parse(await readJsonBody(request));
    sendJson(response, 200, await leaseManager.createSubscription(body));
    return;
  }

  const subscriptionMatch = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)(?:\/events)?$/);

  if (subscriptionMatch != null) {
    const subscriptionId = subscriptionMatch[1];

    if (request.method === 'DELETE' && !url.pathname.endsWith('/events')) {
      leaseManager.removeSubscription(subscriptionId);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname.endsWith('/events')) {
      if (!leaseManager.getEventBus().hasSubscription(subscriptionId)) {
        throw new DaemonError(404, 'subscription_not_found', 'Unknown subscription.');
      }

      const sink = new SseSink(response);
      leaseManager.getEventBus().attachSink(subscriptionId, sink);

      request.on('close', () => {
        leaseManager.removeSubscription(subscriptionId);
      });

      return;
    }
  }

  throw new DaemonError(404, 'not_found', `No route matches ${request.method} ${url.pathname}.`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DaemonError(400, 'invalid_json', 'The request body must be valid JSON.');
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}
