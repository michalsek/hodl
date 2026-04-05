import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { DaemonError, isNodeErrorWithCode } from '../daemon/Errors.js';

export interface SocketRuntimeOptions {
  socketPath?: string;
  stateDirectory?: string;
  daemonEpoch?: string;
}

export interface SocketRuntimeInfo {
  daemonEpoch: string;
  socketPath: string;
  stateDirectory: string;
  metadataPath: string;
}

export class SocketRuntime {
  private readonly socketPath: string;
  private readonly stateDirectory: string;
  private readonly daemonEpoch: string;

  constructor(options: SocketRuntimeOptions = {}) {
    const userId =
      typeof process.getuid === 'function'
        ? String(process.getuid())
        : (process.env.USER ?? 'user');

    this.socketPath = options.socketPath ?? path.join('/tmp', `local-filelockd-${userId}.sock`);
    this.stateDirectory =
      options.stateDirectory ??
      path.join(os.homedir(), 'Library', 'Application Support', 'local-filelockd');
    this.daemonEpoch = options.daemonEpoch ?? randomUUID();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  async prepare(): Promise<SocketRuntimeInfo> {
    await fs.mkdir(this.stateDirectory, { recursive: true });
    await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
    await this.ensureSocketAvailable();

    const metadataPath = path.join(this.stateDirectory, 'runtime.json');

    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          pid: process.pid,
          daemonEpoch: this.daemonEpoch,
          socketPath: this.socketPath,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );

    return {
      daemonEpoch: this.daemonEpoch,
      socketPath: this.socketPath,
      stateDirectory: this.stateDirectory,
      metadataPath,
    };
  }

  async cleanup(metadataPath?: string): Promise<void> {
    await Promise.allSettled([
      fs.unlink(this.socketPath),
      metadataPath == null ? Promise.resolve() : fs.unlink(metadataPath),
    ]);
  }

  private async ensureSocketAvailable(): Promise<void> {
    try {
      await fs.access(this.socketPath);
    } catch (error) {
      if (isNodeErrorWithCode(error) && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }

    const alive = await probeSocket(this.socketPath);

    if (alive) {
      throw new DaemonError(
        409,
        'daemon_already_running',
        `A daemon is already listening on ${this.socketPath}.`
      );
    }

    await fs.unlink(this.socketPath);
  }
}

async function probeSocket(socketPath: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const request = http.request(
      {
        socketPath,
        path: '/health',
        method: 'GET',
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );

    request.on('error', () => {
      resolve(false);
    });

    request.end();
  });
}
