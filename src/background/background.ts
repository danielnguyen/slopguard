const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const runtime = extensionApi.runtime;
const storage = extensionApi.storage;

console.log('SlopGuard background loaded');

const DEFAULT_WARN_THRESHOLD = 20;
const DEFAULT_HIGH_THRESHOLD = 40;
const DEFAULT_OPENAI_GATE_THRESHOLD = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 7;
const OPENAI_CALL_WINDOW_MS = 60 * 1000;
const MAX_OPENAI_CALLS_PER_WINDOW = 10;

type Provider = 'heuristic' | 'openai';
type ContentCategory = 'political_current_affairs' | 'creator_drama' | 'entertainment' | 'ad_placement' | 'unknown';

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
  isSponsored?: boolean;
};

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
  source: 'heuristic' | 'openai' | 'cache';
  category: ContentCategory;
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

function combinedText(metadata: VideoMetadata): string {
  return `${metadata.title} ${metadata.channel || ''} ${metadata.snippet || ''}`.toLowerCase();
}

function categorize(metadata: VideoMetadata): ContentCategory {
  if (metadata.isSponsored) return 'ad_placement';

  const text = combinedText(metadata);

  const currentAffairsSignals = [
    'canada', 'canadian', 'carney', 'trump', 'biden', 'poilievre', 'alberta', 'ottawa', 'government',
    'election', 'minister', 'parliament', 'tariff', 'nato', 'military', 'defence', 'defense', 'fighter',
    'gripen', 'f-35', 'war', 'russia', 'ukraine', 'china', 'india', 'immigration', 'economy', 'trade',
    'hantavirus', 'outbreak', 'public health', 'pressroom', 'news', 'cbc', 'ctv', 'global news', 'reuters',
    'ap news', 'associated press'
  ];

  if (currentAffairsSignals.some((signal) => text.includes(signal))) {
    return 'political_current_affairs';
  }

  const creatorDramaSignals = [
    'downfall', 'controversy', 'drama', 'exposed', 'scammer', 'scumbag', 'influencer', 'creator',
    'reaction', 'responds', 'called out', 'boss stole', 'cheating', 'financial audit'
  ];

  if (creatorDramaSignals.some((signal) => text.includes(signal))) {
    return 'creator_drama';
  }

  const entertainmentSignals = ['movie', 'music', 'song', 'gaming', 'roblox', 'hockey', 'podcast', 'comedy', 'shorts'];
  if (entertainmentSignals.some((signal) => text.includes(signal))) {
    return 'entertainment';
  }

  return 'unknown';
}

function heuristicRiskScore(metadata: VideoMetadata, category: ContentCategory): number {
  if (category !== 'political_current_affairs') return 0;

  let score = 0;
  const lower = combinedText(metadata);

  if (lower.includes('exposed') || lower.includes('shocking')) score += 20;
  if (lower.includes('breaking') || lower.includes('1min ago') || lower.includes('1 min ago') || lower.includes('3min ago') || lower.includes('3 min ago')) score += 20;
  if (lower.includes('war') || lower.includes('military') || lower.includes('defence') || lower.includes('defense')) score += 10;
  if (lower.includes('invading') || lower.includes('invasion')) score += 10;
  if (lower.includes('ukraine') || lower.includes('russia') || lower.includes('china')) score += 10;
  if (lower.includes('jtf2') || lower.includes('special forces') || lower.includes('green beret')) score += 20;
  if (lower.includes('trump') || lower.includes('carney') || lower.includes('poilievre')) score += 10;
  if (lower.includes('collapse') || lower.includes('betrayed') || lower.includes('karma') || lower.includes('panic')) score += 15;
  if (lower.includes('secret') || lower.includes('secret tests') || lower.includes('unstoppable') || lower.includes('massive') || lower.includes('changes everything')) score += 20;
  if (lower.includes('world') && lower.includes('best')) score += 15;
  if (/[!]{3,}/.test(metadata.title)) score += 10;

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
  const category = categorize(metadata);
  const score = heuristicRiskScore(metadata, category);

  return {
    score,
    label: labelForScore(score, settings),
    source: 'heuristic',
    category,
    explanation:
      category === 'political_current_affairs'
        ? score > 0
          ? 'Matched current-affairs source-transparency signals.'
          : 'No current-affairs source-transparency signals matched.'
        : `Categorized as ${category}; source-risk scoring skipped.`,
    labels: metadata.isSponsored ? ['sponsored_placement'] : [],
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

async function openAIClassification(metadata: VideoMetadata, settings: SlopGuardSettings, category: ContentCategory): Promise<ClassificationResult> {
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
            'You classify YouTube metadata for current-affairs source-transparency risk. Return JSON only. Do not judge political alignment or whether the viewpoint is correct. Only score political/current-affairs/geopolitical/public-health/economic content. Creator drama, entertainment, personal commentary, comedy, gaming, music, and general influencer content should usually score 0 unless it makes current-affairs claims. Penalize low-transparency current-affairs patterns: synthetic-news style, faceless narrative farming, fabricated-sounding claims, vague attribution, AI-politician thumbnails implied by metadata, urgent geopolitical claims, or sensational policy/war/election framing without clear sourcing. Reward named news outlets, clear original reporting, primary sources, and transparent creator context.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            category,
            metadata,
            task: 'Return JSON with slop_score 0-100, category, labels string array, and explanation <= 20 words. Use diplomatic labels like source_transparency_risk, sensational_framing, vague_attribution, synthetic_news_style, named_news_outlet, original_reporting, commentary_context, sponsored_placement.'
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
  const parsed = parseOpenAIJson(outputText) as any;
  const score = Math.max(0, Math.min(100, Number(parsed.slop_score ?? parsed.score ?? 0)));
  const labels = Array.isArray(parsed.labels) ? parsed.labels.map(String) : [];

  if (metadata.isSponsored && !labels.includes('sponsored_placement')) {
    labels.push('sponsored_placement');
  }

  return {
    score,
    label: labelForScore(score, settings),
    source: 'openai',
    category: parsed.category || category,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : 'OpenAI classification completed.',
    labels,
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
      category: 'unknown',
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
  if (
    settings.provider === 'openai' &&
    heuristic.category === 'political_current_affairs' &&
    heuristic.score >= settings.openaiGateThreshold &&
    settings.openaiApiKey
  ) {
    try {
      result = await openAIClassification(metadata, settings, heuristic.category);
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
    pageUrl: msg.pageUrl,
    isSponsored: msg.isSponsored
  });
});
