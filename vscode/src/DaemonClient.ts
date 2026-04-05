import http from 'node:http';
import path from 'node:path';

import type {
  AcquireRequest,
  AcquireResponse,
  GetStatusResponse,
  ReleaseResponse,
  RenewSuccessPayload,
} from './Protocol';

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface DaemonClientOptions {
  socketPath?: string;
}

export class DaemonClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DaemonClientError';
  }
}

export class DaemonClient {
  private readonly socketPath: string;

  constructor(options: DaemonClientOptions = {}) {
    this.socketPath = options.socketPath ?? defaultSocketPath();
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

  async getStatus(filePath: string): Promise<GetStatusResponse> {
    return await this.requestJson<GetStatusResponse>(
      'GET',
      `/v1/locks/status?path=${encodeURIComponent(filePath)}`
    );
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  private async requestJson<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
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

      throw new DaemonClientError(
        response.statusCode,
        errorPayload?.code ?? 'request_failed',
        errorPayload?.message ?? `Request failed with status ${response.statusCode}.`
      );
    }

    return parsed as T;
  }
}

function defaultSocketPath(): string {
  const userId =
    typeof process.getuid === 'function' ? String(process.getuid()) : (process.env.USER ?? 'user');

  return path.join('/tmp', `hodl-${userId}.sock`);
}
