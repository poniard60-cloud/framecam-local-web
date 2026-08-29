'use strict';

// 3:4 / 4:3 capture format.
// Keeps the long edge at 1800px and updates the live finder geometry to match.

const FRAMECAM_CAPTURE_SIZE_V4 = {
  portrait: { w: 1350, h: 1800 },
  landscape: { w: 1800, h: 1350 }
};

outputSize = function outputSizeThreeByFour() {
  return settings.orientation === 'landscape'
    ? { ...FRAMECAM_CAPTURE_SIZE_V4.landscape }
    : { ...FRAMECAM_CAPTURE_SIZE_V4.portrait };
};

function applyThreeByFourLabelsV4() {
  if (!els.orientationSelect) return;
  const portraitOption = els.orientationSelect.querySelector('option[value="portrait"]');
  const landscapeOption = els.orientationSelect.querySelector('option[value="landscape"]');
  if (portraitOption) portraitOption.textContent = '縦（3:4）';
  if (landscapeOption) landscapeOption.textContent = '横（4:3）';
}

function ensureThreeByFourStylesV4() {
  if (document.getElementById('framecamAspectThreeByFourV4')) return;

  const style = document.createElement('style');
  style.id = 'framecamAspectThreeByFourV4';
  style.textContent = `
    .preview-wrap.portrait {
      aspect-ratio: 3 / 4 !important;
    }
    .preview-wrap.landscape {
      aspect-ratio: 4 / 3 !important;
    }

    .preview-wrap.landscape .frame-overlay.frame-auto-rotate {
      width: 75% !important;
      height: 133.333333% !important;
    }
    .preview-wrap.portrait .frame-overlay.frame-auto-rotate {
      width: 133.333333% !important;
      height: 75% !important;
    }

    @media (max-width: 700px) and (orientation: portrait) {
      .preview-wrap.portrait {
        width: min(92vw, calc((100dvh - 185px) * 3 / 4)) !important;
        max-width: 92vw !important;
        max-height: calc(100dvh - 185px) !important;
        aspect-ratio: 3 / 4 !important;
      }
      .preview-wrap.landscape {
        width: min(94vw, calc((100dvh - 185px) * 4 / 3)) !important;
        max-width: 94vw !important;
        max-height: calc(100dvh - 185px) !important;
        aspect-ratio: 4 / 3 !important;
      }
    }

    @media (max-width: 700px) and (orientation: portrait) and (max-height: 720px) {
      .preview-wrap.portrait {
        width: min(92vw, calc((100dvh - 165px) * 3 / 4)) !important;
        max-height: calc(100dvh - 165px) !important;
      }
      .preview-wrap.landscape {
        width: min(94vw, calc((100dvh - 165px) * 4 / 3)) !important;
        max-height: calc(100dvh - 165px) !important;
      }
    }

    @media (orientation: landscape) and (max-height: 620px) {
      .preview-wrap.portrait { aspect-ratio: 3 / 4 !important; }
      .preview-wrap.landscape { aspect-ratio: 4 / 3 !important; }
    }
  `;
  document.head.appendChild(style);
}

applyThreeByFourLabelsV4();
ensureThreeByFourStylesV4();
applySettingsToUI();
updateFramePreviewOrientation();
