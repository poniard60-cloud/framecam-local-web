'use strict';

// Zero-cost operational telemetry for FrameCam.
// Enabled only when a monitoring topic is provisioned through the URL hash
// (#monitor=<unguessable-topic>). No photo/frame/title/image data is sent.

const FRAMECAM_MONITOR_TOPIC_KEY = 'framecam.monitor.topic.v1';
const FRAMECAM_MONITOR_DEVICE_KEY = 'framecam.monitor.device.v1';
const FRAMECAM_MONITOR_DAY_KEY = 'framecam.monitor.day.v1';
const FRAMECAM_MONITOR_CAPTURE_KEY = 'framecam.monitor.captureToday.v1';
const FRAMECAM_MONITOR_LAST_SEND_KEY = 'framecam.monitor.lastSend.v1';
const FRAMECAM_MONITOR_ENDPOINT = 'https://ntfy.sh';
const FRAMECAM_MONITOR_HEARTBEAT_MS = 15 * 60 * 1000;
const FRAMECAM_MONITOR_VISIBLE_REFRESH_MS = 10 * 60 * 1000;

function monitorRandomId(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map(v => v.toString(16).padStart(2, '0')).join('');
}

function monitorValidTopic(value) {
  return /^framecam-[a-z0-9_-]{24,96}$/i.test(String(value || ''));
}

function monitorHashTopic() {
  try {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const value = params.get('monitor');
    if (!value) return null;
    if (value === 'off') return 'off';
    return monitorValidTopic(value) ? value : null;
  } catch (_) {
    return null;
  }
}

const monitorHash = monitorHashTopic();
if (monitorHash === 'off') {
  localStorage.removeItem(FRAMECAM_MONITOR_TOPIC_KEY);
} else if (monitorHash) {
  localStorage.setItem(FRAMECAM_MONITOR_TOPIC_KEY, monitorHash);
}

const framecamMonitorTopic = monitorValidTopic(localStorage.getItem(FRAMECAM_MONITOR_TOPIC_KEY))
  ? localStorage.getItem(FRAMECAM_MONITOR_TOPIC_KEY)
  : '';

function monitorDeviceId() {
  let id = localStorage.getItem(FRAMECAM_MONITOR_DEVICE_KEY);
  if (!/^[a-f0-9]{24,64}$/i.test(String(id || ''))) {
    id = monitorRandomId(12);
    localStorage.setItem(FRAMECAM_MONITOR_DEVICE_KEY, id);
  }
  return id;
}

function monitorLocalDay() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monitorEnsureDay() {
  const today = monitorLocalDay();
  if (localStorage.getItem(FRAMECAM_MONITOR_DAY_KEY) !== today) {
    localStorage.setItem(FRAMECAM_MONITOR_DAY_KEY, today);
    localStorage.setItem(FRAMECAM_MONITOR_CAPTURE_KEY, '0');
  }
  return today;
}

function monitorCaptureToday() {
  monitorEnsureDay();
  return Math.max(0, Number(localStorage.getItem(FRAMECAM_MONITOR_CAPTURE_KEY) || '0') || 0);
}

function monitorBrowser() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua)) return 'iPhone Safari';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function monitorOrientation() {
  return settings?.orientation === 'landscape' ? 'landscape' : 'portrait';
}

async function monitorSend(type, extra = {}) {
  if (!framecamMonitorTopic || !navigator.onLine) return false;
  const now = Date.now();
  const payload = {
    schema: 1,
    app: 'framecam-local',
    type,
    device: monitorDeviceId(),
    session: framecamMonitorSession,
    ts: now,
    day: monitorEnsureDay(),
    captureToday: monitorCaptureToday(),
    browser: monitorBrowser(),
    screen: `${screen.width}x${screen.height}`,
    dpr: Number(devicePixelRatio || 1).toFixed(1),
    orientation: monitorOrientation(),
    ...extra
  };

  try {
    const response = await fetch(`${FRAMECAM_MONITOR_ENDPOINT}/${encodeURIComponent(framecamMonitorTopic)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
      keepalive: type === 'close'
    });
    if (!response.ok) throw new Error(`monitor-http-${response.status}`);
    localStorage.setItem(FRAMECAM_MONITOR_LAST_SEND_KEY, String(now));
    return true;
  } catch (err) {
    console.debug('FrameCam monitor send skipped', err);
    return false;
  }
}

const framecamMonitorSession = monitorRandomId(8);

function monitorSetPrivacyLabel() {
  if (!framecamMonitorTopic) return;
  const privacy = document.getElementById('privacyState');
  if (privacy) privacy.textContent = '画像通信なし / 匿名運用ログON';
}

function monitorIncrementCapture(delta = 1) {
  monitorEnsureDay();
  const next = monitorCaptureToday() + Math.max(1, Number(delta) || 1);
  localStorage.setItem(FRAMECAM_MONITOR_CAPTURE_KEY, String(next));
}

if (framecamMonitorTopic) {
  monitorSetPrivacyLabel();

  // Count successful JPEG creations locally. Capture totals are included in
  // heartbeat/close messages, so message volume never scales with photo count.
  if (typeof updateCount === 'function') {
    const updateCountBaseMonitor = updateCount;
    let observedCaptureCount = Number(typeof captureCount !== 'undefined' ? captureCount : 0) || 0;
    updateCount = function updateCountWithMonitor(...args) {
      const result = updateCountBaseMonitor.apply(this, args);
      const current = Number(typeof captureCount !== 'undefined' ? captureCount : 0) || 0;
      if (current > observedCaptureCount) monitorIncrementCapture(current - observedCaptureCount);
      observedCaptureCount = current;
      return result;
    };
  }

  setTimeout(() => { void monitorSend('open'); }, 900);
  setInterval(() => { void monitorSend('heartbeat'); }, FRAMECAM_MONITOR_HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const last = Number(localStorage.getItem(FRAMECAM_MONITOR_LAST_SEND_KEY) || '0') || 0;
    if (Date.now() - last >= FRAMECAM_MONITOR_VISIBLE_REFRESH_MS) void monitorSend('heartbeat');
  });

  window.addEventListener('online', () => { void monitorSend('heartbeat'); });
  window.addEventListener('pagehide', () => { void monitorSend('close'); });
}
