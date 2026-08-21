'use strict';

// FrameCam shooting UX enhancements:
// - first launch after this update starts in portrait
// - selected frame follows portrait/landscape automatically
// - preview clearly shows the active frame
// - continuous AF is requested when the browser exposes focusMode controls
// - keeps existing direct-to-Photos Web Share flow

const PORTRAIT_BOOT_KEY = 'framecam.portraitDefaultApplied.v1';

function targetIsPortrait() {
  return settings.orientation === 'portrait';
}

function imageIsPortrait(image) {
  return Boolean(image && image.naturalHeight > image.naturalWidth);
}

function imageNeedsRotation(image) {
  if (!image || !image.naturalWidth || !image.naturalHeight) return false;
  if (image.naturalWidth === image.naturalHeight) return false;
  return imageIsPortrait(image) !== targetIsPortrait();
}

function ensureFramePreviewBadge() {
  let badge = document.getElementById('framePreviewBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'framePreviewBadge';
    badge.className = 'frame-preview-badge';
    badge.hidden = true;
    els.previewWrap.appendChild(badge);
  }
  return badge;
}

function updateFramePreviewOrientation() {
  const rotate = imageNeedsRotation(frameImage);
  els.frameOverlay.classList.toggle('frame-auto-rotate', rotate);

  const badge = ensureFramePreviewBadge();
  if (!frameImage) {
    badge.hidden = true;
    return;
  }

  const savedName = localStorage.getItem('framecam.frameName.v1') || '';
  const kind = frameFormat === 'jpeg' ? 'JPEG' : 'PNG';
  badge.textContent = savedName ? `${kind}：${savedName}` : `${kind}フレーム適用中`;
  badge.hidden = false;
}

function drawAdaptiveOverlay(ctx, image, dw, dh) {
  if (!image) return;
  if (!imageNeedsRotation(image)) {
    ctx.drawImage(image, 0, 0, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, -dh / 2, -dw / 2, dh, dw);
  ctx.restore();
}

function drawAdaptiveCover(ctx, image, dw, dh) {
  if (!image) return;
  if (!imageNeedsRotation(image)) {
    drawImageCover(ctx, image, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-dh / 2, -dw / 2);
  drawImageCover(ctx, image, dh, dw);
  ctx.restore();
}

async function enableContinuousAutofocus() {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;

  try {
    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    const modes = caps?.focusMode;
    if (Array.isArray(modes) && modes.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch (err) {
    console.debug('Continuous AF constraint unavailable; using native AF.', err);
  }
}

const startCameraBase = startCamera;
startCamera = async function startCameraEnhanced() {
  await startCameraBase();
  if (isStreamLive()) await enableContinuousAutofocus();
};

const loadFrameEnhancedBase = loadFrame;
loadFrame = async function loadFrameAdaptive(file) {
  if (!file) return;

  const detected = await detectImageFormat(file);
  if (!detected) {
    return loadFrameEnhancedBase(file);
  }

  if (file.size > MAX_FRAME_BYTES) {
    setStatus('画像が大きすぎます（上限12MB）', true);
    els.frameInput.value = '';
    return;
  }

  const nextUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
    frameObjectUrl = nextUrl;
    frameImage = img;
    frameFormat = detected;

    els.previewWrap.classList.toggle('jpeg-background', detected === 'jpeg');
    els.frameOverlay.src = frameObjectUrl;
    els.frameOverlay.hidden = false;
    els.frameName.textContent = `${detected === 'png' ? 'フレーム' : '背景'}：${file.name}`;
    localStorage.setItem('framecam.frameName.v1', file.name);
    void putState('activeFrame', { blob: file, name: file.name, type: file.type, format: detected });

    updateFramePreviewOrientation();
    setStatus(detected === 'png'
      ? 'PNGフレームを撮影向きに合わせて表示しています'
      : 'JPEGフレームを撮影向きに合わせて表示しています');
  };
  img.onerror = () => {
    URL.revokeObjectURL(nextUrl);
    els.frameInput.value = '';
    setStatus('画像を読み込めませんでした。別のJPEGまたはPNGを選んでください。', true);
  };
  img.src = nextUrl;
};

els.orientationSelect.addEventListener('change', event => {
  event.stopImmediatePropagation();
  settings.orientation = event.target.value === 'landscape' ? 'landscape' : 'portrait';
  persistSettings();
  applySettingsToUI();
  updateFramePreviewOrientation();
  setStatus(settings.orientation === 'portrait'
    ? '縦撮影に切り替えました。フレームも縦向きに合わせます'
    : '横撮影に切り替えました。フレームも横向きに合わせます');
}, true);

const clearFrameBase = clearFrame;
clearFrame = function clearFrameEnhanced() {
  clearFrameBase();
  updateFramePreviewOrientation();
};

async function captureToPhotosAdaptive() {
  if (capturing) return;
  if (!isStreamLive()) {
    els.shootBtn.disabled = true;
    els.cameraMessage.hidden = false;
    els.cameraMessage.textContent = 'カメラが停止しています。「カメラ再起動」を押してください。';
    setStatus('カメラが停止しています。再起動してください。', true);
    return;
  }

  capturing = true;
  els.shootBtn.disabled = true;
  const { w, h } = outputSize();
  const canvas = els.captureCanvas;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });

  try {
    if (frameImage && frameFormat === 'jpeg') {
      drawAdaptiveCover(ctx, frameImage, w, h);
      drawVideoContain(ctx, els.video, w, h);
    } else {
      drawVideoCover(ctx, els.video, w, h);
      if (frameImage) drawAdaptiveOverlay(ctx, frameImage, w, h);
    }
    drawTitle(ctx, w, h);

    const blob = canvasToJpegBlobSync(canvas, 0.94);
    const filename = timestampName();

    captureCount += 1;
    updateCount();

    if (lastCapture?.previewUrl) URL.revokeObjectURL(lastCapture.previewUrl);
    lastCapture = {
      filename,
      blob,
      previewUrl: URL.createObjectURL(blob),
      createdAt: Date.now()
    };
    els.lastBtn.disabled = false;
    flashFeedback();

    const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
    const shareData = { files: [file] };
    const canShareFiles = typeof navigator.share === 'function' &&
      (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

    if (canShareFiles) {
      setStatus('共有画面で「画像を保存」を選ぶと写真アプリへ保存できます');
      try {
        await navigator.share(shareData);
        setStatus('写真の共有画面を閉じました');
      } catch (err) {
        if (err?.name === 'AbortError') {
          setStatus('写真の保存をキャンセルしました');
        } else {
          console.warn('Direct photo share failed; falling back to download.', err);
          downloadBlob(blob, filename);
          setStatus('直接保存を使えないためDownloadsへ保存しました', true);
        }
      }
    } else {
      downloadBlob(blob, filename);
      setStatus('この端末では直接保存を使えないためDownloadsへ保存しました', true);
    }
  } catch (err) {
    console.error(err);
    setStatus('JPEGを作成できませんでした。もう一度撮影してください。', true);
  } finally {
    capturing = false;
    els.shootBtn.disabled = !isStreamLive();
  }
}

els.shootBtn.removeEventListener('click', captureToPhotos);
els.shootBtn.addEventListener('click', captureToPhotosAdaptive);

if (!localStorage.getItem(PORTRAIT_BOOT_KEY)) {
  settings.orientation = 'portrait';
  persistSettings();
  localStorage.setItem(PORTRAIT_BOOT_KEY, '1');
}

applySettingsToUI();
updateFramePreviewOrientation();
