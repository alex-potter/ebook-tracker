# Adaptive Context-Aware Chunking for Book Processing

**Date**: 2026-03-27
**Goal**: Ensure no chapter content is ever skipped, dropped, or truncated during analysis — accuracy over processing time or API calls.

## Problem Statement

The current analysis pipeline has three data loss vectors:

1. **Long chapters truncated** (Problem A): Single chapters exceeding 120k chars (delta) or 180k chars (full) are hard-truncated, silently dropping content from the beginning of the chapter. Characters and events in the dropped portion are never extracted.

2. **Middle chapters dropped in full analysis** (Problem B): When total text exceeds 180k chars, the system keeps the first 50k and last 130k chars, discarding everything in between with a `[... middle chapters omitted ...]` marker.

3. **Truncated LLM output** (Problem C): When the model's response hits `max_tokens`, the JSON is cut off mid-object. `recoverPartialJson` salvages complete objects but entities after the truncation point are permanently lost.

All three are caused by the same root issue: fixed-size limits that don't account for the actual model context window, which varies across providers and user configurations (especially Ollama where `num_ctx` can range from 4096 to 128k+).

## Design: Server-Side Adaptive Chunking

### Overview

The API route detects the model's context window at call time, calculates a safe input budget, and splits oversized chapters into sub-chunks — all transparently. The client sends chapters exactly as it does today; the server handles the rest.

### 1. Context Window Detection

**New module: `lib/context-window.ts`**

Exports `getContextWindow(config): Promise<number>` — returns the context window size in tokens.

#### Provider-specific detection

- **Ollama**: The user-configured `baseUrl` typically points to `http://localhost:11434/v1` (OpenAI-compatible endpoint). Strip the `/v1` suffix to get the Ollama native API base, then `POST {ollamaBase}/api/show` with `{ name: model }`. The response includes `model_info` with a context length key (e.g. `qwen2.5.context_length`) or `num_ctx` in parameters. If the endpoint is unreachable or returns an error, fall back to **4096 tokens** (the Ollama default).

- **Anthropic**: Lookup table keyed by model name. Known models: `claude-haiku-4-5-20251001` = 200k, `claude-sonnet-4-5-20241022` = 200k. Fallback for unknown Anthropic models: **100k tokens**.

- **Gemini**: Lookup table. Known models: `gemini-2.0-flash` = 1M, `gemini-2.5-pro` = 1M. Fallback: **128k tokens**.

- **OpenAI-compatible**: Try `GET {baseUrl}/models/{model}` which often includes `context_length` or `context_window`. If unavailable, fall back to **8192 tokens** (conservative since context size is unknown).

#### Caching

Cache the detected value for the duration of a single API request (not globally), since different requests may target different models.

### 2. Text Budget Calculation

For each LLM call, compute the available input budget in characters:

```
prompt_overhead_tokens = estimate_tokens(system_prompt + schema + existing_entity_list + instructions)
output_reserve_tokens  = max_output_tokens for this pass (see below)
available_input_tokens = context_window - output_reserve_tokens - prompt_overhead_tokens
available_input_chars  = available_input_tokens * 3.5
```

Token estimation uses 3.5 chars/token (conservative for English text).

**Output token reserves per pass:**
- Character pass: 8192 tokens (or scaled — see Section 5)
- Location pass: 8192 tokens
- Arc pass: 4096 tokens
- Verification pass: 4096 tokens
- Reconciliation pass: 4096 tokens

### 3. Chapter Splitting

**New function: `splitChapterText(text, availableChars): ChapterChunk[]`**

Returns an array of sub-chunks. If the text fits within `availableChars`, returns a single-element array.

#### Splitting strategy

1. Find the last `\n\n` (paragraph boundary) before the `availableChars` limit
2. If no `\n\n` found, fall back to last `\n` (line boundary)
3. If no `\n` found, fall back to last `. ` (sentence boundary)
4. Include **~500 chars of overlap** from the end of the previous chunk at the start of the next chunk, to avoid missing entities at boundaries

#### Return type

```typescript
interface ChapterChunk {
  text: string;
  index: number;   // 0-based sub-chunk index
  total: number;   // total sub-chunks for this chapter
}
```

#### Edge cases

- **Empty/whitespace-only chunks**: Skip them.
- **Tiny context windows**: A chapter may split into 20+ chunks. This is correct behavior. Log a warning: `[analyze] Warning: context window is N tokens — chapter "X" will require M chunks. Consider increasing num_ctx for better performance.`

### 4. Integration into the Analysis Pipeline

#### Changes to `app/api/analyze/route.ts`

**Remove hard truncation:**
- Delete `MAX_NEW_CHARS` (120k), `MAX_CHARS` (180k), `HEAD_CHARS` (50k) constants
- Remove the truncation logic in the `POST` handler (lines 1592, 1601-1606)
- The adaptive chunking replaces all of this

**Two-level splitting:**

There are two levels where text may be split, addressing different concerns:

**Level 1 — Chapter-level splitting (in the `POST` handler):**
Splits the chapter into sub-chunks before entering the multi-pass pipeline. Uses a conservative budget estimate (smallest of the three passes). Each sub-chunk runs through the full 3-pass pipeline (characters → locations → arcs), and results accumulate between sub-chunks.

```
1. Detect context window (once per request)
2. Estimate conservative text budget (using the pass with the most overhead)
3. Split chapter text into sub-chunks based on that budget
4. For each sub-chunk:
   a. If first sub-chunk and no prior state → runMultiPassFull
   b. Otherwise → runMultiPassDelta against accumulated state
   c. Accumulated result = output of this sub-chunk
5. Return final accumulated result
```

**Level 2 — Per-pass splitting (inside `runMultiPassFull`/`runMultiPassDelta`):**
A safety net. Each of the 3 passes has different prompt overhead (character pass includes the character list, arc pass includes characters + locations + arcs). If a sub-chunk from Level 1 still exceeds a specific pass's budget (because the entity lists grew large), the pass itself re-splits the text and runs multiple LLM calls, merging results between splits. This is unlikely to trigger often but prevents any edge case where entity list growth makes a sub-chunk too large for a later pass.

**What stays the same:**
- `mergeDelta`, `deduplicateCharacters`, `deduplicateLocations`, `deduplicateArcs`
- Reconciliation, verification, and all post-processing
- Sub-chunk merging uses the exact same merge path as chapter-to-chapter merging

### 5. Output Truncation Protection

#### Continuation on truncated output

When `callAndParseJSON` detects a truncated response (partial JSON recovery triggered):

1. Count how many entities were successfully recovered
2. Re-call the LLM with a continuation prompt: "Continue extracting from the text. You already found these N characters: [names]. Find any ADDITIONAL characters not listed above."
3. Merge continuation results into the recovered partial
4. Repeat until the response completes without truncation, up to 3 continuation passes

#### Dynamic output token scaling

Instead of fixed `maxTokens` values, scale based on input size:

```
maxTokens = max(baseTokens, inputChars / 20)
```

Capped at whatever the context window allows after input. The `/20` ratio is conservative — roughly 1 output token per 20 chars of input text.

#### Unified continuation across providers

Extend the Anthropic continuation loop pattern (assistant prefill with partial output) to Gemini and OpenAI-compatible providers. All providers detect their respective truncation signals:
- Anthropic: `stop_reason === 'max_tokens'`
- Gemini: `finishReason === 'MAX_TOKENS'`
- OpenAI-compatible: `finish_reason === 'length'`

### 6. Progress Reporting

**API response addition:**

```typescript
{ _chunkInfo?: { chunks: number; currentChunk: number } }
```

Only present when a chapter was split (chunks > 1). The client can display `ch.3/12 (chunk 2/4)` in the progress pill. Absence means the chapter was processed in a single pass (no change from current behavior).

**Server-side logging:**

Each sub-chunk logs: `[analyze] Chapter "X" chunk 2/4 (chars 45000-90000)`

### 7. Scope Boundaries

**What is NOT changed:**

- **Mobile/client-side path** (`lib/ai-shared.ts`, `lib/ai-client.ts`): The mobile path uses the Anthropic SDK directly in the browser with a 200k context window. Truncation is far less likely. The `truncateForFullAnalysis`, `truncateForDelta`, `buildFullPrompt`, and `buildUpdatePrompt` functions in `ai-shared.ts` remain untouched.

- **Client-side analysis loop** (`app/page.tsx`): Still sends one chapter at a time. No client changes needed.

- **Merge/dedup/reconciliation logic**: All existing post-processing remains identical.

### 8. Safety and Edge Cases

- **Context detection failure**: Fall back to conservative defaults (4096 for Ollama, 8192 for OpenAI-compatible) — over-splitting is better than silent truncation.

- **Reconciliation/verification prompts**: Currently hard-slice text at 15k/80k chars. Apply the same budget-aware approach — calculate available chars after entity data and truncate text to fit. For reconciliation, entity data takes priority over raw text excerpts.

- **Overlap deduplication**: The ~500 char overlap between sub-chunks means some text appears in two consecutive chunks. The existing `deduplicateCharacters`/`deduplicateLocations` and `mergeDelta` logic handles this — entities extracted from both chunks are merged by name.

## Files Changed

| File | Change |
|------|--------|
| `lib/context-window.ts` | **New** — context window detection + text budget calculation + chapter splitting |
| `app/api/analyze/route.ts` | Remove hard truncation constants; add sub-chunk loop; per-pass budget recalculation |
| `lib/llm.ts` | Extend continuation loop to Gemini and OpenAI-compatible providers |
| `lib/reconcile.ts` | Replace hard 15k slice with budget-aware text truncation |

## Files NOT Changed

| File | Reason |
|------|--------|
| `lib/ai-shared.ts` | Mobile path only; separate constraints |
| `lib/ai-client.ts` | Mobile path only |
| `app/page.tsx` | Client sends chapters as-is; server handles splitting |
| `components/ProcessingQueue.tsx` | May optionally display chunk info from response, but not required |
