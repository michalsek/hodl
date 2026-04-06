import http from 'node:http';

import type {
  AcquireRequest,
  AcquireResponse,
  GetStatusResponse,
  HealthResponse,
  ListLocksResponse,
  LockEvent,
  ReleaseResponse,
  RenewSuccessPayload,
  SubscribeRequest,
  SubscriptionResponse,
} from '../protocol/Types.js';

export interface NodeClientOptions {
  socketPath: string;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface SubscriptionHandle {
  subscriptionId: string;
  close(): Promise<void>;
}

export class NodeClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'NodeClientError';
  }
}

export class NodeFileLockClient {
  constructor(private readonly options: NodeClientOptions) {}

  async health(): Promise<HealthResponse> {
    return await this.requestJson<HealthResponse>('GET', '/health');
  }

  async acquire(request: AcquireRequest): Promise<AcquireResponse> {
    return await this.requestJson<AcquireResponse>('POST', '/v1/locks/acquire', request);
  }

  async renew(token: string): Promise<RenewSuccessPayload> {
    return await this.requestJson<RenewSuccessPayload>('POST', '/v1/locks/renew', { token });
  }

  async release(token: string): Promise<ReleaseResponse> {
    return await this.requestJson<ReleaseResponse>('POST', '/v1/locks/release', { token });
  }

  async getStatus(path: string): Promise<GetStatusResponse> {
    const encodedPath = encodeURIComponent(path);

    return await this.requestJson<GetStatusResponse>('GET', `/v1/locks/status?path=${encodedPath}`);
  }

  async listLocks(): Promise<ListLocksResponse> {
    return await this.requestJson<ListLocksResponse>('GET', '/v1/locks');
  }

  async subscribe(
    request: SubscribeRequest,
    onEvent: (event: LockEvent) => void
  ): Promise<SubscriptionHandle> {
    const subscription = await this.requestJson<SubscriptionResponse>(
      'POST',
      '/v1/subscriptions',
      request
    );

    const streamRequest = http.request({
      socketPath: this.options.socketPath,
      path: subscription.stream_path,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
    });

    let streamClosed = false;

    await new Promise<void>((resolve, reject) => {
      streamRequest.on('response', (response) => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Subscription stream failed with status ${response.statusCode}.`));
          return;
        }

        response.setEncoding('utf8');

        let buffer = '';

        response.on('data', (chunk) => {
          buffer += chunk;

          while (buffer.includes('\n\n')) {
            const separatorIndex = buffer.indexOf('\n\n');
            const rawMessage = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);

            const event = parseSseEvent(rawMessage);

            if (event != null) {
              onEvent(event);
            }
          }
        });

        resolve();
      });

      streamRequest.on('error', (error) => {
        streamClosed = true;
        reject(error);
      });

      streamRequest.end();
    });

    return {
      subscriptionId: subscription.subscription_id,
      close: async () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;
        streamRequest.destroy();

        try {
          await this.requestJson<void>(
            'DELETE',
            `/v1/subscriptions/${encodeURIComponent(subscription.subscription_id)}`
          );
        } catch (error) {
          if (isIgnorableDisconnect(error)) {
            return;
          }

          throw error;
        }
      },
    };
  }

  private async requestJson<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.options.socketPath,
          path: pathname,
          method,
          headers:
            body == null
              ? undefined
              : {
                  'Content-Type': 'application/json',
                },
        },
        (response) => {
          response.setEncoding('utf8');

          let responseBody = '';

          response.on('data', (chunk) => {
            responseBody += chunk;
          });

          response.on('end', () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              body: responseBody,
            });
          });
        }
      );

      request.on('error', reject);

      if (body != null) {
        request.write(JSON.stringify(body));
      }

      request.end();
    });

    const parsed =
      response.body.length > 0 ? (JSON.parse(response.body) as T | ErrorEnvelope) : null;

    if (response.statusCode >= 400) {
      const errorPayload = (parsed as ErrorEnvelope | null)?.error;

      throw new NodeClientError(
        response.statusCode,
        errorPayload?.code ?? 'request_failed',
        errorPayload?.message ?? `Request failed with status ${response.statusCode}.`
      );
    }

    return parsed as T;
  }
}

function parseSseEvent(rawMessage: string): LockEvent | null {
  const dataLines = rawMessage
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));

  if (dataLines.length === 0) {
    return null;
  }

  return JSON.parse(dataLines.join('\n')) as LockEvent;
}

function isIgnorableDisconnect(error: unknown): boolean {
  return (
    error instanceof NodeClientError ||
    (error instanceof Error &&
      (error.message.includes('socket hang up') ||
        'code' in error &&
        typeof error.code === 'string' &&
        (error.code === 'ECONNRESET' || error.code === 'ENOENT')))
  );
}
