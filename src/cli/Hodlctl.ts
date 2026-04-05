#!/usr/bin/env node

import { NodeFileLockClient } from '../client/NodeClient.js';
import { SocketRuntime } from '../ipc/SocketRuntime.js';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command == null) {
    throw new Error('A command is required.');
  }

  const client = new NodeFileLockClient({
    socketPath: readOptionalFlag('--socket-path') ?? new SocketRuntime().getSocketPath(),
  });

  switch (command) {
    case 'health':
      print(await client.health());
      return;
    case 'status':
      print(await client.getStatus(readRequiredFlag('--path')));
      return;
    case 'acquire':
      print(
        await client.acquire({
          path: readRequiredFlag('--path'),
          owner_type: readRequiredFlag('--owner-type') as 'agent' | 'subagent' | 'vscode' | 'cli',
          owner_id: readRequiredFlag('--owner-id'),
          session_id: readRequiredFlag('--session-id'),
          ttl_ms: readOptionalNumberFlag('--ttl-ms'),
        })
      );
      return;
    case 'renew':
      print(await client.renew(readRequiredFlag('--token')));
      return;
    case 'release':
      print(await client.release(readRequiredFlag('--token')));
      return;
    case 'subscribe': {
      const handle = await client.subscribe(
        {
          path: readOptionalFlag('--path'),
          prefix: readOptionalFlag('--prefix'),
        },
        (event) => {
          console.log(JSON.stringify(event));
        }
      );

      process.once('SIGINT', () => {
        void handle.close().finally(() => process.exit(0));
      });
      process.once('SIGTERM', () => {
        void handle.close().finally(() => process.exit(0));
      });
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function print(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function readRequiredFlag(flagName: string): string {
  const value = readOptionalFlag(flagName);

  if (value == null || value.length === 0) {
    throw new Error(`Missing required flag: ${flagName}`);
  }

  return value;
}

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
