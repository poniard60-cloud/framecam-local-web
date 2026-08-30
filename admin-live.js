'use strict';

const LIVE_TOPIC_KEY = 'framecam.monitor.topic.v1';
const LIVE_APP_URL = 'https://poniard60-cloud.github.io/framecam-local-web/';
const LIVE_NTFY = 'https://ntfy.sh';
const LIVE_ACTIVE_MS = 20 * 60 * 1000;
const LIVE_POLL_MS = 60 * 1000;
let livePollTimer = null;
let liveLoading = false;

function liveValidTopic(value) {
  return /^framecam-[a-z0-9_-]{24,96}$/i.test(String(value || ''));
}

function liveRandomTopic() {
  const data = new Uint8Array(16);
  crypto.getRandomValues(data);
  const hex = [...data].map(v => v.toString(16).padStart(2, '0')).join('');
  return `framecam-${hex}`;
}

function liveTopic() {
  const value = localStorage.getItem(LIVE_TOPIC_KEY) || '';
  return liveValidTopic(value) ? value : '';
}

function liveMonitoredUrl(topic = liveTopic()) {
  return topic ? `${LIVE_APP_URL}#monitor=${encodeURIComponent(topic)}` : '';
}

function liveToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function liveAgo(timestamp) {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return 'たった今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  return `${Math.floor(diff / 3_600_000)}時間前`;
}

function liveTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function liveInsertPanel() {
  if (document.getElementById('liveMonitorPanel')) return;
  const overview = document.getElementById('tab-overview');
  if (!overview) return;

  const panel = document.createElement('section');
  panel.id = 'liveMonitorPanel';
  panel.className = 'panel live-monitor-panel';
  panel.innerHTML = `
    <div class="live-head">
      <div>
        <div class="section-kicker">ZERO COST LIVE MONITOR</div>
        <h2>利用状況・撮影数</h2>
        <p>匿名の運用ログだけを使い、イベント端末の稼働状況を確認します。</p>
      </div>
      <div id="liveState" class="live-state">未設定</div>
    </div>

    <div class="live-metrics">
      <div class="live-metric"><span>現在利用中</span><strong id="liveActive">—</strong><small>20分以内に通信</small></div>
      <div class="live-metric"><span>確認端末 / 12時間</span><strong id="liveDevices">—</strong><small>匿名端末ID</small></div>
      <div class="live-metric"><span>本日の撮影</span><strong id="liveCaptures">—</strong><small>各端末の累計を合算</small></div>
      <div class="live-metric"><span>最終受信</span><strong id="liveLastSeen">—</strong><small id="liveLastSeenSub">監視開始後に表示</small></div>
    </div>

    <div id="liveSetup" class="live-setup">
      <div class="live-setup-copy">
        <h3 id="liveSetupTitle">無料リアルタイム監視を開始</h3>
        <p id="liveSetupText">外部アカウント作成や有料契約は不要です。監視専用URLを発行し、そのURLでFrameCamを開きます。</p>
      </div>
      <div class="live-actions">
        <button id="liveStartBtn" class="primary" type="button">無料監視を開始</button>
        <button id="liveRefreshBtn" class="ghost" type="button">今すぐ更新</button>
      </div>
    </div>

    <div id="liveUrlArea" hidden>
      <div class="live-url-wrap">
        <input id="liveUrl" type="text" readonly aria-label="監視用FrameCam URL" />
        <button id="liveCopyBtn" class="primary" type="button">監視URLをコピー</button>
      </div>
      <p class="live-url-help">イベント端末では通常URLではなく、この監視URLを最初に1回開いてください。その後は端末に監視設定が保持されます。</p>
      <div class="live-actions">
        <button id="liveRotateBtn" class="ghost compact" type="button">監視キーを再発行</button>
        <button id="liveDisableAdminBtn" class="ghost compact" type="button">この管理画面から解除</button>
      </div>
    </div>

    <details class="live-restore">
      <summary>別の管理端末で監視設定を復元</summary>
      <div class="live-restore-row">
        <input id="liveRestoreInput" type="text" placeholder="監視URL または framecam-... の監視キー" />
        <button id="liveRestoreBtn" class="ghost" type="button">復元</button>
      </div>
    </details>

    <div class="live-device-section">
      <div class="section-head"><div><div class="section-kicker">RECENT DEVICES</div><h2>端末一覧</h2></div></div>
      <div class="table-wrap">
        <table class="live-device-table">
          <thead><tr><th>端末</th><th>状態</th><th>最終利用</th><th>本日撮影</th></tr></thead>
          <tbody id="liveDeviceBody"><tr><td class="live-empty" colspan="4">監視を開始すると表示されます</td></tr></tbody>
        </table>
      </div>
      <div id="liveRefreshNote" class="live-refresh-note">60秒ごとに自動更新</div>
    </div>

    <div class="live-privacy-note">送信するのは匿名端末ID、アクセス時刻、ブラウザ種別、画面サイズ、縦横、本日の撮影枚数だけです。撮影画像・カメラ映像・フレーム画像・タイトル文言・氏名は送信しません。ログ保存先はntfy.sh無料公開サービスで、監視キーは推測困難なランダム値を使用します。</div>
  `;
  overview.insertBefore(panel, overview.firstChild);
}

function livePatchOldSummary(active, configured) {
  const metric = document.querySelector('#tab-overview .warn-metric');
  if (metric) {
    const strong = metric.querySelector('strong');
    const small = metric.querySelector('small');
    if (strong) strong.textContent = configured ? String(active) : '未設定';
    if (small) small.textContent = configured ? '匿名運用ログ / 20分以内' : '無料監視を開始すると表示';
    metric.classList.toggle('warn-metric', !configured);
  }
  const trafficMetric = document.querySelector('#tab-traffic .muted-metric');
  if (trafficMetric) {
    const strong = trafficMetric.querySelector('strong');
    const small = trafficMetric.querySelector('small');
    if (strong) strong.textContent = configured ? String(active) : '未設定';
    if (small) small.textContent = configured ? '現在利用中 / 20分以内' : '無料監視を開始すると表示';
  }
}

function liveUpdateSetup() {
  const topic = liveTopic();
  const state = document.getElementById('liveState');
  const start = document.getElementById('liveStartBtn');
  const title = document.getElementById('liveSetupTitle');
  const text = document.getElementById('liveSetupText');
  const urlArea = document.getElementById('liveUrlArea');
  const url = document.getElementById('liveUrl');

  if (!topic) {
    state.className = 'live-state';
    state.textContent = '未設定';
    start.textContent = '無料監視を開始';
    title.textContent = '無料リアルタイム監視を開始';
    text.textContent = '外部アカウント作成や有料契約は不要です。監視専用URLを発行し、そのURLでFrameCamを開きます。';
    urlArea.hidden = true;
    livePatchOldSummary(0, false);
    return;
  }

  state.className = 'live-state on';
  state.textContent = '監視ON / 0円';
  start.textContent = '監視中';
  title.textContent = '無料リアルタイム監視：稼働中';
  text.textContent = '下の監視URLをイベント端末に配布してください。GitHubトークンなしでもこの欄は動作します。';
  urlArea.hidden = false;
  url.value = liveMonitoredUrl(topic);
}

async function liveCopy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = 'コピー済み';
    setTimeout(() => { button.textContent = old; }, 1300);
  } catch (_) {
    button.textContent = 'コピー失敗';
    setTimeout(() => { button.textContent = '監視URLをコピー'; }, 1300);
  }
}

function liveParseRestore(value) {
  const raw = String(value || '').trim();
  if (liveValidTopic(raw)) return raw;
  try {
    const url = new URL(raw);
    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    const topic = params.get('monitor') || '';
    return liveValidTopic(topic) ? topic : '';
  } catch (_) {
    return '';
  }
}

function liveMessagePayload(message) {
  if (!message || message.event !== 'message') return null;
  try {
    const payload = JSON.parse(message.message || '');
    if (payload?.app !== 'framecam-local' || payload?.schema !== 1) return null;
    if (!/^[a-f0-9]{24,64}$/i.test(String(payload.device || ''))) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function liveFetchEvents(topic) {
  const response = await fetch(`${LIVE_NTFY}/${encodeURIComponent(topic)}/json?poll=1&since=12h`, {
    credentials: 'omit',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`ntfy-http-${response.status}`);
  const text = await response.text();
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const message = JSON.parse(trimmed);
      const payload = liveMessagePayload(message);
      if (payload) result.push({ payload, serverTime: Number(message.time || 0) * 1000 });
    } catch (_) {}
  }
  return result;
}

function liveAggregate(events) {
  const today = liveToday();
  const devices = new Map();
  for (const entry of events) {
    const p = entry.payload;
    const id = p.device;
    const ts = Number(p.ts || entry.serverTime || 0);
    let row = devices.get(id);
    if (!row) {
      row = { id, lastSeen: 0, browser: '—', screen: '—', orientation: '—', captureToday: 0, day: '', events: 0 };
      devices.set(id, row);
    }
    row.events += 1;
    if (p.day === today) row.captureToday = Math.max(row.captureToday, Number(p.captureToday || 0));
    if (ts >= row.lastSeen) {
      row.lastSeen = ts;
      row.browser = String(p.browser || '—').slice(0, 40);
      row.screen = String(p.screen || '—').slice(0, 24);
      row.orientation = p.orientation === 'landscape' ? '横' : '縦';
      row.day = String(p.day || '');
    }
  }
  return [...devices.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function liveRenderDevices(rows) {
  const body = document.getElementById('liveDeviceBody');
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'live-empty';
    td.textContent = 'まだ端末から運用ログを受信していません。監視URLでFrameCamを開いてください。';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const active = Date.now() - row.lastSeen <= LIVE_ACTIVE_MS;
    const tr = document.createElement('tr');
    const device = document.createElement('td');
    const status = document.createElement('td');
    const last = document.createElement('td');
    const captures = document.createElement('td');

    const chip = document.createElement('span');
    chip.className = 'device-id-chip';
    chip.textContent = `端末 ${row.id.slice(-6).toUpperCase()}`;
    device.appendChild(chip);
    const meta = document.createElement('div');
    meta.className = 'fine-note';
    meta.textContent = `${row.browser} / ${row.screen} / ${row.orientation}`;
    device.appendChild(meta);

    status.textContent = active ? '利用中' : '待機';
    status.className = active ? 'active-now' : 'offline-now';
    last.textContent = `${liveAgo(row.lastSeen)} (${liveTime(row.lastSeen)})`;
    captures.textContent = String(row.captureToday);
    tr.append(device, status, last, captures);
    body.appendChild(tr);
  }
}

function liveRenderSummary(rows) {
  const activeRows = rows.filter(row => Date.now() - row.lastSeen <= LIVE_ACTIVE_MS);
  const active = activeRows.length;
  const captures = rows.reduce((sum, row) => sum + Number(row.captureToday || 0), 0);
  const lastSeen = rows.length ? rows[0].lastSeen : 0;

  document.getElementById('liveActive').textContent = String(active);
  document.getElementById('liveDevices').textContent = String(rows.length);
  document.getElementById('liveCaptures').textContent = String(captures);
  document.getElementById('liveLastSeen').textContent = lastSeen ? liveTime(lastSeen) : '—';
  document.getElementById('liveLastSeenSub').textContent = lastSeen ? liveAgo(lastSeen) : 'まだ受信していません';
  livePatchOldSummary(active, true);
}

async function liveRefresh() {
  const topic = liveTopic();
  if (!topic || liveLoading) return;
  liveLoading = true;
  const state = document.getElementById('liveState');
  const note = document.getElementById('liveRefreshNote');
  try {
    const events = await liveFetchEvents(topic);
    const rows = liveAggregate(events);
    liveRenderDevices(rows);
    liveRenderSummary(rows);
    state.className = 'live-state on';
    state.textContent = '監視ON / 0円';
    note.textContent = `更新 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} / 60秒ごとに自動更新`;
  } catch (err) {
    console.warn('Live monitor refresh failed', err);
    state.className = 'live-state error';
    state.textContent = '取得エラー';
    note.textContent = 'ntfy.shから取得できませんでした。通信状態を確認してください。';
  } finally {
    liveLoading = false;
  }
}

function liveStartPolling() {
  clearInterval(livePollTimer);
  if (!liveTopic()) return;
  void liveRefresh();
  livePollTimer = setInterval(() => { void liveRefresh(); }, LIVE_POLL_MS);
}

function liveProvision({ rotate = false } = {}) {
  if (rotate && !window.confirm('監視キーを再発行します。現在の監視URLを使っている端末は、新しいURLを一度開くまで新しい管理画面へ表示されません。続けますか？')) return;
  if (!liveTopic() || rotate) localStorage.setItem(LIVE_TOPIC_KEY, liveRandomTopic());
  liveUpdateSetup();
  liveStartPolling();
}

function liveBind() {
  document.getElementById('liveStartBtn').addEventListener('click', () => liveProvision());
  document.getElementById('liveRefreshBtn').addEventListener('click', () => { void liveRefresh(); });
  document.getElementById('liveCopyBtn').addEventListener('click', event => { void liveCopy(liveMonitoredUrl(), event.currentTarget); });
  document.getElementById('liveRotateBtn').addEventListener('click', () => liveProvision({ rotate: true }));
  document.getElementById('liveDisableAdminBtn').addEventListener('click', () => {
    if (!window.confirm('この管理端末から監視キーを削除しますか？イベント端末側のログ送信設定はそのまま残ります。')) return;
    localStorage.removeItem(LIVE_TOPIC_KEY);
    clearInterval(livePollTimer);
    liveUpdateSetup();
    liveRenderDevices([]);
    document.getElementById('liveActive').textContent = '—';
    document.getElementById('liveDevices').textContent = '—';
    document.getElementById('liveCaptures').textContent = '—';
    document.getElementById('liveLastSeen').textContent = '—';
  });
  document.getElementById('liveRestoreBtn').addEventListener('click', () => {
    const input = document.getElementById('liveRestoreInput');
    const topic = liveParseRestore(input.value);
    if (!topic) {
      input.setCustomValidity('監視URLまたは監視キーを確認してください');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    localStorage.setItem(LIVE_TOPIC_KEY, topic);
    input.value = '';
    liveUpdateSetup();
    liveStartPolling();
  });
}

function livePatchPrivacyCopy() {
  const privacy = document.getElementById('privacyHealth');
  const sys = document.getElementById('sysConnectText');
  const privacyIcon = document.getElementById('privacyHealthIcon');
  const sysIcon = document.getElementById('sysConnectIcon');
  if (privacy && /要確認|外部通信なし/.test(privacy.textContent || '')) {
    privacy.textContent = '画像送信なし / ntfy.shへ匿名運用ログのみ許可';
    if (privacyIcon) privacyIcon.className = 'health-icon ok';
  }
  if (sys && /要確認|connect-src/.test(sys.textContent || '')) {
    sys.textContent = 'ntfy.shのみ許可（匿名運用ログ）';
    if (sysIcon) sysIcon.className = 'health-icon ok';
  }
}

liveInsertPanel();
liveBind();
liveUpdateSetup();
if (liveTopic()) liveStartPolling();

// The base admin renderer may update the CSP health copy after GitHub refresh.
const livePrivacyObserver = new MutationObserver(livePatchPrivacyCopy);
const privacyTarget = document.getElementById('privacyHealth');
const sysTarget = document.getElementById('sysConnectText');
if (privacyTarget) livePrivacyObserver.observe(privacyTarget, { childList: true, characterData: true, subtree: true });
if (sysTarget) livePrivacyObserver.observe(sysTarget, { childList: true, characterData: true, subtree: true });
livePatchPrivacyCopy();
