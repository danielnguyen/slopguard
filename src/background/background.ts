const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const runtime = extensionApi.runtime;
const storage = extensionApi.storage;

console.log('SlopGuard background loaded');

const DEFAULT_WARN_THRESHOLD = 20;
const DEFAULT_HIGH_THRESHOLD = 40;
const DEFAULT_OPENAI_GATE_THRESHOLD = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Provider = 'heuristic' | 'openai';

type SlopGuardSettings = {
  enabled: boolean;
  provider: Provider;
  warnThreshold: number;
  highThreshold: number;
  openaiGateThreshold: number;
  openaiApiKey?: string;
  openaiModel: string;
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
};

type ClassifyVideoMessage = {
  type: 'CLASSIFY_VIDEO';
  videoId?: string;
  title?: string;
};

const memoryCache = new Map<string, CacheEntry>();

function getDefaultSettings(): SlopGuardSettings {
  return {
    enabled: true,
    provider: 'heuristic',
    warnThreshold: DEFAULT_WARN_THRESHOLD,
    highThreshold: DEFAULT_HIGH_THRESHOLD,
    openaiGateThreshold: DEFAULT_OPENAI_GATE_THRESHOLD,
    openaiModel: 'gpt-4.1-mini'
  };
}

function storageGet(keys: string[] | Record<string, unknown>): Promise<Record<string, any>> {
  return new Promise((resolve) => storage.local.get(keys, resolve));
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => storage.local.set(values, resolve));
}

async function getSettings(): Promise<SlopGuardSettings> {
  const defaults = getDefaultSettings();
  const stored = await storageGet({ slopguardSettings: defaults, openaiApiKey: '' });
  const settings = {
    ...defaults,
    ...(stored.slopguardSettings || {})
  };

  // Backwards compatibility with the original options page key.
  if (!settings.openaiApiKey && stored.openaiApiKey) {
    settings.openaiApiKey = stored.openaiApiKey;
  }

  return settings;
}

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

function labelForScore(score: number, settings: SlopGuardSettings): 'low' | 'medium' | 'high' {
  if (score >= settings.highThreshold) return 'high';
  if (score >= settings.warnThreshold) return 'medium';
  return 'low';
}

async function getCachedResult(videoId: string): Promise<CacheEntry | null> {
  if (memoryCache.has(videoId)) {
    const entry = memoryCache.get(videoId)!;
    if (Date.now() - entry.analyzedAt < CACHE_TTL_MS) return entry;
  }

  const stored = await storageGet([`slopguardCache:${videoId}`]);
  const entry = stored[`slopguardCache:${videoId}`] as CacheEntry | undefined;

  if (!entry) return null;
  if (Date.now() - entry.analyzedAt >= CACHE_TTL_MS) return null;

  memoryCache.set(videoId, entry);
  return entry;
}

async function setCachedResult(videoId: string, title: string, result: ClassificationResult): Promise<CacheEntry> {
  const entry: CacheEntry = {
    ...result,
    videoId,
    title
  };

  memoryCache.set(videoId, entry);
  await storageSet({ [`slopguardCache:${videoId}`]: entry });
  return entry;
}

function heuristicClassification(title: string, settings: SlopGuardSettings): ClassificationResult {
  const score = heuristicScore(title);
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

async function openAIClassification(title: string, settings: SlopGuardSettings): Promise<ClassificationResult> {
  if (!settings.openaiApiKey) {
    return heuristicClassification(title, settings);
  }

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
            'You classify YouTube video metadata for low-transparency, engagement-driven content patterns. Return JSON only. Do not judge political alignment. Focus on sourcing, framing, sensationalism, and speculative narrative patterns.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            title,
            task: 'Return JSON with slop_score 0-100, labels string array, and explanation <= 20 words.'
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

async function classifyVideo(videoId: string, title: string): Promise<ClassificationResult> {
  const settings = await getSettings();

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

  const cached = await getCachedResult(videoId);
  if (cached) {
    return {
      ...cached,
      source: 'cache'
    };
  }

  const heuristic = heuristicClassification(title, settings);

  let result = heuristic;
  if (settings.provider === 'openai' && heuristic.score >= settings.openaiGateThreshold && settings.openaiApiKey) {
    try {
      result = await openAIClassification(title, settings);
    } catch (error) {
      console.warn('SlopGuard OpenAI classification failed; falling back to heuristic.', error);
      result = {
        ...heuristic,
        explanation: 'OpenAI failed; used heuristic fallback.'
      };
    }
  }

  return setCachedResult(videoId, title, result);
}

runtime.onMessage.addListener((msg: ClassifyVideoMessage) => {
  if (msg.type !== 'CLASSIFY_VIDEO') return undefined;

  if (!msg.videoId || !msg.title) {
    return undefined;
  }

  return classifyVideo(msg.videoId, msg.title);
});
