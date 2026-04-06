# hodl

`hodl` is a machine-wide local daemon that coordinates lease-based file locks using canonical absolute paths. It is the single source of truth for acquire, renew, release, status, and event delivery.

The npm package is published as `agent-hodl`.

## How To Use

Start the daemon:

```sh
npx agent-hodl
```

The daemon prints structured JSON on startup, including the active Unix socket path and the dashboard URL. By default the dashboard is available at `http://127.0.0.1:4319`.

Check connectivity from another terminal:

```sh
npx agent-hodlctl health
```

Acquire a lease for a file before writing it:

```sh
npx agent-hodlctl acquire \
  --path /absolute/path/to/file \
  --owner-type agent \
  --owner-id task \
  --session-id session-1
```

Renew the lease during long-running work:

```sh
npx agent-hodlctl renew --token <token>
```

Release the lease as soon as the write is finished:

```sh
npx agent-hodlctl release --token <token>
```

Inspect the current holder for a path:

```sh
npx agent-hodlctl status --path /absolute/path/to/file
```

Subscribe to lock events for a file or path prefix:

```sh
npx agent-hodlctl subscribe --path /absolute/path/to/file
npx agent-hodlctl subscribe --prefix /absolute/path/prefix
```

Optional daemon flags:

- `--socket-path` overrides the default socket path.
- `--dashboard-host` overrides the dashboard host.
- `--dashboard-port` overrides the dashboard port.

## VS Code Extension

`hodl` also has a VS Code extension published as `senekapp.hodl-vscode-plugin` in the Visual Studio Marketplace.

Install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=senekapp.hodl-vscode-plugin).

The extension integrates the editor with the daemon for file-backed documents:

- It acquires a lease when a document becomes dirty.
- It renews the lease automatically while you keep editing.
- It releases the lease after save or when the document closes.
- It shows errors and warnings when a file cannot be locked or a lease is lost.
- It exposes blocked-file state in the status bar.

Configuration:

- `localFileLock.socketPath`: optional override for the daemon Unix socket path.
- `localFileLock.ttlMs`: requested lease TTL in milliseconds. The default is `30000`.

The extension expects the `hodl` daemon to already be running locally.

## Agent Instructions

Copy the [AGENTS.md](./AGENTS.md) contents into agent system prompts when you need agents to comply with the lock daemon.

## Protocol Notes

- Locks are keyed by canonical absolute path.
- Lease expiry is authoritative. Notifications are hints only.
- The default socket path is `/tmp/hodl-<uid>.sock`.
