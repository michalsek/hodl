#!/usr/bin/env node

import { createFileLockHttpServer } from '../ipc/HttpServer.js';
import { SocketRuntime } from '../ipc/SocketRuntime.js';
import { LeaseManager } from '../daemon/LeaseManager.js';
import { ExpiryLoop } from '../daemon/ExpiryLoop.js';
import { runInkDashboard } from '../dashboard/InkDashboard.js';
import { runHodlctl } from './Hodlctl.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'ctl') {
    await runHodlctl(argv.slice(1));
    return;
  }

  if (command != null && !command.startsWith('-')) {
    throw new Error(`Unknown command: ${command}\n\n${getHelpText()}`);
  }

  const socketPath = readOptionalFlag(argv, '--socket-path');
  const dashboardEnabled = argv.includes('--dashboard');
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

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(runtimeInfo.socketPath, resolve);
  });

  expiryLoop.start();
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    expiryLoop.stop();
    await app.close();
    await runtime.cleanup(runtimeInfo.metadataPath);
  };

  if (dashboardEnabled) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new Error('The terminal dashboard requires an interactive TTY.');
    }

    await runInkDashboard({
      socketPath: runtimeInfo.socketPath,
      daemonEpoch: runtimeInfo.daemonEpoch,
    });
    await shutdown();
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        daemon_epoch: runtimeInfo.daemonEpoch,
        socket_path: runtimeInfo.socketPath,
      },
      null,
      2
    )
  );

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function printHelp(): void {
  console.log(getHelpText());
}

function getHelpText(): string {
  return [
    'Usage:',
    '  agent-hodl',
    '  agent-hodl help',
    '  agent-hodl ctl <command> [options]',
    '',
    'Commands:',
    '  ctl           Run the control client commands.',
    '  help          Show this help message.',
    '',
    'Daemon Options:',
    '  --socket-path <path>      Override the Unix socket path.',
    '  --dashboard               Start the terminal dashboard.',
  ].join('\n');
}

function readOptionalFlag(argv: string[], flagName: string): string | undefined {
  const flagIndex = argv.indexOf(flagName);

  if (flagIndex < 0) {
    return undefined;
  }

  return argv[flagIndex + 1];
}
