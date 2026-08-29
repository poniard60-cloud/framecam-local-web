'use strict';

const OWNER = 'poniard60-cloud';
const REPO = 'framecam-local-web';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

const els = {
  tokenInput: document.getElementById('tokenInput'),
  loadBtn: document.getElementById('loadBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  authStatus: document.getElementById('authStatus'),
  dashboard: document.getElementById('dashboard'),
  viewCount: document.getElementById('viewCount'),
  viewUnique: document.getElementById('viewUnique'),
  uniqueVisitors: document.getElementById('uniqueVisitors'),
  cloneCount: document.getElementById('cloneCount'),
  cloneUnique: document.getElementById('cloneUnique'),
  dailyChart: document.getElementById('dailyChart'),
  referrerBody: document.getElementById('referrerBody'),
  pathBody: document.getElementById('pathBody'),
  updatedAt: document.getElementById('updatedAt')
};

let activeToken = '';

if (window.top !== window.self) {
  document.documentElement.textContent = 'このページは埋め込み表示できません。';
  throw new Error('FrameCam Admin cannot run inside a frame.');
}

function setStatus(text, kind = '') {
  els.authStatus.textContent = text;
  els.authStatus.className = `status${kind ? ` ${kind}` : ''}`;
}

function fmt(value) {
  return new Intl.NumberFormat('ja-JP').format(Number(value || 0));
}

function dateLabel(timestamp) {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
    empty.textContent = '日別データはまだありません。';
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

async function loadTraffic(token) {
  setStatus('GitHubから集計データを取得しています…');
  els.loadBtn.disabled = true;
  if (els.refreshBtn) els.refreshBtn.disabled = true;

  try {
    const [views, clones, referrers, paths] = await Promise.all([
      github('/traffic/views', token),
      github('/traffic/clones', token),
      github('/traffic/popular/referrers', token),
      github('/traffic/popular/paths', token)
    ]);

    activeToken = token;
    els.viewCount.textContent = fmt(views.count);
    els.viewUnique.textContent = `ユニーク ${fmt(views.uniques)}`;
    els.uniqueVisitors.textContent = fmt(views.uniques);
    els.cloneCount.textContent = fmt(clones.count);
    els.cloneUnique.textContent = `ユニーク ${fmt(clones.uniques)}`;
    renderDaily(views.views);
    fillTable(els.referrerBody, referrers, 'referrer');
    fillTable(els.pathBody, paths, 'path');
    els.updatedAt.textContent = `更新: ${new Date().toLocaleString('ja-JP')}`;
    els.dashboard.hidden = false;
    setStatus('接続済み。Traffic情報を表示しています。', 'ok');
  } catch (err) {
    console.error(err);
    activeToken = '';
    els.dashboard.hidden = true;
    if (err.status === 401) setStatus('トークンが無効です。GitHubトークンを確認してください。', 'error');
    else if (err.status === 403) setStatus('このトークンではTraffic情報を読めません。リポジトリへの必要な権限を確認してください。', 'error');
    else if (err.status === 404) setStatus('リポジトリまたはTraffic情報へアクセスできません。トークンの対象リポジトリを確認してください。', 'error');
    else setStatus(`取得に失敗しました: ${err.message}`, 'error');
  } finally {
    els.loadBtn.disabled = false;
    if (els.refreshBtn) els.refreshBtn.disabled = false;
  }
}

els.loadBtn.addEventListener('click', () => {
  const token = els.tokenInput.value.trim();
  if (!token) {
    setStatus('GitHubトークンを入力してください。', 'error');
    els.tokenInput.focus();
    return;
  }
  void loadTraffic(token);
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
  void loadTraffic(activeToken);
});

window.addEventListener('pagehide', () => {
  activeToken = '';
  els.tokenInput.value = '';
});
