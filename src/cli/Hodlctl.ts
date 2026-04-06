#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { NodeFileLockClient } from '../client/NodeClient.js';
import { SocketRuntime } from '../ipc/SocketRuntime.js';

export async function runHodlctl(argv: string[]): Promise<void> {
  const command = argv[0];

  if (command == null) {
    throw new Error('A command is required.');
  }

  const client = new NodeFileLockClient({
    socketPath: readOptionalFlag(argv, '--socket-path') ?? new SocketRuntime().getSocketPath(),
  });

  switch (command) {
    case 'health':
      print(await client.health());
      return;
    case 'status':
      print(await client.getStatus(readRequiredFlag(argv, '--path')));
      return;
    case 'acquire':
      print(
        await client.acquire({
          path: readRequiredFlag(argv, '--path'),
          owner_type: readRequiredFlag(argv, '--owner-type') as 'agent' | 'subagent' | 'vscode' | 'cli',
          owner_id: readRequiredFlag(argv, '--owner-id'),
          session_id: readRequiredFlag(argv, '--session-id'),
          ttl_ms: readOptionalNumberFlag(argv, '--ttl-ms'),
        })
      );
      return;
    case 'renew':
      print(await client.renew(readRequiredFlag(argv, '--token')));
      return;
    case 'release':
      print(await client.release(readRequiredFlag(argv, '--token')));
      return;
    case 'subscribe': {
      const handle = await client.subscribe(
        {
          path: readOptionalFlag(argv, '--path'),
          prefix: readOptionalFlag(argv, '--prefix'),
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

async function main(): Promise<void> {
  await runHodlctl(process.argv.slice(2));
}

if (isDirectExecution()) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

function print(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function readRequiredFlag(argv: string[], flagName: string): string {
  const value = readOptionalFlag(argv, flagName);

  if (value == null || value.length === 0) {
    throw new Error(`Missing required flag: ${flagName}`);
  }

  return value;
}

function readOptionalFlag(argv: string[], flagName: string): string | undefined {
  const flagIndex = argv.indexOf(flagName);

  if (flagIndex < 0) {
    return undefined;
  }

  return argv[flagIndex + 1];
}

function readOptionalNumberFlag(argv: string[], flagName: string): number | undefined {
  const value = readOptionalFlag(argv, flagName);

  if (value == null) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];

  if (entrypoint == null) {
    return false;
  }

  return import.meta.url === pathToFileURL(entrypoint).href;
}
