const locksBody = document.getElementById('locks-body');
const epochBadge = document.getElementById('epoch-badge');
const countBadge = document.getElementById('count-badge');
const statusBadge = document.getElementById('status-badge');
const updatedBadge = document.getElementById('updated-badge');
const emptyHint = document.getElementById('empty-hint');

function formatTime(value) {
  return new Date(value).toLocaleTimeString();
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString();
}

function formatDuration(ms) {
  if (ms <= 0) {
    return 'expired';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}

function formatEpoch(value) {
  return String(value).slice(0, 8);
}

function formatStatus(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function render(payload) {
  epochBadge.textContent = formatEpoch(payload.daemon_epoch);
  epochBadge.title = payload.daemon_epoch;
  countBadge.textContent = String(payload.locks.length);
  updatedBadge.textContent = formatTime(payload.server_time);
  updatedBadge.title = formatTimestamp(payload.server_time);
  emptyHint.textContent =
    payload.locks.length === 0
      ? 'No live locks right now.'
      : 'Sorted by canonical path across every active lease.';

  if (payload.locks.length === 0) {
    locksBody.innerHTML = '<tr><td class="empty" colspan="4">No active locks.</td></tr>';
    return;
  }

  locksBody.innerHTML = payload.locks
    .map((lock) => {
      const owner = [lock.owner_type, lock.owner_id, lock.session_id].join(' / ');
      return (
        '<tr>' +
        `<td data-label="Path"><code>${escapeHtml(lock.canonical_path)}</code></td>` +
        `<td data-label="Owner"><span class="pill">${escapeHtml(owner)}</span></td>` +
        `<td data-label="Lease"><div><code>${escapeHtml(lock.lease_id)}</code></div><div>` +
        `gen ${lock.generation} · acquired ${formatTime(lock.acquired_at)}` +
        '</div></td>' +
        `<td data-label="TTL" class="${lock.remaining_ttl_ms <= 2000 ? 'danger' : ''}">` +
        `${formatDuration(lock.remaining_ttl_ms)}<br><span>${formatTime(lock.expires_at)}</span>` +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function setStatus(text) {
  statusBadge.textContent = formatStatus(text);
  statusBadge.dataset.state = text;
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
  ['snapshot', 'LOCK_ACQUIRED', 'LOCK_RELEASED', 'LOCK_EXPIRED', 'LOCK_STOLEN'].forEach(
    (eventType) => {
      source.addEventListener(eventType, () => {
        void refresh();
      });
    }
  );
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
