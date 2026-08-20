'use strict';

// GitHub Pages cannot emit CSP frame-ancestors headers. Refuse framed UI as a
// best-effort clickjacking mitigation. This does not transmit any data.
if (window.top !== window.self) {
  document.documentElement.textContent = 'このページは埋め込み表示できません。';
  throw new Error('FrameCam cannot run inside a frame.');
}

const els = {
  video: document.getElementById('video'),
  previewWrap: document.getElementById('previewWrap'),
  frameOverlay: document.getElementById('frameOverlay'),
  titleOverlay: document.getElementById('titleOverlay'),
  cameraMessage: document.getElementById('cameraMessage'),
  cameraBtn: document.getElementById('cameraBtn'),
  shootBtn: document.getElementById('shootBtn'),
  lastBtn: document.getElementById('lastBtn'),
  counter: document.getElementById('counter'),
  frameName: document.getElementById('frameName'),
  saveState: document.getElementById('saveState'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  closeSettings: document.getElementById('closeSettings'),
  orientationSelect: document.getElementById('orientationSelect'),
  frameInput: document.getElementById('frameInput'),
  clearFrameBtn: document.getElementById('clearFrameBtn'),
  titleEnabled: document.getElementById('titleEnabled'),
  titleFields: document.getElementById('titleFields'),
  titleText: document.getElementById('titleText'),
  titlePosition: document.getElementById('titlePosition'),
  titleSize: document.getElementById('titleSize'),
  titleColor: document.getElementById('titleColor'),
  titleBand: document.getElementById('titleBand'),
  resetCountBtn: document.getElementById('resetCountBtn'),
  captureCanvas: document.getElementById('captureCanvas'),
  lastDialog: document.getElementById('lastDialog'),
  closeLast: document.getElementById('closeLast'),
  lastImage: document.getElementById('lastImage'),
  lastFilename: document.getElementById('lastFilename'),
  downloadLastBtn: document.getElementById('downloadLastBtn'),
  photosImportBtn: document.getElementById('photosImportBtn'),
  photosHelpBtn: document.getElementById('photosHelpBtn'),
  photosHelpDialog: document.getElementById('photosHelpDialog'),
  closePhotosHelp: document.getElementById('closePhotosHelp')
};

const SETTINGS_KEY = 'framecam.settings.v2';
const COUNT_KEY = 'framecam.count.v2';
const DB_NAME = 'FrameCamLocalWebV1';
const STORE = 'state';
const PHOTOS_SHORTCUT_NAME = 'FrameCam写真取込';
const MAX_FRAME_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_URL_TTL_MS = 15000;

let stream = null;
let cameraWanted = false;
let cameraStarting = false;
let cameraStopping = false;
let capturing = false;
let wakeLock = null;
let frameImage = null;
let frameObjectUrl = null;
let captureCount = Number(localStorage.getItem(COUNT_KEY) || localStorage.getItem('framecam.count.v1') || '0');
let lastCapture = null;
let composingTitle = false;
let statusTimer = null;
let resizeTimer = null;
const pendingDownloadUrls = new Set();

const settings = Object.assign({
  orientation: 'landscape',
  titleEnabled: false,
  titleText: '',
  titlePosition: 'bottom',
  titleSize: 72,
  titleColor: 'white',
  titleBand: true
}, safeJSON(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem('framecam.settings.v1')));

function safeJSON(s) {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function updateCount() {
  els.counter.textContent = `撮影 ${captureCount}`;
  localStorage.setItem(COUNT_KEY, String(captureCount));
}

function setStatus(text, sticky = false) {
  els.saveState.textContent = text;
  els.saveState.classList.toggle('error', sticky);
  clearTimeout(statusTimer);
  if (!sticky) {
    statusTimer = setTimeout(() => {
      els.saveState.textContent = '連続撮影OK。必要な時に「写真アプリへ取り込む」を押してください';
      els.saveState.classList.remove('error');
    }, 2200);
  }
}

function applySettingsToUI() {
  els.orientationSelect.value = settings.orientation;
  els.titleEnabled.checked = Boolean(settings.titleEnabled);
  els.titleText.value = settings.titleText;
  els.titlePosition.value = settings.titlePosition;
  els.titleSize.value = String(settings.titleSize);
  els.titleColor.value = settings.titleColor;
  els.titleBand.checked = Boolean(settings.titleBand);
  els.titleFields.hidden = !settings.titleEnabled;
  els.previewWrap.classList.toggle('landscape', settings.orientation === 'landscape');
  els.previewWrap.classList.toggle('portrait', settings.orientation === 'portrait');
  renderTitlePreview();
}

function outputSize() {
  return settings.orientation === 'landscape'
    ? { w: 1800, h: 1200 }
    : { w: 1200, h: 1800 };
}

function outputTitleSize(outW) {
  return Number(settings.titleSize) * (outW / 1800);
}

function renderTitlePreview() {
  const text = settings.titleText.trim();
  const on = Boolean(settings.titleEnabled && text);
  els.titleOverlay.hidden = !on;
  if (!on) return;

  const { w: outW } = outputSize();
  const outSize = outputTitleSize(outW);
  const measure = els.captureCanvas.getContext('2d');
  measure.font = `800 ${outSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;
  const lines = wrapText(measure, text, outW * 0.90, 3);
  els.titleOverlay.textContent = lines.join('\n');

  els.titleOverlay.classList.toggle('top', settings.titlePosition === 'top');
  els.titleOverlay.classList.toggle('bottom', settings.titlePosition === 'bottom');
  els.titleOverlay.classList.toggle('band', Boolean(settings.titleBand));
  els.titleOverlay.classList.toggle('text-black', settings.titleColor === 'black');
  els.titleOverlay.classList.toggle('text-white', settings.titleColor !== 'black');

  const clamped = Math.max(40, Math.min(140, Math.round(Number(settings.titleSize) / 2) * 2));
  els.titleOverlay.dataset.size = String(clamped);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock unavailable', err);
  }
}

function isStreamLive() {
  return Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));
}

function attachTrackWatchers() {
  if (!stream) return;
  stream.getVideoTracks().forEach(track => {
    track.addEventListener('ended', () => {
      if (cameraStopping || document.visibilityState !== 'visible') return;
      els.shootBtn.disabled = true;
      els.cameraMessage.hidden = false;
      els.cameraMessage.textContent = 'カメラが停止しました。「カメラ再起動」を押してください。';
      setStatus('カメラが停止しています。再起動してください。', true);
    }, { once: true });
  });
}

async function startCamera() {
  if (cameraStarting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    els.cameraMessage.hidden = false;
    els.cameraMessage.textContent = 'このSafariではライブカメラを利用できません。';
    return;
  }

  cameraWanted = true;
  cameraStarting = true;
  els.cameraBtn.disabled = true;
  els.shootBtn.disabled = true;
  els.cameraMessage.hidden = false;
  els.cameraMessage.textContent = 'カメラを起動しています…';
  stopCamera({ preserveWanted: true });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1920 }
      }
    });

    els.video.srcObject = stream;
    await els.video.play();
    attachTrackWatchers();
    await requestWakeLock();

    els.cameraMessage.hidden = true;
    els.shootBtn.disabled = false;
    els.cameraBtn.textContent = 'カメラ再起動';
    setStatus('カメラ準備OK');
  } catch (err) {
    console.error(err);
    stream = null;
    els.cameraMessage.hidden = false;
    const messages = {
      NotAllowedError: 'カメラが許可されていません。SafariのWebサイト設定でカメラを「許可」にしてください。',
      NotFoundError: '背面カメラが見つかりません。端末を確認してください。',
      NotReadableError: 'カメラを利用できません。他のカメラ使用中アプリを閉じてください。',
      OverconstrainedError: '背面カメラの指定に失敗しました。ページを再読み込みして再度お試しください。',
      AbortError: 'カメラの開始が中断されました。もう一度「カメラ再起動」を押してください。'
    };
    const msg = messages[err?.name] || 'カメラを開始できませんでした。Safariを再読み込みして再度お試しください。';
    els.cameraMessage.textContent = msg;
    setStatus(msg, true);
    els.shootBtn.disabled = true;
  } finally {
    cameraStarting = false;
    els.cameraBtn.disabled = false;
  }
}

function stopCamera({ preserveWanted = false } = {}) {
  cameraStopping = true;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  els.video.srcObject = null;
  if (!preserveWanted) cameraWanted = false;
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  setTimeout(() => { cameraStopping = false; }, 0);
}

async function recoverIfNeeded() {
  if (!cameraWanted || document.visibilityState !== 'visible' || cameraStarting) return;
  if (!isStreamLive()) {
    els.shootBtn.disabled = true;
    els.cameraMessage.hidden = false;
    els.cameraMessage.textContent = 'カメラを再開しています…';
    await startCamera();
    return;
  }
  if (els.video.paused) els.video.play().catch(() => {});
  if (!wakeLock) void requestWakeLock();
}
