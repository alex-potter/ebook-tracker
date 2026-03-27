# Free Cloud LLM Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini (free tier) and generic OpenAI-compatible providers with adaptive rate limiting, a unified LLM caller, and a guided setup prompt for zero-friction onboarding.

**Architecture:** New `lib/llm.ts` consolidates all provider-specific calling logic (Anthropic, Ollama, Gemini, OpenAI-compatible) behind a single `callLLM` function with built-in adaptive rate limiting from `lib/rate-limiter.ts`. All 6 API routes are refactored to use this unified caller. Settings UI expands to 4 provider tabs. A contextual setup prompt guides first-time users to a free Gemini API key.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Google Generative AI REST API, OpenAI-compatible chat completions API, `@anthropic-ai/sdk`, `undici`

**Spec:** `docs/superpowers/specs/2026-03-26-free-cloud-llm-design.md`

---

### Task 1: Create adaptive rate limiter (`lib/rate-limiter.ts`)

**Files:**
- Create: `lib/rate-limiter.ts`

This module has zero dependencies beyond standard JS. It works in both Node.js and browser environments.

- [ ] **Step 1: Create the rate limiter module**

```typescript
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
  const backoff = retryAfterMs ?? p.currentDelay * 2;
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add lib/rate-limiter.ts
git commit -m "feat: add adaptive rate limiter for free-tier API pacing"
```

---

### Task 2: Create unified LLM caller (`lib/llm.ts`)

**Files:**
- Create: `lib/llm.ts`

This is the core abstraction. It dispatches to 4 provider callers and integrates the rate limiter. The Anthropic and Ollama callers are based on the existing implementations in `app/api/analyze/route.ts:1214-1286` and `app/api/reconcile/route.ts:14-79`.

- [ ] **Step 1: Create the unified LLM module**

```typescript
// lib/llm.ts

import Anthropic from '@anthropic-ai/sdk';
import { Agent, fetch as undiciFetch } from 'undici';
import * as rateLimiter from './rate-limiter';
import type { ProviderType } from './rate-limiter';

export type { ProviderType };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMCallConfig {
  provider: ProviderType;
  model: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
  jsonMode?: boolean;
  temperature?: number;       // defaults to 0
  messages?: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }>;
  images?: Array<{ data: string; mimeType: string }>;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMResult {
  text: string;
  rateLimitWaitMs?: number;
}

export interface ResolveConfigOverrides {
  defaultAnthropicModel?: string;
  defaultOllamaModel?: string;
  defaultGeminiModel?: string;
  useVisionModel?: boolean;
}

// ─── Shared infrastructure ───────────────────────────────────────────────────

const ollamaAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const TIMEOUT_MS = 300_000; // 5 minutes for cloud providers

// Anthropic client cache — keyed by API key to avoid creating new clients per call
const anthropicClients = new Map<string, Anthropic>();
function getAnthropicClient(apiKey?: string): Anthropic {
  const key = apiKey ?? 'default';
  let client = anthropicClients.get(key);
  if (!client) {
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    anthropicClients.set(key, client);
  }
  return client;
}

// ─── Provider callers ────────────────────────────────────────────────────────

async function callAnthropicProvider(config: LLMCallConfig): Promise<string> {
  const client = getAnthropicClient(config.apiKey);
  const model = config.model || 'claude-haiku-4-5-20251001';
  let fullText = '';

  // Continuation loop: if the response hits max_tokens, prefill the assistant
  // turn with what we have so far and let the model continue where it left off.
  for (let pass = 0; pass < 5; pass++) {
    const messages: Anthropic.MessageParam[] = [];

    if (config.messages?.length) {
      // Multi-turn chat mode
      for (const m of config.messages) {
        messages.push({ role: m.role as 'user' | 'assistant', content: m.content as string });
      }
    } else if (config.images?.length) {
      // Vision mode
      const content: Anthropic.ContentBlockParam[] = config.images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: img.data },
      }));
      content.push({ type: 'text' as const, text: config.userPrompt });
      messages.push({ role: 'user', content });
    } else {
      // Standard single-turn
      messages.push({ role: 'user', content: config.userPrompt });
    }

    if (fullText) {
      messages.push({ role: 'assistant', content: fullText });
    }

    const response = await client.messages.create({
      model,
      max_tokens: config.maxTokens,
      temperature: config.temperature ?? 0,
      system: config.system || undefined,
      messages,
    });

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') break;
    fullText += block.text;

    if (response.stop_reason !== 'max_tokens') break;
    console.log(`[llm] Anthropic response hit max_tokens, continuing (pass ${pass + 1})…`);
  }

  if (!fullText) throw new Error('No text response from Anthropic.');
  return fullText;
}

async function callOllamaProvider(config: LLMCallConfig): Promise<string> {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  const model = config.model || 'qwen2.5:14b';

  const messages: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }> = [];

  if (config.messages?.length) {
    if (config.system) messages.push({ role: 'system', content: config.system });
    messages.push(...config.messages);
  } else if (config.images?.length) {
    const content: Array<{ type: string; [key: string]: unknown }> = config.images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    }));
    content.push({ type: 'text', text: config.userPrompt });
    messages.push({ role: 'user', content });
  } else {
    if (config.system) messages.push({ role: 'system', content: config.system });
    messages.push({ role: 'user', content: config.userPrompt });
  }

  const body: Record<string, unknown> = {
    model,
    temperature: config.temperature ?? 0,
    max_tokens: config.maxTokens,
    messages,
  };
  if (config.jsonMode) body.response_format = { type: 'json_object' };

  const res = await undiciFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    dispatcher: ollamaAgent,
    body: JSON.stringify(body),
  } as Parameters<typeof undiciFetch>[1]);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error (${res.status}): ${err}`);
  }

  const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content in Ollama response.');
  return text;
}

async function callGeminiProvider(config: LLMCallConfig): Promise<string> {
  if (!config.apiKey) throw new Error('Gemini API key not configured. Open Settings to add your key.');
  const model = config.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  if (config.images?.length) {
    for (const img of config.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: config.userPrompt });

  const contents: Array<{ role: string; parts: typeof parts }> = [];

  if (config.messages?.length) {
    // Multi-turn chat: map messages to Gemini format
    for (const m of config.messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
    }
  } else {
    contents.push({ role: 'user', parts });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: config.maxTokens,
      temperature: config.temperature ?? 0,
    },
  };

  if (config.system) {
    body.systemInstruction = { parts: [{ text: config.system }] };
  }
  if (config.jsonMode) {
    (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error (${res.status}): ${err}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text in Gemini response.');

  // Handle truncation: retry once with more tokens (no recursion — spec says "retry once")
  if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS' && !(config as { _retried?: boolean })._retried) {
    console.log('[llm] Gemini response truncated, retrying with more tokens…');
    const retryConfig = { ...config, maxTokens: Math.ceil(config.maxTokens * 1.5), _retried: true } as LLMCallConfig & { _retried: boolean };
    return callGeminiProvider(retryConfig);
  }

  return text;
}

async function callOpenAICompatibleProvider(config: LLMCallConfig): Promise<string> {
  if (!config.baseUrl) throw new Error('OpenAI-compatible base URL not configured. Open Settings.');
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = config.model;
  if (!model) throw new Error('No model specified for OpenAI-compatible provider. Open Settings to configure.');

  const messages: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }> = [];

  if (config.messages?.length) {
    if (config.system) messages.push({ role: 'system', content: config.system });
    messages.push(...config.messages);
  } else if (config.images?.length) {
    const content: Array<{ type: string; [key: string]: unknown }> = config.images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    }));
    content.push({ type: 'text', text: config.userPrompt });
    if (config.system) messages.push({ role: 'system', content: config.system });
    messages.push({ role: 'user', content });
  } else {
    if (config.system) messages.push({ role: 'system', content: config.system });
    messages.push({ role: 'user', content: config.userPrompt });
  }

  const body: Record<string, unknown> = {
    model,
    temperature: config.temperature ?? 0,
    max_tokens: config.maxTokens,
    messages,
  };
  if (config.jsonMode) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI-compatible error (${res.status}): ${err}`);
  }

  const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content in OpenAI-compatible response.');

  // Handle truncation: retry once (no recursion — spec says "retry once")
  if (data.choices?.[0]?.finish_reason === 'length' && !(config as { _retried?: boolean })._retried) {
    console.log('[llm] OpenAI-compatible response truncated, retrying with more tokens…');
    const retryConfig = { ...config, maxTokens: Math.ceil(config.maxTokens * 1.5), _retried: true } as LLMCallConfig & { _retried: boolean };
    return callOpenAICompatibleProvider(retryConfig);
  }

  return text;
}

// ─── Dispatch + rate limiting ────────────────────────────────────────────────

function dispatch(config: LLMCallConfig): Promise<string> {
  switch (config.provider) {
    case 'anthropic': return callAnthropicProvider(config);
    case 'ollama': return callOllamaProvider(config);
    case 'gemini': return callGeminiProvider(config);
    case 'openai-compatible': return callOpenAICompatibleProvider(config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

function isRateLimitError(err: unknown): err is Error & { status?: number; response?: { headers?: Headers } } {
  if (err instanceof Error) {
    if ('status' in err && (err as { status?: number }).status === 429) return true;
    if (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')) return true;
  }
  return false;
}

function extractHeaders(err: unknown): Headers | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { headers?: Headers } }).response;
    return resp?.headers;
  }
  return undefined;
}

export async function callLLM(config: LLMCallConfig): Promise<LLMResult> {
  const maxRetries = 3;
  let totalWaitMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const paceWait = await rateLimiter.waitIfNeeded(config.provider);
    totalWaitMs += paceWait;

    try {
      const text = await dispatch(config);
      rateLimiter.recordSuccess(config.provider);
      return { text, rateLimitWaitMs: totalWaitMs || undefined };
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        const retryAfterMs = rateLimiter.parseRetryAfter(extractHeaders(err));
        const waitMs = rateLimiter.recordRateLimit(config.provider, retryAfterMs);
        console.warn(`[llm] Rate limited by ${config.provider}, waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})…`);
        await new Promise((r) => setTimeout(r, waitMs));
        totalWaitMs += waitMs;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
}

// ─── Config resolution ───────────────────────────────────────────────────────

interface RequestBody {
  _provider?: string;
  _apiKey?: string;
  _ollamaUrl?: string;
  _model?: string;
  _geminiKey?: string;
  _openaiCompatibleUrl?: string;
  _openaiCompatibleKey?: string;
}

export function resolveConfig(body: RequestBody, overrides?: ResolveConfigOverrides): Omit<LLMCallConfig, 'system' | 'userPrompt' | 'maxTokens'> {
  const provider = (body._provider ?? 'ollama') as ProviderType;

  switch (provider) {
    case 'anthropic': {
      const serverKey = process.env.ANTHROPIC_API_KEY;
      return {
        provider,
        model: body._model ?? overrides?.defaultAnthropicModel ?? 'claude-haiku-4-5-20251001',
        apiKey: serverKey ?? body._apiKey,
      };
    }
    case 'ollama': {
      const serverConfigured = process.env.USE_LOCAL_MODEL === 'true';
      const useVision = overrides?.useVisionModel;
      const defaultModel = useVision
        ? (process.env.LOCAL_VISION_MODEL_NAME ?? 'qwen2.5vl:7b')
        : (overrides?.defaultOllamaModel ?? 'qwen2.5:14b');
      return {
        provider,
        model: (serverConfigured ? (useVision ? process.env.LOCAL_VISION_MODEL_NAME : process.env.LOCAL_MODEL_NAME) : body._model) ?? defaultModel,
        baseUrl: (serverConfigured ? process.env.LOCAL_MODEL_URL : body._ollamaUrl) ?? 'http://localhost:11434/v1',
      };
    }
    case 'gemini': {
      const serverKey = process.env.GEMINI_API_KEY;
      return {
        provider,
        model: body._model ?? overrides?.defaultGeminiModel ?? 'gemini-2.0-flash',
        apiKey: serverKey ?? body._geminiKey,
      };
    }
    case 'openai-compatible': {
      const serverUrl = process.env.OPENAI_COMPATIBLE_URL;
      const serverConfigured = !!serverUrl;
      return {
        provider,
        model: (serverConfigured ? process.env.OPENAI_COMPATIBLE_MODEL : body._model) ?? '',
        apiKey: (serverConfigured ? process.env.OPENAI_COMPATIBLE_KEY : body._openaiCompatibleKey) ?? '',
        baseUrl: serverUrl ?? body._openaiCompatibleUrl ?? '',
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add lib/llm.ts
git commit -m "feat: add unified LLM caller with Gemini and OpenAI-compatible support"
```

---

### Task 3: Expand AiSettings and client-side callers (`lib/ai-client.ts`)

**Files:**
- Modify: `lib/ai-client.ts:23-47` (AiSettings type, loadAiSettings, saveAiSettings)
- Modify: `lib/ai-client.ts:98-155` (callAnthropic, callOllama, callAi)
- Modify: `lib/ai-client.ts:166-224` (chatWithBook, testConnection)

This task expands the settings type and adds Gemini + OpenAI-compatible callers for mobile/direct-to-LLM mode. It also integrates the client-side rate limiter.

- [ ] **Step 1: Update AiSettings interface and defaults**

In `lib/ai-client.ts`, replace the `AiSettings` interface (line 23-28) and `loadAiSettings` defaults (line 37-42):

```typescript
export interface AiSettings {
  provider: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
  anthropicKey: string;
  ollamaUrl: string;
  model: string;
  geminiKey: string;
  openaiCompatibleUrl: string;
  openaiCompatibleKey: string;
  openaiCompatibleName: string;
}
```

Update `loadAiSettings` defaults to include new fields:

```typescript
export function loadAiSettings(): AiSettings {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure new fields have defaults for existing saved settings
      return {
        provider: parsed.provider ?? 'ollama',
        anthropicKey: parsed.anthropicKey ?? '',
        ollamaUrl: parsed.ollamaUrl ?? 'http://localhost:11434/v1',
        model: parsed.model ?? 'qwen2.5:14b',
        geminiKey: parsed.geminiKey ?? '',
        openaiCompatibleUrl: parsed.openaiCompatibleUrl ?? '',
        openaiCompatibleKey: parsed.openaiCompatibleKey ?? '',
        openaiCompatibleName: parsed.openaiCompatibleName ?? '',
      };
    }
  } catch { /* ignore */ }
  return {
    provider: 'ollama',
    anthropicKey: '',
    ollamaUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    geminiKey: '',
    openaiCompatibleUrl: '',
    openaiCompatibleKey: '',
    openaiCompatibleName: '',
  };
}
```

- [ ] **Step 2: Add Gemini and OpenAI-compatible client-side callers**

After the existing `callOllama` function (line 145), add two new callers:

```typescript
async function callGeminiClient(apiKey: string, model: string, system: string, userPrompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error (${res.status}): ${err}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text in Gemini response.');
  return text;
}

async function callOpenAICompatibleClient(baseUrl: string, apiKey: string, model: string, system: string, userPrompt: string): Promise<string> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: userPrompt });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, max_tokens: 8192, temperature: 0, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${model} error (${res.status}): ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content in response.');
  return text;
}
```

- [ ] **Step 3: Update callAi to support all 4 providers with client-side rate limiting**

Replace the existing `callAi` function (line 147-155). Import the rate limiter and wrap each call with pacing:

```typescript
import { waitIfNeeded, recordSuccess, recordRateLimit } from './rate-limiter';
import type { ProviderType } from './rate-limiter';

async function callAi(settings: AiSettings, userPrompt: string): Promise<string> {
  const provider = settings.provider as ProviderType;
  await waitIfNeeded(provider);
  try {
    let result: string;
    switch (settings.provider) {
      case 'anthropic':
        if (!settings.anthropicKey) throw new Error('Anthropic API key not set. Open Settings to configure.');
        result = await callAnthropic(settings.anthropicKey, settings.model || 'claude-haiku-4-5-20251001', SYSTEM_PROMPT, userPrompt);
        break;
      case 'gemini':
        if (!settings.geminiKey) throw new Error('Gemini API key not set. Open Settings to configure.');
        result = await callGeminiClient(settings.geminiKey, settings.model || 'gemini-2.0-flash', SYSTEM_PROMPT, userPrompt);
        break;
      case 'openai-compatible':
        if (!settings.openaiCompatibleUrl) throw new Error('OpenAI-compatible URL not set. Open Settings to configure.');
        result = await callOpenAICompatibleClient(settings.openaiCompatibleUrl, settings.openaiCompatibleKey, settings.model, SYSTEM_PROMPT, userPrompt);
        break;
      default: // ollama
        if (!settings.ollamaUrl) throw new Error('Ollama URL not set. Open Settings to configure.');
        result = await callOllama(settings.ollamaUrl, settings.model || 'qwen2.5:14b', SYSTEM_PROMPT, userPrompt);
        break;
    }
    recordSuccess(provider);
    return result;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('429') || err.message.toLowerCase().includes('rate limit'))) {
      recordRateLimit(provider);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Update chatWithBook to support all 4 providers**

Replace the `chatWithBook` function (line 166-209) with a version that supports all 4 providers. The Anthropic and Ollama branches stay as-is; add Gemini and OpenAI-compatible branches following their respective multi-turn formats.

```typescript
export async function chatWithBook(
  systemPrompt: string,
  messages: ChatMessage[],
  settings: AiSettings,
): Promise<string> {
  switch (settings.provider) {
    case 'anthropic': {
      if (!settings.anthropicKey) throw new Error('No API key. Open ⚙ Settings to configure.');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: settings.model || 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';
    }
    case 'gemini': {
      if (!settings.geminiKey) throw new Error('No Gemini key. Open ⚙ Settings to configure.');
      const model = settings.model || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.geminiKey}`;
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0 },
      };
      if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Gemini error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    case 'openai-compatible': {
      if (!settings.openaiCompatibleUrl) throw new Error('No URL. Open ⚙ Settings to configure.');
      const url = settings.openaiCompatibleUrl.replace(/\/$/, '') + '/chat/completions';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.openaiCompatibleKey) headers['Authorization'] = `Bearer ${settings.openaiCompatibleKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 1024,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      });
      if (!res.ok) throw new Error(`Error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    }
    default: { // ollama
      if (!settings.ollamaUrl) throw new Error('No Ollama URL. Open ⚙ Settings to configure.');
      const url = settings.ollamaUrl.replace(/\/$/, '') + '/chat/completions';
      const res = await wrapOllamaFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.model || 'qwen2.5:14b',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      });
      if (!res.ok) throw new Error(`Ollama error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    }
  }
}
```

- [ ] **Step 5: Update testConnection to support all 4 providers**

Replace the `testConnection` function (line 215-225) to route to the correct caller per provider:

```typescript
export async function testConnection(settings: AiSettings): Promise<string> {
  const ping = 'Reply with exactly one word: OK';
  switch (settings.provider) {
    case 'anthropic':
      if (!settings.anthropicKey) throw new Error('No API key entered.');
      return (await callAnthropic(settings.anthropicKey, settings.model || 'claude-haiku-4-5-20251001', 'You are a test assistant.', ping)).trim();
    case 'gemini':
      if (!settings.geminiKey) throw new Error('No Gemini API key entered.');
      return (await callGeminiClient(settings.geminiKey, settings.model || 'gemini-2.0-flash', 'You are a test assistant.', ping)).trim();
    case 'openai-compatible':
      if (!settings.openaiCompatibleUrl) throw new Error('No base URL entered.');
      return (await callOpenAICompatibleClient(settings.openaiCompatibleUrl, settings.openaiCompatibleKey, settings.model, 'You are a test assistant.', ping)).trim();
    default:
      if (!settings.ollamaUrl) throw new Error('No Ollama URL entered.');
      return (await callOllama(settings.ollamaUrl, settings.model || 'qwen2.5:14b', 'You are a test assistant.', ping)).trim();
  }
}
```

- [ ] **Step 6: Update callAndParseClient to support all 4 providers**

Find the `callAndParseClient` function (which uses `callAi` internally). It should already work because `callAi` now dispatches to all 4 providers. Verify this — if `callAndParseClient` calls `callAi`, no changes needed. If it has its own provider branching, update it to use `callAi`.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 8: Commit**

```bash
git add lib/ai-client.ts
git commit -m "feat: expand AiSettings with Gemini and OpenAI-compatible providers"
```

---

### Task 4: Update Settings modal UI (`components/SettingsModal.tsx`)

**Files:**
- Modify: `components/SettingsModal.tsx`

Expand from 2 provider tabs to 4, with Gemini and OpenAI-compatible configuration panels.

- [ ] **Step 1: Update the provider toggle**

Replace the 2-button provider toggle (lines 82-96) with a 4-button version:

```typescript
        {/* Provider toggle */}
        <div>
          <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-2">Provider</label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-stone-300 dark:border-zinc-700 p-1">
            {([
              { value: 'ollama' as const, label: 'Ollama (local)' },
              { value: 'anthropic' as const, label: 'Anthropic' },
              { value: 'gemini' as const, label: 'Gemini (free)' },
              { value: 'openai-compatible' as const, label: settings.openaiCompatibleName || 'OpenAI-compat' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => set('provider', opt.value)}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  settings.provider === opt.value
                    ? 'bg-stone-200 dark:bg-zinc-700 text-stone-900 dark:text-zinc-100'
                    : 'text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
```

- [ ] **Step 2: Remove the `isOllama` variable and update conditionals**

Replace `const isOllama = settings.provider === 'ollama';` (line 66) and update the config panel conditionals. Change `{isOllama && (` to `{settings.provider === 'ollama' && (` and `{!isOllama && (` to `{settings.provider === 'anthropic' && (`.

- [ ] **Step 3: Add Gemini configuration panel**

After the Anthropic panel, add:

```typescript
        {/* Gemini config */}
        {settings.provider === 'gemini' && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-stone-400 dark:text-zinc-500">API Key</label>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
                >
                  Get a free key →
                </a>
              </div>
              <input
                type="password"
                value={settings.geminiKey}
                onChange={(e) => set('geminiKey', e.target.value)}
                placeholder="AIza..."
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-1.5">Model</label>
              <select
                value={settings.model}
                onChange={(e) => set('model', e.target.value)}
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (fast, recommended)</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (fastest)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (smartest)</option>
              </select>
            </div>
            <p className="text-[10px] text-stone-400 dark:text-zinc-600">
              Free tier — no credit card required. Your key is stored on this device only.
            </p>
          </div>
        )}
```

- [ ] **Step 4: Add OpenAI-compatible configuration panel**

After the Gemini panel:

```typescript
        {/* OpenAI-compatible config */}
        {settings.provider === 'openai-compatible' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-1.5">Provider Name</label>
              <input
                type="text"
                value={settings.openaiCompatibleName}
                onChange={(e) => set('openaiCompatibleName', e.target.value)}
                placeholder="e.g. Groq, OpenRouter"
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-stone-400 dark:text-zinc-600 self-center">Quick setup:</span>
              {[
                { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
                { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
                { name: 'Cerebras', url: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b' },
              ].map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    set('openaiCompatibleName', preset.name);
                    set('openaiCompatibleUrl', preset.url);
                    set('model', preset.model);
                  }}
                  className="px-2 py-0.5 text-[10px] rounded-full border border-stone-300 dark:border-zinc-700 text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-1.5">Base URL</label>
              <input
                type="url"
                value={settings.openaiCompatibleUrl}
                onChange={(e) => set('openaiCompatibleUrl', e.target.value)}
                placeholder="https://api.groq.com/openai/v1"
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-1.5">API Key</label>
              <input
                type="password"
                value={settings.openaiCompatibleKey}
                onChange={(e) => set('openaiCompatibleKey', e.target.value)}
                placeholder="sk-... or gsk-..."
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 dark:text-zinc-500 mb-1.5">Model</label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="llama-3.3-70b-versatile"
                className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>
        )}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add components/SettingsModal.tsx
git commit -m "feat: add Gemini and OpenAI-compatible tabs to Settings modal"
```

---

### Task 5: Refactor analyze route to use unified caller (`app/api/analyze/route.ts`)

**Files:**
- Modify: `app/api/analyze/route.ts:1-10` (imports)
- Modify: `app/api/analyze/route.ts:1212-1286` (remove local LLM callers)
- Modify: `app/api/analyze/route.ts:1335-1369` (callAndParseJSON)
- Modify: `app/api/analyze/route.ts:1393-1401` (runMultiPassFull signature)
- Modify: `app/api/analyze/route.ts:1617-1686` (POST handler)

This is the largest route refactoring. The key changes: remove inline `callAnthropic`/`callLocal`/`callLLM`/`CallOpts`, replace with imports from `lib/llm.ts`, and update the multi-pass functions to accept a config object instead of `useLocal`/`callOpts`.

- [ ] **Step 1: Update imports**

Remove `Anthropic` import and `undici` imports (lines 2-3). Remove `ollamaAgent` and `anthropic` client instantiation (lines near the top). Add:

```typescript
import { callLLM, resolveConfig, type LLMResult } from '@/lib/llm';
import type { ProviderType } from '@/lib/rate-limiter';
```

Keep the existing imports for `NextRequest`, `NextResponse`, types, and shared analysis functions.

- [ ] **Step 2: Remove inline LLM callers**

Delete the following blocks (approximately lines 1212-1286):
- `callAnthropic` function
- `callLocal` function
- `CallOpts` type
- The local `callLLM` wrapper

- [ ] **Step 3: Define a lightweight config type for internal passing**

Replace `CallOpts` with a config type that `callAndParseJSON` and the multi-pass functions use:

```typescript
type AnalyzeConfig = Omit<import('@/lib/llm').LLMCallConfig, 'system' | 'userPrompt' | 'maxTokens'>;
```

- [ ] **Step 4: Update callAndParseJSON**

Replace the signature and body of `callAndParseJSON` (line 1335-1369) to use the unified caller:

```typescript
async function callAndParseJSON<T>(
  system: string,
  userPrompt: string,
  config: AnalyzeConfig,
  label: string,
  maxTokens?: number,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: raw } = await callLLM({ ...config, system, userPrompt, maxTokens: maxTokens ?? 16384, jsonMode: true });
    let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const recovered = recoverPartialResponse(cleaned);
      if (recovered && Object.keys(recovered).length > 0) {
        console.log(`[analyze] ${label}: recovered partial JSON (keys: ${Object.keys(recovered).join(', ')})`);
        return recovered as T;
      }
      if (attempt === 0) {
        console.warn(`[analyze] ${label}: parse failed, retrying…`);
      } else {
        console.warn(`[analyze] ${label}: all attempts failed. Preview:`, cleaned.slice(-200));
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Update runMultiPassFull and runMultiPassDelta signatures**

Change `useLocal: boolean, callOpts: CallOpts` parameters to `config: AnalyzeConfig` in both functions. Replace all `useLocal` checks with `config.provider === 'ollama'` for choosing simplified prompts.

`runMultiPassFull` signature becomes:
```typescript
async function runMultiPassFull(
  bookTitle: string, bookAuthor: string, chapterTitle: string, text: string,
  allChapterTitles: string[] | undefined, config: AnalyzeConfig,
): Promise<AnalysisResult> {
```

Within the function body, replace all:
- `useLocal ? X_LOCAL : X` → `config.provider === 'ollama' ? X_LOCAL : X`
- `callAndParseJSON<T>(system, prompt, useLocal, callOpts, label, maxTokens)` → `callAndParseJSON<T>(system, prompt, config, label, maxTokens)`

Same treatment for `runMultiPassDelta`.

- [ ] **Step 6: Update POST handler**

Replace the provider resolution block (lines 1635-1654) with:

```typescript
    const config = resolveConfig(body);

    if (config.provider !== 'ollama' && !config.apiKey) {
      return NextResponse.json(
        { error: 'No API key configured. Open ⚙ Settings to add your key.' },
        { status: 400 },
      );
    }

    const modelName = config.model;
```

Update the `runMultiPassFull`/`runMultiPassDelta` calls to pass `config` instead of `useLocal, callOpts`.

When returning JSON responses from the POST handler, include `_rateLimitWaitMs` if any call returned a non-zero `rateLimitWaitMs`. Track this by accumulating wait time from `callLLM` results and adding to the response:

```typescript
    return NextResponse.json({ ...result, _rateLimitWaitMs: totalRateLimitMs || undefined });
```

Also expand the `_provider` type in the body destructuring to accept all 4 providers:
```typescript
_provider?: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
_geminiKey?: string;
_openaiCompatibleUrl?: string;
_openaiCompatibleKey?: string;
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 8: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "refactor: migrate analyze route to unified LLM caller"
```

---

### Task 6: Refactor remaining API routes

**Files:**
- Modify: `app/api/chat/route.ts` (all 74 lines — near-total rewrite)
- Modify: `app/api/group-arcs/route.ts:1-5, 42-90` (imports, POST handler)
- Modify: `app/api/reconcile/route.ts:1-79, 149-185` (remove LLM infra, update handler)
- Modify: `app/api/reconcile-propose/route.ts:1-~80, handler` (remove duplicated LLM infra)
- Modify: `app/api/detect-pins/route.ts:1-6, 96-185` (remove callers, update handler)

All routes follow the same pattern: remove inline LLM infra, import `callLLM`/`resolveConfig` from `lib/llm`, update the handler.

- [ ] **Step 1: Refactor `app/api/chat/route.ts`**

Replace the entire file:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { callLLM, resolveConfig } from '@/lib/llm';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      systemPrompt: string;
      messages: ChatMessage[];
      _provider?: string;
      _apiKey?: string;
      _ollamaUrl?: string;
      _model?: string;
      _geminiKey?: string;
      _openaiCompatibleUrl?: string;
      _openaiCompatibleKey?: string;
    };
    const { systemPrompt, messages } = body;
    const config = resolveConfig(body);

    const { text } = await callLLM({
      ...config,
      system: systemPrompt,
      userPrompt: '',
      maxTokens: 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return NextResponse.json({ reply: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat failed.';
    console.error('[chat] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Refactor `app/api/group-arcs/route.ts`**

Remove the `Anthropic` import, the `anthropic` client instance (lines 1-5). Import from `lib/llm`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { callLLM, resolveConfig } from '@/lib/llm';
import type { NarrativeArc, ParentArc } from '@/types';
```

Replace the LLM call block (lines 63-90) with:

```typescript
    const config = resolveConfig(body, { defaultAnthropicModel: 'claude-sonnet-4-20250514' });
    const { text } = await callLLM({
      ...config,
      system: '',
      userPrompt: prompt,
      maxTokens: 4096,
      jsonMode: true,
    });
```

The validation/cleanup logic after the call (lines 92-119) stays unchanged.

- [ ] **Step 3: Refactor `app/api/reconcile/route.ts`**

Remove the entire LLM infrastructure block (lines 1-79): imports of `Anthropic`, `undici`, `ollamaAgent`, `anthropic`, `CallOpts`, `callAnthropic`, `callLocal`, `callLLM`, `extractJsonArray`, `recoverPartialResponse`, `callAndParseJSON`.

Replace with imports and a new `callAndParseJSON`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { AnalysisResult } from '@/types';
import { reconcileResult, type CallAndParseFn } from '@/lib/reconcile';
import { callLLM, resolveConfig } from '@/lib/llm';

function extractJsonArray(raw: string, fieldName: string): unknown[] {
  // Keep existing implementation (lines 82-111 of current file)
}

function recoverPartialResponse(raw: string): Record<string, unknown> | null {
  // Keep existing implementation (lines 113-120 of current file)
}

async function callAndParseJSON<T>(
  system: string, userPrompt: string, config: ReturnType<typeof resolveConfig>, label: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: raw } = await callLLM({ ...config, system, userPrompt, maxTokens: 16384, jsonMode: true });
    let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const recovered = recoverPartialResponse(cleaned);
      if (recovered && Object.keys(recovered).length > 0) {
        console.log(`[reconcile] ${label}: recovered partial JSON`);
        return recovered as T;
      }
      if (attempt === 0) console.warn(`[reconcile] ${label}: parse failed, retrying…`);
      else console.warn(`[reconcile] ${label}: all attempts failed.`);
    }
  }
  return null;
}
```

Update the POST handler (lines 149-194): remove `useLocal`/`callOpts` resolution, replace with:

```typescript
    const config = resolveConfig(body);
    const callAndParse: CallAndParseFn = <T>(system: string, userPrompt: string, label: string) =>
      callAndParseJSON<T>(system, userPrompt, config, label);
```

- [ ] **Step 4: Refactor `app/api/reconcile-propose/route.ts`**

Same treatment as reconcile route — it mirrors the same LLM infrastructure. Remove duplicated `callAnthropic`/`callLocal`/`callLLM`/`CallOpts`/etc. Import from `lib/llm`. Update the handler to use `resolveConfig` + `callLLM`.

- [ ] **Step 5: Refactor `app/api/detect-pins/route.ts`**

Remove the `Anthropic` import, `undici` import, `ollamaAgent`, `callLocal`, `callAnthropic` functions (lines 1-146). Import from `lib/llm`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { LocationPin } from '@/types';
import { callLLM, resolveConfig } from '@/lib/llm';
```

Keep `SUPPORTED_TYPES`, `buildPrompt`, and `extractPins` functions.

Update the POST handler: add `_provider`/`_apiKey`/etc. to the request body type. Replace the LLM call block (lines 170-174) with:

```typescript
    const config = resolveConfig(body, { useVisionModel: true });

    const commaIdx = imageDataUrl.indexOf(',');
    const base64Data = imageDataUrl.slice(commaIdx + 1);
    const rawType = imageDataUrl.slice(0, commaIdx).match(/data:([^;]+)/)?.[1] ?? 'image/png';
    const mediaType = SUPPORTED_TYPES.has(rawType) ? rawType : 'image/png';

    const { text: raw } = await callLLM({
      ...config,
      system: '',
      userPrompt: prompt,
      maxTokens: 4096,
      images: [{ data: base64Data, mimeType: mediaType }],
    });
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add app/api/chat/route.ts app/api/group-arcs/route.ts app/api/reconcile/route.ts app/api/reconcile-propose/route.ts app/api/detect-pins/route.ts
git commit -m "refactor: migrate all API routes to unified LLM caller"
```

---

### Task 7: Pass new settings fields from client to API routes (`app/page.tsx`, `components/MapBoard.tsx`)

**Files:**
- Modify: `app/page.tsx:209-246` (analyzeChapter function)
- Modify: `app/page.tsx:~270` (generateParentArcs function)
- Modify: `components/MapBoard.tsx:397-413` (handleAutoDetect function)

Update the client-side functions that call API routes to pass the new provider fields.

- [ ] **Step 1: Update analyzeChapter settings passthrough**

Find the `analyzeChapter` function (line 209). In the block that loads AI settings (around line 222-231), add the new fields:

```typescript
    if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
    if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
    if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
```

- [ ] **Step 2: Update generateParentArcs settings passthrough**

Find the `generateParentArcs` function (follows the same settings-loading pattern). Add the same 3 lines for the new fields.

- [ ] **Step 3: Update any other API call sites in `app/page.tsx`**

Search for other functions that load AI settings and pass them to API routes (e.g., reconcile calls). Add the new fields to each. Use `grep -n "loadAiSettings\|_provider\|_apiKey" app/page.tsx` to find all call sites.

- [ ] **Step 4: Update `components/MapBoard.tsx` detect-pins call site**

The `handleAutoDetect` function (line 397) calls `/api/detect-pins` but currently passes no AI settings. Import `loadAiSettings` from `@/lib/ai-client` and pass provider fields in the request body:

```typescript
  async function handleAutoDetect() {
    if (!mapState || !locations.length) return;
    setDetecting(true);
    setDetectError(null);
    setSuggestions(null);
    try {
      const { loadAiSettings } = await import('@/lib/ai-client');
      const s = loadAiSettings();
      const { dataUrl: imageDataUrl, width: imageWidth, height: imageHeight } = await resizeDataUrl(mapState.imageDataUrl, 1024);
      const aiSettings: Record<string, string> = {};
      aiSettings._provider = s.provider;
      if (s.anthropicKey) aiSettings._apiKey = s.anthropicKey;
      if (s.ollamaUrl) aiSettings._ollamaUrl = s.ollamaUrl;
      if (s.model) aiSettings._model = s.model;
      if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
      if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
      if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
      const res = await fetch('/api/detect-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl,
          imageWidth,
          imageHeight,
          locations: locations.map(([name]) => name).filter(isPlaceName),
          ...aiSettings,
        }),
      });
      // ... rest stays the same
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx components/MapBoard.tsx
git commit -m "feat: pass Gemini and OpenAI-compatible settings to all API call sites"
```

---

### Task 8: Add contextual setup prompt (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

Add the inline setup card that appears when a user tries to analyze without a configured provider.

- [ ] **Step 1: Add showSetupPrompt state**

Near the other state declarations, add:

```typescript
const [showSetupPrompt, setShowSetupPrompt] = useState(false);
```

- [ ] **Step 2: Add pre-flight provider check**

In `handleAnalyze`, before the analysis loop starts, add a check:

```typescript
    // Pre-flight: check if provider is configured
    const settings = loadAiSettings();
    const hasCredentials =
      (settings.provider === 'anthropic' && settings.anthropicKey) ||
      (settings.provider === 'ollama' && settings.ollamaUrl) ||
      (settings.provider === 'gemini' && settings.geminiKey) ||
      (settings.provider === 'openai-compatible' && settings.openaiCompatibleUrl);
    if (!hasCredentials) {
      setShowSetupPrompt(true);
      return;
    }
```

Also hide the setup prompt when settings change (add to any settings-save callback):
```typescript
setShowSetupPrompt(false);
```

- [ ] **Step 3: Add the setup prompt JSX**

In the main content area, where the "click Analyze to begin" placeholder is, add a conditional render:

```typescript
                  {showSetupPrompt && (
                    <SetupPrompt
                      onComplete={() => { setShowSetupPrompt(false); handleAnalyze(); }}
                      onOpenSettings={() => { setShowSetupPrompt(false); setShowSettings(true); }}
                    />
                  )}
```

Create a `SetupPrompt` component inline (or as a small function component within page.tsx — no separate file needed given the simplicity):

```typescript
function SetupPrompt({ onComplete, onOpenSettings }: { onComplete: () => void; onOpenSettings: () => void }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  async function handleTestAndSave() {
    if (!key.trim()) return;
    setTesting(true);
    setError('');
    try {
      const { saveAiSettings, testConnection } = await import('@/lib/ai-client');
      const settings = {
        provider: 'gemini' as const,
        anthropicKey: '', ollamaUrl: 'http://localhost:11434/v1', model: 'gemini-2.0-flash',
        geminiKey: key.trim(),
        openaiCompatibleUrl: '', openaiCompatibleKey: '', openaiCompatibleName: '',
      };
      await testConnection(settings);
      saveAiSettings(settings);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center gap-4 px-4">
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4">
        <h3 className="font-bold text-stone-900 dark:text-zinc-100 text-sm">Set up an AI provider to analyze this book</h3>
        <div className="text-left space-y-2">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">★ Recommended: Google Gemini (free)</p>
          <p className="text-xs text-stone-500 dark:text-zinc-400">Get a free API key in ~60 seconds — no credit card required.</p>
        </div>
        <button
          onClick={() => setGuideOpen(!guideOpen)}
          className="text-xs text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors w-full text-left"
        >
          {guideOpen ? '▾' : '▸'} Step-by-step guide
        </button>
        {guideOpen && (
          <ol className="text-xs text-stone-500 dark:text-zinc-400 space-y-1 list-decimal list-inside text-left">
            <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-amber-600 dark:text-amber-400 hover:underline">Google AI Studio</a></li>
            <li>Sign in with your Google account</li>
            <li>Click &quot;Create API Key&quot;</li>
            <li>Copy the key and paste it below</li>
          </ol>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(''); }}
            placeholder="Paste Gemini API key"
            className="flex-1 bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-zinc-200 focus:outline-none focus:border-amber-500/50"
            onKeyDown={(e) => e.key === 'Enter' && handleTestAndSave()}
          />
          <button
            onClick={handleTestAndSave}
            disabled={testing || !key.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {testing ? 'Testing…' : 'Test & Save'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={onOpenSettings}
          className="text-xs text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors"
        >
          Other providers →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add rate limit progress feedback**

In the `analyzeChapter` function (or wherever the analyze response is processed), check for `_rateLimitWaitMs` in the response and display it in the progress indicator. Find where progress text is set during analysis and add:

```typescript
    if (data._rateLimitWaitMs) {
      setProgress(prev => prev ? `${prev} (rate limit: waited ${Math.ceil(data._rateLimitWaitMs / 1000)}s)` : prev);
    }
```

This ensures users see when rate limiting is actively pacing their requests, so they understand any delays.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add contextual setup prompt and rate limit progress feedback"
```

---

### Task 9: Verify full build and integration

**Files:** (no changes, verification only)

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build completes successfully. All API routes appear in the build output, including `/api/group-arcs`, `/api/detect-pins`, etc.

- [ ] **Step 3: Verify no stale imports**

Search for any remaining direct imports of `Anthropic` or `undici` in API routes (they should only be in `lib/llm.ts` now):

Run: `grep -rn "from '@anthropic-ai/sdk'" app/api/` and `grep -rn "from 'undici'" app/api/`
Expected: No results (all moved to `lib/llm.ts`)

- [ ] **Step 4: Commit any final fixes, if needed**

```bash
git add -A
git commit -m "chore: fix any remaining issues from integration verification"
```
