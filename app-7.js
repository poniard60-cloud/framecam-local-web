'use strict';

// PNG transparent-window auto fit + camera zoom controls.
// All image analysis stays on-device in the browser.

const ZOOM_KEY = 'framecam.zoom.v1';
const ALPHA_THRESHOLD = 64;
const MASK_MAX_SIDE = 320;

let frameWindowSource = null; // normalized bounds in the original PNG orientation
let frameWindowImage = null;
let activeFrameWindow = null; // normalized bounds after portrait/landscape rotation
let nativeZoomAvailable = false;
let nativeZoomRange = { min: 1, max: 3, step: 0.1 };
let zoomValue = Math.max(1, Number(localStorage.getItem(ZOOM_KEY) || '1') || 1);
let zoomApplyTimer = null;
let pinchStartDistance = 0;
let pinchStartZoom = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureCameraWindowLayer() {
  let layer = document.getElementById('cameraWindowLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'cameraWindowLayer';
    layer.className = 'camera-window-layer';
    const parent = els.video.parentNode;
    parent.insertBefore(layer, els.video);
    layer.appendChild(els.video);
  }
  return layer;
}

const cameraWindowLayer = ensureCameraWindowLayer();

function ensureZoomHud() {
  let hud = document.getElementById('zoomHud');
  if (hud) return hud;

  hud = document.createElement('div');
  hud.id = 'zoomHud';
  hud.className = 'zoom-hud';
  hud.innerHTML = `
    <button id="zoomOutBtn" type="button" aria-label="ズームアウト">−</button>
    <input id="zoomRange" type="range" min="1" max="3" step="0.1" value="1" aria-label="ズーム" />
    <button id="zoomInBtn" type="button" aria-label="ズームイン">＋</button>
    <span id="zoomValueLabel">1.0×</span>
  `;
  els.previewWrap.appendChild(hud);
  return hud;
}

const zoomHud = ensureZoomHud();
const zoomRange = document.getElementById('zoomRange');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomValueLabel = document.getElementById('zoomValueLabel');

function transformedFrameWindow(bounds) {
  if (!bounds) return null;
  if (!imageNeedsRotation(frameImage)) return { ...bounds };
  return {
    x: 1 - bounds.y - bounds.h,
    y: bounds.x,
    w: bounds.h,
    h: bounds.w
  };
}

function applyCameraWindow() {
  activeFrameWindow = frameFormat === 'png' && frameWindowSource
    ? transformedFrameWindow(frameWindowSource)
    : null;

  if (!activeFrameWindow) {
    cameraWindowLayer.style.left = '0%';
    cameraWindowLayer.style.top = '0%';
    cameraWindowLayer.style.width = '100%';
    cameraWindowLayer.style.height = '100%';
    els.previewWrap.classList.remove('frame-window-detected');
    return;
  }

  const b = activeFrameWindow;
  cameraWindowLayer.style.left = `${(b.x * 100).toFixed(3)}%`;
  cameraWindowLayer.style.top = `${(b.y * 100).toFixed(3)}%`;
  cameraWindowLayer.style.width = `${(b.w * 100).toFixed(3)}%`;
  cameraWindowLayer.style.height = `${(b.h * 100).toFixed(3)}%`;
  els.previewWrap.classList.add('frame-window-detected');
}

function componentScore(component, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const bx = (component.minX + component.maxX) / 2;
  const by = (component.minY + component.maxY) / 2;
  const dx = (bx - cx) / width;
  const dy = (by - cy) / height;
  const distance = Math.min(1, Math.hypot(dx, dy) * 2);
  const centerWeight = component.containsCenter ? 20 : (1.35 - distance * 0.7);
  const edgeTouches = Number(component.minX === 0) + Number(component.minY === 0) +
    Number(component.maxX === width - 1) + Number(component.maxY === height - 1);
  const edgePenalty = component.containsCenter ? 1 : (edgeTouches >= 3 ? 0.35 : edgeTouches >= 2 ? 0.6 : 1);
  return component.count * centerWeight * edgePenalty;
}

function detectTransparentWindow(image) {
  const sourceW = image.naturalWidth;
  const sourceH = image.naturalHeight;
  if (!sourceW || !sourceH) return null;

  const scale = Math.min(1, MASK_MAX_SIDE / Math.max(sourceW, sourceH));
  const width = Math.max(2, Math.round(sourceW * scale));
  const height = Math.max(2, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const centerIndex = centerY * width + centerX;
  let best = null;
  let bestScore = -1;

  const isTransparent = index => pixels[index * 4 + 3] <= ALPHA_THRESHOLD;

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || !isTransparent(start)) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    let containsCenter = false;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      count += 1;
      if (index === centerIndex) containsCenter = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const left = index - 1;
      const right = index + 1;
      const up = index - width;
      const down = index + width;

      if (x > 0 && !visited[left] && isTransparent(left)) {
        visited[left] = 1; queue[tail++] = left;
      }
      if (x + 1 < width && !visited[right] && isTransparent(right)) {
        visited[right] = 1; queue[tail++] = right;
      }
      if (y > 0 && !visited[up] && isTransparent(up)) {
        visited[up] = 1; queue[tail++] = up;
      }
      if (y + 1 < height && !visited[down] && isTransparent(down)) {
        visited[down] = 1; queue[tail++] = down;
      }
    }

    const component = { minX, minY, maxX, maxY, count, containsCenter };
    const score = componentScore(component, width, height);
    if (score > bestScore) {
      best = component;
      bestScore = score;
    }
  }

  if (!best) return null;
  const boxW = best.maxX - best.minX + 1;
  const boxH = best.maxY - best.minY + 1;
  const areaRatio = (boxW * boxH) / total;
  const pixelRatio = best.count / total;
  if (areaRatio < 0.035 || pixelRatio < 0.02) return null;

  // Slightly inset the detected bounds so antialiased frame edges do not enter the shooting area.
  const insetX = Math.min(2, Math.floor(boxW * 0.01));
  const insetY = Math.min(2, Math.floor(boxH * 0.01));
  const x0 = clamp(best.minX + insetX, 0, width - 1);
  const y0 = clamp(best.minY + insetY, 0, height - 1);
  const x1 = clamp(best.maxX - insetX, x0 + 1, width - 1);
  const y1 = clamp(best.maxY - insetY, y0 + 1, height - 1);

  return {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0 + 1) / width,
    h: (y1 - y0 + 1) / height
  };
}

function analyzeCurrentPngWindow() {
  if (frameFormat !== 'png' || !frameImage) {
    frameWindowSource = null;
    frameWindowImage = null;
    applyCameraWindow();
    return;
  }

  if (frameWindowImage === frameImage && frameWindowSource) {
    applyCameraWindow();
    return;
  }

  try {
    frameWindowSource = detectTransparentWindow(frameImage);
    frameWindowImage = frameImage;
    applyCameraWindow();
    if (frameWindowSource) {
      setStatus('PNGの透過領域を自動認識し、撮影範囲を合わせました');
    } else {
      setStatus('大きな透過領域を検出できないため、全面を撮影範囲にします');
    }
  } catch (err) {
    console.warn('PNG transparent-window detection failed', err);
    frameWindowSource = null;
    frameWindowImage = frameImage;
    applyCameraWindow();
  }
}

const updateFramePreviewOrientationBase2 = updateFramePreviewOrientation;
updateFramePreviewOrientation = function updateFramePreviewOrientationWithWindow() {
  updateFramePreviewOrientationBase2();
  analyzeCurrentPngWindow();
};

function currentDigitalZoom() {
  return nativeZoomAvailable ? 1 : Math.max(1, zoomValue);
}

function updatePreviewZoom() {
  const digital = currentDigitalZoom();
  els.video.style.transform = digital > 1.001 ? `scale(${digital})` : 'none';
  els.video.style.transformOrigin = '50% 50%';
  zoomValueLabel.textContent = `${zoomValue.toFixed(1)}×`;
}

function updateZoomUiRange() {
  zoomRange.min = String(nativeZoomRange.min);
  zoomRange.max = String(nativeZoomRange.max);
  zoomRange.step = String(nativeZoomRange.step || 0.1);
  zoomValue = clamp(zoomValue, nativeZoomRange.min, nativeZoomRange.max);
  zoomRange.value = String(zoomValue);
  localStorage.setItem(ZOOM_KEY, String(zoomValue));
  updatePreviewZoom();
}

async function applyZoomNow() {
  const track = stream?.getVideoTracks?.()[0];
  if (nativeZoomAvailable && track) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: zoomValue }] });
    } catch (err) {
      console.debug('Native zoom unavailable; switching to digital zoom.', err);
      nativeZoomAvailable = false;
      nativeZoomRange = { min: 1, max: 3, step: 0.1 };
      zoomValue = clamp(zoomValue, 1, 3);
      updateZoomUiRange();
    }
  }
  updatePreviewZoom();
}

function scheduleZoomApply() {
  clearTimeout(zoomApplyTimer);
  zoomApplyTimer = setTimeout(() => void applyZoomNow(), 25);
}

function setZoom(value) {
  zoomValue = clamp(Number(value) || 1, nativeZoomRange.min, nativeZoomRange.max);
  zoomRange.value = String(zoomValue);
  zoomValueLabel.textContent = `${zoomValue.toFixed(1)}×`;
  localStorage.setItem(ZOOM_KEY, String(zoomValue));
  if (!nativeZoomAvailable) updatePreviewZoom();
  scheduleZoomApply();
}

async function configureCameraZoom() {
  const track = stream?.getVideoTracks?.()[0];
  nativeZoomAvailable = false;
  nativeZoomRange = { min: 1, max: 3, step: 0.1 };

  if (track && typeof track.getCapabilities === 'function') {
    try {
      const caps = track.getCapabilities();
      const zoom = caps?.zoom;
      if (zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.max > zoom.min) {
        nativeZoomAvailable = true;
        nativeZoomRange = {
          min: zoom.min,
          max: zoom.max,
          step: Number.isFinite(zoom.step) && zoom.step > 0 ? zoom.step : 0.1
        };
        const settingsNow = typeof track.getSettings === 'function' ? track.getSettings() : null;
        if (!localStorage.getItem(ZOOM_KEY) && Number.isFinite(settingsNow?.zoom)) zoomValue = settingsNow.zoom;
      }
    } catch (err) {
      console.debug('Camera zoom capabilities unavailable.', err);
    }
  }

  updateZoomUiRange();
  await applyZoomNow();
}

const startCameraBaseZoom = startCamera;
startCamera = async function startCameraWithZoom() {
  await startCameraBaseZoom();
  if (isStreamLive()) await configureCameraZoom();
};

zoomRange.addEventListener('input', event => setZoom(event.target.value));
zoomOutBtn.addEventListener('click', () => setZoom(zoomValue - Math.max(nativeZoomRange.step || 0.1, 0.1)));
zoomInBtn.addEventListener('click', () => setZoom(zoomValue + Math.max(nativeZoomRange.step || 0.1, 0.1)));

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

els.previewWrap.addEventListener('touchstart', event => {
  if (event.touches.length !== 2) return;
  pinchStartDistance = touchDistance(event.touches);
  pinchStartZoom = zoomValue;
}, { passive: true });

els.previewWrap.addEventListener('touchmove', event => {
  if (event.touches.length !== 2 || !pinchStartDistance) return;
  event.preventDefault();
  const ratio = touchDistance(event.touches) / pinchStartDistance;
  setZoom(pinchStartZoom * ratio);
}, { passive: false });

els.previewWrap.addEventListener('touchend', event => {
  if (event.touches.length < 2) pinchStartDistance = 0;
}, { passive: true });

function drawVideoIntoRect(ctx, video, dx, dy, dw, dh, mode = 'cover') {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) throw new Error('video-not-ready');

  const zoom = currentDigitalZoom();
  let cropW = sw / zoom;
  let cropH = sh / zoom;
  let sx = (sw - cropW) / 2;
  let sy = (sh - cropH) / 2;

  const sourceRatio = cropW / cropH;
  const targetRatio = dw / dh;

  if (mode === 'cover') {
    if (sourceRatio > targetRatio) {
      const nextW = cropH * targetRatio;
      sx += (cropW - nextW) / 2;
      cropW = nextW;
    } else {
      const nextH = cropW / targetRatio;
      sy += (cropH - nextH) / 2;
      cropH = nextH;
    }
    ctx.drawImage(video, sx, sy, cropW, cropH, dx, dy, dw, dh);
    return;
  }

  const scale = Math.min(dw / cropW, dh / cropH);
  const outW = cropW * scale;
  const outH = cropH * scale;
  ctx.drawImage(video, sx, sy, cropW, cropH,
    dx + (dw - outW) / 2, dy + (dh - outH) / 2, outW, outH);
}

const drawVideoCoverBaseZoom = drawVideoCover;
drawVideoCover = function drawVideoCoverWithWindowAndZoom(ctx, video, dw, dh) {
  if (frameFormat === 'png' && activeFrameWindow) {
    const b = activeFrameWindow;
    const dx = Math.round(dw * b.x);
    const dy = Math.round(dh * b.y);
    const rw = Math.max(1, Math.round(dw * b.w));
    const rh = Math.max(1, Math.round(dh * b.h));
    drawVideoIntoRect(ctx, video, dx, dy, rw, rh, 'cover');
    return;
  }

  if (!nativeZoomAvailable && zoomValue > 1.001) {
    drawVideoIntoRect(ctx, video, 0, 0, dw, dh, 'cover');
    return;
  }
  drawVideoCoverBaseZoom(ctx, video, dw, dh);
};

const drawVideoContainBaseZoom = drawVideoContain;
drawVideoContain = function drawVideoContainWithZoom(ctx, video, dw, dh) {
  if (!nativeZoomAvailable && zoomValue > 1.001) {
    drawVideoIntoRect(ctx, video, 0, 0, dw, dh, 'contain');
    return;
  }
  drawVideoContainBaseZoom(ctx, video, dw, dh);
};

updateZoomUiRange();
analyzeCurrentPngWindow();
