function capture() {
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
    downloadBlob(blob, filename);

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
    setStatus(`${filename} の保存処理を開始しました`);
  } catch (err) {
    console.error(err);
    setStatus('JPEGを作成できませんでした。もう一度撮影してください。', true);
  } finally {
    capturing = false;
    els.shootBtn.disabled = !isStreamLive();
  }
}

function flashFeedback() {
  const flash = document.createElement('div');
  flash.className = 'capture-flash';
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.classList.add('fade'); });
  setTimeout(() => flash.remove(), 220);
}

async function detectImageFormat(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return 'png';
  if (head.length >= 3 && head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'jpeg';
  return null;
}

async function loadFrame(file) {
  if (!file) return;

  if (file.size > MAX_FRAME_BYTES) {
    setStatus('画像が大きすぎます（上限12MB）', true);
    els.frameInput.value = '';
    return;
  }

  const format = await detectImageFormat(file);
  if (!format) {
    setStatus('JPEGまたはPNGの画像を選択してください。', true);
    els.frameInput.value = '';
    return;
  }

  const nextUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const { w, h } = outputSize();
    const target = w / h;
    const actual = img.naturalWidth / img.naturalHeight;

    if (format === 'png' && (!Number.isFinite(actual) || Math.abs(actual - target) / target > 0.02)) {
      URL.revokeObjectURL(nextUrl);
      els.frameInput.value = '';
      setStatus(settings.orientation === 'landscape'
        ? '横L判用の3:2 PNGを選択してください（推奨1800×1200）。'
        : '縦L判用の2:3 PNGを選択してください（推奨1200×1800）。', true);
      return;
    }

    if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
    frameObjectUrl = nextUrl;
    frameImage = img;
    frameFormat = format;
    els.previewWrap.classList.toggle('jpeg-background', format === 'jpeg');
    els.frameOverlay.src = frameObjectUrl;
    els.frameOverlay.hidden = false;
    els.frameName.textContent = `${format === 'png' ? 'フレーム' : '背景'}：${file.name}`;
    localStorage.setItem('framecam.frameName.v1', file.name);
    void putState('activeFrame', { blob: file, name: file.name, type: file.type, format });
    setStatus(format === 'png' ? 'PNGフレームを読み込みました' : 'JPEG背景を読み込みました');
  };
  img.onerror = () => {
    URL.revokeObjectURL(nextUrl);
    els.frameInput.value = '';
    setStatus('画像を読み込めませんでした。別のJPEGまたはPNGを選んでください。', true);
  };
  img.src = nextUrl;
}

function clearFrame() {
  frameImage = null;
  frameFormat = null;
  if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
  frameObjectUrl = null;
  els.frameOverlay.removeAttribute('src');
  els.frameOverlay.hidden = true;
  els.previewWrap.classList.remove('jpeg-background');
  els.frameInput.value = '';
  els.frameName.textContent = 'フレーム：未選択';
  localStorage.removeItem('framecam.frameName.v1');
  void deleteState('activeFrame');
  setStatus('フレームを外しました');
}

function openLast() {
  if (!lastCapture) return;
  els.lastImage.src = lastCapture.previewUrl;
  els.lastFilename.textContent = lastCapture.filename;
  els.lastDialog.showModal();
}

function openPhotosImporter() {
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(PHOTOS_SHORTCUT_NAME)}`;
  window.location.href = url;
}

function saveSimpleSetting(name, value) {
  settings[name] = value;
  persistSettings();
  renderTitlePreview();
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putState(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Local state save failed', err);
  }
}

async function deleteState(key) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Local state delete failed', err);
  }
}

async function getState(key) {
  try {
    const db = await openDB();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (err) {
    console.warn('Local state load failed', err);
    return null;
  }
}

async function restoreLocalState() {
  els.frameInput.disabled = true;
  try {
    await deleteState('lastCapture');
    const savedFrame = await getState('activeFrame');
    if (savedFrame?.blob && savedFrame?.name) {
      const file = new File([savedFrame.blob], savedFrame.name, {
        type: savedFrame.type || savedFrame.blob.type || (savedFrame.format === 'jpeg' ? 'image/jpeg' : 'image/png')
      });
      await loadFrame(file);
    }
  } finally {
    els.frameInput.disabled = false;
  }
}
