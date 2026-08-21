'use strict';

// Persistent multi-frame library for event shooting.
// Frames stay on-device in IndexedDB and can be switched from the shooting UI.

const FRAME_LIBRARY_STATE_KEY = 'frameLibrary.v1';
const FRAME_LIBRARY_ACTIVE_ID_KEY = 'framecam.frameLibrary.activeId.v1';
const FRAME_LIBRARY_MAX = 12;

let frameLibraryItems = [];
const frameLibraryThumbUrls = new Map();
let frameLibraryReady = false;

function ensureFrameLibraryStyles() {
  if (document.querySelector('link[data-frame-library-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './frame-library.css';
  link.dataset.frameLibraryStyle = '1';
  document.head.appendChild(link);
}

function makeFrameLibraryId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function frameLibraryActiveId() {
  return localStorage.getItem(FRAME_LIBRARY_ACTIVE_ID_KEY) || '';
}

function setFrameLibraryActiveId(id) {
  if (id) localStorage.setItem(FRAME_LIBRARY_ACTIVE_ID_KEY, id);
  else localStorage.removeItem(FRAME_LIBRARY_ACTIVE_ID_KEY);
}

function frameLibraryMime(item) {
  if (item.type) return item.type;
  if (item.format === 'jpeg') return 'image/jpeg';
  if (item.format === 'png') return 'image/png';
  if (item.format === 'heic') return 'image/heic';
  return 'application/octet-stream';
}

function itemToFrameFile(item) {
  return new File([item.blob], item.name || 'frame', {
    type: frameLibraryMime(item),
    lastModified: item.lastModified || Date.now()
  });
}

function revokeFrameLibraryThumbs() {
  for (const url of frameLibraryThumbUrls.values()) URL.revokeObjectURL(url);
  frameLibraryThumbUrls.clear();
}

function frameLibraryThumbUrl(item) {
  if (!item?.blob) return '';
  if (!frameLibraryThumbUrls.has(item.id)) {
    frameLibraryThumbUrls.set(item.id, URL.createObjectURL(item.blob));
  }
  return frameLibraryThumbUrls.get(item.id);
}

async function persistFrameLibrary() {
  await putState(FRAME_LIBRARY_STATE_KEY, frameLibraryItems);
}

function frameLibraryDuplicate(file) {
  return frameLibraryItems.some(item =>
    item.name === file.name &&
    Number(item.blob?.size || item.size || 0) === Number(file.size || 0) &&
    Number(item.lastModified || 0) === Number(file.lastModified || 0)
  );
}

async function describeFrameLibraryFile(file) {
  if (!file || file.size > MAX_FRAME_BYTES) return null;
  const detected = await detectImageFormat(file);
  if (detected) return detected;
  const mime = String(file.type || '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif' || /\.(heic|heif)$/i.test(file.name || '')) return 'heic';
  return null;
}

function createFrameQuickPicker() {
  let picker = document.getElementById('frameQuickPicker');
  if (picker) return picker;

  picker = document.createElement('div');
  picker.id = 'frameQuickPicker';
  picker.className = 'frame-quick-picker';
  picker.setAttribute('aria-label', '撮影フレーム選択');

  const statusRow = document.querySelector('.status-row');
  if (statusRow?.parentNode) statusRow.parentNode.insertBefore(picker, statusRow);
  else els.previewWrap.insertAdjacentElement('afterend', picker);
  return picker;
}

function createFrameLibraryManager() {
  let manager = document.getElementById('frameLibraryManager');
  if (manager) return manager;

  manager = document.createElement('section');
  manager.id = 'frameLibraryManager';
  manager.className = 'frame-library-manager';
  manager.innerHTML = `
    <div class="frame-library-head">
      <strong>登録済みフレーム</strong>
      <span id="frameLibraryCount">0 / ${FRAME_LIBRARY_MAX}</span>
    </div>
    <div id="frameLibraryList" class="frame-library-list"></div>
    <div class="small-note">一度登録したフレームはこの端末に保存され、撮影画面からすぐ切り替えられます。</div>
  `;

  const frameField = document.getElementById('framePickerBtn')?.closest('.field');
  const note = frameField?.nextElementSibling;
  if (note?.parentNode) note.insertAdjacentElement('afterend', manager);
  else frameField?.insertAdjacentElement('afterend', manager);
  return manager;
}

function makeQuickFrameButton(item, activeId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'frame-quick-choice';
  button.dataset.frameId = item.id;
  button.setAttribute('aria-pressed', item.id === activeId ? 'true' : 'false');
  button.title = item.name || 'フレーム';

  const thumb = document.createElement('span');
  thumb.className = 'frame-quick-thumb checker-bg';
  const img = document.createElement('img');
  img.src = frameLibraryThumbUrl(item);
  img.alt = '';
  thumb.appendChild(img);

  const label = document.createElement('span');
  label.className = 'frame-quick-label';
  label.textContent = item.name || 'フレーム';

  button.append(thumb, label);
  button.addEventListener('click', () => { void activateFrameLibraryItem(item.id); });
  return button;
}

function renderFrameQuickPicker() {
  const picker = createFrameQuickPicker();
  const activeId = frameLibraryActiveId();
  picker.replaceChildren();

  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'frame-quick-choice frame-none-choice';
  none.setAttribute('aria-pressed', activeId ? 'false' : 'true');
  none.innerHTML = '<span class="frame-quick-thumb frame-none-thumb">なし</span><span class="frame-quick-label">フレームなし</span>';
  none.addEventListener('click', deactivateFrameLibrary);
  picker.appendChild(none);

  for (const item of frameLibraryItems) picker.appendChild(makeQuickFrameButton(item, activeId));

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'frame-quick-choice frame-add-choice';
  add.innerHTML = '<span class="frame-quick-thumb frame-add-thumb">＋</span><span class="frame-quick-label">追加</span>';
  add.addEventListener('click', () => document.getElementById('framePickerBtn')?.click());
  picker.appendChild(add);
}

function renderFrameLibraryManager() {
  createFrameLibraryManager();
  const list = document.getElementById('frameLibraryList');
  const count = document.getElementById('frameLibraryCount');
  if (!list || !count) return;

  const activeId = frameLibraryActiveId();
  count.textContent = `${frameLibraryItems.length} / ${FRAME_LIBRARY_MAX}`;
  list.replaceChildren();

  if (!frameLibraryItems.length) {
    const empty = document.createElement('div');
    empty.className = 'frame-library-empty';
    empty.textContent = 'まだフレームが登録されていません';
    list.appendChild(empty);
    return;
  }

  for (const item of frameLibraryItems) {
    const row = document.createElement('div');
    row.className = 'frame-library-row';
    row.dataset.active = item.id === activeId ? 'true' : 'false';

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'frame-library-select';

    const thumb = document.createElement('span');
    thumb.className = 'frame-library-thumb checker-bg';
    const img = document.createElement('img');
    img.src = frameLibraryThumbUrl(item);
    img.alt = '';
    thumb.appendChild(img);

    const meta = document.createElement('span');
    meta.className = 'frame-library-meta';
    const name = document.createElement('strong');
    name.textContent = item.name || 'フレーム';
    const kind = document.createElement('small');
    kind.textContent = `${String(item.format || '').toUpperCase()}${item.id === activeId ? ' ・ 使用中' : ''}`;
    meta.append(name, kind);
    choose.append(thumb, meta);
    choose.addEventListener('click', () => { void activateFrameLibraryItem(item.id); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'frame-library-delete';
    remove.textContent = '削除';
    remove.addEventListener('click', () => { void deleteFrameLibraryItem(item.id); });

    row.append(choose, remove);
    list.appendChild(row);
  }
}

function renderFrameLibraryUi() {
  renderFrameQuickPicker();
  renderFrameLibraryManager();
}

async function activateFrameLibraryItem(id) {
  const item = frameLibraryItems.find(entry => entry.id === id);
  if (!item?.blob) return;

  setFrameLibraryActiveId(id);
  renderFrameLibraryUi();
  await loadFrame(itemToFrameFile(item));
  setTimeout(renderFrameLibraryUi, 60);
}

function deactivateFrameLibrary() {
  setFrameLibraryActiveId('');
  clearFrame();
  renderFrameLibraryUi();
}

async function deleteFrameLibraryItem(id) {
  const index = frameLibraryItems.findIndex(item => item.id === id);
  if (index < 0) return;
  const wasActive = frameLibraryActiveId() === id;
  frameLibraryItems.splice(index, 1);
  if (wasActive) {
    setFrameLibraryActiveId('');
    clearFrame();
  }
  revokeFrameLibraryThumbs();
  await persistFrameLibrary();
  renderFrameLibraryUi();
  setStatus('登録フレームを削除しました');
}

async function addFilesToFrameLibrary(files) {
  const selected = [...files];
  if (!selected.length) return;

  let added = 0;
  let skipped = 0;
  const newIds = [];

  for (const file of selected) {
    if (frameLibraryItems.length >= FRAME_LIBRARY_MAX) {
      skipped += 1;
      continue;
    }
    if (frameLibraryDuplicate(file)) {
      skipped += 1;
      continue;
    }
    const format = await describeFrameLibraryFile(file);
    if (!format) {
      skipped += 1;
      continue;
    }

    const id = makeFrameLibraryId();
    frameLibraryItems.push({
      id,
      name: file.name || `frame-${frameLibraryItems.length + 1}`,
      type: file.type || '',
      format,
      blob: file,
      size: file.size || 0,
      lastModified: file.lastModified || Date.now(),
      createdAt: Date.now()
    });
    newIds.push(id);
    added += 1;
  }

  revokeFrameLibraryThumbs();
  await persistFrameLibrary();

  if (!frameLibraryActiveId() && newIds.length) await activateFrameLibraryItem(newIds[0]);
  else renderFrameLibraryUi();

  if (added && skipped) setStatus(`${added}件登録しました。${skipped}件は重複・形式・上限のため追加していません`);
  else if (added) setStatus(`${added}件のフレームを登録しました`);
  else setStatus(`追加できませんでした。JPEG/PNGを選び、最大${FRAME_LIBRARY_MAX}件まで登録できます`, true);
}

function replaceFrameInputForLibrary() {
  const oldInput = els.frameInput;
  if (!oldInput || oldInput.dataset.libraryReady === '1') return;

  const nextInput = oldInput.cloneNode(true);
  nextInput.multiple = true;
  nextInput.dataset.libraryReady = '1';
  nextInput.value = '';
  oldInput.replaceWith(nextInput);
  els.frameInput = nextInput;

  nextInput.addEventListener('change', event => {
    const files = event.target.files;
    void addFilesToFrameLibrary(files).finally(() => { event.target.value = ''; });
  });

  const pickerBtn = document.getElementById('framePickerBtn');
  if (pickerBtn) pickerBtn.textContent = 'フレームを追加（複数選択可）';
}

async function restoreFrameLibrary() {
  const saved = await getState(FRAME_LIBRARY_STATE_KEY);
  if (Array.isArray(saved)) {
    frameLibraryItems = saved.filter(item => item?.id && item?.blob).slice(0, FRAME_LIBRARY_MAX);
  }

  // Migrate the previously active single frame into the library once, so
  // existing users do not have to register it again after this update.
  const legacy = await getState('activeFrame');
  if (legacy?.blob && legacy?.name) {
    const exists = frameLibraryItems.some(item =>
      item.name === legacy.name && Number(item.blob?.size || 0) === Number(legacy.blob?.size || 0)
    );
    if (!exists && frameLibraryItems.length < FRAME_LIBRARY_MAX) {
      const id = makeFrameLibraryId();
      frameLibraryItems.unshift({
        id,
        name: legacy.name,
        type: legacy.type || legacy.blob.type || '',
        format: legacy.format || 'png',
        blob: legacy.blob,
        size: legacy.blob.size || 0,
        lastModified: Date.now(),
        createdAt: Date.now()
      });
      if (!frameLibraryActiveId()) setFrameLibraryActiveId(id);
      await persistFrameLibrary();
    }
  }

  const activeId = frameLibraryActiveId();
  if (activeId && !frameLibraryItems.some(item => item.id === activeId)) setFrameLibraryActiveId('');
  if (!frameLibraryActiveId() && frameLibraryItems.length && frameImage) {
    const currentName = localStorage.getItem('framecam.frameName.v1') || '';
    const match = frameLibraryItems.find(item => item.name === currentName);
    if (match) setFrameLibraryActiveId(match.id);
  }

  frameLibraryReady = true;
  renderFrameLibraryUi();
}

ensureFrameLibraryStyles();
createFrameQuickPicker();
createFrameLibraryManager();
replaceFrameInputForLibrary();

els.clearFrameBtn.addEventListener('click', () => {
  setFrameLibraryActiveId('');
  renderFrameLibraryUi();
});

window.addEventListener('pagehide', revokeFrameLibraryThumbs);
void restoreFrameLibrary();
