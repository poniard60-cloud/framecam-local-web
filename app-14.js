'use strict';

// Preserve white artwork while removing checkerboard pseudo-transparency.
// White is never treated as transparent globally. Only pixels inside the
// detected checker window are candidates, and foreground artwork plus its
// nearby white outlines/details are protected before the checker is cleared.

const ARTWORK_CHROMA_MIN_V8 = 22;
const ARTWORK_DARK_MEAN_MAX_V8 = 224;
const CHECKER_LIGHT_MEAN_MIN_V8 = 232;
const CHECKER_NEUTRAL_CHROMA_MAX_V8 = 22;

function protectArtworkDistanceV8(data, width, height) {
  const total = width * height;
  const INF = 65535;
  const dist = new Uint16Array(total);
  dist.fill(INF);

  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    if (data[p + 3] < 32) continue;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const mean = (r + g + b) / 3;
    const chroma = max - min;

    if (chroma >= ARTWORK_CHROMA_MIN_V8 || mean <= ARTWORK_DARK_MEAN_MAX_V8) {
      dist[i] = 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + 1);
      if (x + 1 < width && y > 0) d = Math.min(d, dist[i - width + 1] + 1);
      dist[i] = d;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, dist[i + width] + 1);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, dist[i + width + 1] + 1);
      if (x > 0 && y + 1 < height) d = Math.min(d, dist[i + width - 1] + 1);
      dist[i] = d;
    }
  }
  return dist;
}

clearCheckerInsideWindowV7 = function clearCheckerInsideWindowPreserveWhiteV8(canvas, bounds) {
  if (!bounds) return;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x = clamp(Math.floor(bounds.x * canvas.width), 0, canvas.width - 1);
  const y = clamp(Math.floor(bounds.y * canvas.height), 0, canvas.height - 1);
  const w = clamp(Math.ceil(bounds.w * canvas.width), 1, canvas.width - x);
  const h = clamp(Math.ceil(bounds.h * canvas.height), 1, canvas.height - y);
  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;
  const distance = protectArtworkDistanceV8(data, w, h);

  const protectRadius = Math.max(12, Math.min(30, Math.round(Math.min(w, h) * 0.018)));

  for (let i = 0; i < w * h; i += 1) {
    const p = i * 4;
    if (data[p + 3] < 32) continue;

    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const mean = (r + g + b) / 3;
    const chroma = max - min;

    const checkerBackground = chroma <= CHECKER_NEUTRAL_CHROMA_MAX_V8 && mean >= CHECKER_LIGHT_MEAN_MIN_V8;
    if (checkerBackground && distance[i] > protectRadius) {
      data[p + 3] = 0;
    }
  }

  ctx.putImageData(imageData, x, y);
};

function rebuildFrameAfterWhiteFixV8() {
  if (frameFormat !== 'png' || !frameImage) return;
  try {
    canonicalFrameCanvasV7 = null;
    canonicalFrameDataUrlV7 = '';
    canonicalFrameImageV7 = null;
    canonicalFrameOrientationV7 = '';
  } catch (_) {}
  analyzeCurrentPngWindow();
}

setTimeout(rebuildFrameAfterWhiteFixV8, 80);
setTimeout(rebuildFrameAfterWhiteFixV8, 450);
