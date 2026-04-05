#!/usr/bin/env node

import { createFileLockHttpServer } from '../ipc/HttpServer.js';
import { SocketRuntime } from '../ipc/SocketRuntime.js';
import { LeaseManager } from '../daemon/LeaseManager.js';
import { ExpiryLoop } from '../daemon/ExpiryLoop.js';
import { createDashboardServer } from '../dashboard/DashboardServer.js';

async function main(): Promise<void> {
  const socketPath = readOptionalFlag('--socket-path');
  const dashboardHost = readOptionalFlag('--dashboard-host');
  const dashboardPort = readOptionalNumberFlag('--dashboard-port');
  const runtime = new SocketRuntime({ socketPath });
  const runtimeInfo = await runtime.prepare();
  const leaseManager = new LeaseManager({
    daemonEpoch: runtimeInfo.daemonEpoch,
  });
  const expiryLoop = new ExpiryLoop(leaseManager);
  const app = createFileLockHttpServer({
    leaseManager,
    socketPath: runtimeInfo.socketPath,
  });
  const dashboard = await createDashboardServer({
    leaseManager,
    host: dashboardHost,
    port: dashboardPort,
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(runtimeInfo.socketPath, resolve);
  });

  expiryLoop.start();
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        daemon_epoch: runtimeInfo.daemonEpoch,
        socket_path: runtimeInfo.socketPath,
        dashboard_url: dashboard.url,
      },
      null,
      2
    )
  );

  const shutdown = async () => {
    expiryLoop.stop();
    await dashboard.close();
    await app.close();
    await runtime.cleanup(runtimeInfo.metadataPath);
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function readOptionalFlag(flagName: string): string | undefined {
  const flagIndex = process.argv.indexOf(flagName);

  if (flagIndex < 0) {
    return undefined;
  }

  return process.argv[flagIndex + 1];
}

function readOptionalNumberFlag(flagName: string): number | undefined {
  const value = readOptionalFlag(flagName);

  if (value == null) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}
