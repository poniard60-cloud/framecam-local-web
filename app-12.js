'use strict';

// 3:4 frame/transparent-window compatibility layer.
// The active PNG is first rendered into the exact 3:4 / 4:3 finder coordinate
// system, then transparency is detected from that rendered result. This keeps
// the visible overlay, AUTO window and captured JPEG on the same geometry.

const FRAME_ANALYSIS_MAX_SIDE_V6 = 520;
let canonicalFrameCanvasV6 = null;
let canonicalFrameDataUrlV6 = '';
let canonicalFrameImageV6 = null;
let canonicalFrameOrientationV6 = '';
let frameWindowTargetCoordinatesV6 = false;

function canonicalFrameMatchesV6() {
  return Boolean(
    canonicalFrameCanvasV6 &&
    canonicalFrameImageV6 === frameImage &&
    canonicalFrameOrientationV6 === settings.orientation
  );
}

function drawFrameIntoTargetCanvasV6(image) {
  const { w, h } = outputSize();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (!imageNeedsRotation(image)) {
    ctx.drawImage(image, 0, 0, w, h);
    return canvas;
  }

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, -h / 2, -w / 2, h, w);
  ctx.restore();
  return canvas;
}

function analysisFromTargetCanvasV6(source) {
  const scale = Math.min(1, FRAME_ANALYSIS_MAX_SIDE_V6 / Math.max(source.width, source.height));
  const width = Math.max(4, Math.round(source.width * scale));
  const height = Math.max(4, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}

function clearDetectedPseudoWindowV6(canvas, bounds) {
  if (!bounds) return;
  const ctx = canvas.getContext('2d');
  const x = Math.round(bounds.x * canvas.width);
  const y = Math.round(bounds.y * canvas.height);
  const w = Math.round(bounds.w * canvas.width);
  const h = Math.round(bounds.h * canvas.height);
  const insetX = Math.max(1, Math.round(w * 0.002));
  const insetY = Math.max(1, Math.round(h * 0.002));
  ctx.clearRect(
    x + insetX,
    y + insetY,
    Math.max(1, w - insetX * 2),
    Math.max(1, h - insetY * 2)
  );
}

function forcePngOverlayAboveCameraV6() {
  if (frameFormat !== 'png' || !frameImage) return;

  if (canonicalFrameCanvasV6) {
    if (!canonicalFrameDataUrlV6) {
      canonicalFrameDataUrlV6 = canonicalFrameCanvasV6.toDataURL('image/png');
    }
    if (els.frameOverlay.getAttribute('src') !== canonicalFrameDataUrlV6) {
      els.frameOverlay.setAttribute('src', canonicalFrameDataUrlV6);
    }
  }

  els.frameOverlay.classList.remove('frame-auto-rotate');
  els.frameOverlay.hidden = false;
  els.frameOverlay.style.inset = '0';
  els.frameOverlay.style.left = '0';
  els.frameOverlay.style.top = '0';
  els.frameOverlay.style.width = '100%';
  els.frameOverlay.style.height = '100%';
  els.frameOverlay.style.transform = 'none';
  els.frameOverlay.style.transformOrigin = '50% 50%';
  els.frameOverlay.style.objectFit = 'fill';
  els.frameOverlay.style.zIndex = '2';
  els.frameOverlay.style.pointerEvents = 'none';
}

function clearCanonicalFrameV6() {
  canonicalFrameCanvasV6 = null;
  canonicalFrameDataUrlV6 = '';
  canonicalFrameImageV6 = null;
  canonicalFrameOrientationV6 = '';
  frameWindowTargetCoordinatesV6 = false;
}

const applyCameraWindowBaseV6 = applyCameraWindow;
applyCameraWindow = function applyCameraWindowThreeByFourV6() {
  if (!frameWindowTargetCoordinatesV6) {
    applyCameraWindowBaseV6();
    return;
  }

  activeFrameWindow = frameFormat === 'png' && frameWindowSource
    ? { ...frameWindowSource }
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
};

analyzeCurrentPngWindow = function analyzeCurrentPngWindowThreeByFourV6() {
  if (frameFormat !== 'png' || !frameImage) {
    frameWindowSource = null;
    frameWindowImage = null;
    activeFrameWindow = null;
    clearCanonicalFrameV6();
    applyCameraWindow();
    return;
  }

  try {
    const targetCanvas = drawFrameIntoTargetCanvasV6(frameImage);
    const analysis = analysisFromTargetCanvasV6(targetCanvas);

    let alphaBounds = null;
    let pseudo = null;
    if (typeof detectRealAlphaWindowV2 === 'function') {
      alphaBounds = detectRealAlphaWindowV2(analysis);
    }
    if (!alphaBounds && typeof detectPseudoTransparentWindowV2 === 'function') {
      pseudo = detectPseudoTransparentWindowV2(analysis);
    }

    const bounds = alphaBounds || pseudo?.bounds || null;
    if (pseudo?.bounds) clearDetectedPseudoWindowV6(targetCanvas, pseudo.bounds);

    canonicalFrameCanvasV6 = targetCanvas;
    canonicalFrameDataUrlV6 = '';
    canonicalFrameImageV6 = frameImage;
    canonicalFrameOrientationV6 = settings.orientation;
    frameWindowTargetCoordinatesV6 = true;
    frameWindowSource = bounds;
    frameWindowImage = frameImage;

    if (typeof processedPngOverlayCanvasV2 !== 'undefined') processedPngOverlayCanvasV2 = null;
    if (typeof processedPngOverlayDataUrlV2 !== 'undefined') processedPngOverlayDataUrlV2 = null;

    forcePngOverlayAboveCameraV6();
    applyCameraWindow();

    if (bounds) {
      els.previewWrap.dataset.windowMethod = alphaBounds ? 'alpha-3x4' : (pseudo?.checkerLike ? 'checker-3x4' : 'color-3x4');
      setStatus(alphaBounds
        ? '3:4フレームの透過領域を認識し、撮影範囲を合わせました'
        : '3:4フレームの撮影窓を認識して透明化しました');
    } else {
      delete els.previewWrap.dataset.windowMethod;
      setStatus('フレームを3:4で表示しました。透過窓はカメラ全面表示で確認できます');
    }
  } catch (err) {
    console.warn('3:4 frame transparency analysis failed', err);
    frameWindowSource = null;
    frameWindowImage = frameImage;
    frameWindowTargetCoordinatesV6 = true;
    activeFrameWindow = null;

    try {
      canonicalFrameCanvasV6 = drawFrameIntoTargetCanvasV6(frameImage);
      canonicalFrameDataUrlV6 = '';
      canonicalFrameImageV6 = frameImage;
      canonicalFrameOrientationV6 = settings.orientation;
      forcePngOverlayAboveCameraV6();
    } catch (_) {}
    applyCameraWindow();
    setStatus('透過判定を再調整しました。フレームはカメラ前面に表示します', true);
  }
};

const drawAdaptiveOverlayBaseV6 = drawAdaptiveOverlay;
drawAdaptiveOverlay = function drawAdaptiveOverlayThreeByFourV6(ctx, image, dw, dh) {
  if (frameFormat === 'png' && image === frameImage) {
    if (!canonicalFrameMatchesV6()) analyzeCurrentPngWindow();
    if (canonicalFrameCanvasV6) {
      ctx.drawImage(canonicalFrameCanvasV6, 0, 0, dw, dh);
      return;
    }
  }
  drawAdaptiveOverlayBaseV6(ctx, image, dw, dh);
};

const updateFramePreviewOrientationBaseV6 = updateFramePreviewOrientation;
updateFramePreviewOrientation = function updateFramePreviewOrientationThreeByFourV6() {
  updateFramePreviewOrientationBaseV6();
  if (frameFormat === 'png' && frameImage) forcePngOverlayAboveCameraV6();
};

async function restoreActiveFrameAfterUpgradeV6() {
  if (frameImage) {
    updateFramePreviewOrientation();
    return;
  }
  try {
    if (typeof frameLibraryActiveId === 'function' && typeof activateFrameLibraryItem === 'function') {
      const id = frameLibraryActiveId();
      if (id) await activateFrameLibraryItem(id);
    }
  } catch (err) {
    console.debug('Active frame restore retry skipped.', err);
  }
  if (frameImage) updateFramePreviewOrientation();
}

els.frameOverlay.addEventListener('load', () => {
  if (frameFormat === 'png' && frameImage) forcePngOverlayAboveCameraV6();
});

setTimeout(() => { void restoreActiveFrameAfterUpgradeV6(); }, 250);
setTimeout(() => { void restoreActiveFrameAfterUpgradeV6(); }, 900);

updateFramePreviewOrientation();
