// lib/rate-limiter.ts

export type ProviderType = 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';

interface ProviderPacing {
  currentDelay: number;
  minDelay: number;
  maxDelay: number;
  lastCallTime: number;
  consecutiveSuccesses: number;
}

const DEFAULT_PACING: Record<ProviderType, Omit<ProviderPacing, 'lastCallTime' | 'consecutiveSuccesses'>> = {
  anthropic:            { currentDelay: 0,    minDelay: 0,   maxDelay: 60_000 },
  ollama:               { currentDelay: 0,    minDelay: 0,   maxDelay: 5_000 },
  gemini:               { currentDelay: 2000, minDelay: 500, maxDelay: 120_000 },
  'openai-compatible':  { currentDelay: 1000, minDelay: 200, maxDelay: 120_000 },
};

const pacing = new Map<ProviderType, ProviderPacing>();

function getPacing(provider: ProviderType): ProviderPacing {
  let p = pacing.get(provider);
  if (!p) {
    const defaults = DEFAULT_PACING[provider] ?? DEFAULT_PACING['openai-compatible'];
    p = { ...defaults, lastCallTime: 0, consecutiveSuccesses: 0 };
    pacing.set(provider, p);
  }
  return p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait if needed before making a call. Returns ms actually waited. */
export async function waitIfNeeded(provider: ProviderType): Promise<number> {
  const p = getPacing(provider);
  const elapsed = Date.now() - p.lastCallTime;
  const wait = Math.max(0, p.currentDelay - elapsed);
  if (wait > 0) await sleep(wait);
  p.lastCallTime = Date.now();
  return wait;
}

/** Record a successful call. Gradually reduces delay after consecutive successes. */
export function recordSuccess(provider: ProviderType): void {
  const p = getPacing(provider);
  p.consecutiveSuccesses++;
  if (p.consecutiveSuccesses >= 5) {
    p.currentDelay = Math.max(p.minDelay, Math.floor(p.currentDelay * 0.75));
    p.consecutiveSuccesses = 0;
  }
}

/** Record a rate limit (429). Returns ms to wait before retry. */
export function recordRateLimit(provider: ProviderType, retryAfterMs?: number): number {
  const p = getPacing(provider);
  const backoff = retryAfterMs ?? Math.max(p.currentDelay * 2, 1000);
  p.currentDelay = Math.min(p.maxDelay, Math.max(p.currentDelay * 2, backoff));
  p.consecutiveSuccesses = 0;
  return p.currentDelay;
}

/** Parse Retry-After header value (seconds) to milliseconds. */
export function parseRetryAfter(headers?: Headers | { get(name: string): string | null }): number | undefined {
  const val = headers?.get?.('retry-after');
  if (!val) return undefined;
  const secs = parseFloat(val);
  return isNaN(secs) ? undefined : Math.ceil(secs * 1000);
}
