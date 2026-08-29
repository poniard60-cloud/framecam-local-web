'use strict';

// Frame underlay model for 3:4 / 4:3 shooting.
// Camera is intentionally a little larger than the detected window and the
// processed frame is always painted above it. For checkerboard pseudo-alpha,
// only light neutral checker pixels are removed so foreground artwork survives.

const FRAME_UNDERLAY_MARGIN_V7 = 0.045;
const CHECKER_ANALYSIS_MAX_SIDE_V7 = 640;
const CHECKER_MIN_BOX_RATIO_V7 = 0.08;
const CHECKER_MIN_PIXEL_RATIO_V7 = 0.045;

let canonicalFrameCanvasV7 = null;
let canonicalFrameImageV7 = null;
let canonicalFrameOrientationV7 = '';
let canonicalFrameDataUrlV7 = '';
let trueWindowBoundsV7 = null;
let finderWindowBoundsV7 = null;
let frameWindowCoordinatesAreTargetV7 = false;

function frameTargetCanvasV7(image) {
  const { w, h } = outputSize();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (!imageNeedsRotation(image)) {
    ctx.drawImage(image, 0, 0, w, h);
  } else {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, -h / 2, -w / 2, h, w);
    ctx.restore();
  }
  return canvas;
}

function makeAnalysisV7(source) {
  const scale = Math.min(1, CHECKER_ANALYSIS_MAX_SIDE_V7 / Math.max(source.width, source.height));
  const width = Math.max(4, Math.round(source.width * scale));
  const height = Math.max(4, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}

function checkerPixelV7(pixels, pixelIndex, upper = 253.4) {
  const i = pixelIndex * 4;
  const a = pixels[i + 3];
  if (a < 235) return false;
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mean = (r + g + b) / 3;
  return (max - min) <= 18 && mean >= 236 && mean <= upper;
}

function findCheckerWindowV7(analysis) {
  const { width, height, pixels } = analysis;
  const total = width * height;
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);

  for (let i = 0; i < total; i += 1) {
    if (checkerPixelV7(pixels, i)) mask[i] = 1;
  }

  let best = null;
  let bestScore = -Infinity;
  const centerX = width / 2;
  const centerY = height / 2;

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    let containsCenter = false;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (Math.abs(x - centerX) <= 1 && Math.abs(y - centerY) <= 1) containsCenter = true;

      const left = index - 1;
      const right = index + 1;
      const up = index - width;
      const down = index + width;
      if (x > 0 && mask[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x + 1 < width && mask[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0 && mask[up] && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      if (y + 1 < height && mask[down] && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const boxRatio = (boxW * boxH) / total;
    const pixelRatio = count / total;
    const axisW = boxW / width;
    const axisH = boxH / height;
    if (boxRatio < CHECKER_MIN_BOX_RATIO_V7 || pixelRatio < CHECKER_MIN_PIXEL_RATIO_V7) continue;
    if (axisW < 0.24 || axisH < 0.24) continue;

    const bx = (minX + maxX) / 2;
    const by = (minY + maxY) / 2;
    const distance = Math.min(1, Math.hypot((bx - centerX) / width, (by - centerY) / height) * 2.2);
    const centerWeight = containsCenter ? 6 : (2.2 - distance);
    const edgeTouches = Number(minX === 0) + Number(minY === 0) + Number(maxX === width - 1) + Number(maxY === height - 1);
    const edgePenalty = edgeTouches >= 3 ? 0.25 : edgeTouches === 2 ? 0.55 : 1;
    const score = count * centerWeight * edgePenalty;

    if (score > bestScore) {
      bestScore = score;
      best = { minX, minY, maxX, maxY, count };
    }
  }

  if (!best) return null;
  const padX = Math.max(1, Math.round(width * 0.003));
  const padY = Math.max(1, Math.round(height * 0.003));
  const x0 = clamp(best.minX - padX, 0, width - 1);
  const y0 = clamp(best.minY - padY, 0, height - 1);
  const x1 = clamp(best.maxX + padX, x0, width - 1);
  const y1 = clamp(best.maxY + padY, y0, height - 1);
  return {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0 + 1) / width,
    h: (y1 - y0 + 1) / height
  };
}

function clearCheckerInsideWindowV7(canvas, bounds) {
  if (!bounds) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x = clamp(Math.floor(bounds.x * canvas.width), 0, canvas.width - 1);
  const y = clamp(Math.floor(bounds.y * canvas.height), 0, canvas.height - 1);
  const w = clamp(Math.ceil(bounds.w * canvas.width), 1, canvas.width - x);
  const h = clamp(Math.ceil(bounds.h * canvas.height), 1, canvas.height - y);
  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;

  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3];
    if (a < 235) continue;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const mean = (r + g + b) / 3;

    if ((max - min) <= 20 && mean >= 235 && mean <= 254.4) {
      data[p + 3] = 0;
    }
  }

  ctx.putImageData(imageData, x, y);
}

function expandFinderWindowV7(bounds) {
  if (!bounds) return null;
  const growW = bounds.w * FRAME_UNDERLAY_MARGIN_V7;
  const growH = bounds.h * FRAME_UNDERLAY_MARGIN_V7;
  const x0 = Math.max(0, bounds.x - growW);
  const y0 = Math.max(0, bounds.y - growH);
  const x1 = Math.min(1, bounds.x + bounds.w + growW);
  const y1 = Math.min(1, bounds.y + bounds.h + growH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function showCanonicalOverlayV7() {
  if (frameFormat !== 'png' || !frameImage || !canonicalFrameCanvasV7) return;
  if (!canonicalFrameDataUrlV7) canonicalFrameDataUrlV7 = canonicalFrameCanvasV7.toDataURL('image/png');
  if (els.frameOverlay.getAttribute('src') !== canonicalFrameDataUrlV7) {
    els.frameOverlay.setAttribute('src', canonicalFrameDataUrlV7);
  }
  els.frameOverlay.classList.remove('frame-auto-rotate');
  els.frameOverlay.hidden = false;
  els.frameOverlay.style.position = 'absolute';
  els.frameOverlay.style.inset = '0';
  els.frameOverlay.style.left = '0';
  els.frameOverlay.style.top = '0';
  els.frameOverlay.style.width = '100%';
  els.frameOverlay.style.height = '100%';
  els.frameOverlay.style.objectFit = 'fill';
  els.frameOverlay.style.transform = 'none';
  els.frameOverlay.style.zIndex = '2';
  els.frameOverlay.style.pointerEvents = 'none';
}

function resetFrameGeometryV7() {
  canonicalFrameCanvasV7 = null;
  canonicalFrameImageV7 = null;
  canonicalFrameOrientationV7 = '';
  canonicalFrameDataUrlV7 = '';
  trueWindowBoundsV7 = null;
  finderWindowBoundsV7 = null;
  frameWindowCoordinatesAreTargetV7 = false;
}

const applyCameraWindowBaseV7 = applyCameraWindow;
applyCameraWindow = function applyCameraWindowUnderFrameV7() {
  if (!frameWindowCoordinatesAreTargetV7) {
    applyCameraWindowBaseV7();
    return;
  }

  activeFrameWindow = frameFormat === 'png' && finderWindowBoundsV7
    ? { ...finderWindowBoundsV7 }
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
  cameraWindowLayer.style.zIndex = '1';
  els.previewWrap.classList.add('frame-window-detected');
};

analyzeCurrentPngWindow = function analyzeCurrentPngWindowUnderFrameV7() {
  if (frameFormat !== 'png' || !frameImage) {
    frameWindowSource = null;
    frameWindowImage = null;
    activeFrameWindow = null;
    resetFrameGeometryV7();
    applyCameraWindow();
    return;
  }

  try {
    const target = frameTargetCanvasV7(frameImage);
    const analysis = makeAnalysisV7(target);

    let alphaBounds = null;
    if (typeof detectRealAlphaWindowV2 === 'function') {
      alphaBounds = detectRealAlphaWindowV2(analysis);
    }

    let pseudoBounds = null;
    if (!alphaBounds) pseudoBounds = findCheckerWindowV7(analysis);

    const visibleWindow = alphaBounds || pseudoBounds || null;
    if (pseudoBounds) clearCheckerInsideWindowV7(target, pseudoBounds);

    canonicalFrameCanvasV7 = target;
    canonicalFrameImageV7 = frameImage;
    canonicalFrameOrientationV7 = settings.orientation;
    canonicalFrameDataUrlV7 = '';
    trueWindowBoundsV7 = visibleWindow;
    finderWindowBoundsV7 = visibleWindow ? expandFinderWindowV7(visibleWindow) : null;
    frameWindowCoordinatesAreTargetV7 = true;

    if (typeof canonicalFrameCanvasV6 !== 'undefined') canonicalFrameCanvasV6 = target;
    if (typeof canonicalFrameImageV6 !== 'undefined') canonicalFrameImageV6 = frameImage;
    if (typeof canonicalFrameOrientationV6 !== 'undefined') canonicalFrameOrientationV6 = settings.orientation;
    if (typeof canonicalFrameDataUrlV6 !== 'undefined') canonicalFrameDataUrlV6 = '';
    if (typeof frameWindowTargetCoordinatesV6 !== 'undefined') frameWindowTargetCoordinatesV6 = false;

    frameWindowSource = visibleWindow;
    frameWindowImage = frameImage;
    showCanonicalOverlayV7();
    applyCameraWindow();

    if (visibleWindow) {
      els.previewWrap.dataset.windowMethod = alphaBounds ? 'alpha-underlay' : 'checker-underlay';
      setStatus(alphaBounds
        ? '透過窓より少し大きくカメラを敷き、フレームを前面表示しました'
        : '市松部分だけを透明化し、キャラクターを残してカメラを下に敷きました');
    } else {
      delete els.previewWrap.dataset.windowMethod;
      setStatus('フレームは前面表示しています。透過窓が見つからないためカメラ全面を使用します');
    }
  } catch (err) {
    console.warn('Frame underlay analysis failed', err);
    frameWindowSource = null;
    frameWindowImage = frameImage;
    trueWindowBoundsV7 = null;
    finderWindowBoundsV7 = null;
    frameWindowCoordinatesAreTargetV7 = true;
    try {
      canonicalFrameCanvasV7 = frameTargetCanvasV7(frameImage);
      canonicalFrameImageV7 = frameImage;
      canonicalFrameOrientationV7 = settings.orientation;
      canonicalFrameDataUrlV7 = '';
      showCanonicalOverlayV7();
    } catch (_) {}
    applyCameraWindow();
    setStatus('フレームを前面表示しました。透過判定のみ全面表示へフォールバックしています', true);
  }
};

const drawAdaptiveOverlayBaseV7 = drawAdaptiveOverlay;
drawAdaptiveOverlay = function drawAdaptiveOverlayUnderFrameV7(ctx, image, dw, dh) {
  if (frameFormat === 'png' && image === frameImage) {
    const matches = canonicalFrameCanvasV7 &&
      canonicalFrameImageV7 === frameImage &&
      canonicalFrameOrientationV7 === settings.orientation;
    if (!matches) analyzeCurrentPngWindow();
    if (canonicalFrameCanvasV7) {
      ctx.drawImage(canonicalFrameCanvasV7, 0, 0, dw, dh);
      return;
    }
  }
  drawAdaptiveOverlayBaseV7(ctx, image, dw, dh);
};

const updateFramePreviewOrientationBaseV7 = updateFramePreviewOrientation;
updateFramePreviewOrientation = function updateFramePreviewOrientationUnderFrameV7() {
  updateFramePreviewOrientationBaseV7();
  if (frameFormat === 'png' && frameImage) {
    const matches = canonicalFrameCanvasV7 &&
      canonicalFrameImageV7 === frameImage &&
      canonicalFrameOrientationV7 === settings.orientation;
    if (!matches) analyzeCurrentPngWindow();
    showCanonicalOverlayV7();
  }
};

setTimeout(() => {
  if (frameFormat === 'png' && frameImage) analyzeCurrentPngWindow();
}, 300);
setTimeout(() => {
  if (frameFormat === 'png' && frameImage) analyzeCurrentPngWindow();
}, 1000);
