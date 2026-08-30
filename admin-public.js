'use strict';

// Public repository health does not require a token. Traffic statistics still do.
const PUBLIC_API_BASE = 'https://api.github.com/repos/poniard60-cloud/framecam-local-web';

function publicDecodeContent(file) {
  const encoded = String(file?.content || '').replace(/\s/g, '');
  if (!encoded) return '';
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function publicGithub(path) {
  const response = await fetch(`${PUBLIC_API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    cache: 'no-store',
    credentials: 'omit'
  });
  if (!response.ok) throw new Error(`github-public-${response.status}`);
  return response.json();
}

async function loadPublicDeploymentHealth() {
  try {
    const [commit, indexFile, swFile] = await Promise.all([
      publicGithub('/commits/gh-pages'),
      publicGithub('/contents/index.html?ref=gh-pages'),
      publicGithub('/contents/sw.js?ref=gh-pages')
    ]);
    const indexText = publicDecodeContent(indexFile);
    const swText = publicDecodeContent(swFile);

    if (typeof renderSystem === 'function') {
      renderSystem(commit, indexText, swText);
      if (typeof livePatchPrivacyCopy === 'function') livePatchPrivacyCopy();
      return;
    }

    const apps = [...indexText.matchAll(/app-(\d+)\.js/g)].map(m => Number(m[1]));
    const appNo = apps.length ? Math.max(...apps) : null;
    const release = appNo ? `app-${appNo}` : '不明';
    const cache = swText.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/)?.[1] || '不明';
    document.getElementById('releaseLabel').textContent = release;
    document.getElementById('systemRelease').textContent = release;
    document.getElementById('cacheVersion').textContent = cache;
  } catch (err) {
    console.debug('Public deployment health unavailable', err);
  }
}

void loadPublicDeploymentHealth();
