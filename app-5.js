'use strict';

// iOS SafariではWebページから写真ライブラリへ無確認で直接書き込めないため、
// 撮影直後のJPEGをDownloadsへ保存せず、Web Share経由でiOSへ渡します。
// 対応端末では共有画面から「画像を保存」を選ぶと写真アプリへ入ります。

async function captureToPhotos() {
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
      drawImageCover(ctx, frameImage, w, h);
      drawVideoContain(ctx, els.video, w, h);
    } else {
      drawVideoCover(ctx, els.video, w, h);
      if (frameImage) ctx.drawImage(frameImage, 0, 0, w, h);
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

    const file = new File([blob], filename, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
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

// app-4.jsで登録済みの旧captureハンドラを差し替える。
els.shootBtn.removeEventListener('click', capture);
els.shootBtn.addEventListener('click', captureToPhotos);

// 直前確認からの再保存もDownloadsではなく共有画面を優先する。
els.downloadLastBtn.textContent = '写真アプリへ保存';
const newDownloadLastBtn = els.downloadLastBtn.cloneNode(true);
els.downloadLastBtn.replaceWith(newDownloadLastBtn);
els.downloadLastBtn = newDownloadLastBtn;
els.downloadLastBtn.addEventListener('click', async () => {
  if (!lastCapture) return;
  const file = new File([lastCapture.blob], lastCapture.filename, {
    type: 'image/jpeg',
    lastModified: Date.now()
  });
  const shareData = { files: [file] };
  const canShareFiles = typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

  if (canShareFiles) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn(err);
        downloadBlob(lastCapture.blob, lastCapture.filename);
        setStatus('直接保存を使えないためDownloadsへ保存しました', true);
      }
    }
  } else {
    downloadBlob(lastCapture.blob, lastCapture.filename);
    setStatus('この端末では直接保存を使えないためDownloadsへ保存しました', true);
  }
});
