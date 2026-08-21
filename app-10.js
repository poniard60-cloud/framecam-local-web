'use strict';

// Enlarge the visible shooting window inside custom PNG frames.
// The whole PNG overlay is scaled slightly around the canvas center so the
// transparent aperture becomes larger. Preview and captured JPEG use the same
// geometry. All processing remains on-device.

const FRAME_SHOOTING_AREA_SCALE = 1.10;

function scaleWindowBoundsForLargerShootingArea(bounds) {
  if (!bounds) return null;

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const scaledW = bounds.w * FRAME_SHOOTING_AREA_SCALE;
  const scaledH = bounds.h * FRAME_SHOOTING_AREA_SCALE;

  let x0 = cx - scaledW / 2;
  let y0 = cy - scaledH / 2;
  let x1 = cx + scaledW / 2;
  let y1 = cy + scaledH / 2;

  x0 = clamp(x0, 0, 1);
  y0 = clamp(y0, 0, 1);
  x1 = clamp(x1, x0, 1);
  y1 = clamp(y1, y0, 1);

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function applyLargeShootingAreaPreviewStyle() {
  const useLargeWindow = frameFormat === 'png' && Boolean(frameImage);
  els.frameOverlay.style.scale = useLargeWindow ? String(FRAME_SHOOTING_AREA_SCALE) : '1';
  els.frameOverlay.style.transformOrigin = '50% 50%';
  els.previewWrap.classList.toggle('large-shooting-area', useLargeWindow);
}

applyCameraWindow = function applyCameraWindowLargerV3() {
  const transformed = frameFormat === 'png' && frameWindowSource
    ? transformedFrameWindow(frameWindowSource)
    : null;

  activeFrameWindow = transformed
    ? scaleWindowBoundsForLargerShootingArea(transformed)
    : null;

  if (!activeFrameWindow) {
    cameraWindowLayer.style.left = '0%';
    cameraWindowLayer.style.top = '0%';
    cameraWindowLayer.style.width = '100%';
    cameraWindowLayer.style.height = '100%';
    els.previewWrap.classList.remove('frame-window-detected');
    applyLargeShootingAreaPreviewStyle();
    return;
  }

  const b = activeFrameWindow;
  cameraWindowLayer.style.left = `${(b.x * 100).toFixed(3)}%`;
  cameraWindowLayer.style.top = `${(b.y * 100).toFixed(3)}%`;
  cameraWindowLayer.style.width = `${(b.w * 100).toFixed(3)}%`;
  cameraWindowLayer.style.height = `${(b.h * 100).toFixed(3)}%`;
  els.previewWrap.classList.add('frame-window-detected');
  applyLargeShootingAreaPreviewStyle();
};

const drawAdaptiveOverlayBaseLargeV3 = drawAdaptiveOverlay;
drawAdaptiveOverlay = function drawAdaptiveOverlayLargerV3(ctx, image, dw, dh) {
  if (frameFormat === 'png' && image === frameImage) {
    ctx.save();
    ctx.translate(dw / 2, dh / 2);
    ctx.scale(FRAME_SHOOTING_AREA_SCALE, FRAME_SHOOTING_AREA_SCALE);
    ctx.translate(-dw / 2, -dh / 2);
    drawAdaptiveOverlayBaseLargeV3(ctx, image, dw, dh);
    ctx.restore();
    return;
  }
  drawAdaptiveOverlayBaseLargeV3(ctx, image, dw, dh);
};

const updateFramePreviewOrientationBaseLargeV3 = updateFramePreviewOrientation;
updateFramePreviewOrientation = function updateFramePreviewOrientationLargerV3() {
  updateFramePreviewOrientationBaseLargeV3();
  applyCameraWindow();
  applyLargeShootingAreaPreviewStyle();
};

applyCameraWindow();
applyLargeShootingAreaPreviewStyle();
