const runtime = (globalThis as any).browser?.runtime || (globalThis as any).chrome?.runtime;

const VIDEO_CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-rich-grid-media',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'yt-lockup-view-model'
].join(',');

const VIEWPORT_BUFFER_MULTIPLIER = 1.5;

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
  source?: 'heuristic' | 'openai' | 'cache';
  explanation?: string;
  labels?: string[];
};

type VideoMetadata = {
  videoId: string;
  title: string;
  channel?: string;
  snippet?: string;
  pageUrl: string;
  isSponsored?: boolean;
};

let scanTimer: number | undefined;

function textFrom(selector: string, root: Element): string | undefined {
  const el = root.querySelector(selector) as HTMLElement | null;
  return el?.innerText?.trim() || undefined;
}

function cleanText(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function isNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const buffer = window.innerHeight * VIEWPORT_BUFFER_MULTIPLIER;

  return rect.bottom >= -buffer && rect.top <= window.innerHeight + buffer;
}

function getTitle(card: Element): string | null {
  const titleEl = card.querySelector(
    '#video-title, a#video-title-link, yt-formatted-string#video-title, h3 a, a[title]'
  );

  const text = (titleEl as HTMLElement | null)?.innerText?.trim();
  const attrTitle = (titleEl as HTMLAnchorElement | null)?.title?.trim();

  return text || attrTitle || null;
}

function getChannel(card: Element): string | undefined {
  return cleanText(
    textFrom('#channel-name yt-formatted-string', card) ||
      textFrom('ytd-channel-name yt-formatted-string', card) ||
      textFrom('a.yt-simple-endpoint[href^="/@"]', card) ||
      textFrom('a[href^="/@"]', card)
  );
}

function getSnippet(card: Element): string | undefined {
  const snippet = cleanText(
    textFrom('#description-text', card) ||
      textFrom('yt-formatted-string.metadata-snippet-text', card)
  );

  if (!snippet) return undefined;
  if (snippet.length > 280) return `${snippet.slice(0, 277)}...`;
  return snippet;
}

function isSponsoredCard(card: Element): boolean {
  const visibleText = cleanText(card.textContent || '') || '';
  const hasSponsoredText = /(^|\s)Sponsored(\s|$|·|\.)/.test(visibleText);
  const hasAdCta = Boolean(
    card.querySelector('ytd-button-renderer, button, a[href*="googleadservices"], a[href*="doubleclick"]')
  );
  const hasAdRenderer = Boolean(
    card.closest('ytd-ad-slot-renderer') ||
      card.querySelector('ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-in-feed-ad-layout-renderer')
  );

  return hasAdRenderer || (hasSponsoredText && hasAdCta);
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

function getBadgeTitle(result: ClassificationResult): string {
  const lines = [`SlopGuard score: ${result.score} (${result.label})`];

  if (result.source) lines.push(`Source: ${result.source}`);
  if (result.explanation) lines.push(`Reason: ${result.explanation}`);
  if (result.labels?.length) lines.push(`Labels: ${result.labels.join(', ')}`);

  return lines.join('\n');
}

function createBadge(className: string, text: string, title: string, top: string, background: string): HTMLDivElement {
  const badge = document.createElement('div');
  badge.className = className;
  badge.textContent = text;
  badge.title = title;

  Object.assign(badge.style, {
    position: 'absolute',
    top,
    left: '6px',
    background,
    color: 'white',
    padding: '3px 7px',
    fontSize: '11px',
    fontWeight: '700',
    borderRadius: '6px',
    zIndex: '9999',
    pointerEvents: 'none'
  });

  return badge;
}

function ensureBadgeTargetPosition(target: HTMLElement): void {
  if (getComputedStyle(target).position === 'static') {
    target.style.position = 'relative';
  }
}

function injectSponsoredBadge(card: HTMLElement): void {
  if (card.querySelector('.slopguard-sponsored-badge')) return;

  const target = getBadgeTarget(card);
  if (!target) return;

  const badge = createBadge(
    'slopguard-sponsored-badge',
    '🔵 Sponsored',
    'SlopGuard: this card appears to be a YouTube sponsored placement.',
    '6px',
    'rgba(20, 70, 150, 0.9)'
  );

  ensureBadgeTargetPosition(target);
  target.appendChild(badge);
}

function injectBadge(card: HTMLElement, result: ClassificationResult): void {
  if (card.querySelector('.slopguard-badge')) return;

  const target = getBadgeTarget(card);
  if (!target) return;

  const top = card.querySelector('.slopguard-sponsored-badge') ? '32px' : '6px';
  const badge = createBadge(
    'slopguard-badge',
    result.label === 'high' ? '🔴 Slop risk' : '🟡 Check content',
    getBadgeTitle(result),
    top,
    'rgba(0, 0, 0, 0.86)'
  );

  ensureBadgeTargetPosition(target);
  target.appendChild(badge);
}

function classifyCard(card: Element, metadata: VideoMetadata): void {
  runtime
    .sendMessage({
      type: 'CLASSIFY_VIDEO',
      ...metadata
    })
    .then((result: ClassificationResult | undefined) => {
      console.log('SlopGuard result', {
        ...metadata,
        score: result?.score,
        label: result?.label,
        source: result?.source,
        labels: result?.labels,
        explanation: result?.explanation,
        result
      });

      if (!result) return;

      if (result.label !== 'low') {
        injectBadge(card as HTMLElement, result);
      }
    })
    .catch((error: any) => {
      console.warn('SlopGuard classify failed', { metadata, error });
    });
}

function scan(): void {
  const cards = document.querySelectorAll(VIDEO_CARD_SELECTOR);
  console.log('SlopGuard scanning', cards.length, location.href);

  cards.forEach((card) => {
    const htmlCard = card as HTMLElement;

    if (htmlCard.dataset.slopguardProcessed === 'true') return;
    if (!isNearViewport(card)) return;

    const title = getTitle(card);
    if (!title) return;

    const sponsored = isSponsoredCard(card);
    if (sponsored) {
      injectSponsoredBadge(htmlCard);
    }

    const videoId = getVideoId(card);
    if (!videoId) return;

    const metadata: VideoMetadata = {
      videoId,
      title,
      channel: getChannel(card),
      snippet: getSnippet(card),
      pageUrl: location.href,
      isSponsored: sponsored
    };

    htmlCard.dataset.slopguardProcessed = 'true';
    classifyCard(card, metadata);
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

  window.addEventListener('scroll', scheduleScan, { passive: true });

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
