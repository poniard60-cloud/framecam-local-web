'use strict';

// Robust transparent-window detection for custom PNG frames.
// Rejects tiny transparent marks and falls back to detecting a large central
// solid/checkerboard pseudo-transparent area. All processing stays on-device.

const WINDOW_MASK_MAX_SIDE_V2 = 420;
const WINDOW_ALPHA_THRESHOLDS_V2 = [32, 96, 160, 224];
const WINDOW_MIN_BOX_RATIO_V2 = 0.08;
const WINDOW_MIN_PIXEL_RATIO_V2 = 0.055;
const WINDOW_MIN_AXIS_RATIO_V2 = 0.20;

let processedPngOverlayCanvasV2 = null;
let processedPngOverlayDataUrlV2 = null;
let frameWindowMethodV2 = null;

function windowCandidateScoreV2(component, width, height) {
  const boxW = component.maxX - component.minX + 1;
  const boxH = component.maxY - component.minY + 1;
  const boxArea = boxW * boxH;
  const total = width * height;
  const boxRatio = boxArea / total;
  const pixelRatio = component.count / total;
  const fillRatio = component.count / boxArea;
  const centerX = (component.minX + component.maxX) / 2;
  const centerY = (component.minY + component.maxY) / 2;
  const dx = (centerX - width / 2) / width;
  const dy = (centerY - height / 2) / height;
  const centerCloseness = 1 - Math.min(1, Math.hypot(dx, dy) * 2.2);
  const edgeTouches = Number(component.minX === 0) + Number(component.minY === 0) +
    Number(component.maxX === width - 1) + Number(component.maxY === height - 1);
  const edgePenalty = edgeTouches >= 3 ? 0.30 : edgeTouches === 2 ? 0.65 : 1;

  return (boxRatio * 7 + pixelRatio * 8 + fillRatio * 2.5 + centerCloseness * 3 +
    (component.containsCenter ? 3.5 : 0)) * edgePenalty;
}

function isValidWindowCandidateV2(component, width, height) {
  const boxW = component.maxX - component.minX + 1;
  const boxH = component.maxY - component.minY + 1;
  const boxArea = boxW * boxH;
  const total = width * height;
  const boxRatio = boxArea / total;
  const pixelRatio = component.count / total;
  const fillRatio = component.count / boxArea;
  const axisW = boxW / width;
  const axisH = boxH / height;

  if (boxRatio < WINDOW_MIN_BOX_RATIO_V2) return false;
  if (pixelRatio < WINDOW_MIN_PIXEL_RATIO_V2) return false;
  if (axisW < WINDOW_MIN_AXIS_RATIO_V2 || axisH < WINDOW_MIN_AXIS_RATIO_V2) return false;
  if (fillRatio < 0.38) return false;

  // A nearly full-canvas component is usually the outside of an open frame,
  // not a deliberate shooting window.
  const edgeTouches = Number(component.minX === 0) + Number(component.minY === 0) +
    Number(component.maxX === width - 1) + Number(component.maxY === height - 1);
  if (boxRatio > 0.94 && edgeTouches >= 3) return false;
  return true;
}

function findBestMaskComponentV2(mask, width, height) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const centerIndex = centerY * width + centerX;
  let best = null;
  let bestScore = -Infinity;

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || !mask[start]) continue;
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
      if (index === centerIndex) containsCenter = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const left = index - 1;
      const right = index + 1;
      const up = index - width;
      const down = index + width;
      if (x > 0 && !visited[left] && mask[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x + 1 < width && !visited[right] && mask[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0 && !visited[up] && mask[up]) { visited[up] = 1; queue[tail++] = up; }
      if (y + 1 < height && !visited[down] && mask[down]) { visited[down] = 1; queue[tail++] = down; }
    }

    const component = { minX, minY, maxX, maxY, count, containsCenter };
    if (!isValidWindowCandidateV2(component, width, height)) continue;
    const score = windowCandidateScoreV2(component, width, height);
    if (score > bestScore) {
      best = component;
      bestScore = score;
    }
  }
  return best;
}

function componentToNormalizedBoundsV2(component, width, height) {
  if (!component) return null;
  const boxW = component.maxX - component.minX + 1;
  const boxH = component.maxY - component.minY + 1;
  // Small inward inset prevents anti-aliased frame edges from being clipped.
  const insetX = Math.max(0, Math.min(2, Math.floor(boxW * 0.006)));
  const insetY = Math.max(0, Math.min(2, Math.floor(boxH * 0.006)));
  const x0 = clamp(component.minX + insetX, 0, width - 1);
  const y0 = clamp(component.minY + insetY, 0, height - 1);
  const x1 = clamp(component.maxX - insetX, x0, width - 1);
  const y1 = clamp(component.maxY - insetY, y0, height - 1);
  return {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0 + 1) / width,
    h: (y1 - y0 + 1) / height
  };
}

function makeAnalysisPixelsV2(image) {
  const sourceW = image.naturalWidth;
  const sourceH = image.naturalHeight;
  if (!sourceW || !sourceH) return null;
  const scale = Math.min(1, WINDOW_MASK_MAX_SIDE_V2 / Math.max(sourceW, sourceH));
  const width = Math.max(4, Math.round(sourceW * scale));
  const height = Math.max(4, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}

function detectRealAlphaWindowV2(analysis) {
  const { width, height, pixels } = analysis;
  const total = width * height;
  let best = null;
  let bestScore = -Infinity;

  for (const threshold of WINDOW_ALPHA_THRESHOLDS_V2) {
    const mask = new Uint8Array(total);
    let transparentCount = 0;
    for (let i = 0; i < total; i += 1) {
      if (pixels[i * 4 + 3] <= threshold) {
        mask[i] = 1;
        transparentCount += 1;
      }
    }
    if (transparentCount / total < WINDOW_MIN_PIXEL_RATIO_V2) continue;
    const candidate = findBestMaskComponentV2(mask, width, height);
    if (!candidate) continue;
    const score = windowCandidateScoreV2(candidate, width, height) - threshold * 0.001;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best ? componentToNormalizedBoundsV2(best, width, height) : null;
}

function colorDistanceSqV2(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function quantKeyV2(r, g, b) {
  return `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
}

function keyToColorV2(key) {
  const parts = key.split(',').map(Number);
  return [parts[0] * 24, parts[1] * 24, parts[2] * 24];
}

function detectPseudoTransparentWindowV2(analysis) {
  const { width, height, pixels } = analysis;
  const x0 = Math.floor(width * 0.20);
  const x1 = Math.ceil(width * 0.80);
  const y0 = Math.floor(height * 0.20);
  const y1 = Math.ceil(height * 0.80);
  const counts = new Map();
  let samples = 0;

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 245) continue;
      const key = quantKeyV2(pixels[i], pixels[i + 1], pixels[i + 2]);
      counts.set(key, (counts.get(key) || 0) + 1);
      samples += 1;
    }
  }
  if (samples < 20) return null;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const top1Ratio = ranked[0][1] / samples;
  const top2Ratio = ranked.length > 1 ? (ranked[0][1] + ranked[1][1]) / samples : top1Ratio;
  const c1 = keyToColorV2(ranked[0][0]);
  const c2 = ranked.length > 1 ? keyToColorV2(ranked[1][0]) : c1;
  const neutral1 = Math.max(...c1) - Math.min(...c1) <= 42;
  const neutral2 = Math.max(...c2) - Math.min(...c2) <= 42;

  // Strong central solid color, or the common two-neutral-color checkerboard.
  const solidLike = top1Ratio >= 0.52;
  const checkerLike = top2Ratio >= 0.66 && neutral1 && neutral2 &&
    colorDistanceSqV2(...c1, ...c2) >= 20 * 20;
  if (!solidLike && !checkerLike) return null;

  const colors = checkerLike ? [c1, c2] : [c1];
  const maxDistanceSq = checkerLike ? 52 * 52 : 42 * 42;
  const total = width * height;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    if (pixels[p + 3] < 235) continue;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    if (colors.some(c => colorDistanceSqV2(r, g, b, c[0], c[1], c[2]) <= maxDistanceSq)) {
      mask[i] = 1;
    }
  }

  const candidate = findBestMaskComponentV2(mask, width, height);
  if (!candidate) return null;
  const bounds = componentToNormalizedBoundsV2(candidate, width, height);
  return bounds ? { bounds, checkerLike } : null;
}

function makePseudoTransparentOverlayV2(image, bounds) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  const x = Math.round(bounds.x * canvas.width);
  const y = Math.round(bounds.y * canvas.height);
  const w = Math.round(bounds.w * canvas.width);
  const h = Math.round(bounds.h * canvas.height);
  const insetX = Math.max(1, Math.round(w * 0.003));
  const insetY = Math.max(1, Math.round(h * 0.003));
  ctx.clearRect(x + insetX, y + insetY, Math.max(1, w - insetX * 2), Math.max(1, h - insetY * 2));
  return canvas;
}

function restoreOriginalFramePreviewV2() {
  processedPngOverlayCanvasV2 = null;
  processedPngOverlayDataUrlV2 = null;
  if (frameObjectUrl && frameFormat === 'png') {
    els.frameOverlay.src = frameObjectUrl;
  }
}

function applyPseudoOverlayPreviewV2(canvas) {
  processedPngOverlayCanvasV2 = canvas;
  processedPngOverlayDataUrlV2 = canvas.toDataURL('image/png');
  els.frameOverlay.src = processedPngOverlayDataUrlV2;
  els.frameOverlay.hidden = false;
}

// Replace the old detector with a stricter detector so tiny transparent icons
// cannot become the shooting window.
detectTransparentWindow = function detectTransparentWindowRobustV2(image) {
  const analysis = makeAnalysisPixelsV2(image);
  if (!analysis) return null;
  return detectRealAlphaWindowV2(analysis);
};

analyzeCurrentPngWindow = function analyzeCurrentPngWindowRobustV2() {
  if (frameFormat !== 'png' || !frameImage) {
    frameWindowSource = null;
    frameWindowImage = null;
    frameWindowMethodV2 = null;
    processedPngOverlayCanvasV2 = null;
    processedPngOverlayDataUrlV2 = null;
    applyCameraWindow();
    return;
  }

  try {
    const analysis = makeAnalysisPixelsV2(frameImage);
    if (!analysis) throw new Error('frame-analysis-unavailable');

    const alphaBounds = detectRealAlphaWindowV2(analysis);
    if (alphaBounds) {
      frameWindowSource = alphaBounds;
      frameWindowImage = frameImage;
      frameWindowMethodV2 = 'alpha';
      restoreOriginalFramePreviewV2();
      applyCameraWindow();
      els.previewWrap.dataset.windowMethod = 'alpha';
      setStatus('PNGの大きな透過領域を認識し、撮影範囲を表示しました');
      return;
    }

    const pseudo = detectPseudoTransparentWindowV2(analysis);
    if (pseudo?.bounds) {
      frameWindowSource = pseudo.bounds;
      frameWindowImage = frameImage;
      frameWindowMethodV2 = pseudo.checkerLike ? 'checker' : 'color';
      applyPseudoOverlayPreviewV2(makePseudoTransparentOverlayV2(frameImage, pseudo.bounds));
      applyCameraWindow();
      els.previewWrap.dataset.windowMethod = frameWindowMethodV2;
      setStatus(pseudo.checkerLike
        ? '市松模様の疑似透過領域を撮影窓として透明化しました'
        : '中央の透過色領域を撮影窓として透明化しました');
      return;
    }

    frameWindowSource = null;
    frameWindowImage = frameImage;
    frameWindowMethodV2 = null;
    restoreOriginalFramePreviewV2();
    applyCameraWindow();
    delete els.previewWrap.dataset.windowMethod;
    setStatus('撮影窓として十分に大きい透過領域を検出できないため、カメラ全体を表示します', true);
  } catch (err) {
    console.warn('Robust PNG window detection failed', err);
    frameWindowSource = null;
    frameWindowImage = frameImage;
    frameWindowMethodV2 = null;
    restoreOriginalFramePreviewV2();
    applyCameraWindow();
    delete els.previewWrap.dataset.windowMethod;
    setStatus('透過領域の判定に失敗したため、カメラ全体を表示します', true);
  }
};

// Ensure capture uses the processed overlay when a checkerboard/solid pseudo
// transparency area had to be converted into a real transparent window.
const drawAdaptiveOverlayBaseV2 = drawAdaptiveOverlay;
drawAdaptiveOverlay = function drawAdaptiveOverlayRobustV2(ctx, image, dw, dh) {
  if (frameFormat === 'png' && processedPngOverlayCanvasV2 && image === frameImage) {
    if (!imageNeedsRotation(frameImage)) {
      ctx.drawImage(processedPngOverlayCanvasV2, 0, 0, dw, dh);
      return;
    }
    ctx.save();
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(processedPngOverlayCanvasV2, -dh / 2, -dw / 2, dh, dw);
    ctx.restore();
    return;
  }
  drawAdaptiveOverlayBaseV2(ctx, image, dw, dh);
};

// Re-run after this script loads so a bad cached detection from app-7 is
// immediately replaced, and subsequent orientation changes use the new logic.
frameWindowSource = null;
frameWindowImage = null;
analyzeCurrentPngWindow();
