'use strict';

// Smooth pinch zoom for iPhone/Safari.
// The old pinch handler in app-7 updates camera constraints on every move,
// which can feel stepped. This capture-phase handler replaces only pinch
// gestures: visual feedback is rAF-driven and native camera zoom is committed
// sparingly/finally instead of on every touchmove.

let smoothPinchActiveV3 = false;
let smoothPinchStartDistanceV3 = 0;
let smoothPinchStartZoomV3 = 1;
let smoothPinchTargetZoomV3 = 1;
let smoothPinchNativeAnchorV3 = 1;
let smoothPinchRafV3 = 0;
let smoothPinchNativeBusyV3 = false;
let smoothPinchNativeQueuedV3 = null;
let smoothPinchLastNativeAtV3 = 0;

function smoothPinchDistanceV3(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function smoothPinchUiV3(value) {
  zoomRange.value = String(value);
  zoomValueLabel.textContent = `${value.toFixed(1)}×`;
}

function smoothPinchRenderV3() {
  smoothPinchRafV3 = 0;
  if (!smoothPinchActiveV3) return;

  const target = smoothPinchTargetZoomV3;
  smoothPinchUiV3(target);
  els.video.style.transformOrigin = '50% 50%';
  els.video.style.willChange = 'transform';
  els.video.style.transition = 'none';

  if (!nativeZoomAvailable) {
    els.video.style.transform = target > 1.001 ? `scale(${target})` : 'none';
    return;
  }

  if (target >= smoothPinchNativeAnchorV3) {
    const ratio = target / Math.max(nativeZoomRange.min, smoothPinchNativeAnchorV3);
    els.video.style.transform = ratio > 1.001 ? `scale(${ratio})` : 'none';
  } else {
    els.video.style.transform = 'none';
    smoothPinchQueueNativeV3(target, false);
  }
}

function smoothPinchScheduleRenderV3() {
  if (smoothPinchRafV3) return;
  smoothPinchRafV3 = requestAnimationFrame(smoothPinchRenderV3);
}

async function smoothPinchApplyNativeV3(value) {
  const track = stream?.getVideoTracks?.()[0];
  if (!nativeZoomAvailable || !track) return false;

  try {
    await track.applyConstraints({ advanced: [{ zoom: value }] });
    smoothPinchNativeAnchorV3 = value;
    return true;
  } catch (err) {
    console.debug('Smooth native pinch zoom unavailable; using digital zoom.', err);
    nativeZoomAvailable = false;
    nativeZoomRange = { min: 1, max: 3, step: 0.1 };
    smoothPinchTargetZoomV3 = clamp(smoothPinchTargetZoomV3, 1, 3);
    return false;
  }
}

async function smoothPinchDrainNativeV3(force = false) {
  if (smoothPinchNativeBusyV3 || smoothPinchNativeQueuedV3 == null) return;

  const now = performance.now();
  const wait = force ? 0 : Math.max(0, 90 - (now - smoothPinchLastNativeAtV3));
  if (wait > 0) {
    setTimeout(() => void smoothPinchDrainNativeV3(false), wait);
    return;
  }

  const value = smoothPinchNativeQueuedV3;
  smoothPinchNativeQueuedV3 = null;
  smoothPinchNativeBusyV3 = true;
  smoothPinchLastNativeAtV3 = performance.now();
  await smoothPinchApplyNativeV3(value);
  smoothPinchNativeBusyV3 = false;
  smoothPinchScheduleRenderV3();

  if (smoothPinchNativeQueuedV3 != null) void smoothPinchDrainNativeV3(force);
}

function smoothPinchQueueNativeV3(value, force) {
  smoothPinchNativeQueuedV3 = value;
  void smoothPinchDrainNativeV3(force);
}

function smoothPinchBeginV3(event) {
  if (event.touches.length !== 2) return;

  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();

  smoothPinchActiveV3 = true;
  smoothPinchStartDistanceV3 = smoothPinchDistanceV3(event.touches);
  smoothPinchStartZoomV3 = zoomValue;
  smoothPinchTargetZoomV3 = zoomValue;
  smoothPinchNativeAnchorV3 = zoomValue;
  smoothPinchNativeQueuedV3 = null;
  smoothPinchUiV3(zoomValue);
  els.previewWrap.classList.add('pinch-zoom-active');
}

function smoothPinchMoveV3(event) {
  if (!smoothPinchActiveV3 || event.touches.length !== 2 || !smoothPinchStartDistanceV3) return;

  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();

  const distance = smoothPinchDistanceV3(event.touches);
  const rawRatio = distance / smoothPinchStartDistanceV3;
  const dampedRatio = Math.pow(Math.max(0.01, rawRatio), 0.90);
  let target = smoothPinchStartZoomV3 * dampedRatio;
  target = clamp(target, nativeZoomRange.min, nativeZoomRange.max);

  if (Math.abs(target - smoothPinchTargetZoomV3) < 0.006) return;
  smoothPinchTargetZoomV3 = target;
  smoothPinchScheduleRenderV3();
}

async function smoothPinchFinishV3(event) {
  if (!smoothPinchActiveV3) return;
  if (event.touches && event.touches.length >= 2) return;

  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();

  smoothPinchActiveV3 = false;
  smoothPinchStartDistanceV3 = 0;
  if (smoothPinchRafV3) {
    cancelAnimationFrame(smoothPinchRafV3);
    smoothPinchRafV3 = 0;
  }

  zoomValue = clamp(smoothPinchTargetZoomV3, nativeZoomRange.min, nativeZoomRange.max);
  localStorage.setItem(ZOOM_KEY, String(zoomValue));
  smoothPinchUiV3(zoomValue);

  if (nativeZoomAvailable) {
    if (zoomValue >= smoothPinchNativeAnchorV3) {
      const ratio = zoomValue / Math.max(nativeZoomRange.min, smoothPinchNativeAnchorV3);
      els.video.style.transform = ratio > 1.001 ? `scale(${ratio})` : 'none';
    } else {
      els.video.style.transform = 'none';
    }

    smoothPinchNativeQueuedV3 = zoomValue;
    await smoothPinchDrainNativeV3(true);
    for (let i = 0; i < 8 && (smoothPinchNativeBusyV3 || smoothPinchNativeQueuedV3 != null); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 16));
      if (!smoothPinchNativeBusyV3 && smoothPinchNativeQueuedV3 != null) await smoothPinchDrainNativeV3(true);
    }
  }

  els.video.style.transition = 'transform 90ms ease-out';
  updatePreviewZoom();
  requestAnimationFrame(() => {
    els.video.style.willChange = '';
    els.previewWrap.classList.remove('pinch-zoom-active');
    setTimeout(() => { els.video.style.transition = ''; }, 110);
  });
}

els.previewWrap.addEventListener('touchstart', smoothPinchBeginV3, { capture: true, passive: false });
els.previewWrap.addEventListener('touchmove', smoothPinchMoveV3, { capture: true, passive: false });
els.previewWrap.addEventListener('touchend', event => { void smoothPinchFinishV3(event); }, { capture: true, passive: false });
els.previewWrap.addEventListener('touchcancel', event => { void smoothPinchFinishV3(event); }, { capture: true, passive: false });
