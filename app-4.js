// iPhone写真アプリ互換: JPEG/PNGに加え、写真アプリからHEIC/HEIFで渡された場合は
// Safari内だけでJPEGへ変換してから既存のフレーム処理へ渡します。
els.frameInput.accept = 'image/jpeg,image/png,image/heic,image/heif';
const framePickerLabel = els.frameInput.closest('label')?.querySelector('span');
if (framePickerLabel) framePickerLabel.textContent = '写真アプリからJPEG / PNGを選ぶ';

const loadFrameBase = loadFrame;
loadFrame = async function loadFrameWithPhotoCompatibility(file) {
  if (!file) return;

  const detected = await detectImageFormat(file);
  if (detected) return loadFrameBase(file);

  const mime = String(file.type || '').toLowerCase();
  const looksLikeHeic = mime === 'image/heic' || mime === 'image/heif' || /\.(heic|heif)$/i.test(file.name || '');
  if (!looksLikeHeic) return loadFrameBase(file);

  setStatus('iPhone写真をJPEGに変換しています…');
  let objectUrl = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('heic-decode-failed'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) throw new Error('jpeg-convert-failed');

    const name = String(file.name || 'frame').replace(/\.(heic|heif)$/i, '') + '.jpg';
    const converted = new File([blob], name, {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now()
    });
    return loadFrameBase(converted);
  } catch (err) {
    console.error(err);
    els.frameInput.value = '';
    setStatus('このiPhone写真を読み込めませんでした。JPEGまたはPNGに書き出してから選択してください。', true);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

els.cameraBtn.addEventListener('click', () => void startCamera());
els.shootBtn.addEventListener('click', capture);
els.settingsBtn.addEventListener('click', () => {
  applySettingsToUI();
  els.settingsDialog.showModal();
});
els.closeSettings.addEventListener('click', () => els.settingsDialog.close());
els.lastBtn.addEventListener('click', openLast);
els.closeLast.addEventListener('click', () => els.lastDialog.close());
els.downloadLastBtn.addEventListener('click', () => {
  if (lastCapture) downloadBlob(lastCapture.blob, lastCapture.filename);
});
els.photosImportBtn.addEventListener('click', openPhotosImporter);
els.photosHelpBtn.addEventListener('click', () => els.photosHelpDialog.showModal());
els.closePhotosHelp.addEventListener('click', () => els.photosHelpDialog.close());

els.orientationSelect.addEventListener('change', e => {
  const next = e.target.value;
  const changed = settings.orientation !== next;
  settings.orientation = next;
  persistSettings();
  applySettingsToUI();
  if (changed && frameImage) {
    clearFrame();
    setStatus('仕上がりの縦横を変更したため、画像を選び直してください。', true);
  }
});

els.cameraFacingSelect.addEventListener('change', e => {
  settings.cameraFacing = e.target.value === 'user' ? 'user' : 'environment';
  persistSettings();
  if (cameraWanted) void startCamera();
});

els.frameInput.addEventListener('change', e => void loadFrame(e.target.files?.[0]));
els.clearFrameBtn.addEventListener('click', clearFrame);

els.titleEnabled.addEventListener('change', e => {
  settings.titleEnabled = e.target.checked;
  persistSettings();
  els.titleFields.hidden = !settings.titleEnabled;
  renderTitlePreview();
});

els.titleText.addEventListener('compositionstart', () => { composingTitle = true; });
els.titleText.addEventListener('compositionend', e => {
  composingTitle = false;
  settings.titleText = e.target.value;
  persistSettings();
  renderTitlePreview();
});
els.titleText.addEventListener('input', e => {
  if (composingTitle) return;
  settings.titleText = e.target.value;
  persistSettings();
  renderTitlePreview();
});

els.titlePosition.addEventListener('change', e => saveSimpleSetting('titlePosition', e.target.value));
els.titleSize.addEventListener('input', e => saveSimpleSetting('titleSize', Number(e.target.value)));
els.titleColor.addEventListener('change', e => saveSimpleSetting('titleColor', e.target.value));
els.titleBand.addEventListener('change', e => saveSimpleSetting('titleBand', e.target.checked));

els.resetCountBtn.addEventListener('click', () => {
  if (!window.confirm('撮影枚数を0に戻します。よろしいですか？')) return;
  captureCount = 0;
  updateCount();
  setStatus('撮影枚数をリセットしました');
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTitlePreview, 120);
});
window.addEventListener('orientationchange', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTitlePreview, 120);
});
window.addEventListener('pagehide', () => stopCamera({ preserveWanted: true }));
window.addEventListener('pageshow', () => void recoverIfNeeded());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void recoverIfNeeded();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
}

applySettingsToUI();
updateCount();
void restoreLocalState();
