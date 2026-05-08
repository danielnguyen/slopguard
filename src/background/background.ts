const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const runtime = extensionApi.runtime;
const storage = extensionApi.storage;
const tabs = extensionApi.tabs;

console.log('ContextChecker background loaded');

const DEFAULT_WARN_THRESHOLD = 20;
const DEFAULT_HIGH_THRESHOLD = 40;
const DEFAULT_OPENAI_GATE_THRESHOLD = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 11;
const OPENAI_CALL_WINDOW_MS = 60 * 1000;
const MAX_OPENAI_CALLS_PER_WINDOW = 20;
const OPENAI_INITIAL_BURST = 5;
const OPENAI_QUEUE_INTERVAL_MS = 3500;

type Provider = 'heuristic' | 'openai';
type ResultSource = 'heuristic' | 'openai' | 'cache' | 'local_throttled' | 'local_error_fallback';
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
  source: ResultSource;
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
  openaiQueued: number;
  openaiUpgrades: number;
  openaiThrottled: number;
};

type EligibilitySignal = {
  id: string;
  weight: number;
  terms: string[];
};

type EligibilityResult = {
  category: ContentCategory;
  score: number;
  labels: string[];
  currentAffairsScore: number;
  attentionFramingScore: number;
};

type QueueSubscriber = {
  tabId: number;
};

type QueuedReview = {
  metadata: VideoMetadata;
  cacheKey: string;
  priority: number;
  enqueuedAt: number;
  subscribers: QueueSubscriber[];
};

const memoryCache = new Map<string, CacheEntry>();
const pendingOpenAIReviews = new Map<string, QueuedReview>();
const openaiCallTimestamps: number[] = [];
const stats: Stats = {
  classified: 0,
  cacheHits: 0,
  heuristicResults: 0,
  openaiCalls: 0,
  openaiFailures: 0,
  openaiQueued: 0,
  openaiUpgrades: 0,
  openaiThrottled: 0
};

const CURRENT_AFFAIRS_SIGNALS: EligibilitySignal[] = [
  {
    id: 'government_and_politics',
    weight: 10,
    terms: ['government', 'minister', 'parliament', 'election', 'policy', 'regulation', 'ottawa', 'washington']
  },
  {
    id: 'public_figures',
    weight: 10,
    terms: ['carney', 'trump', 'biden', 'poilievre']
  },
  {
    id: 'canada_and_regions',
    weight: 10,
    terms: ['canada', 'canadian', 'alberta', 'quebec', 'ontario', 'border', 'ambassador bridge']
  },
  {
    id: 'geopolitics_and_security',
    weight: 10,
    terms: ['nato', 'military', 'defence', 'defense', 'fighter', 'gripen', 'f-35', 'war', 'russia', 'ukraine', 'china']
  },
  {
    id: 'economy_and_trade',
    weight: 10,
    terms: ['economy', 'trade', 'tariff', 'supply chain', 'monopoly', 'market', 'inflation']
  },
  {
    id: 'public_health',
    weight: 10,
    terms: ['hantavirus', 'outbreak', 'public health', 'pandemic', 'virus', 'health officials']
  },
  {
    id: 'news_context',
    weight: 10,
    terms: ['pressroom', 'news', 'cbc', 'ctv', 'global news', 'reuters', 'ap news', 'associated press']
  }
];

const ATTENTION_FRAMING_SIGNALS: EligibilitySignal[] = [
  {
    id: 'urgency',
    weight: 10,
    terms: ['breaking', '1min ago', '1 min ago', '3min ago', '3 min ago', 'just in']
  },
  {
    id: 'revelation_or_exposure',
    weight: 10,
    terms: ['exposed', 'secret', 'leaked', 'revealed', 'caught', 'hidden']
  },
  {
    id: 'dramatic_outcome',
    weight: 10,
    terms: ['collapse', 'ends', 'loses', 'battle', 'panic', 'betrayed', 'karma']
  },
  {
    id: 'superlative_claim',
    weight: 10,
    terms: ['massive', 'unstoppable', 'changes everything', 'world\'s best', 'never seen before']
  },
  {
    id: 'conflict_or_threat',
    weight: 10,
    terms: ['invading', 'invasion', 'threat', 'war begins', 'retaliates', 'demands']
  }
];

const CREATOR_DRAMA_TERMS = [
  'downfall', 'controversy', 'drama', 'scammer', 'scumbag', 'influencer', 'creator',
  'reaction', 'responds', 'called out', 'boss stole', 'cheating', 'financial audit'
];

const ENTERTAINMENT_TERMS = ['movie', 'music', 'song', 'gaming', 'roblox', 'hockey', 'podcast', 'comedy', 'shorts'];

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

  return `contextCheckerCache:v${CACHE_VERSION}:${providerPart}:warn${settings.warnThreshold}:high${settings.highThreshold}:${videoId}`;
}

function pruneOpenAIWindow(now = Date.now()): void {
  while (openaiCallTimestamps.length > 0 && now - openaiCallTimestamps[0] > OPENAI_CALL_WINDOW_MS) {
    openaiCallTimestamps.shift();
  }
}

function canCallOpenAI(): boolean {
  const now = Date.now();
  pruneOpenAIWindow(now);

  if (openaiCallTimestamps.length >= MAX_OPENAI_CALLS_PER_WINDOW) {
    return false;
  }

  const recentBurstCalls = openaiCallTimestamps.filter((timestamp) => now - timestamp < OPENAI_QUEUE_INTERVAL_MS).length;
  if (openaiCallTimestamps.length >= OPENAI_INITIAL_BURST && recentBurstCalls > 0) {
    return false;
  }

  openaiCallTimestamps.push(now);
  return true;
}

function combinedText(metadata: VideoMetadata): string {
  return `${metadata.title} ${metadata.channel || ''} ${metadata.snippet || ''}`.toLowerCase();
}

function hasTerm(text: string, term: string): boolean {
  return text.includes(term.toLowerCase());
}

function scoreSignals(text: string, signals: EligibilitySignal[]): { score: number; labels: string[] } {
  const labels: string[] = [];
  let score = 0;

  for (const signal of signals) {
    if (signal.terms.some((term) => hasTerm(text, term))) {
      score += signal.weight;
      labels.push(signal.id);
    }
  }

  return { score, labels };
}

function getEligibility(metadata: VideoMetadata): EligibilityResult {
  if (metadata.isSponsored) {
    return {
      category: 'ad_placement',
      score: 0,
      labels: ['sponsored_placement'],
      currentAffairsScore: 0,
      attentionFramingScore: 0
    };
  }

  const text = combinedText(metadata);
  const currentAffairs = scoreSignals(text, CURRENT_AFFAIRS_SIGNALS);
  const attentionFraming = scoreSignals(text, ATTENTION_FRAMING_SIGNALS);

  if (currentAffairs.score > 0) {
    return {
      category: 'political_current_affairs',
      score: Math.min(100, currentAffairs.score + attentionFraming.score),
      labels: [...currentAffairs.labels, ...attentionFraming.labels],
      currentAffairsScore: currentAffairs.score,
      attentionFramingScore: attentionFraming.score
    };
  }

  if (CREATOR_DRAMA_TERMS.some((term) => hasTerm(text, term))) {
    return {
      category: 'creator_drama',
      score: 0,
      labels: ['creator_drama_context'],
      currentAffairsScore: 0,
      attentionFramingScore: attentionFraming.score
    };
  }

  if (ENTERTAINMENT_TERMS.some((term) => hasTerm(text, term))) {
    return {
      category: 'entertainment',
      score: 0,
      labels: ['entertainment_context'],
      currentAffairsScore: 0,
      attentionFramingScore: attentionFraming.score
    };
  }

  return {
    category: 'unknown',
    score: 0,
    labels: [],
    currentAffairsScore: 0,
    attentionFramingScore: attentionFraming.score
  };
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

function shouldPersistResult(result: ClassificationResult): boolean {
  return result.source !== 'local_throttled' && result.source !== 'local_error_fallback';
}

async function clearCache(): Promise<{ removed: number }> {
  memoryCache.clear();
  pendingOpenAIReviews.clear();
  const all = await storageGet(null);
  const keys = Object.keys(all).filter((key) => key.startsWith('slopguardCache:') || key.startsWith('contextCheckerCache:'));
  if (keys.length > 0) await storageRemove(keys);
  return { removed: keys.length };
}

function heuristicClassification(metadata: VideoMetadata, settings: SlopGuardSettings): ClassificationResult {
  const eligibility = getEligibility(metadata);

  return {
    score: eligibility.score,
    label: labelForScore(eligibility.score, settings),
    source: 'heuristic',
    category: eligibility.category,
    explanation:
      eligibility.category === 'political_current_affairs'
        ? `Eligibility gate: current-affairs ${eligibility.currentAffairsScore}, attention-framing ${eligibility.attentionFramingScore}.`
        : `Categorized as ${eligibility.category}; source-risk scoring skipped.`,
    labels: eligibility.labels,
    analyzedAt: Date.now()
  };
}

function markLocalFallback(result: ClassificationResult, source: 'local_throttled' | 'local_error_fallback', explanation: string): ClassificationResult {
  const labels = new Set(result.labels || []);
  labels.add(source);

  return {
    ...result,
    source,
    explanation,
    labels: Array.from(labels)
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

async function performOpenAIClassification(metadata: VideoMetadata, settings: SlopGuardSettings, category: ContentCategory): Promise<ClassificationResult> {
  if (!settings.openaiApiKey) {
    return heuristicClassification(metadata, settings);
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

async function openAIClassification(metadata: VideoMetadata, settings: SlopGuardSettings, category: ContentCategory): Promise<ClassificationResult> {
  if (!settings.openaiApiKey) {
    return heuristicClassification(metadata, settings);
  }

  if (!canCallOpenAI()) {
    stats.openaiThrottled += 1;
    return markLocalFallback(
      heuristicClassification(metadata, settings),
      'local_throttled',
      'AI review was queued; local eligibility check shown for now.'
    );
  }

  return performOpenAIClassification(metadata, settings, category);
}

function sendClassificationUpdate(review: QueuedReview, result: ClassificationResult): void {
  if (!tabs?.sendMessage) return;

  const seenTabs = new Set<number>();
  for (const subscriber of review.subscribers) {
    if (seenTabs.has(subscriber.tabId)) continue;
    seenTabs.add(subscriber.tabId);

    try {
      const maybePromise = tabs.sendMessage(subscriber.tabId, {
        type: 'CLASSIFICATION_UPDATED',
        videoId: review.metadata.videoId,
        result
      });

      if (maybePromise?.catch) {
        maybePromise.catch(() => undefined);
      }
    } catch {
      // The tab may have navigated away or closed. Safe to ignore.
    }
  }
}

function enqueueOpenAIReview(metadata: VideoMetadata, cacheKey: string, priority: number, sender: any): void {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return;

  const existing = pendingOpenAIReviews.get(metadata.videoId);
  const subscriber = { tabId };

  if (existing) {
    if (!existing.subscribers.some((item) => item.tabId === tabId)) {
      existing.subscribers.push(subscriber);
    }
    existing.priority = Math.max(existing.priority, priority);
    return;
  }

  pendingOpenAIReviews.set(metadata.videoId, {
    metadata,
    cacheKey,
    priority,
    enqueuedAt: Date.now(),
    subscribers: [subscriber]
  });
  stats.openaiQueued += 1;
}

function getNextQueuedReview(): QueuedReview | null {
  const queued = Array.from(pendingOpenAIReviews.values());
  if (queued.length === 0) return null;

  queued.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.enqueuedAt - b.enqueuedAt;
  });

  return queued[0];
}

async function processOpenAIQueue(): Promise<void> {
  const review = getNextQueuedReview();
  if (!review) return;
  if (!canCallOpenAI()) return;

  const settings = await getSettings();
  if (!settings.enabled || settings.provider !== 'openai' || !settings.openaiApiKey) return;

  pendingOpenAIReviews.delete(review.metadata.videoId);

  try {
    const result = await performOpenAIClassification(review.metadata, settings, 'political_current_affairs');
    const cached = await setCachedResult(review.cacheKey, review.metadata, result);
    stats.openaiUpgrades += 1;
    sendClassificationUpdate(review, cached);
  } catch (error) {
    stats.openaiFailures += 1;
    console.warn('ContextChecker queued OpenAI classification failed.', error);
    const fallback = markLocalFallback(
      heuristicClassification(review.metadata, settings),
      'local_error_fallback',
      'Queued AI review failed; local eligibility check shown.'
    );
    sendClassificationUpdate(review, fallback);
  }
}

async function classifyVideo(metadata: VideoMetadata, sender?: any): Promise<ClassificationResult> {
  const settings = await getSettings();
  stats.classified += 1;

  if (!settings.enabled) {
    return {
      score: 0,
      label: 'low',
      source: 'heuristic',
      category: 'unknown',
      explanation: 'ContextChecker is disabled.',
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
      if (result.source === 'local_throttled') {
        enqueueOpenAIReview(metadata, cacheKey, heuristic.score, sender);
      }
    } catch (error) {
      stats.openaiFailures += 1;
      console.warn('ContextChecker OpenAI classification failed; falling back to local eligibility.', error);
      result = markLocalFallback(
        heuristic,
        'local_error_fallback',
        'AI review failed; used local eligibility check only.'
      );
    }
  }

  debugLog(settings, 'ContextChecker classified', { metadata, result });

  if (!shouldPersistResult(result)) {
    return result;
  }

  return setCachedResult(cacheKey, metadata, result);
}

setInterval(() => {
  processOpenAIQueue().catch((error) => {
    stats.openaiFailures += 1;
    console.warn('ContextChecker queue processing failed.', error);
  });
}, OPENAI_QUEUE_INTERVAL_MS);

runtime.onMessage.addListener((msg: SlopGuardMessage, sender: any) => {
  if (msg.type === 'GET_STATS') {
    return Promise.resolve({ ...stats, memoryCacheSize: memoryCache.size, pendingOpenAIReviews: pendingOpenAIReviews.size });
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
  }, sender);
});
