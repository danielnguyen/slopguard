const runtime = (globalThis as any).browser?.runtime || (globalThis as any).chrome?.runtime;

console.log('SlopGuard background loaded');

const WARN_THRESHOLD = 20;
const HIGH_THRESHOLD = 40;

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
};

type ClassifyVideoMessage = {
  type: 'CLASSIFY_VIDEO';
  videoId?: string;
  title?: string;
};

const cache = new Map<string, ClassificationResult>();

function heuristicScore(title: string): number {
  let score = 0;
  const lower = title.toLowerCase();

  if (lower.includes('exposed') || lower.includes('shocking')) score += 20;
  if (lower.includes('war') || lower.includes('military')) score += 10;
  if (lower.includes('invading') || lower.includes('invasion')) score += 10;
  if (lower.includes('ukraine') || lower.includes('russia')) score += 10;
  if (lower.includes('jtf2') || lower.includes('special forces') || lower.includes('green beret')) score += 20;
  if (lower.includes('trump')) score += 10;
  if (lower.includes('collapse') || lower.includes('betrayed') || lower.includes('karma')) score += 15;
  if (lower.includes('world') && lower.includes('best')) score += 15;
  if (/[!]{3,}/.test(title)) score += 10;

  return Math.min(score, 100);
}

function classifyVideo(videoId: string, title: string): ClassificationResult {
  if (cache.has(videoId)) {
    return cache.get(videoId)!;
  }

  const score = heuristicScore(title);
  const result: ClassificationResult = {
    score,
    label: score >= HIGH_THRESHOLD ? 'high' : score >= WARN_THRESHOLD ? 'medium' : 'low'
  };

  cache.set(videoId, result);
  return result;
}

runtime.onMessage.addListener((msg: ClassifyVideoMessage) => {
  if (msg.type !== 'CLASSIFY_VIDEO') return undefined;

  if (!msg.videoId || !msg.title) {
    return undefined;
  }

  return Promise.resolve(classifyVideo(msg.videoId, msg.title));
});
