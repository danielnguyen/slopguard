const runtime = (globalThis as any).browser?.runtime || (globalThis as any).chrome?.runtime;

const VIDEO_CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-rich-grid-media',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'yt-lockup-view-model'
].join(',');

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
};

let scanTimer: number | undefined;

function getTitle(card: Element): string | null {
  const titleEl = card.querySelector(
    '#video-title, a#video-title-link, yt-formatted-string#video-title, h3 a, a[title]'
  );

  const text = (titleEl as HTMLElement | null)?.innerText?.trim();
  const attrTitle = (titleEl as HTMLAnchorElement | null)?.title?.trim();

  return text || attrTitle || null;
}

function getVideoId(card: Element): string | null {
  const link =
    card.querySelector('a#thumbnail[href*="/watch"]') ||
    card.querySelector('a[href*="/watch?v="]');

  const href = (link as HTMLAnchorElement | null)?.href;
  if (!href) return null;

  try {
    return new URL(href).searchParams.get('v');
  } catch {
    return null;
  }
}

function getBadgeTarget(card: Element): HTMLElement | null {
  return (
    card.querySelector('a#thumbnail') ||
    card.querySelector('ytd-thumbnail') ||
    card.querySelector('#thumbnail') ||
    card
  ) as HTMLElement | null;
}

function injectBadge(card: HTMLElement, result: ClassificationResult): void {
  if (card.querySelector('.slopguard-badge')) return;

  const target = getBadgeTarget(card);
  if (!target) return;

  const badge = document.createElement('div');
  badge.className = 'slopguard-badge';
  badge.textContent = result.score >= 50 ? '🔴 Slop risk' : '🟡 Check content';
  badge.title = `SlopGuard score: ${result.score} (${result.label})`;

  Object.assign(badge.style, {
    position: 'absolute',
    top: '6px',
    left: '6px',
    background: 'rgba(0, 0, 0, 0.86)',
    color: 'white',
    padding: '3px 7px',
    fontSize: '11px',
    fontWeight: '700',
    borderRadius: '6px',
    zIndex: '9999',
    pointerEvents: 'none'
  });

  if (getComputedStyle(target).position === 'static') {
    target.style.position = 'relative';
  }

  target.appendChild(badge);
}

function classifyCard(card: Element, title: string, videoId: string): void {
  runtime
    .sendMessage({
      type: 'CLASSIFY_VIDEO',
      videoId,
      title
    })
    .then((result: ClassificationResult | undefined) => {
      console.log('SlopGuard result', { title, videoId, result });

      if (!result) return;

      if (result.score >= 30) {
        injectBadge(card as HTMLElement, result);
      }
    })
    .catch((error: any) => {
      console.warn('SlopGuard classify failed', { title, videoId, error });
    });
}

function scan(): void {
  const cards = document.querySelectorAll(VIDEO_CARD_SELECTOR);
  console.log('SlopGuard scanning', cards.length, location.href);

  cards.forEach((card) => {
    const htmlCard = card as HTMLElement;

    if (htmlCard.dataset.slopguardProcessed === 'true') return;

    const title = getTitle(card);
    if (!title) return;

    const videoId = getVideoId(card);
    if (!videoId) return;

    htmlCard.dataset.slopguardProcessed = 'true';
    classifyCard(card, title, videoId);
  });
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 300);
}

function resetProcessedCards(): void {
  document.querySelectorAll('[data-slopguard-processed]').forEach((el) => {
    delete (el as HTMLElement).dataset.slopguardProcessed;
  });
}

function bootstrap(): void {
  scheduleScan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('yt-navigate-finish', () => {
    resetProcessedCards();
    scheduleScan();
  });

  window.setTimeout(scan, 1000);
  window.setTimeout(scan, 2500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
