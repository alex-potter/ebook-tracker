# Free Cloud LLM Providers: Unified LLM Caller with Adaptive Rate Limiting

## Problem

The app currently supports two AI providers: Anthropic (requires a paid API key) and Ollama (requires local setup). Most users want to try the app without spending money or configuring a local server. There is no free, zero-friction path to book analysis.

## Solution

Add two new provider options — **Google Gemini** (first-class free tier) and a **generic OpenAI-compatible** endpoint (covers Groq, OpenRouter, Cerebras, etc.). Consolidate all provider logic into a unified LLM caller with an adaptive rate limiter that handles free-tier throttling gracefully. Add a contextual setup prompt that guides users to a free API key at the moment they need one.

## Provider Model

### AiSettings Changes

Expand `AiSettings` in `lib/ai-client.ts`:

```typescript
export interface AiSettings {
  provider: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
  anthropicKey: string;
  ollamaUrl: string;
  model: string;
  // New fields
  geminiKey: string;
  openaiCompatibleUrl: string;   // e.g. https://api.groq.com/openai/v1
  openaiCompatibleKey: string;
  openaiCompatibleName: string;  // user-assigned label, e.g. "Groq"
}
```

`loadAiSettings()` defaults: `provider: 'ollama'`, new fields default to `''`. Existing stored settings without the new fields load cleanly (missing keys → `''`).

### Server Environment Variables

New optional env vars alongside existing ones:

```
GEMINI_API_KEY=...
OPENAI_COMPATIBLE_URL=...
OPENAI_COMPATIBLE_KEY=...
OPENAI_COMPATIBLE_MODEL=...
```

The existing `ANTHROPIC_API_KEY`, `USE_LOCAL_MODEL`, `LOCAL_MODEL_URL`, `LOCAL_MODEL_NAME` remain unchanged.

## Unified LLM Caller (`lib/llm.ts`)

### Overview

A new server-side module that replaces the per-route provider branching. All API routes call `callLLM` instead of directly using `callAnthropic`/`callLocal`.

### LLMCallConfig

```typescript
export interface LLMCallConfig {
  provider: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
  model: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
  jsonMode?: boolean;         // enable native JSON output
  images?: string[];          // base64 data URIs for vision calls (detect-pins)
  // Connection details (resolved by resolveConfig)
  apiKey?: string;            // Anthropic or Gemini or OpenAI-compatible key
  baseUrl?: string;           // Ollama or OpenAI-compatible URL
}
```

### `resolveConfig(body, overrides?)` → `Omit<LLMCallConfig, 'system' | 'userPrompt' | 'maxTokens'>`

Extracts provider/model/connection details from a request body. Priority:

1. Server env vars (if configured for that provider)
2. Client-sent settings (`_provider`, `_apiKey`, `_ollamaUrl`, `_model`, `_geminiKey`, `_openaiCompatibleUrl`, `_openaiCompatibleKey`)
3. Defaults per provider

The server is "configured" if any of `ANTHROPIC_API_KEY`, `USE_LOCAL_MODEL=true`, `GEMINI_API_KEY`, or `OPENAI_COMPATIBLE_URL` are set. When the server is configured, it uses its own env vars and ignores client-sent credentials. When not configured, it falls back to client-sent settings.

### Provider Routing

`callLLM` dispatches to one of four internal callers:

**`callAnthropicProvider`** — Anthropic Messages API. Existing logic from `app/api/analyze/route.ts:1214-1247` moved here. Uses `@anthropic-ai/sdk`. Default model: `claude-haiku-4-5-20251001`.

**`callOllamaProvider`** — OpenAI-compatible chat completions to Ollama URL. Existing logic from `app/api/analyze/route.ts:1249-1278` moved here. Adds `response_format: { type: 'json_object' }` when `jsonMode` is true. Default model: `qwen2.5:14b`.

**`callGeminiProvider`** — Google Generative AI REST API (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`). Uses API key auth via `key` query parameter. When `jsonMode` is true, sets `generationConfig.responseMimeType: "application/json"`. For vision calls, includes image parts in the content array. Default model: `gemini-2.0-flash`.

**`callOpenAICompatibleProvider`** — Standard OpenAI chat completions format to the configured base URL. Adds `response_format: { type: 'json_object' }` when `jsonMode` is true. Uses `Authorization: Bearer {key}` header. Default model: read from `_model` field (no default — user must specify).

### What Moves Out of Routes

Each route's inline provider branching (`useLocal`, `callOpts`, `callAnthropic`/`callLocal` if/else) is replaced by:

```typescript
const config = resolveConfig(body);
const raw = await callLLM({ ...config, system, userPrompt, maxTokens, jsonMode: true });
```

The analyze route's existing `callLLM` wrapper (line 1282), `callAnthropic` (line 1214), `callLocal` (line 1249), and `CallOpts` type (line 1280) all move to `lib/llm.ts` and are generalized to support 4 providers.

### What Stays in Routes

System prompts, JSON schemas, retry-on-bad-JSON loops, validation logic, response parsing, the multi-pass analysis structure — all of this stays in the routes. Only the "make the LLM call" function changes.

## Adaptive Rate Limiter (`lib/rate-limiter.ts`)

### Purpose

Free-tier APIs enforce rate limits (requests/minute, tokens/minute). The rate limiter paces calls to avoid hitting limits and recovers gracefully when limits are hit.

### State

Per-provider pacing state stored in a module-level `Map<string, ProviderPacing>`:

```typescript
interface ProviderPacing {
  currentDelay: number;      // ms to wait between calls
  minDelay: number;          // floor (never go below this)
  maxDelay: number;          // ceiling (never exceed this)
  lastCallTime: number;      // Date.now() of last call
  consecutiveSuccesses: number;
}
```

### Default Pacing Seeds

| Provider | Initial delay | Min delay | Max delay |
|---|---|---|---|
| `anthropic` | 0ms | 0ms | 60,000ms |
| `ollama` | 0ms | 0ms | 5,000ms |
| `gemini` | 2,000ms | 500ms | 120,000ms |
| `openai-compatible` | 1,000ms | 200ms | 120,000ms |

### Adaptive Logic

**Before each call — `waitIfNeeded(provider)`:**
1. Calculate `elapsed = Date.now() - lastCallTime`
2. If `elapsed < currentDelay`, sleep for `currentDelay - elapsed`
3. Update `lastCallTime = Date.now()`

**After a successful call — `recordSuccess(provider)`:**
1. Increment `consecutiveSuccesses`
2. After 5 consecutive successes, reduce `currentDelay` by 25% (minimum: `minDelay`)

**After a 429 response — `recordRateLimit(provider, retryAfterMs?)`:**
1. Parse `Retry-After` header if present (seconds → ms)
2. Set `currentDelay = max(currentDelay * 2, retryAfterMs ?? currentDelay * 2)` (capped at `maxDelay`)
3. Reset `consecutiveSuccesses` to 0
4. Return the delay to wait before retry

### Integration with `callLLM`

The rate limiter is called inside `callLLM`, transparent to routes:

```typescript
export async function callLLM(config: LLMCallConfig): Promise<string> {
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimiter.waitIfNeeded(config.provider);
    try {
      const result = await dispatch(config);
      rateLimiter.recordSuccess(config.provider);
      return result;
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        const waitMs = rateLimiter.recordRateLimit(config.provider, parseRetryAfter(err));
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Rate limit exceeded after max retries');
}
```

`isRateLimitError` checks for HTTP 429 status. `parseRetryAfter` extracts the `Retry-After` header value.

### UI Feedback

When `callLLM` encounters a 429 and waits, the response to the client includes metadata:

```typescript
{ _rateLimited: true, _waitSeconds: number }
```

The analysis progress indicator in `page.tsx` shows: "Waiting for rate limit... (Xs)" when this metadata is present. This is communicated via the response of each chapter analysis call — the client-side `analyzeChapter` function checks for `_rateLimited` in the response and updates the progress UI.

Since the rate limiter handles retries internally, the calling route may need to surface the wait time. The simplest approach: `callLLM` returns a result object `{ text: string; rateLimitWaitMs?: number }` instead of a plain string. Routes pass through the `rateLimitWaitMs` to the response. The client progress UI renders it.

## Client-Side Rate Limiting (Mobile Mode)

`lib/ai-client.ts` handles mobile/APK builds where there is no Next.js server. The same adaptive rate limiting logic applies here but runs in the browser.

Extract the rate limiter logic into a shared module that works in both environments. `lib/rate-limiter.ts` should have no Node.js-specific dependencies — it uses only `Date.now()` and `Promise`/`setTimeout` for sleeping, which work in both environments.

The client-side `callAi` function in `lib/ai-client.ts` is updated to:
1. Support `gemini` and `openai-compatible` providers (adding `callGeminiClient` and `callOpenAICompatibleClient` alongside existing `callAnthropic` and `callOllama`)
2. Wrap calls with the rate limiter's `waitIfNeeded`/`recordSuccess`/`recordRateLimit` cycle

For Gemini client-side calls, the browser calls the Gemini REST API directly (same as server-side, just from the browser). CORS is not an issue — Google AI Studio APIs allow browser requests with API key auth.

For OpenAI-compatible client-side calls, CORS depends on the provider. Groq allows browser CORS. Others may not. If a CORS error is detected, show a message suggesting the user switch to server mode or use a different provider. The existing `diagnoseOllamaConnection` pattern serves as precedent.

## Settings Modal Changes (`components/SettingsModal.tsx`)

### Provider Toggle

Expand from 2 buttons to 4:

```
[ Ollama (local) ] [ Anthropic ] [ Gemini (free) ] [ OpenAI-compatible ]
```

The "Gemini (free)" button has a subtle "(free)" label to signal the zero-cost option.

### Gemini Configuration Panel

Shown when `provider === 'gemini'`:

- **API key** input (password field)
- **"Get a free key"** link → `https://aistudio.google.com/apikey` (opens in new tab)
- **Model selector** dropdown:
  - `gemini-2.0-flash` (fast, recommended)
  - `gemini-2.0-flash-lite` (fastest)
  - `gemini-1.5-pro` (smartest)
- **Note:** "Free tier — no credit card required. Your key is stored on this device only."
- **Test Connection** button (same pattern as existing)

### OpenAI-Compatible Configuration Panel

Shown when `provider === 'openai-compatible'`:

- **Provider name** text input (e.g. "Groq", "OpenRouter") — used for display labels
- **Base URL** input (e.g. `https://api.groq.com/openai/v1`)
- **API key** input (password field)
- **Model name** text input (free-form, e.g. `llama-3.3-70b-versatile`)
- **Quick presets** — clickable chips that auto-fill URL + model:
  - "Groq" → `https://api.groq.com/openai/v1` + `llama-3.3-70b-versatile`
  - "OpenRouter" → `https://openrouter.ai/api/v1` + `meta-llama/llama-3.3-70b-instruct:free`
  - "Cerebras" → `https://api.cerebras.ai/v1` + `llama-3.3-70b`
- **Test Connection** button

### Test Connection

`testConnection` in `lib/ai-client.ts` is updated to support all 4 providers. It sends a lightweight prompt (`"Reply with exactly one word: OK"`) and checks for a successful response. For Gemini, it calls the REST API directly. For OpenAI-compatible, it calls the chat completions endpoint.

## Contextual Setup Prompt

### Trigger

When the user clicks "Analyze" and no provider is configured (no valid key/URL for the selected provider, or provider is still on default `ollama` with no local Ollama running), instead of starting analysis, show an inline setup card.

Detection: `analyzeChapter` in `page.tsx` currently catches errors and sets `analyzeError`. The new logic adds a pre-flight check before the first `analyzeChapter` call in the analysis loop. If settings are unconfigured, set a new state variable `showSetupPrompt = true` instead of starting analysis.

### UI

An inline card rendered in `page.tsx` where analysis results would appear (same area as the existing "click Analyze to begin" placeholder):

```
┌──────────────────────────────────────────────────┐
│  Set up an AI provider to analyze this book      │
│                                                  │
│  ★ Recommended: Google Gemini (free)             │
│  Get a free API key in ~60 seconds               │
│                                                  │
│  ▸ Step-by-step guide  (collapsed by default)    │
│    1. Go to Google AI Studio (link)              │
│    2. Sign in with your Google account           │
│    3. Click "Create API Key"                     │
│    4. Copy the key and paste it below            │
│                                                  │
│  [ API key input ___________] [Test & Save]      │
│                                                  │
│  Other providers → (opens Settings modal)        │
└──────────────────────────────────────────────────┘
```

### Behavior

- **Test & Save:** Validates the key with a lightweight API call (same as Settings test). On success, saves settings with `provider: 'gemini'`, hides the setup card, and automatically starts analysis (calls `handleAnalyze`).
- **"Other providers →":** Opens the Settings modal. After saving in Settings, the setup card disappears on next interaction.
- **Dismissal:** If the user navigates away or uploads a different book, the card is hidden.

### State

`showSetupPrompt: boolean` — non-persisted state in `page.tsx`. Set to `true` when pre-flight check fails. Set to `false` when settings are saved (either via inline card or Settings modal).

## API Route Changes

All 6 routes get the same structural change. The `_provider` field in request bodies expands to accept the new provider values:

```typescript
_provider?: 'anthropic' | 'ollama' | 'gemini' | 'openai-compatible';
_geminiKey?: string;
_openaiCompatibleUrl?: string;
_openaiCompatibleKey?: string;
```

### `app/api/analyze/route.ts`

- Remove `callAnthropic` (line 1214), `callLocal` (line 1249), `CallOpts` (line 1280), and the local `callLLM` wrapper (line 1282)
- Import `callLLM`, `resolveConfig` from `@/lib/llm`
- Replace `useLocal`/`callOpts` resolution (lines 1635-1642) with `const config = resolveConfig(body)`
- Update `runMultiPassFull` and `runMultiPassDelta` to accept `config` instead of `useLocal`/`callOpts`
- The `callAndParse` helper (line 1346) calls `callLLM({ ...config, system, userPrompt, maxTokens, jsonMode: true })` instead of the local `callLLM`
- The `useLocal` checks that gate simplified prompts for local models become `config.provider === 'ollama'` checks. Gemini and OpenAI-compatible providers use the full (non-simplified) prompts since they are cloud models with good instruction-following

### `app/api/group-arcs/route.ts`

- Remove inline Anthropic/Ollama branching
- Import `callLLM`, `resolveConfig` from `@/lib/llm`
- Single call: `callLLM({ ...resolveConfig(body), system: '', userPrompt: prompt, maxTokens: 4096, jsonMode: true })`

### `app/api/chat/route.ts`

- Remove inline provider branching
- Import `callLLM`, `resolveConfig` from `@/lib/llm`
- Chat uses multi-turn messages, so `callLLM` needs to support a `messages` array as an alternative to `userPrompt`. Add optional `messages?: { role: string; content: string }[]` to `LLMCallConfig`. When present, `callLLM` sends the messages array instead of constructing a single user message.

### `app/api/reconcile/route.ts` and `app/api/reconcile-propose/route.ts`

- Remove inline provider branching
- Import `callLLM`, `resolveConfig` from `@/lib/llm`
- These routes use the `CallAndParseFn` abstraction in `lib/reconcile.ts`. Update the factory function that creates the `CallAndParseFn` to use `callLLM` internally.

### `app/api/detect-pins/route.ts`

- Remove inline provider branching
- Import `callLLM`, `resolveConfig` from `@/lib/llm`
- Pass base64 image data via `images` array in `LLMCallConfig`
- Gemini handles vision natively (image parts in content). OpenAI-compatible uses the standard vision message format (`{ type: "image_url", image_url: { url: "data:..." } }`). If the selected provider/model doesn't support vision, the call fails with a clear error message.

## Client-Side `analyzeChapter` Changes (`app/page.tsx`)

The `analyzeChapter` function (line 209) loads `AiSettings` and passes them as `_provider`, `_apiKey`, etc. in the request body. Update it to also pass the new fields:

```typescript
if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
```

The same pattern applies to `generateParentArcs` (which follows the same settings-loading pattern).

### Rate Limit Progress Feedback

The analysis loop in `handleAnalyze` shows per-chapter progress via `setAnalyzeProgress`. When a response includes `_rateLimited: true` and `_waitSeconds`, show this in the progress indicator:

```
Analyzing chapter 5 of 20... (rate limit: waiting 8s)
```

This is a simple string update to the existing progress state — no new UI components needed.

## Files to Create

| File | Purpose |
|------|---------|
| `lib/llm.ts` | Unified `callLLM`, `resolveConfig`, provider dispatch, Gemini caller, OpenAI-compatible caller. Moved + generalized Anthropic and Ollama callers. |
| `lib/rate-limiter.ts` | Adaptive rate limiter: `waitIfNeeded`, `recordSuccess`, `recordRateLimit`. Browser + Node compatible. |

## Files to Modify

| File | Change |
|------|--------|
| `lib/ai-client.ts` | Expand `AiSettings` type, add `geminiKey`/`openaiCompatibleUrl`/`openaiCompatibleKey`/`openaiCompatibleName` fields and defaults, add Gemini + OpenAI-compatible client-side callers, update `callAi`/`chatWithBook`/`testConnection`, integrate client-side rate limiter |
| `components/SettingsModal.tsx` | Add Gemini and OpenAI-compatible provider tabs, model selectors, quick presets for OpenAI-compatible, update test connection |
| `app/page.tsx` | Add `showSetupPrompt` state and inline setup card UI, pass new settings fields to `analyzeChapter`/`generateParentArcs`, show rate limit wait in progress indicator |
| `app/api/analyze/route.ts` | Remove `callAnthropic`/`callLocal`/`CallOpts`/local `callLLM`, import from `lib/llm`, update `runMultiPassFull`/`runMultiPassDelta` to use `resolveConfig` + `callLLM`, gate simplified prompts on `provider === 'ollama'` instead of `useLocal` |
| `app/api/group-arcs/route.ts` | Remove inline provider branching, use `callLLM`/`resolveConfig` |
| `app/api/chat/route.ts` | Remove inline provider branching, use `callLLM`/`resolveConfig` with `messages` array |
| `app/api/reconcile/route.ts` | Remove inline provider branching, update `CallAndParseFn` factory to use `callLLM` |
| `app/api/reconcile-propose/route.ts` | Remove inline provider branching, update `CallAndParseFn` factory to use `callLLM` |
| `app/api/detect-pins/route.ts` | Remove inline provider branching, use `callLLM`/`resolveConfig` with `images` |

## Edge Cases

- **Existing users:** `loadAiSettings()` returns defaults for missing fields. Users with saved Anthropic or Ollama settings are unaffected — their provider stays as-is.
- **Server env vars take precedence:** If the server has `GEMINI_API_KEY` set, client-sent keys are ignored (same pattern as existing `ANTHROPIC_API_KEY` precedence).
- **Gemini free tier limits:** If a user processes many books in one day and exceeds Gemini's daily token quota, the 429 handling surfaces this clearly: "Rate limit reached — try again tomorrow or switch to a different provider."
- **OpenAI-compatible CORS (mobile mode):** Not all OpenAI-compatible providers allow browser CORS. If a CORS error is detected client-side, show: "This provider doesn't support browser requests. Try using the app in server mode, or switch to Gemini or Ollama." The existing `diagnoseOllamaConnection` pattern handles this detection.
- **Vision model compatibility:** Not all providers/models support vision. If `detect-pins` is called with a provider that doesn't support images, return a clear error: "Pin detection requires a vision-capable model. Try Gemini Flash or Claude."
- **Model name validation:** OpenAI-compatible providers have different model naming conventions. The model field is free-form text — no validation beyond the provider accepting it.
- **Empty API keys:** The pre-flight check in `page.tsx` validates that the selected provider has credentials before starting analysis. Missing key → setup prompt.

## Scope Exclusions

- **Streaming responses:** All calls remain non-streaming. Streaming could improve UX for long responses but adds complexity across all 4 providers. Not needed for the core "free and easy" goal.
- **Token counting / usage tracking:** No tracking of token usage or remaining quota. The rate limiter handles throttling reactively.
- **Provider-specific prompt tuning:** Same prompts for all cloud providers (Anthropic, Gemini, OpenAI-compatible). Only Ollama gets simplified prompts (for smaller local models). If a specific cloud model struggles with the prompts, users can switch models — not a first-version concern.
- **Automatic provider fallback:** If one provider fails, the app does not automatically try another. Users switch providers manually in Settings.
- **OAuth / Google Sign-In:** Gemini API keys are pasted manually, not obtained via OAuth. This keeps the integration simple and avoids third-party auth dependencies.
