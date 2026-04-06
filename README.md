# agent-hodl

`agent-hodl` is a machine-wide local daemon that coordinates lease-based file locks using canonical absolute paths. It is the single source of truth for acquire, renew, release, status, and event delivery.

## How To Use

Start the daemon:

```sh
npx agent-hodl
```

Show command help:

```sh
npx agent-hodl help
```

Start the daemon with the terminal dashboard:

```sh
npx agent-hodl --dashboard
```

By default the dashboard is disabled. Without `--dashboard`, the daemon prints structured JSON on startup with the active Unix socket path.

Check connectivity from another terminal:

```sh
npx agent-hodl ctl health
```

Acquire a lease for a file before writing it:

```sh
npx agent-hodl ctl acquire \
  --path /absolute/path/to/file \
  --owner-type agent \
  --owner-id task \
  --session-id session-1
```

Renew the lease during long-running work:

```sh
npx agent-hodl ctl renew --token <token>
```

Release the lease as soon as the write is finished:

```sh
npx agent-hodl ctl release --token <token>
```

Inspect the current holder for a path:

```sh
npx agent-hodl ctl status --path /absolute/path/to/file
```

Subscribe to lock events for a file or path prefix:

```sh
npx agent-hodl ctl subscribe --path /absolute/path/to/file
npx agent-hodl ctl subscribe --prefix /absolute/path/prefix
```

Optional daemon flags:

- `--socket-path` overrides the default socket path.
- `--dashboard` starts the terminal dashboard.

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
