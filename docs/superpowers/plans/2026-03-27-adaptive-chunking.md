# Adaptive Context-Aware Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all silent data loss during book analysis by detecting each model's context window and adaptively splitting oversized chapters into sub-chunks.

**Architecture:** New `lib/context-window.ts` module handles context detection, budget calculation, and text splitting. The analyze API route uses it to split chapters before processing and to recalculate budgets per-pass. LLM providers get unified continuation loops for truncated output.

**Tech Stack:** TypeScript, Next.js API routes, Ollama REST API, Anthropic SDK, Gemini REST API, OpenAI-compatible REST API.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/context-window.ts` | **New.** Context window detection per provider, token estimation, text budget calculation, chapter text splitting |
| `lib/llm.ts` | **Modify.** Add truncation detection return value; add continuation loops to Gemini and OpenAI-compatible providers |
| `app/api/analyze/route.ts` | **Modify.** Remove hard truncation; add sub-chunk loop in POST handler; add per-pass budget-aware splitting; add output continuation in `callAndParseJSON` |
| `lib/reconcile.ts` | **Modify.** Replace hard 15k char slice with budget-aware text truncation |

---

### Task 1: Create `lib/context-window.ts` — Core Types and Token Estimation

**Files:**
- Create: `lib/context-window.ts`

- [ ] **Step 1: Create the module with types and `estimateTokens`**

Create `lib/context-window.ts` with the foundational types and the token estimation function:

```typescript
// lib/context-window.ts

import { Agent, fetch as undiciFetch } from 'undici';
import type { ProviderType } from './rate-limiter';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChapterChunk {
  text: string;
  index: number;   // 0-based sub-chunk index
  total: number;   // total sub-chunks for this chapter
}

export interface ContextConfig {
  provider: ProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 3.5;
const OVERLAP_CHARS = 500;

// ─── Token estimation ────────────────────────────────────────────────────────

/** Estimate the number of tokens in a string. Conservative (3.5 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Convert a token count to approximate character count. */
export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit lib/context-window.ts 2>&1 | head -20`

This may show import errors since it depends on the project's tsconfig. Alternatively:

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -5`

Expected: Build succeeds (or only pre-existing warnings).

- [ ] **Step 3: Commit**

```bash
git add lib/context-window.ts
git commit -m "feat: add context-window module with types and token estimation"
```

---

### Task 2: Context Window Detection — Ollama

**Files:**
- Modify: `lib/context-window.ts`

- [ ] **Step 1: Add Ollama context detection**

Append to `lib/context-window.ts`, after the token estimation section:

```typescript
// ─── Ollama context detection ────────────────────────────────────────────────

const ollamaAgent = new Agent({ headersTimeout: 30_000, bodyTimeout: 30_000 });
const OLLAMA_DEFAULT_CTX = 4096;

/**
 * Query Ollama's /api/show endpoint to get the model's context window size.
 * The baseUrl from config typically points to "http://host:11434/v1" —
 * we strip "/v1" to reach the native Ollama API.
 */
async function getOllamaContextWindow(model: string, baseUrl?: string): Promise<number> {
  const v1Url = (baseUrl ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  // Strip /v1 or /v1/ suffix to get the Ollama native base
  const ollamaBase = v1Url.replace(/\/v1\/?$/, '');

  try {
    const res = await undiciFetch(`${ollamaBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      dispatcher: ollamaAgent,
    } as Parameters<typeof undiciFetch>[1]);

    if (!res.ok) {
      console.warn(`[context-window] Ollama /api/show returned ${res.status}, using default ${OLLAMA_DEFAULT_CTX}`);
      return OLLAMA_DEFAULT_CTX;
    }

    const data = await res.json() as {
      model_info?: Record<string, unknown>;
      parameters?: string;
    };

    // Strategy 1: model_info contains a key like "qwen2.5.context_length" or
    // "<arch>.context_length" with the numeric value
    if (data.model_info) {
      for (const [key, value] of Object.entries(data.model_info)) {
        if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
          console.log(`[context-window] Ollama model ${model}: context_length=${value} (from model_info)`);
          return value;
        }
      }
    }

    // Strategy 2: parameters string contains "num_ctx <number>"
    if (data.parameters) {
      const match = data.parameters.match(/num_ctx\s+(\d+)/);
      if (match) {
        const numCtx = parseInt(match[1], 10);
        console.log(`[context-window] Ollama model ${model}: num_ctx=${numCtx} (from parameters)`);
        return numCtx;
      }
    }

    console.warn(`[context-window] Ollama model ${model}: no context size found, using default ${OLLAMA_DEFAULT_CTX}`);
    return OLLAMA_DEFAULT_CTX;
  } catch (err) {
    console.warn(`[context-window] Ollama /api/show failed for ${model}:`, err instanceof Error ? err.message : err);
    return OLLAMA_DEFAULT_CTX;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/context-window.ts
git commit -m "feat: add Ollama context window detection via /api/show"
```

---

### Task 3: Context Window Detection — All Providers

**Files:**
- Modify: `lib/context-window.ts`

- [ ] **Step 1: Add lookup tables and OpenAI-compatible detection**

Append to `lib/context-window.ts`:

```typescript
// ─── Cloud provider lookup tables ────────────────────────────────────────────

const ANTHROPIC_CONTEXT: Record<string, number> = {
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-5-20241022': 200_000,
  'claude-sonnet-4-6-20260320': 200_000,
  'claude-opus-4-6': 200_000,
};
const ANTHROPIC_DEFAULT_CTX = 100_000;

const GEMINI_CONTEXT: Record<string, number> = {
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
};
const GEMINI_DEFAULT_CTX = 128_000;

const OPENAI_COMPAT_DEFAULT_CTX = 8192;

async function getOpenAICompatibleContextWindow(model: string, baseUrl?: string, apiKey?: string): Promise<number> {
  if (!baseUrl || !model) return OPENAI_COMPAT_DEFAULT_CTX;
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}`;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return OPENAI_COMPAT_DEFAULT_CTX;
    const data = await res.json() as Record<string, unknown>;
    const ctx = (data.context_length ?? data.context_window ?? data.max_model_len) as number | undefined;
    if (ctx && typeof ctx === 'number' && ctx > 0) {
      console.log(`[context-window] OpenAI-compatible model ${model}: context=${ctx}`);
      return ctx;
    }
  } catch {
    // ignore — use default
  }
  console.warn(`[context-window] OpenAI-compatible model ${model}: using default ${OPENAI_COMPAT_DEFAULT_CTX}`);
  return OPENAI_COMPAT_DEFAULT_CTX;
}
```

- [ ] **Step 2: Add the unified `getContextWindow` function**

Append to `lib/context-window.ts`:

```typescript
// ─── Unified context window detection ────────────────────────────────────────

/** Detect the context window size (in tokens) for the given provider and model. */
export async function getContextWindow(config: ContextConfig): Promise<number> {
  switch (config.provider) {
    case 'ollama':
      return getOllamaContextWindow(config.model, config.baseUrl);

    case 'anthropic': {
      // Check exact match first, then prefix match for versioned model names
      if (ANTHROPIC_CONTEXT[config.model]) return ANTHROPIC_CONTEXT[config.model];
      for (const [prefix, ctx] of Object.entries(ANTHROPIC_CONTEXT)) {
        if (config.model.startsWith(prefix.split('-').slice(0, -1).join('-'))) return ctx;
      }
      return ANTHROPIC_DEFAULT_CTX;
    }

    case 'gemini': {
      if (GEMINI_CONTEXT[config.model]) return GEMINI_CONTEXT[config.model];
      for (const [prefix, ctx] of Object.entries(GEMINI_CONTEXT)) {
        if (config.model.startsWith(prefix)) return ctx;
      }
      return GEMINI_DEFAULT_CTX;
    }

    case 'openai-compatible':
      return getOpenAICompatibleContextWindow(config.model, config.baseUrl, config.apiKey);

    default:
      return OLLAMA_DEFAULT_CTX;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/context-window.ts
git commit -m "feat: add context window detection for all LLM providers"
```

---

### Task 4: Text Budget Calculation and Chapter Splitting

**Files:**
- Modify: `lib/context-window.ts`

- [ ] **Step 1: Add `computeTextBudget` and `splitChapterText`**

Append to `lib/context-window.ts`:

```typescript
// ─── Text budget calculation ─────────────────────────────────────────────────

/**
 * Compute the available character budget for chapter text in an LLM call.
 *
 * @param contextWindow  Total context window in tokens
 * @param outputReserve  Tokens reserved for the model's response
 * @param promptOverhead The non-text portion of the prompt (system + schema + entity lists + instructions) as a string
 * @returns Available characters for chapter text (minimum 500 to avoid degenerate splits)
 */
export function computeTextBudget(
  contextWindow: number,
  outputReserve: number,
  promptOverhead: string,
): number {
  const overheadTokens = estimateTokens(promptOverhead);
  const availableTokens = contextWindow - outputReserve - overheadTokens;
  const availableChars = tokensToChars(Math.max(availableTokens, 0));
  // Floor at 500 chars to avoid degenerate empty chunks
  return Math.max(availableChars, 500);
}

// ─── Chapter text splitting ──────────────────────────────────────────────────

/**
 * Split chapter text into sub-chunks that each fit within `availableChars`.
 * Splits at paragraph boundaries (\n\n), then line boundaries (\n), then
 * sentence boundaries (". "). Includes ~500 char overlap between chunks.
 *
 * Returns a single-element array if the text already fits.
 */
export function splitChapterText(text: string, availableChars: number): ChapterChunk[] {
  if (text.length <= availableChars) {
    return [{ text, index: 0, total: 1 }];
  }

  const chunks: string[] = [];
  let remaining = text;
  let offset = 0;

  while (remaining.length > 0) {
    if (remaining.length <= availableChars) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point before the limit
    let splitAt = -1;
    const searchRegion = remaining.slice(0, availableChars);

    // Priority 1: paragraph boundary
    splitAt = searchRegion.lastIndexOf('\n\n');

    // Priority 2: line boundary
    if (splitAt < availableChars * 0.3) {
      const lineSplit = searchRegion.lastIndexOf('\n');
      if (lineSplit > splitAt) splitAt = lineSplit;
    }

    // Priority 3: sentence boundary
    if (splitAt < availableChars * 0.3) {
      const sentenceSplit = searchRegion.lastIndexOf('. ');
      if (sentenceSplit > splitAt) splitAt = sentenceSplit + 1; // include the period
    }

    // Fallback: hard split at the limit
    if (splitAt < availableChars * 0.1) {
      splitAt = availableChars;
    }

    chunks.push(remaining.slice(0, splitAt));
    // Advance with overlap: go back OVERLAP_CHARS from the split point
    const advance = Math.max(1, splitAt - OVERLAP_CHARS);
    remaining = remaining.slice(advance);
    offset += advance;
  }

  // Filter out whitespace-only chunks
  const filtered = chunks.filter((c) => c.trim().length > 0);
  return filtered.map((c, i) => ({ text: c, index: i, total: filtered.length }));
}
```

- [ ] **Step 2: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/context-window.ts
git commit -m "feat: add text budget calculation and chapter splitting"
```

---

### Task 5: Extend LLM Providers with Continuation Loops

**Files:**
- Modify: `lib/llm.ts:109-155` (Ollama provider)
- Modify: `lib/llm.ts:157-234` (Gemini provider)
- Modify: `lib/llm.ts:236-294` (OpenAI-compatible provider)
- Modify: `lib/llm.ts:26-29` (LLMResult type)

- [ ] **Step 1: Add `truncated` flag to `LLMResult`**

In `lib/llm.ts`, modify the `LLMResult` interface at line 26:

```typescript
export interface LLMResult {
  text: string;
  truncated?: boolean;       // true if the response hit max_tokens
  rateLimitWaitMs?: number;
}
```

- [ ] **Step 2: Update `callLLM` to propagate `truncated`**

In `lib/llm.ts`, the `dispatch` function currently returns `Promise<string>`. Change it and the provider callers to return `{ text: string; truncated: boolean }`:

First, update the dispatch return type and `callLLM`:

Replace the `dispatch` function and `callLLM` at lines 298-345:

```typescript
interface DispatchResult { text: string; truncated: boolean }

function dispatch(config: LLMCallConfig): Promise<DispatchResult> {
  switch (config.provider) {
    case 'anthropic': return callAnthropicProvider(config);
    case 'ollama': return callOllamaProvider(config);
    case 'gemini': return callGeminiProvider(config);
    case 'openai-compatible': return callOpenAICompatibleProvider(config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ... isRateLimitError and extractHeaders stay the same ...

export async function callLLM(config: LLMCallConfig): Promise<LLMResult> {
  const maxRetries = 3;
  let totalWaitMs = 0;

  for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
    const paceWait = await rateLimiter.waitIfNeeded(config.provider);
    totalWaitMs += paceWait;

    try {
      const { text, truncated } = await dispatch(config);
      rateLimiter.recordSuccess(config.provider);
      return { text, truncated: truncated || undefined, rateLimitWaitMs: totalWaitMs || undefined };
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const retryAfterMs = rateLimiter.parseRetryAfter(extractHeaders(err));
      const waitMs = rateLimiter.recordRateLimit(config.provider, retryAfterMs);
      console.warn(`[llm] Rate limited by ${config.provider}, waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})…`);
      await new Promise((r) => setTimeout(r, waitMs));
      totalWaitMs += waitMs;
    }
  }
  throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
}
```

- [ ] **Step 3: Update `callAnthropicProvider` to return `DispatchResult`**

Replace the function signature and return at lines 57-107:

```typescript
async function callAnthropicProvider(config: LLMCallConfig): Promise<DispatchResult> {
  const client = getAnthropicClient(config.apiKey);
  const model = config.model || 'claude-haiku-4-5-20251001';
  let fullText = '';
  let truncated = false;

  // Continuation loop: if the response hits max_tokens, prefill the assistant
  // turn with what we have so far and let the model continue where it left off.
  for (let pass = 0; pass < 5; pass++) {
    const messages: Anthropic.MessageParam[] = [];

    if (config.messages?.length) {
      for (const m of config.messages) {
        messages.push({ role: m.role as 'user' | 'assistant', content: m.content as string });
      }
    } else if (config.images?.length) {
      const content: Anthropic.ContentBlockParam[] = config.images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: img.data },
      }));
      content.push({ type: 'text' as const, text: config.userPrompt });
      messages.push({ role: 'user', content });
    } else {
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
    // If we're on the last pass and still truncated, flag it
    if (pass === 4) truncated = true;
  }

  if (!fullText) throw new Error('No text response from Anthropic.');
  return { text: fullText, truncated };
}
```

- [ ] **Step 4: Replace `callOllamaProvider` with continuation loop**

Replace lines 109-155:

```typescript
async function callOllamaProvider(config: LLMCallConfig): Promise<DispatchResult> {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  const model = config.model || 'qwen2.5:14b';
  let fullText = '';
  let truncated = false;

  for (let pass = 0; pass < 5; pass++) {
    const messages: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }> = [];

    if (config.messages?.length) {
      if (config.system) messages.push({ role: 'system', content: config.system });
      messages.push(...config.messages);
    } else if (config.images?.length) {
      if (config.system) messages.push({ role: 'system', content: config.system });
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

    // Prefill with accumulated text for continuation
    if (fullText) {
      messages.push({ role: 'assistant', content: fullText });
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
    if (!text && !fullText) throw new Error('No content in Ollama response.');
    if (text) fullText += text;

    if (data.choices?.[0]?.finish_reason !== 'length') break;
    console.log(`[llm] Ollama response hit max_tokens, continuing (pass ${pass + 1})…`);
    if (pass === 4) truncated = true;
  }

  if (!fullText) throw new Error('No content in Ollama response.');
  return { text: fullText, truncated };
}
```

- [ ] **Step 5: Replace `callGeminiProvider` with continuation loop**

Replace lines 157-234:

```typescript
async function callGeminiProvider(config: LLMCallConfig): Promise<DispatchResult> {
  if (!config.apiKey) throw new Error('Gemini API key not configured. Open Settings to add your key.');
  const model = config.model || 'gemini-2.0-flash';
  let fullText = '';
  let truncated = false;

  for (let pass = 0; pass < 5; pass++) {
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
      for (const m of config.messages) {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const msgParts: typeof parts = [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }];
        contents.push({ role, parts: msgParts });
      }
      if (config.images?.length) {
        const imgParts: typeof parts = config.images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
        const lastUser = [...contents].reverse().find((c) => c.role === 'user');
        if (lastUser) lastUser.parts.push(...imgParts);
        else contents.push({ role: 'user', parts: imgParts });
      }
    } else {
      contents.push({ role: 'user', parts });
    }

    // Prefill with accumulated text for continuation
    if (fullText) {
      contents.push({ role: 'model', parts: [{ text: fullText }] });
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
      signal: AbortSignal.timeout(300_000),
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
    if (!text && !fullText) throw new Error('No text in Gemini response.');
    if (text) fullText += text;

    if (data.candidates?.[0]?.finishReason !== 'MAX_TOKENS') break;
    console.log(`[llm] Gemini response hit max_tokens, continuing (pass ${pass + 1})…`);
    if (pass === 4) truncated = true;
  }

  if (!fullText) throw new Error('No text in Gemini response.');
  return { text: fullText, truncated };
}
```

- [ ] **Step 6: Replace `callOpenAICompatibleProvider` with continuation loop**

Replace lines 236-294:

```typescript
async function callOpenAICompatibleProvider(config: LLMCallConfig): Promise<DispatchResult> {
  if (!config.baseUrl) throw new Error('OpenAI-compatible base URL not configured. Open Settings.');
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = config.model;
  if (!model) throw new Error('No model specified for OpenAI-compatible provider. Open Settings to configure.');
  let fullText = '';
  let truncated = false;

  for (let pass = 0; pass < 5; pass++) {
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

    // Prefill with accumulated text for continuation
    if (fullText) {
      messages.push({ role: 'assistant', content: fullText });
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
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI-compatible error (${res.status}): ${err}`);
    }

    const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text && !fullText) throw new Error('No content in OpenAI-compatible response.');
    if (text) fullText += text;

    if (data.choices?.[0]?.finish_reason !== 'length') break;
    console.log(`[llm] OpenAI-compatible response hit max_tokens, continuing (pass ${pass + 1})…`);
    if (pass === 4) truncated = true;
  }

  if (!fullText) throw new Error('No content in OpenAI-compatible response.');
  return { text: fullText, truncated };
}
```

- [ ] **Step 7: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -10`

Expected: Build succeeds. All existing callers of `callLLM` receive `LLMResult` which already had optional fields, so `truncated?: boolean` is backward compatible.

- [ ] **Step 8: Commit**

```bash
git add lib/llm.ts
git commit -m "feat: add continuation loops to all LLM providers and truncation flag"
```

---

### Task 6: Output Continuation in `callAndParseJSON`

**Files:**
- Modify: `app/api/analyze/route.ts:1261-1292` (`callAndParseJSON` function)

- [ ] **Step 1: Add dynamic output token scaling and output continuation**

Replace the `callAndParseJSON` function at lines 1261-1292 with:

```typescript
async function callAndParseJSON<T>(
  system: string,
  userPrompt: string,
  config: AnalyzeConfig,
  label: string,
  maxTokens?: number,
  contextWindow?: number,
): Promise<{ result: T | null; rateLimitWaitMs: number }> {
  let totalRateLimitMs = 0;

  // Dynamic output token scaling: scale based on input size, capped by context window
  const inputChars = userPrompt.length + (system?.length ?? 0);
  const scaledTokens = Math.max(maxTokens ?? 16384, Math.ceil(inputChars / 20));
  const effectiveMaxTokens = contextWindow
    ? Math.min(scaledTokens, Math.floor(contextWindow * 0.4)) // don't let output exceed 40% of context
    : scaledTokens;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: raw, truncated, rateLimitWaitMs } = await callLLM({
      ...config, system, userPrompt,
      maxTokens: effectiveMaxTokens,
      jsonMode: true,
    });
    if (rateLimitWaitMs) totalRateLimitMs += rateLimitWaitMs;

    let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

    try {
      return { result: JSON.parse(cleaned) as T, rateLimitWaitMs: totalRateLimitMs };
    } catch {
      const recovered = recoverPartialResponse(cleaned);
      if (recovered && Object.keys(recovered).length > 0) {
        console.log(`[analyze] ${label}: recovered partial JSON (keys: ${Object.keys(recovered).join(', ')})`);

        // If truncated, try continuation: ask the model to find additional entities
        if (truncated) {
          const continuationResult = await attemptOutputContinuation<T>(
            system, userPrompt, config, label, recovered, effectiveMaxTokens,
          );
          if (continuationResult.rateLimitWaitMs) totalRateLimitMs += continuationResult.rateLimitWaitMs;
          if (continuationResult.result) {
            return { result: continuationResult.result, rateLimitWaitMs: totalRateLimitMs };
          }
        }

        return { result: recovered as T, rateLimitWaitMs: totalRateLimitMs };
      }
      if (attempt === 0) {
        console.warn(`[analyze] ${label}: parse failed, retrying…`);
      } else {
        console.warn(`[analyze] ${label}: all attempts failed. Preview:`, cleaned.slice(-200));
      }
    }
  }
  return { result: null, rateLimitWaitMs: totalRateLimitMs };
}
```

- [ ] **Step 2: Add the `attemptOutputContinuation` helper**

Add this function right before `callAndParseJSON` (around line 1258):

```typescript
/** When an LLM response is truncated, ask the model to continue extracting entities it missed. */
async function attemptOutputContinuation<T>(
  system: string,
  originalPrompt: string,
  config: AnalyzeConfig,
  label: string,
  partialResult: Record<string, unknown>,
  maxTokens: number,
): Promise<{ result: T | null; rateLimitWaitMs: number }> {
  let totalRateLimitMs = 0;
  let accumulated = { ...partialResult };

  for (let contPass = 0; contPass < 3; contPass++) {
    // Build a list of already-found entity names to exclude
    const foundNames: string[] = [];
    for (const key of ['characters', 'updatedCharacters', 'locations', 'updatedLocations', 'arcs', 'updatedArcs']) {
      const arr = accumulated[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object' && 'name' in item) foundNames.push((item as { name: string }).name);
        }
      }
    }

    if (foundNames.length === 0) break;

    const continuationPrompt = `Your previous response was truncated. You already found these ${foundNames.length} entities: ${foundNames.join(', ')}.

Continue extracting from the SAME text provided earlier. Return ONLY entities you have NOT already listed above. Use the exact same JSON schema. If there are no additional entities, return an empty result.

Original instructions (for reference — do NOT repeat entities listed above):
${originalPrompt.slice(0, 2000)}`;

    console.log(`[analyze] ${label}: output truncated, continuation pass ${contPass + 1} (already found ${foundNames.length} entities)`);

    const { text: contRaw, truncated: contTruncated, rateLimitWaitMs } = await callLLM({
      ...config, system, userPrompt: continuationPrompt, maxTokens, jsonMode: true,
    });
    if (rateLimitWaitMs) totalRateLimitMs += rateLimitWaitMs;

    let contCleaned = contRaw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const fb = contCleaned.indexOf('{');
    const lb = contCleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) contCleaned = contCleaned.slice(fb, lb + 1);

    let contParsed: Record<string, unknown> | null = null;
    try {
      contParsed = JSON.parse(contCleaned);
    } catch {
      contParsed = recoverPartialResponse(contCleaned);
    }

    if (!contParsed) break;

    // Merge continuation arrays into accumulated result
    let addedAny = false;
    for (const key of ['characters', 'updatedCharacters', 'locations', 'updatedLocations', 'arcs', 'updatedArcs', 'verdicts', 'mergeGroups', 'splits']) {
      const contArr = contParsed[key];
      if (Array.isArray(contArr) && contArr.length > 0) {
        const existing = accumulated[key];
        accumulated[key] = Array.isArray(existing) ? [...existing, ...contArr] : contArr;
        addedAny = true;
      }
    }
    if (contParsed.summary && !accumulated.summary) accumulated.summary = contParsed.summary;

    if (!addedAny || !contTruncated) break;
  }

  return { result: accumulated as T, rateLimitWaitMs: totalRateLimitMs };
}
```

- [ ] **Step 3: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "feat: add output continuation and dynamic token scaling in callAndParseJSON"
```

---

### Task 7: Remove Hard Truncation and Add Sub-Chunk Loop in POST Handler

**Files:**
- Modify: `app/api/analyze/route.ts:1-13` (imports and constants)
- Modify: `app/api/analyze/route.ts:1553-1617` (POST handler)

- [ ] **Step 1: Update imports and remove hard truncation constants**

Replace lines 1-13 of `app/api/analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { AnalysisResult } from '@/types';
import { reconcileResult, computeNameOverlaps, updateArcReferences, type CallAndParseFn } from '@/lib/reconcile';
import { levenshtein } from '@/lib/ai-shared';
import { escapeRegex, validateCharactersAgainstText, validateLocationsAgainstText } from '@/lib/validate-entities';
import { callLLM, resolveConfig, type LLMResult } from '@/lib/llm';
import { getContextWindow, splitChapterText, computeTextBudget, estimateTokens } from '@/lib/context-window';
import type { ProviderType } from '@/lib/rate-limiter';
```

The `MAX_NEW_CHARS`, `MAX_CHARS`, and `HEAD_CHARS` constants are deleted entirely.

- [ ] **Step 2: Replace the POST handler with sub-chunk loop**

Replace the POST handler (lines 1553-1617) with:

```typescript
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      chaptersRead?: Array<{ title: string; text: string }>;
      newChapters?: Array<{ title: string; text: string }>;
      allChapterTitles?: string[];
      currentChapterTitle: string;
      bookTitle: string;
      bookAuthor: string;
      previousResult?: AnalysisResult;
      _provider?: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
      _apiKey?: string;
      _ollamaUrl?: string;
      _model?: string;
      _geminiKey?: string;
      _openaiCompatibleUrl?: string;
      _openaiCompatibleKey?: string;
    };
    const { chaptersRead, newChapters, allChapterTitles, currentChapterTitle, bookTitle, bookAuthor, previousResult } = body;

    const config = resolveConfig(body);

    if (config.provider !== 'ollama' && !config.apiKey) {
      return NextResponse.json(
        { error: 'No API key configured. Open Settings to add your key.' },
        { status: 400 },
      );
    }

    const modelName = config.model;

    // Detect context window for this provider/model
    const contextWindow = await getContextWindow(config);
    console.log(`[analyze] Context window: ${contextWindow} tokens (${config.provider}/${config.model})`);

    const isDelta = !!(previousResult && newChapters?.length);
    let result: AnalysisResult;
    let totalRateLimitMs = 0;

    if (isDelta) {
      const newText = newChapters!
        .map((ch) => `=== ${ch.title} ===\n\n${ch.text}`)
        .join('\n\n---\n\n');

      // Estimate conservative budget for Level 1 splitting
      // Use a generous overhead estimate to avoid sub-chunks being too large for any pass
      const conservativeOverhead = 6000; // chars for system + schema + entity lists (worst case)
      const outputReserve = 8192;
      const budget = computeTextBudget(contextWindow, outputReserve, 'x'.repeat(conservativeOverhead));
      const chunks = splitChapterText(newText, budget);

      if (chunks.length > 1) {
        console.log(`[analyze] Chapter "${currentChapterTitle}" split into ${chunks.length} chunks (budget: ${budget} chars)`);
        if (contextWindow <= 4096) {
          console.warn(`[analyze] Warning: context window is ${contextWindow} tokens — chapter "${currentChapterTitle}" requires ${chunks.length} chunks. Consider increasing num_ctx for better performance.`);
        }
      }

      let accumulated: AnalysisResult = previousResult!;

      for (const chunk of chunks) {
        if (chunks.length > 1) {
          console.log(`[analyze] Chapter "${currentChapterTitle}" chunk ${chunk.index + 1}/${chunk.total} (${chunk.text.length} chars)`);
        }
        const { result: chunkResult, totalRateLimitMs: chunkRl } = await runMultiPassDelta(
          bookTitle, bookAuthor, currentChapterTitle, chunk.text, accumulated, config, contextWindow,
        );
        totalRateLimitMs += chunkRl;
        accumulated = chunkResult;
      }
      result = accumulated;
    } else {
      if (!chaptersRead?.length) {
        return NextResponse.json({ error: 'No chapter text provided.' }, { status: 400 });
      }
      const fullText = chaptersRead
        .map((ch) => `=== ${ch.title} ===\n\n${ch.text}`)
        .join('\n\n---\n\n');

      // Same conservative budget for Level 1 splitting
      const conservativeOverhead = 6000;
      const outputReserve = 8192;
      const budget = computeTextBudget(contextWindow, outputReserve, 'x'.repeat(conservativeOverhead));
      const chunks = splitChapterText(fullText, budget);

      if (chunks.length > 1) {
        console.log(`[analyze] Chapter "${currentChapterTitle}" split into ${chunks.length} chunks (budget: ${budget} chars)`);
        if (contextWindow <= 4096) {
          console.warn(`[analyze] Warning: context window is ${contextWindow} tokens — chapter "${currentChapterTitle}" requires ${chunks.length} chunks. Consider increasing num_ctx for better performance.`);
        }
      }

      // First chunk: full analysis. Subsequent chunks: delta.
      const { result: firstResult, totalRateLimitMs: firstRl } = await runMultiPassFull(
        bookTitle, bookAuthor, currentChapterTitle, chunks[0].text, allChapterTitles, config, contextWindow,
      );
      totalRateLimitMs += firstRl;
      let accumulated = firstResult;

      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[analyze] Chapter "${currentChapterTitle}" chunk ${chunk.index + 1}/${chunk.total} (${chunk.text.length} chars)`);
        const { result: chunkResult, totalRateLimitMs: chunkRl } = await runMultiPassDelta(
          bookTitle, bookAuthor, currentChapterTitle, chunk.text, accumulated, config, contextWindow,
        );
        totalRateLimitMs += chunkRl;
        accumulated = chunkResult;
      }
      result = accumulated;
    }

    const chunkInfo = undefined; // chunk info could be added to response here if needed later

    return NextResponse.json({ ...result, _model: modelName, _rateLimitWaitMs: totalRateLimitMs || undefined });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Update `runMultiPassFull` and `runMultiPassDelta` signatures to accept `contextWindow`**

Update the signature of `runMultiPassFull` (around line 1316) to add `contextWindow?: number` as the last parameter:

```typescript
async function runMultiPassFull(
  bookTitle: string,
  bookAuthor: string,
  chapterTitle: string,
  text: string,
  allChapterTitles: string[] | undefined,
  config: AnalyzeConfig,
  contextWindow?: number,
): Promise<{ result: AnalysisResult; totalRateLimitMs: number }> {
```

And pass `contextWindow` to every `callAndParseJSON` call inside. Each existing call like:

```typescript
const { result: charsResult, rateLimitWaitMs: rlChars } = await callAndParseJSON<...>(
  charSystem, buildCharactersFullPrompt(...), config, 'characters-full', config.provider === 'ollama' ? 16384 : undefined,
);
```

becomes:

```typescript
const { result: charsResult, rateLimitWaitMs: rlChars } = await callAndParseJSON<...>(
  charSystem, buildCharactersFullPrompt(...), config, 'characters-full', config.provider === 'ollama' ? 16384 : undefined, contextWindow,
);
```

Apply the same pattern to `runMultiPassDelta` (around line 1433):

```typescript
async function runMultiPassDelta(
  bookTitle: string,
  bookAuthor: string,
  chapterTitle: string,
  text: string,
  previousResult: AnalysisResult,
  config: AnalyzeConfig,
  contextWindow?: number,
): Promise<{ result: AnalysisResult; totalRateLimitMs: number }> {
```

And pass `contextWindow` to every `callAndParseJSON` call inside that function as well.

Also pass `contextWindow` to the reconciliation `callAndParse` wrapper (around line 1418):

```typescript
const callAndParse: CallAndParseFn = async <T>(system: string, userPrompt: string, label: string) => {
  const { result, rateLimitWaitMs: rl } = await callAndParseJSON<T>(system, userPrompt, config, label, config.provider === 'ollama' ? 4096 : undefined, contextWindow);
  totalRateLimitMs += rl;
  return result;
};
```

- [ ] **Step 4: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/api/analyze/route.ts lib/context-window.ts
git commit -m "feat: replace hard truncation with adaptive context-aware chunking"
```

---

### Task 8: Budget-Aware Reconciliation and Verification Text Limits

**Files:**
- Modify: `lib/reconcile.ts:334-374` (`buildCharReconcilePrompt`)
- Modify: `lib/reconcile.ts:376-427` (`buildLocReconcilePrompt`)
- Modify: `app/api/analyze/route.ts:253-286` (`buildVerificationPrompt`)
- Modify: `app/api/analyze/route.ts:1418-1424` (reconciliation call site)

- [ ] **Step 1: Make reconciliation prompts accept a text budget**

In `lib/reconcile.ts`, update `buildCharReconcilePrompt` to accept an optional `maxExcerptChars` parameter instead of hardcoding 15,000. Change the function signature at line 334:

```typescript
export function buildCharReconcilePrompt(
  bookTitle: string, bookAuthor: string, characters: Character[], chapterExcerpts?: string, maxExcerptChars?: number,
): string {
```

And replace the hard slice at line 352:

```typescript
  const textSection = chapterExcerpts
    ? `\nRECENT CHAPTER TEXT (use to verify whether character names actually appear in the book):\n${chapterExcerpts.slice(0, maxExcerptChars ?? 15_000)}\n`
    : '';
```

Apply the same to `buildLocReconcilePrompt` at line 376:

```typescript
export function buildLocReconcilePrompt(
  bookTitle: string, bookAuthor: string, locations: LocationInfo[], characters: Character[], chapterExcerpts?: string, maxExcerptChars?: number,
): string {
```

And replace the hard slice at line 403:

```typescript
  const textSection = chapterExcerpts
    ? `\nRECENT CHAPTER TEXT (use to verify whether location names actually appear in the book):\n${chapterExcerpts.slice(0, maxExcerptChars ?? 15_000)}\n`
    : '';
```

- [ ] **Step 2: Make verification prompt accept a text budget**

In `app/api/analyze/route.ts`, update `buildVerificationPrompt` at line 253:

```typescript
function buildVerificationPrompt(
  characters: AnalysisResult['characters'],
  chapterText: string,
  maxTextChars?: number,
): string {
  const charBlock = characters.map((c, i) =>
    `#${i}: ${c.name} (aliases: ${c.aliases?.join(', ') || 'none'})`,
  ).join('\n');

  const maxTextLen = maxTextChars ?? 80_000;
  const truncatedText = chapterText.length > maxTextLen
    ? chapterText.slice(0, maxTextLen) + '\n[...truncated...]'
    : chapterText;
```

- [ ] **Step 3: Update call sites to pass budget-aware limits**

In `app/api/analyze/route.ts`, update the reconciliation call site (around line 1423) to compute text budgets. The `text.slice(0, 15_000)` becomes budget-aware:

```typescript
    // Compute text budget for reconciliation excerpts
    const reconcileExcerptBudget = contextWindow
      ? computeTextBudget(contextWindow, 4096, buildCharReconcilePrompt(bookTitle, bookAuthor, assembled.characters))
      : 15_000;
    reconciled = await reconcileResult(assembled, bookTitle, bookAuthor, text.slice(0, reconcileExcerptBudget), callAndParse);
```

Similarly for verification prompts in both `runMultiPassFull` and `runMultiPassDelta`, pass a computed budget:

```typescript
    const verifyBudget = contextWindow
      ? computeTextBudget(contextWindow, 4096, buildVerificationPrompt(characters, ''))
      : 80_000;
```

Then pass it: `buildVerificationPrompt(characters, text, verifyBudget)`.

- [ ] **Step 4: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/reconcile.ts app/api/analyze/route.ts
git commit -m "feat: replace hard text slicing with budget-aware limits in reconciliation and verification"
```

---

### Task 9: Per-Pass Budget Safety Net (Level 2 Splitting)

**Files:**
- Modify: `app/api/analyze/route.ts` (inside `runMultiPassFull` and `runMultiPassDelta`)

- [ ] **Step 1: Add a per-pass text splitting helper**

Add this helper function before `runMultiPassFull` (around line 1314):

```typescript
/**
 * Level 2 safety net: if the text exceeds a pass's specific budget,
 * split and run the pass multiple times, merging array results.
 */
async function runPassWithSplitting<T extends Record<string, unknown>>(
  system: string,
  buildPrompt: (text: string) => string,
  config: AnalyzeConfig,
  label: string,
  text: string,
  contextWindow: number | undefined,
  maxTokens: number | undefined,
): Promise<{ result: T | null; rateLimitWaitMs: number }> {
  if (!contextWindow) {
    // No context window info — just run normally
    return callAndParseJSON<T>(system, buildPrompt(text), config, label, maxTokens, contextWindow);
  }

  const outputReserve = maxTokens ?? 16384;
  // Build the prompt WITHOUT the text to measure overhead
  const promptWithoutText = buildPrompt('');
  const budget = computeTextBudget(contextWindow, outputReserve, promptWithoutText);

  if (text.length <= budget) {
    return callAndParseJSON<T>(system, buildPrompt(text), config, label, maxTokens, contextWindow);
  }

  // Text exceeds this pass's budget — split and run multiple times
  const chunks = splitChapterText(text, budget);
  console.log(`[analyze] ${label}: text exceeds pass budget (${text.length} > ${budget} chars), splitting into ${chunks.length} sub-calls`);

  let accumulated: T | null = null;
  let totalRl = 0;

  for (const chunk of chunks) {
    const { result, rateLimitWaitMs } = await callAndParseJSON<T>(
      system, buildPrompt(chunk.text), config, `${label}-chunk${chunk.index + 1}`, maxTokens, contextWindow,
    );
    totalRl += rateLimitWaitMs;
    if (!result) continue;

    if (!accumulated) {
      accumulated = result;
    } else {
      // Merge array fields from the chunk result into accumulated
      for (const key of Object.keys(result)) {
        const val = result[key];
        const existing = accumulated[key as keyof T];
        if (Array.isArray(val) && Array.isArray(existing)) {
          (accumulated as Record<string, unknown>)[key] = [...existing, ...val];
        } else if (val !== undefined && existing === undefined) {
          (accumulated as Record<string, unknown>)[key] = val;
        }
      }
    }
  }

  return { result: accumulated, rateLimitWaitMs: totalRl };
}
```

- [ ] **Step 2: Update character pass in `runMultiPassFull` to use `runPassWithSplitting`**

In `runMultiPassFull`, replace the character pass call (around lines 1330-1334):

```typescript
  // Pass 1: Characters
  console.log('[analyze] Pass 1: characters');
  const charSystem = config.provider === 'ollama' ? CHARACTERS_SYSTEM_LOCAL : CHARACTERS_SYSTEM;
  const charSchema = config.provider === 'ollama' ? CHARACTER_SCHEMA_LOCAL : CHARACTER_SCHEMA;
  const { result: charsResult, rateLimitWaitMs: rlChars } = await runPassWithSplitting<{ characters?: AnalysisResult['characters'] }>(
    charSystem,
    (t) => buildCharactersFullPrompt(bookTitle, bookAuthor, chapterTitle, t, charSchema),
    config, 'characters-full', text, contextWindow, config.provider === 'ollama' ? 16384 : undefined,
  );
```

Apply the same pattern for the location pass and arc pass in `runMultiPassFull`:

```typescript
  // Pass 2: Locations
  const { result: locsResult, rateLimitWaitMs: rlLocs } = await runPassWithSplitting<LocResult>(
    locSystem,
    (t) => buildLocationsFullPrompt(bookTitle, bookAuthor, chapterTitle, characters, t, allChapterTitles, locSchema),
    config, 'locations-full', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
  );
```

```typescript
  // Pass 3: Arcs
  const { result: arcsResult, rateLimitWaitMs: rlArcs } = await runPassWithSplitting<{ arcs?: AnalysisResult['arcs'] }>(
    arcSystem,
    (t) => buildArcsFullPrompt(bookTitle, bookAuthor, chapterTitle, t, characters, locations, allChapterTitles),
    config, 'arcs-full', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
  );
```

- [ ] **Step 3: Apply same pattern to `runMultiPassDelta`**

Replace character, location, and arc pass calls in `runMultiPassDelta` with `runPassWithSplitting`, using the delta prompt builders:

```typescript
  // Pass 1: Characters (delta)
  const { result: charsResult, rateLimitWaitMs: rlChars } = await runPassWithSplitting<CharDeltaResult>(
    charSystem,
    (t) => buildCharactersDeltaPrompt(bookTitle, bookAuthor, chapterTitle, previousResult.characters, t, charDeltaSchema),
    config, 'characters-delta', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
  );
```

```typescript
  // Pass 2: Locations (delta)
  const { result: locsResult, rateLimitWaitMs: rlLocs } = await runPassWithSplitting<LocDeltaResult>(
    locSystem,
    (t) => buildLocationsDeltaPrompt(bookTitle, bookAuthor, chapterTitle, currentCharacters, previousResult.locations, t, locDeltaSchema),
    config, 'locations-delta', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
  );
```

```typescript
  // Pass 3: Arcs (delta)
  const { result: arcsResult, rateLimitWaitMs: rlArcs } = await runPassWithSplitting<ArcDeltaResult>(
    arcSystem,
    (t) => buildArcsDeltaPrompt(bookTitle, bookAuthor, chapterTitle, previousResult.arcs, currentCharacters, currentLocations, t),
    config, 'arcs-delta', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
  );
```

- [ ] **Step 4: Verify build**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "feat: add per-pass budget safety net (Level 2 splitting)"
```

---

### Task 10: End-to-End Verification

**Files:**
- No file changes — manual testing

- [ ] **Step 1: Verify the build is clean**

Run: `cd D:/Development/ebook-tracker && npx next build 2>&1 | tail -20`

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Start the dev server and test with a book**

Run: `cd D:/Development/ebook-tracker && npx next dev`

Test by:
1. Open the app in a browser
2. Upload an EPUB with at least one long chapter
3. Start analysis and watch the console for:
   - `[context-window] Ollama model ...: context_length=...` (or `num_ctx=...`)
   - `[analyze] Context window: N tokens`
   - If chunking occurs: `[analyze] Chapter "..." split into N chunks`
   - Each chunk processed: `[analyze] Chapter "..." chunk 1/N (M chars)`
4. Verify characters from the beginning of long chapters are not missing
5. Verify no `[... middle chapters omitted ...]` truncation occurs

- [ ] **Step 3: Test with a small context window**

If possible, create a custom Ollama Modelfile with a small `num_ctx` (e.g., 4096) to force aggressive chunking and verify:
- Many chunks are created
- Warning message appears in console
- All entities are still extracted (just more slowly)

- [ ] **Step 4: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```
