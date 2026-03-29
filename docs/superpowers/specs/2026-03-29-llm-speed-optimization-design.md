# Local LLM Speed Optimization

**Date:** 2026-03-29
**Status:** Approved
**Goal:** Reduce chapter processing time from 60+ minutes to under 30 minutes on consumer hardware (RTX 3080 10GB) without sacrificing accuracy on important characters.

## Problem

Long, complex chapters (e.g., "A Long Expected Party" from Fellowship of the Ring) take 60+ minutes to process on qwen2.5:32b with 32K context. The root cause is a hardware/model mismatch:

- qwen2.5:32b at Q4 requires ~18GB VRAM for weights alone
- A 10GB GPU can hold ~40% of the model; the rest spills to CPU/RAM
- This drops generation speed to ~0.5-2 tok/s (vs. 20+ tok/s when fully GPU-resident)
- A single character extraction pass reserves 12,800 output tokens, taking 1-7 hours at that speed

Secondary factor: prompts demand exhaustive extraction of every named character, generating massive output for chapters with large casts.

## Approach

**Right-sized model + focused prompts** — switch to a model that fits in 10GB VRAM and tune prompts to prioritize precision on important characters over exhaustive completeness.

## Design

### 1. Model Selection

**Primary: qwen2.5:14b** (Q4_K_M, ~9GB VRAM)

- Same model family — prompt behavior is predictable, no prompt rewriting needed beyond the tuning below
- Fits in 10GB VRAM with room for KV cache at 16K context (~0.5-1GB)
- Expected speed: 15-25 tok/s (fully GPU-accelerated)
- Quality drop from 32b to 14b is small for structured JSON extraction

**Fallback: qwen3:8b** (Q4_K_M, ~5GB VRAM)

- Use if qwen2.5:14b is too tight on VRAM (Ollama logs warnings about layer offloading)
- Fits easily with 32K context
- Latest generation, strong at instruction following

**Recommended context window:** 16K for qwen2.5:14b (leaves VRAM headroom for KV cache). If using qwen3:8b, 32K is fine.

### 2. Prompt Tuning

All changes are to the local model (`_LOCAL`) prompt variants only. Cloud provider prompts are unchanged.

#### CHARACTERS_SYSTEM_LOCAL

Replace rules 3-4:

**Current:**
```
3. Include every named character who appears by name in the text — protagonists, antagonists, and minor characters.
4. A character mentioned once by name still gets an entry.
```

**New:**
```
3. Include all main and secondary characters who play a role in the chapter's events with full detail.
4. For minor characters (mentioned only in passing, no plot significance), include only their name and importance level — omit description, relationships, and recentEvents.
```

#### buildCharactersFullPrompt

**Current instruction text:**
```
Extract a COMPLETE character roster — every named character who appears, from major protagonists to characters who appear in a single scene. Do not skip anyone because they seem minor.
```

**New:**
```
Extract characters who matter to this chapter's events. Include all main and secondary characters with full detail. Minor characters (mentioned once in passing, no significant action) need only name and importance — keep their entries brief.
```

#### buildCharactersDeltaPrompt

Update instruction 2 (new character introduction):

**Current:**
```
2. For any BRAND NEW named character introduced in this chapter: include them in "updatedCharacters" with all fields filled in. NEVER group individuals — each person gets their own entry.
```

**New:**
```
2. For any BRAND NEW main or secondary character introduced in this chapter: include them in "updatedCharacters" with all fields filled in. For new minor characters (mentioned only in passing), include only name, importance, and status. NEVER group individuals — each person gets their own entry.
```

### 3. Output Token Reduction

Reduce `maxTokens` passed to `runPassWithSplitting` for Ollama provider:

| Pass | Current | New |
|------|---------|-----|
| Characters (Pass 1) | 16,384 | 4,096 |
| Locations (Pass 2) | 8,192 | 2,048 |
| Arcs (Pass 3) | 4,096 | 2,048 |

**Rationale:**
- Focused character extraction (10-15 entries, brief minor stubs) fits in 4K tokens
- Locations already capped at 15 — 2K tokens is sufficient
- Arcs target 3-7 entries — 2K tokens is sufficient
- Smaller output reserves reduce VRAM pressure and give `computeTextBudget` more room for input text
- The existing `attemptOutputContinuation` mechanism still catches genuine truncation

### 4. No Changes Required

These components remain unchanged:

- Multi-pass architecture (characters -> locations -> arcs)
- Level 1 chunking (splitChapterText) and Level 2 splitting (runPassWithSplitting)
- Text grounding validation (validateCharactersAgainstText, validateLocationsAgainstText)
- Character/location deduplication
- Output continuation for truncated responses
- Reconciliation skip for large entity counts (commit 2871ad0)
- Delta analysis for subsequent chunks (runMultiPassDelta)
- All cloud provider code paths

## Time Estimate

For "A Long Expected Party" (~50-100K chars) on qwen2.5:14b at 16K context, ~20 tok/s:

- Text budget per call: ~40K chars
- Chapter splits into 2-3 chunks
- Per chunk: ~5 min (3 passes, reduced output)
- **Total: 10-18 minutes** (vs. 60+ minutes current)

## Files to Modify

1. `app/api/analyze/route.ts` — prompt text changes (CHARACTERS_SYSTEM_LOCAL rules 3-4, buildCharactersFullPrompt instruction, buildCharactersDeltaPrompt instruction, maxTokens values for Ollama on all 3 passes)
2. No UI/documentation changes required — model selection and context window are already user-configurable via settings

## Risks

- **qwen2.5:14b quality regression:** Mitigated by same-family model, focused prompts, and existing text grounding validation. If quality is insufficient, qwen3:8b is an alternative.
- **Minor characters missed:** Intentional tradeoff per user preference. Minor characters still get name+importance stubs, just not full detail.
- **4K maxTokens too small for unusual chapters:** The output continuation mechanism handles this automatically. Can be tuned up if observed in practice.
