# hodl

`hodl` is a machine-wide local daemon that coordinates lease-based file locks using canonical absolute paths. It is the single source of truth for acquire, renew, release, status, and event delivery.

## Agent Instructions

Copy the block below into agent system prompts when you need agents to comply with the lock daemon.

```md
# Local File Lock Rules For Agents

You are operating in a shared working tree with a local file-lock daemon as the only lock authority.

How to talk to the daemon:

- Default Unix socket path: `/tmp/hodl-<uid>.sock`
- Preferred interface for agents in this repo: `hodlctl`
- Socket override: pass `--socket-path /custom/path.sock` to every command if the daemon is not using the default socket.
- Commands return JSON on stdout. Parse that JSON and use the returned `token` from a successful acquire as the input to `renew` and `release`.

Required command flow:

- Acquire before writing:
  `hodlctl acquire --path /absolute/path/to/file --owner-type agent --owner-id <task-or-thread-id> --session-id <unique-session-id>`
- If the acquire response contains `"outcome": "acquired"`, store the returned `token` and proceed.
- If the acquire response contains `"outcome": "denied"`, do not write the file. Either fail fast or retry later according to the parent task policy.
- Renew during long edits:
  `hodlctl renew --token <token>`
- Release immediately after the write is finished:
  `hodlctl release --token <token>`
- Inspect a file without acquiring:
  `hodlctl status --path /absolute/path/to/file`
- Wait for changes if the parent task explicitly allows waiting:
  `hodlctl subscribe --path /absolute/path/to/file`
  or
  `hodlctl subscribe --prefix /absolute/path/prefix`

Expected acquire responses:

- Success:
  `{ "outcome": "acquired", "token": "...", "canonical_path": "...", "expires_at": "...", "generation": 1 }`
- Denied:
  `{ "outcome": "denied", "holder": { ... }, "expires_at": "...", "retry_after_ms": 1234 }`

Direct protocol option:

- If the CLI is unavailable, call the daemon over HTTP on the Unix socket.
- Acquire:
  `curl --unix-socket /tmp/hodl-<uid>.sock -X POST http://localhost/v1/locks/acquire -H 'Content-Type: application/json' -d '{"path":"/absolute/path/to/file","owner_type":"agent","owner_id":"task-1","session_id":"session-1"}'`
- Renew:
  `curl --unix-socket /tmp/hodl-<uid>.sock -X POST http://localhost/v1/locks/renew -H 'Content-Type: application/json' -d '{"token":"<token>"}'`
- Release:
  `curl --unix-socket /tmp/hodl-<uid>.sock -X POST http://localhost/v1/locks/release -H 'Content-Type: application/json' -d '{"token":"<token>"}'`

Rules:

- MUST acquire a valid file lease from the daemon before writing any file.
- MUST NOT modify a file without a current lease token for that exact canonical absolute path.
- MUST renew the lease during long edits until the write is complete.
- MUST release the lease promptly after the file is written and no longer being edited.
- MUST treat notifications and lock events as wake-up hints only, never as proof that you own a file.
- MUST re-run ACQUIRE or GET_STATUS after any relevant event before assuming a file is available.
- SHOULD fail fast if a lock is unavailable instead of waiting indefinitely.
- SHOULD use bounded retries with jitter only when the parent task explicitly allows waiting.
- Parent agents SHOULD coordinate retry policy for subagents and avoid spawning multiple contenders for the same file set.

Ownership:

- Use `owner_type=agent` for the top-level Codex agent.
- Use `owner_type=subagent` for spawned subagents.
- `owner_id` should identify the logical task or thread.
- `session_id` must be unique per running process or agent instance.

Multi-file edits:

- Prefer changing one file at a time.
- If multiple files must be edited together, acquire them in canonical sorted absolute path order.
- If any acquire fails, release every lease already obtained in that set, back off with jitter, and retry the full set only if the parent task requires it.
- Do not hold unrelated file leases while waiting for another file.

Error handling:

- If RENEW fails, assume the lease is lost immediately and stop editing until ACQUIRE succeeds again.
- If the daemon restarts or returns an epoch mismatch, assume every prior token is invalid and reacquire.
- If a lock cannot be acquired quickly, report the conflict instead of waiting forever.
```

## CLI Quickstart

- Install dependencies: `yarn install`
- Build the package: `yarn build`
- Start the daemon: `hodl`
- Open the dashboard: visit the `dashboard_url` printed on startup, or use `http://127.0.0.1:4319` by default
- Acquire a lock: `hodlctl acquire --path /absolute/path --owner-type agent --owner-id task --session-id session-1`
- Renew a lock: `hodlctl renew --token <token>`
- Release a lock: `hodlctl release --token <token>`
- Check status: `hodlctl status --path /absolute/path`

## Protocol Notes

- Locks are keyed by canonical absolute path.
- Lease expiry is authoritative. Notifications are hints only.
- The default socket path is `/tmp/hodl-<uid>.sock`.
