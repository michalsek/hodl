export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Live File Locks</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #efe9db;
        --panel: rgba(255, 252, 245, 0.94);
        --border: rgba(89, 72, 45, 0.18);
        --ink: #23180c;
        --muted: #6c5a46;
        --accent: #0d8a6f;
        --danger: #b04c3e;
        --shadow: 0 18px 48px rgba(35, 24, 12, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(13, 138, 111, 0.18), transparent 26%),
          radial-gradient(circle at top right, rgba(176, 76, 62, 0.12), transparent 24%),
          linear-gradient(180deg, #f6f0e3 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Iosevka Web", "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
      }

      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 32px auto 48px;
      }

      .hero,
      .panel {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .hero {
        display: grid;
        gap: 16px;
        padding: 24px;
        margin-bottom: 20px;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      h1 {
        font-size: clamp(28px, 4vw, 42px);
        letter-spacing: -0.04em;
      }

      p {
        color: var(--muted);
        line-height: 1.5;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.65);
        color: var(--muted);
        font-size: 12px;
      }

      .panel {
        padding: 18px;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        text-align: left;
        padding: 12px 14px;
        border-top: 1px solid rgba(89, 72, 45, 0.12);
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      tbody tr:hover {
        background: rgba(13, 138, 111, 0.06);
      }

      code {
        font-family: inherit;
        word-break: break-word;
      }

      .empty {
        padding: 28px 14px 8px;
        color: var(--muted);
      }

      .pill {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(13, 138, 111, 0.12);
        color: var(--accent);
      }

      .danger {
        color: var(--danger);
      }

      @media (max-width: 860px) {
        table,
        thead,
        tbody,
        th,
        td,
        tr {
          display: block;
        }

        thead {
          display: none;
        }

        tbody tr {
          border-top: 1px solid rgba(89, 72, 45, 0.12);
          padding: 12px 0;
        }

        td {
          border: 0;
          padding: 6px 0;
        }

        td::before {
          content: attr(data-label);
          display: block;
          font-size: 11px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div>
          <h1>Live File Locks</h1>
          <p>Read-only view of the daemon's active leases. Updates stream in locally over loopback.</p>
        </div>
        <div class="meta">
          <span class="badge" id="epoch-badge">epoch: loading</span>
          <span class="badge" id="count-badge">locks: 0</span>
          <span class="badge" id="status-badge">status: connecting</span>
          <span class="badge" id="updated-badge">updated: never</span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Current Leases</h2>
          <p id="empty-hint">Waiting for lock data.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Owner</th>
              <th>Lease</th>
              <th>TTL</th>
            </tr>
          </thead>
          <tbody id="locks-body">
            <tr>
              <td class="empty" colspan="4">No active locks.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>

    <script>
      const locksBody = document.getElementById('locks-body');
      const epochBadge = document.getElementById('epoch-badge');
      const countBadge = document.getElementById('count-badge');
      const statusBadge = document.getElementById('status-badge');
      const updatedBadge = document.getElementById('updated-badge');
      const emptyHint = document.getElementById('empty-hint');

      function formatTime(value) {
        return new Date(value).toLocaleTimeString();
      }

      function formatDuration(ms) {
        if (ms <= 0) {
          return 'expired';
        }

        if (ms < 1000) {
          return ms + 'ms';
        }

        const seconds = Math.round(ms / 100) / 10;
        return seconds + 's';
      }

      function render(payload) {
        epochBadge.textContent = 'epoch: ' + payload.daemon_epoch;
        countBadge.textContent = 'locks: ' + payload.locks.length;
        updatedBadge.textContent = 'updated: ' + formatTime(payload.server_time);
        emptyHint.textContent = payload.locks.length === 0 ? 'No live locks right now.' : 'Sorted by path.';

        if (payload.locks.length === 0) {
          locksBody.innerHTML = '<tr><td class="empty" colspan="4">No active locks.</td></tr>';
          return;
        }

        locksBody.innerHTML = payload.locks
          .map((lock) => {
            const owner = [lock.owner_type, lock.owner_id, lock.session_id].join(' / ');
            return '<tr>' +
              '<td data-label="Path"><code>' + escapeHtml(lock.canonical_path) + '</code></td>' +
              '<td data-label="Owner"><span class="pill">' + escapeHtml(owner) + '</span></td>' +
              '<td data-label="Lease"><div><code>' + escapeHtml(lock.lease_id) + '</code></div><div>' +
                'gen ' + lock.generation + ' · acquired ' + formatTime(lock.acquired_at) +
              '</div></td>' +
              '<td data-label="TTL" class="' + (lock.remaining_ttl_ms <= 2000 ? 'danger' : '') + '">' +
                formatDuration(lock.remaining_ttl_ms) + '<br><span>' + formatTime(lock.expires_at) + '</span>' +
              '</td>' +
            '</tr>';
          })
          .join('');
      }

      function setStatus(text) {
        statusBadge.textContent = 'status: ' + text;
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;');
      }

      async function refresh() {
        const response = await fetch('/api/locks');
        const payload = await response.json();
        render(payload);
      }

      async function bootstrap() {
        await refresh();
        setStatus('live');

        const source = new EventSource('/events');
        ['snapshot', 'LOCK_ACQUIRED', 'LOCK_RELEASED', 'LOCK_EXPIRED', 'LOCK_STOLEN'].forEach((eventType) => {
          source.addEventListener(eventType, () => {
            void refresh();
          });
        });
        source.onerror = async () => {
          setStatus('reconnecting');
          source.close();
          setTimeout(() => {
            void bootstrap();
          }, 1500);
        };
      }

      void bootstrap().catch((error) => {
        setStatus('error');
        emptyHint.textContent = error instanceof Error ? error.message : 'Unable to load locks.';
      });
    </script>
  </body>
</html>`;
}
