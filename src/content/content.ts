import { heuristicScore } from '../scoring/heuristics';

function injectBadge(el: HTMLElement, score: number) {
  const badge = document.createElement('div');
  badge.textContent = score > 30 ? '🔴 Slop risk' : '🟡 Check content';
  badge.style.position = 'absolute';
  badge.style.background = 'black';
  badge.style.color = 'white';
  badge.style.padding = '2px 6px';
  badge.style.fontSize = '10px';
  badge.style.zIndex = '9999';

  el.style.position = 'relative';
  el.appendChild(badge);
}

function scan() {
  const videos = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer');

  videos.forEach((v) => {
    const titleEl = v.querySelector('#video-title');
    if (!titleEl) return;

    const title = (titleEl as HTMLElement).innerText;
    const desc = '';

    const score = heuristicScore(title, desc);

    if (score > 25) {
      injectBadge(v as HTMLElement, score);
    }
  });
}

const observer = new MutationObserver(() => {
  scan();
});

observer.observe(document.body, { childList: true, subtree: true });

scan();
