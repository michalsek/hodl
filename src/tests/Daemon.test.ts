import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileLockClient } from '../client/NodeClient.js';
import { createDashboardServer } from '../dashboard/DashboardServer.js';
import { LeaseManager } from '../daemon/LeaseManager.js';
import { createFileLockHttpServer } from '../ipc/HttpServer.js';

const activeDaemons: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (activeDaemons.length > 0) {
    await activeDaemons.pop()?.();
  }
});

describe('hodl daemon', () => {
  it('grants only one live lease for the same absolute path', async () => {
    const filePath = await createFile('repo-a/example.ts', 'const a = 1;\n');
    const daemon = await startTestDaemon();

    const firstResponse = await daemon.client.acquire({
      path: filePath,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });
    const secondResponse = await daemon.client.acquire({
      path: filePath,
      owner_type: 'agent',
      owner_id: 'task-2',
      session_id: 'session-2',
    });

    expect(firstResponse.outcome).toBe('acquired');
    expect(secondResponse.outcome).toBe('denied');
  });

  it('locks files in different repositories independently', async () => {
    const fileA = await createFile('repo-a/example.ts', 'const a = 1;\n');
    const fileB = await createFile('repo-b/example.ts', 'const b = 2;\n');
    const daemon = await startTestDaemon();

    const firstResponse = await daemon.client.acquire({
      path: fileA,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });
    const secondResponse = await daemon.client.acquire({
      path: fileB,
      owner_type: 'agent',
      owner_id: 'task-2',
      session_id: 'session-2',
    });

    expect(firstResponse.outcome).toBe('acquired');
    expect(secondResponse.outcome).toBe('acquired');
    expect(firstResponse.canonical_path).not.toBe(secondResponse.canonical_path);
  });

  it('canonicalizes symlinked files to the same path', async () => {
    const filePath = await createFile('repo-a/example.ts', 'const a = 1;\n');
    const symlinkPath = `${filePath}.link`;
    await fs.symlink(filePath, symlinkPath);
    const daemon = await startTestDaemon();
    const canonicalFilePath = await fs.realpath(filePath);

    const acquireResponse = await daemon.client.acquire({
      path: symlinkPath,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });
    const statusResponse = await daemon.client.getStatus(filePath);

    expect(acquireResponse.outcome).toBe('acquired');
    expect(acquireResponse.canonical_path).toBe(canonicalFilePath);
    expect(statusResponse).toMatchObject({
      canonical_path: canonicalFilePath,
      state: 'held',
    });
  });

  it('rejects relative paths and directories', async () => {
    const directoryPath = await createDirectory('repo-a/folder');
    const daemon = await startTestDaemon();

    await expect(
      daemon.client.acquire({
        path: 'relative/file.ts',
        owner_type: 'agent',
        owner_id: 'task-1',
        session_id: 'session-1',
      })
    ).rejects.toMatchObject({
      code: 'path_must_be_absolute',
      statusCode: 400,
    });

    await expect(
      daemon.client.acquire({
        path: directoryPath,
        owner_type: 'agent',
        owner_id: 'task-1',
        session_id: 'session-1',
      })
    ).rejects.toMatchObject({
      code: 'path_is_directory',
      statusCode: 400,
    });
  });

  it('invalidates old tokens after a daemon restart', async () => {
    const filePath = await createFile('repo-a/example.ts', 'const a = 1;\n');
    const firstDaemon = await startTestDaemon();
    const acquireResponse = await firstDaemon.client.acquire({
      path: filePath,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });

    expect(acquireResponse.outcome).toBe('acquired');
    if (acquireResponse.outcome !== 'acquired') {
      throw new Error('Expected the initial acquire to succeed.');
    }
    await firstDaemon.close();
    activeDaemons.pop();

    const restartedDaemon = await startTestDaemon({
      socketPath: firstDaemon.socketPath,
    });

    await expect(restartedDaemon.client.renew(acquireResponse.token)).rejects.toMatchObject({
      code: 'daemon_epoch_mismatch',
      statusCode: 410,
    });
  });

  it('emits prefix subscription events for matching absolute paths', async () => {
    const filePath = await createFile('workspace/repo-a/example.ts', 'const a = 1;\n');
    const daemon = await startTestDaemon();
    const observedEvents: string[] = [];
    const prefix = await fs.realpath(path.dirname(path.dirname(filePath)));

    const subscription = await daemon.client.subscribe({ prefix }, (event) => {
      observedEvents.push(event.event_type);
    });

    await daemon.client.acquire({
      path: filePath,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });

    await waitFor(() => {
      expect(observedEvents).toContain('LOCK_ACQUIRED');
    });

    await subscription.close();
  });

  it('serves a dashboard that lists live locks', async () => {
    const filePath = await createFile('repo-a/example.ts', 'const a = 1;\n');
    const leaseManager = new LeaseManager({
      daemonEpoch: randomUUID(),
    });
    const dashboard = await createDashboardServer({
      leaseManager,
      port: 0,
    });

    activeDaemons.push(async () => {
      await dashboard.close();
    });

    await leaseManager.acquire({
      path: filePath,
      owner_type: 'agent',
      owner_id: 'task-1',
      session_id: 'session-1',
    });

    const htmlResponse = await fetch(`${dashboard.url}/`);
    const apiResponse = await fetch(`${dashboard.url}/api/locks`);
    const apiPayload = (await apiResponse.json()) as { locks: Array<{ canonical_path: string }> };

    expect(htmlResponse.status).toBe(200);
    await expect(htmlResponse.text()).resolves.toContain('Live File Locks');
    expect(apiResponse.status).toBe(200);
    expect(apiPayload.locks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonical_path: await fs.realpath(filePath),
        }),
      ])
    );
  });
});

async function startTestDaemon(options: { socketPath?: string } = {}) {
  const socketPath =
    options.socketPath ??
    path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'filelockd-sock-')), 'daemon.sock');
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  await fs.rm(socketPath, { force: true });
  const leaseManager = new LeaseManager({
    daemonEpoch: randomUUID(),
  });
  const app = createFileLockHttpServer({
    leaseManager,
    socketPath,
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(socketPath, resolve);
  });

  const close = async () => {
    await app.close();
    await fs.rm(path.dirname(socketPath), { recursive: true, force: true });
  };

  activeDaemons.push(close);

  return {
    socketPath,
    client: new NodeFileLockClient({ socketPath }),
    close,
  };
}

async function createFile(relativePath: string, contents: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filelockd-file-'));
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');

  return filePath;
}

async function createDirectory(relativePath: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filelockd-dir-'));
  const directoryPath = path.join(root, relativePath);
  await fs.mkdir(directoryPath, { recursive: true });

  return directoryPath;
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  assertion();
}
