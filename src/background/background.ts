const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const runtime = extensionApi.runtime;
const storage = extensionApi.storage;

console.log('SlopGuard background loaded');

const DEFAULT_WARN_THRESHOLD = 20;
const DEFAULT_HIGH_THRESHOLD = 40;
const DEFAULT_OPENAI_GATE_THRESHOLD = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 4;
const OPENAI_CALL_WINDOW_MS = 60 * 1000;
const MAX_OPENAI_CALLS_PER_WINDOW = 10;

type Provider = 'heuristic' | 'openai';

type SlopGuardSettings = {
  enabled: boolean;
  provider: Provider;
  warnThreshold: number;
  highThreshold: number;
  openaiGateThreshold: number;
  openaiApiKey?: string;
  openaiModel: string;
  debugLogging: boolean;
};

type VideoMetadata = {
  videoId: string;
  title: string;
  channel?: string;
  snippet?: string;
  pageUrl?: string;
};

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
  source: 'heuristic' | 'openai' | 'cache';
  explanation?: string;
  labels?: string[];
  analyzedAt: number;
};

type CacheEntry = ClassificationResult & {
  videoId: string;
  title: string;
  cacheKey: string;
  cacheVersion: number;
};

type ClassifyVideoMessage = VideoMetadata & {
  type: 'CLASSIFY_VIDEO';
};

type SlopGuardMessage =
  | ClassifyVideoMessage
  | { type: 'GET_STATS' }
  | { type: 'CLEAR_CACHE' };

type Stats = {
  classified: number;
  cacheHits: number;
  heuristicResults: number;
  openaiCalls: number;
  openaiFailures: number;
  openaiThrottled: number;
};

const memoryCache = new Map<string, CacheEntry>();
const openaiCallTimestamps: number[] = [];
const stats: Stats = {
  classified: 0,
  cacheHits: 0,
  heuristicResults: 0,
  openaiCalls: 0,
  openaiFailures: 0,
  openaiThrottled: 0
};

function getDefaultSettings(): SlopGuardSettings {
  return {
    enabled: true,
    provider: 'heuristic',
    warnThreshold: DEFAULT_WARN_THRESHOLD,
    highThreshold: DEFAULT_HIGH_THRESHOLD,
    openaiGateThreshold: DEFAULT_OPENAI_GATE_THRESHOLD,
    openaiModel: 'gpt-4.1-mini',
    debugLogging: true
  };
}

function storageGet(keys: string[] | Record<string, unknown> | null): Promise<Record<string, any>> {
  return new Promise((resolve) => storage.local.get(keys, resolve));
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => storage.local.set(values, resolve));
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve) => storage.local.remove(keys, resolve));
}

async function getSettings(): Promise<SlopGuardSettings> {
  const defaults = getDefaultSettings();
  const stored = await storageGet({ slopguardSettings: defaults, openaiApiKey: '' });
  const settings = {
    ...defaults,
    ...(stored.slopguardSettings || {})
  };

  if (!settings.openaiApiKey && stored.openaiApiKey) {
    settings.openaiApiKey = stored.openaiApiKey;
  }

  return settings;
}

function debugLog(settings: SlopGuardSettings, ...args: unknown[]): void {
  if (settings.debugLogging) console.log(...args);
}

function getCacheKey(videoId: string, settings: SlopGuardSettings): string {
  const providerPart = settings.provider === 'openai'
    ? `openai:${settings.openaiModel}:gate${settings.openaiGateThreshold}`
    : 'heuristic';

  return `slopguardCache:v${CACHE_VERSION}:${providerPart}:warn${settings.warnThreshold}:high${settings.highThreshold}:${videoId}`;
}

function canCallOpenAI(): boolean {
  const now = Date.now();

  while (openaiCallTimestamps.length > 0 && now - openaiCallTimestamps[0] > OPENAI_CALL_WINDOW_MS) {
    openaiCallTimestamps.shift();
  }

  if (openaiCallTimestamps.length >= MAX_OPENAI_CALLS_PER_WINDOW) {
    return false;
  }

  openaiCallTimestamps.push(now);
  return true;
}

function heuristicScore(title: string): number {
  let score = 0;
  const lower = title.toLowerCase();

  if (lower.includes('exposed') || lower.includes('shocking')) score += 20;
  if (lower.includes('breaking') || lower.includes('1min ago') || lower.includes('1 min ago')) score += 15;
  if (lower.includes('war') || lower.includes('military')) score += 10;
  if (lower.includes('invading') || lower.includes('invasion')) score += 10;
  if (lower.includes('ukraine') || lower.includes('russia')) score += 10;
  if (lower.includes('jtf2') || lower.includes('special forces') || lower.includes('green beret')) score += 20;
  if (lower.includes('trump')) score += 10;
  if (lower.includes('collapse') || lower.includes('betrayed') || lower.includes('karma') || lower.includes('panic')) score += 15;
  if (lower.includes('world') && lower.includes('best')) score += 15;
  if (/[!]{3,}/.test(title)) score += 10;

  return Math.min(score, 100);
}

function labelForScore(score: number, settings: SlopGuardSettings): 'low' | 'medium' | 'high' {
  if (score >= settings.highThreshold) return 'high';
  if (score >= settings.warnThreshold) return 'medium';
  return 'low';
}

async function getCachedResult(cacheKey: string): Promise<CacheEntry | null> {
  if (memoryCache.has(cacheKey)) {
    const entry = memoryCache.get(cacheKey)!;
    if (Date.now() - entry.analyzedAt < CACHE_TTL_MS) return entry;
  }

  const stored = await storageGet([cacheKey]);
  const entry = stored[cacheKey] as CacheEntry | undefined;

  if (!entry) return null;
  if (entry.cacheVersion !== CACHE_VERSION) return null;
  if (Date.now() - entry.analyzedAt >= CACHE_TTL_MS) return null;

  memoryCache.set(cacheKey, entry);
  return entry;
}

async function setCachedResult(cacheKey: string, metadata: VideoMetadata, result: ClassificationResult): Promise<CacheEntry> {
  const entry: CacheEntry = {
    ...result,
    videoId: metadata.videoId,
    title: metadata.title,
    cacheKey,
    cacheVersion: CACHE_VERSION
  };

  memoryCache.set(cacheKey, entry);
  await storageSet({ [cacheKey]: entry });
  return entry;
}

async function clearCache(): Promise<{ removed: number }> {
  memoryCache.clear();
  const all = await storageGet(null);
  const keys = Object.keys(all).filter((key) => key.startsWith('slopguardCache:'));
  if (keys.length > 0) await storageRemove(keys);
  return { removed: keys.length };
}

function heuristicClassification(metadata: VideoMetadata, settings: SlopGuardSettings): ClassificationResult {
  const score = heuristicScore(metadata.title);
  return {
    score,
    label: labelForScore(score, settings),
    source: 'heuristic',
    explanation: score > 0 ? 'Matched lightweight slop-risk signals.' : 'No lightweight slop-risk signals matched.',
    labels: [],
    analyzedAt: Date.now()
  };
}

function parseOpenAIJson(text: string): Partial<ClassificationResult> {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('OpenAI response did not contain JSON.');
  }

  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
}

async function openAIClassification(metadata: VideoMetadata, settings: SlopGuardSettings): Promise<ClassificationResult> {
  if (!settings.openaiApiKey) {
    return heuristicClassification(metadata, settings);
  }

  if (!canCallOpenAI()) {
    stats.openaiThrottled += 1;
    const fallback = heuristicClassification(metadata, settings);
    return {
      ...fallback,
      explanation: 'OpenAI throttle reached; used heuristic fallback.'
    };
  }

  stats.openaiCalls += 1;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content:
            'You classify YouTube video metadata for low-transparency, engagement-driven slop patterns. Return JSON only. Do not judge political alignment. Important distinction: clickbait packaging is not automatically slop. Original creator content, interviews, documentaries, podcasts, and reporting from named news outlets can have sensational titles but should receive lower scores unless the metadata implies fabricated claims, weak sourcing, faceless narrative farming, synthetic news style, or speculative political/geopolitical manipulation. Penalize high-confidence claims with low visible accountability. Reward clear channel identity, named institutions, visible report snippets, interviews, or transparent creator context.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            metadata,
            task: 'Return JSON with slop_score 0-100, labels string array, and explanation <= 20 words. Include labels like clickbait_only, original_creator_context, named_news_outlet, sensationalism, speculative_narrative, weak_sourcing, synthetic_news_style, faceless_content_farm when applicable.'
          })
        }
      ],
      text: {
        format: {
          type: 'json_object'
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = await response.json();
  const outputText = data.output_text || data.output?.flatMap((item: any) => item.content || [])?.map((item: any) => item.text || '').join('') || '';
  const parsed = parseOpenAIJson(outputText);
  const score = Math.max(0, Math.min(100, Number((parsed as any).slop_score ?? parsed.score ?? 0)));

  return {
    score,
    label: labelForScore(score, settings),
    source: 'openai',
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : 'OpenAI classification completed.',
    labels: Array.isArray(parsed.labels) ? parsed.labels.map(String) : [],
    analyzedAt: Date.now()
  };
}

async function classifyVideo(metadata: VideoMetadata): Promise<ClassificationResult> {
  const settings = await getSettings();
  stats.classified += 1;

  if (!settings.enabled) {
    return {
      score: 0,
      label: 'low',
      source: 'heuristic',
      explanation: 'SlopGuard is disabled.',
      labels: [],
      analyzedAt: Date.now()
    };
  }

  const cacheKey = getCacheKey(metadata.videoId, settings);
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    stats.cacheHits += 1;
    return {
      ...cached,
      source: 'cache'
    };
  }

  const heuristic = heuristicClassification(metadata, settings);
  stats.heuristicResults += 1;

  let result = heuristic;
  if (settings.provider === 'openai' && heuristic.score >= settings.openaiGateThreshold && settings.openaiApiKey) {
    try {
      result = await openAIClassification(metadata, settings);
    } catch (error) {
      stats.openaiFailures += 1;
      console.warn('SlopGuard OpenAI classification failed; falling back to heuristic.', error);
      result = {
        ...heuristic,
        explanation: 'OpenAI failed; used heuristic fallback.'
      };
    }
  }

  debugLog(settings, 'SlopGuard classified', { metadata, result });
  return setCachedResult(cacheKey, metadata, result);
}

runtime.onMessage.addListener((msg: SlopGuardMessage) => {
  if (msg.type === 'GET_STATS') {
    return Promise.resolve({ ...stats, memoryCacheSize: memoryCache.size });
  }

  if (msg.type === 'CLEAR_CACHE') {
    return clearCache();
  }

  if (msg.type !== 'CLASSIFY_VIDEO') return undefined;

  if (!msg.videoId || !msg.title) {
    return undefined;
  }

  return classifyVideo({
    videoId: msg.videoId,
    title: msg.title,
    channel: msg.channel,
    snippet: msg.snippet,
    pageUrl: msg.pageUrl
  });
});
