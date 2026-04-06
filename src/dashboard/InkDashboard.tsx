import path from 'node:path';

import React, { useEffect, useState } from 'react';
import { Box, render, Text, useApp, useInput } from 'ink';

import { NodeFileLockClient, type SubscriptionHandle } from '../client/NodeClient.js';
import type { ListLocksResponse, LiveLockRecord, LockEvent } from '../protocol/Types.js';

export interface InkDashboardOptions {
  socketPath: string;
  daemonEpoch: string;
  refreshIntervalMs?: number;
}

interface DashboardAppProps {
  client: NodeFileLockClient;
  daemonEpoch: string;
  refreshIntervalMs: number;
  socketPath: string;
}

export async function runInkDashboard(options: InkDashboardOptions): Promise<void> {
  process.stdout.write('\u001B[?1049h');

  try {
    const app = render(
      <DashboardApp
        client={new NodeFileLockClient({ socketPath: options.socketPath })}
        daemonEpoch={options.daemonEpoch}
        refreshIntervalMs={options.refreshIntervalMs ?? 1_000}
        socketPath={options.socketPath}
      />
    );

    await app.waitUntilExit();
  } finally {
    process.stdout.write('\u001B[?1049l');
  }
}

function DashboardApp({
  client,
  daemonEpoch,
  refreshIntervalMs,
  socketPath,
}: DashboardAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<ListLocksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useInput((input, key) => {
    if (input.toLowerCase() === 'q' || key.escape) {
      exit();
    }
  });

  useEffect(() => {
    let active = true;
    let subscription: SubscriptionHandle | undefined;

    const refresh = async () => {
      try {
        const nextSnapshot = await client.listLocks();

        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
        setError(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(error));
      }
    };

    const onEvent = (event: LockEvent) => {
      if (!active) {
        return;
      }

      setLastEvent(describeEvent(event));
      void refresh();
    };

    void refresh();

    void client
      .subscribe({ prefix: '/' }, onEvent)
      .then((handle) => {
        if (!active) {
          void handle.close();
          return;
        }

        subscription = handle;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setError(getErrorMessage(error));
      });

    const interval = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
      void subscription?.close();
    };
  }, [client, refreshIntervalMs]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between">
        <Box flexDirection="column">
          <Text bold color="cyan">
            hodl dashboard
          </Text>
          <Text dimColor wrap="truncate-end">
            socket {socketPath}
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color="green">{snapshot?.locks.length ?? 0} active locks</Text>
          <Text dimColor>daemon {shortId(daemonEpoch)}</Text>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          updated {formatServerTime(snapshot?.server_time)} {lastEvent == null ? '' : `| ${lastEvent}`}
        </Text>
        {error == null ? null : (
          <Text color="red" wrap="truncate-end">
            error {error}
          </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {snapshot == null ? (
          <Text>Loading live locks...</Text>
        ) : snapshot.locks.length === 0 ? (
          <Box borderStyle="round" borderColor="green" paddingX={1} paddingY={0}>
            <Text color="green">No active locks.</Text>
          </Box>
        ) : (
          snapshot.locks.map((lock) => <LockCard key={lock.token} lock={lock} />)
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press q, Esc, or Ctrl+C to exit.</Text>
      </Box>
    </Box>
  );
}

function LockCard({ lock }: { lock: LiveLockRecord }): React.JSX.Element {
  const ttlColor = lock.remaining_ttl_ms <= 5_000 ? 'red' : lock.remaining_ttl_ms <= 15_000 ? 'yellow' : 'green';

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
      paddingY={0}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan" wrap="truncate-end">
          {truncateMiddle(lock.canonical_path, 96)}
        </Text>
        <Text color={ttlColor}>{formatTtl(lock.remaining_ttl_ms)}</Text>
      </Box>
      <Text wrap="truncate-end">
        {lock.owner_type}:{lock.owner_id} | session {lock.session_id}
      </Text>
      <Text dimColor wrap="truncate-end">
        acquired {formatTimestamp(lock.acquired_at)} | expires {formatTimestamp(lock.expires_at)} |
        generation {lock.generation}
      </Text>
    </Box>
  );
}

function describeEvent(event: LockEvent): string {
  return `${event.event_type.toLowerCase()} ${path.basename(event.canonical_path)}`;
}

function formatServerTime(timestamp: string | undefined): string {
  if (timestamp == null) {
    return 'waiting for daemon';
  }

  return formatTimestamp(timestamp);
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTtl(remainingTtlMs: number): string {
  if (remainingTtlMs < 1_000) {
    return '<1s';
  }

  return `${Math.ceil(remainingTtlMs / 1_000)}s`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const headLength = Math.floor((maxLength - 3) / 2);
  const tailLength = maxLength - headLength - 3;

  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}
