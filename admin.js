'use strict';

const OWNER = 'poniard60-cloud';
const REPO = 'framecam-local-web';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const APP_URL = 'https://poniard60-cloud.github.io/framecam-local-web/';

const els = {
  tokenInput: document.getElementById('tokenInput'),
  toggleTokenBtn: document.getElementById('toggleTokenBtn'),
  loadBtn: document.getElementById('loadBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  copyAppUrlBtn: document.getElementById('copyAppUrlBtn'),
  authStatus: document.getElementById('authStatus'),
  connectionDot: document.getElementById('connectionDot'),
  viewCount: document.getElementById('viewCount'),
  viewUnique: document.getElementById('viewUnique'),
  uniqueVisitors: document.getElementById('uniqueVisitors'),
  trafficViewCount: document.getElementById('trafficViewCount'),
  trafficUnique: document.getElementById('trafficUnique'),
  cloneCount: document.getElementById('cloneCount'),
  cloneUnique: document.getElementById('cloneUnique'),
  releaseLabel: document.getElementById('releaseLabel'),
  deployShort: document.getElementById('deployShort'),
  dailyChart: document.getElementById('dailyChart'),
  referrerBody: document.getElementById('referrerBody'),
  pathBody: document.getElementById('pathBody'),
  updatedAt: document.getElementById('updatedAt'),
  publishHealthIcon: document.getElementById('publishHealthIcon'),
  publishHealth: document.getElementById('publishHealth'),
  ratioHealthIcon: document.getElementById('ratioHealthIcon'),
  ratioHealth: document.getElementById('ratioHealth'),
  privacyHealthIcon: document.getElementById('privacyHealthIcon'),
  privacyHealth: document.getElementById('privacyHealth'),
  cacheHealthIcon: document.getElementById('cacheHealthIcon'),
  cacheHealth: document.getElementById('cacheHealth'),
  deviceBrowser: document.getElementById('deviceBrowser'),
  deviceScreen: document.getElementById('deviceScreen'),
  deviceOnline: document.getElementById('deviceOnline'),
  systemRelease: document.getElementById('systemRelease'),
  lastDeployAt: document.getElementById('lastDeployAt'),
  lastDeploySha: document.getElementById('lastDeploySha'),
  cacheVersion: document.getElementById('cacheVersion'),
  lastDeployMessage: document.getElementById('lastDeployMessage'),
  sysConnectIcon: document.getElementById('sysConnectIcon'),
  sysConnectText: document.getElementById('sysConnectText'),
  sysFrameIcon: document.getElementById('sysFrameIcon'),
  sysFrameText: document.getElementById('sysFrameText'),
  sysRatioIcon: document.getElementById('sysRatioIcon'),
  sysRatioText: document.getElementById('sysRatioText')
};

let activeToken = '';
let loading = false;

if (window.top !== window.self) {
  document.documentElement.textContent = 'このページは埋め込み表示できません。';
  throw new Error('FrameCam Admin cannot run inside a frame.');
}

function setStatus(text, kind = '') {
  els.authStatus.textContent = text;
  els.authStatus.className = `status${kind ? ` ${kind}` : ''}`;
  els.connectionDot.className = `status-dot${kind ? ` ${kind}` : ''}`;
}

function setHealth(icon, kind) {
  icon.className = `health-icon${kind ? ` ${kind}` : ''}`;
}

function fmt(value) {
  return new Intl.NumberFormat('ja-JP').format(Number(value || 0));
}

function dateLabel(timestamp) {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function dateTimeLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}

function decodeGitHubContent(file) {
  const encoded = String(file?.content || '').replace(/\s/g, '');
  if (!encoded) return '';
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function github(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    cache: 'no-store'
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body?.message || `GitHub API error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function renderDaily(items) {
  els.dailyChart.replaceChildren();
  const rows = Array.isArray(items) ? items : [];
  const max = Math.max(1, ...rows.map(item => Number(item.count || 0)));
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.textContent = 'データなし';
    empty.className = 'sub';
    els.dailyChart.appendChild(empty);
    return;
  }
  for (const item of rows) {
    const col = document.createElement('div');
    col.className = 'day-col';
    const area = document.createElement('div');
    area.className = 'bar-area';
    const count = Number(item.count || 0);
    const uniques = Number(item.uniques || 0);
    const countBar = document.createElement('div');
    countBar.className = `bar${count ? '' : ' zero'}`;
    countBar.style.height = `${Math.max(count ? 4 : 2, (count / max) * 100)}%`;
    countBar.title = `閲覧 ${count}`;
    const uniqueBar = document.createElement('div');
    uniqueBar.className = `bar unique${uniques ? '' : ' zero'}`;
    uniqueBar.style.height = `${Math.max(uniques ? 4 : 2, (uniques / max) * 100)}%`;
    uniqueBar.title = `ユニーク ${uniques}`;
    area.append(countBar, uniqueBar);
    const value = document.createElement('div');
    value.className = 'day-value';
    value.textContent = fmt(count);
    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = dateLabel(item.timestamp);
    col.append(area, value, label);
    els.dailyChart.appendChild(col);
  }
}

function fillTable(body, rows, firstKey) {
  body.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'データなし';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    const first = document.createElement('td');
    const count = document.createElement('td');
    const unique = document.createElement('td');
    first.textContent = String(row[firstKey] || '—');
    count.textContent = fmt(row.count);
    unique.textContent = fmt(row.uniques);
    tr.append(first, count, unique);
    body.appendChild(tr);
  }
}

function renderTraffic(views, clones, referrers, paths) {
  els.viewCount.textContent = fmt(views.count);
  els.viewUnique.textContent = `ユニーク ${fmt(views.uniques)}`;
  els.uniqueVisitors.textContent = fmt(views.uniques);
  els.trafficViewCount.textContent = fmt(views.count);
  els.trafficUnique.textContent = fmt(views.uniques);
  els.cloneCount.textContent = fmt(clones.count);
  els.cloneUnique.textContent = `ユニーク ${fmt(clones.uniques)}`;
  renderDaily(views.views);
  fillTable(els.referrerBody, referrers, 'referrer');
  fillTable(els.pathBody, paths, 'path');
  els.updatedAt.textContent = `更新: ${new Date().toLocaleString('ja-JP')}`;
}

function latestAppNumber(indexText) {
  const matches = [...indexText.matchAll(/app-(\d+)\.js/g)].map(match => Number(match[1]));
  return matches.length ? Math.max(...matches) : null;
}

function renderSystem(commit, indexText, swText) {
  const appNo = latestAppNumber(indexText);
  const release = appNo ? `app-${appNo}` : '不明';
  const sha = String(commit?.sha || '');
  const message = String(commit?.commit?.message || '');
  const deployAt = commit?.commit?.committer?.date || commit?.commit?.author?.date;
  const cacheMatch = swText.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
  const cache = cacheMatch?.[1] || '確認できません';
  const ratioOk = indexText.includes('縦（3:4）') && indexText.includes('横（4:3）');
  const connectNone = /connect-src\s+'none'/.test(indexText);
  const frameFixOk = Boolean(appNo && appNo >= 14);

  els.releaseLabel.textContent = release;
  els.deployShort.textContent = sha ? `gh-pages / ${sha.slice(0, 7)}` : 'gh-pages';
  els.systemRelease.textContent = release;
  els.lastDeployAt.textContent = dateTimeLabel(deployAt);
  els.lastDeploySha.textContent = sha ? sha.slice(0, 10) : '—';
  els.cacheVersion.textContent = cache;
  els.lastDeployMessage.textContent = message || 'Commit messageなし';

  setHealth(els.publishHealthIcon, 'ok');
  els.publishHealth.textContent = `gh-pages公開中 / ${release}`;

  setHealth(els.ratioHealthIcon, ratioOk ? 'ok' : 'warn');
  els.ratioHealth.textContent = ratioOk ? '縦3:4 / 横4:3' : '3:4設定を確認できません';

  setHealth(els.privacyHealthIcon, connectNone ? 'ok' : 'warn');
  els.privacyHealth.textContent = connectNone ? "connect-src 'none'：撮影画面から外部通信なし" : 'CSPの外部通信設定を要確認';

  setHealth(els.cacheHealthIcon, cacheMatch ? 'ok' : 'warn');
  els.cacheHealth.textContent = cacheMatch ? cache : 'キャッシュ版を取得できません';

  setHealth(els.sysConnectIcon, connectNone ? 'ok' : 'warn');
  els.sysConnectText.textContent = connectNone ? "connect-src 'none' を確認" : '要確認';
  setHealth(els.sysFrameIcon, frameFixOk ? 'ok' : 'warn');
  els.sysFrameText.textContent = frameFixOk ? `${release}：白保護・フレーム前面処理を含む` : `${release}：最新フレーム修正を要確認`;
  setHealth(els.sysRatioIcon, ratioOk ? 'ok' : 'warn');
  els.sysRatioText.textContent = ratioOk ? '縦3:4 / 横4:3 を確認' : '比率表示を確認できません';
}

async function loadDashboard(token) {
  if (loading) return;
  loading = true;
  setStatus('GitHubから管理データを取得しています…');
  els.loadBtn.disabled = true;
  els.refreshBtn.disabled = true;
  try {
    const [views, clones, referrers, paths, commit, indexFile, swFile] = await Promise.all([
      github('/traffic/views', token),
      github('/traffic/clones', token),
      github('/traffic/popular/referrers', token),
      github('/traffic/popular/paths', token),
      github('/commits/gh-pages', token),
      github('/contents/index.html?ref=gh-pages', token),
      github('/contents/sw.js?ref=gh-pages', token)
    ]);

    activeToken = token;
    renderTraffic(views, clones, referrers, paths);
    renderSystem(commit, decodeGitHubContent(indexFile), decodeGitHubContent(swFile));
    els.tokenInput.value = '';
    els.disconnectBtn.hidden = false;
    els.loadBtn.textContent = '再取得';
    setStatus('接続済み。最新の管理情報を表示しています。', 'ok');
  } catch (err) {
    console.error(err);
    if (err.status === 401) setStatus('トークンが無効です。GitHubトークンを確認してください。', 'error');
    else if (err.status === 403) setStatus('Traffic情報を読む権限がありません。トークンのリポジトリ権限を確認してください。', 'error');
    else if (err.status === 404) setStatus('リポジトリまたはTraffic情報を取得できません。', 'error');
    else setStatus(`取得に失敗しました: ${err.message}`, 'error');
  } finally {
    loading = false;
    els.loadBtn.disabled = false;
    els.refreshBtn.disabled = false;
  }
}

function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `tab-${name}`;
  });
  document.querySelectorAll('.tab-btn').forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function browserLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua)) return 'iPhone / Safari';
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//.test(ua)) return 'Google Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return navigator.platform || 'ブラウザ';
}

function renderThisDevice() {
  els.deviceBrowser.textContent = browserLabel();
  els.deviceScreen.textContent = `${screen.width}×${screen.height} / DPR ${Number(devicePixelRatio || 1).toFixed(1)}`;
  els.deviceOnline.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
}

async function copyAppUrl() {
  try {
    await navigator.clipboard.writeText(APP_URL);
    const old = els.copyAppUrlBtn.textContent;
    els.copyAppUrlBtn.textContent = 'コピー済み';
    setTimeout(() => { els.copyAppUrlBtn.textContent = old; }, 1200);
  } catch (_) {
    setStatus('URLをコピーできませんでした。撮影画面を開いてURLをコピーしてください。', 'error');
  }
}

document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

els.toggleTokenBtn.addEventListener('click', () => {
  const showing = els.tokenInput.type === 'text';
  els.tokenInput.type = showing ? 'password' : 'text';
  els.toggleTokenBtn.textContent = showing ? '表示' : '隠す';
});

els.loadBtn.addEventListener('click', () => {
  const token = els.tokenInput.value.trim() || activeToken;
  if (!token) {
    setStatus('GitHubトークンを入力してください。', 'error');
    els.tokenInput.focus();
    return;
  }
  void loadDashboard(token);
});

els.tokenInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.loadBtn.click();
  }
});

els.refreshBtn.addEventListener('click', () => {
  if (!activeToken) {
    setStatus('先にGitHubへ接続してください。', 'error');
    return;
  }
  void loadDashboard(activeToken);
});

els.disconnectBtn.addEventListener('click', () => {
  activeToken = '';
  els.tokenInput.value = '';
  els.disconnectBtn.hidden = true;
  els.loadBtn.textContent = '接続して更新';
  setStatus('切断しました。表示済みの集計値は画面を閉じるまで残ります。');
});

els.copyAppUrlBtn.addEventListener('click', () => { void copyAppUrl(); });
window.addEventListener('online', renderThisDevice);
window.addEventListener('offline', renderThisDevice);
window.addEventListener('pagehide', () => {
  activeToken = '';
  els.tokenInput.value = '';
});

renderThisDevice();
showTab('overview');
