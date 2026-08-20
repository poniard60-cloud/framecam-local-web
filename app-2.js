function drawVideoCover(ctx, video, dw, dh) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) throw new Error('video-not-ready');

  const sourceRatio = sw / sh;
  const targetRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;

  if (sourceRatio > targetRatio) {
    cw = sh * targetRatio;
    sx = (sw - cw) / 2;
  } else {
    ch = sw / targetRatio;
    sy = (sh - ch) / 2;
  }

  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, dw, dh);
}

function drawTitle(ctx, w, h) {
  const text = settings.titleText.trim();
  if (!settings.titleEnabled || !text) return;

  const size = outputTitleSize(w);
  const marginX = Math.round(w * 0.05);
  const padY = Math.round(size * 0.38);
  const maxW = w - marginX * 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;

  const lines = wrapText(ctx, text, maxW, 3);
  const lineH = Math.round(size * 1.16);
  const blockH = lines.length * lineH + padY * 2;
  const centerY = settings.titlePosition === 'top'
    ? Math.round(h * 0.04 + blockH / 2)
    : Math.round(h - h * 0.04 - blockH / 2);

  if (settings.titleBand) {
    ctx.save();
    ctx.fillStyle = settings.titleColor === 'black'
      ? 'rgba(255,255,255,.62)'
      : 'rgba(0,0,0,.52)';
    roundRect(ctx, marginX, centerY - blockH / 2, maxW, blockH, Math.round(size * 0.25));
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = settings.titleColor === 'black' ? '#000000' : '#ffffff';
  ctx.shadowColor = settings.titleColor === 'black'
    ? 'rgba(255,255,255,.35)'
    : 'rgba(0,0,0,.45)';
  ctx.shadowBlur = Math.max(1, Math.round(size * 0.04));
  const firstY = centerY - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, firstY + i * lineH));
  ctx.shadowBlur = 0;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(text);
  const lines = [];
  let line = '';
  let i = 0;

  for (; i < chars.length; i += 1) {
    const next = line + chars[i];
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = chars[i];
      if (lines.length === maxLines - 1) {
        i += 1;
        break;
      }
    } else {
      line = next;
    }
  }

  const rest = chars.slice(i).join('');
  let finalLine = line + rest;
  if (rest) {
    const finalChars = Array.from(finalLine);
    while (finalChars.length > 1 && ctx.measureText(finalChars.join('') + '…').width > maxWidth) {
      finalChars.pop();
    }
    finalLine = finalChars.join('') + '…';
  }

  if (finalLine || lines.length === 0) lines.push(finalLine);
  return lines.slice(0, maxLines);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function timestampName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `FRAMECAM_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${ms}.jpg`;
}

function canvasToJpegBlobSync(canvas, quality = 0.94) {
  const dataURL = canvas.toDataURL('image/jpeg', quality);
  const comma = dataURL.indexOf(',');
  if (comma < 0) throw new Error('jpeg-encode-failed');
  const binary = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  pendingDownloadUrls.add(url);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    pendingDownloadUrls.delete(url);
  }, DOWNLOAD_URL_TTL_MS);
}
