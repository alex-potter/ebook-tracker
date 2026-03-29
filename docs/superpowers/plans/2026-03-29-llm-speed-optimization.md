# Local LLM Speed Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce chapter processing time from 60+ minutes to under 30 minutes on consumer GPU (RTX 3080 10GB) by tuning prompts for focused extraction and reducing output token reserves.

**Architecture:** All changes are in `app/api/analyze/route.ts`. Prompt text edits to reduce output volume for local models, and maxTokens reductions on all 6 Ollama pass call sites (3 full + 3 delta). Cloud provider paths are untouched.

**Tech Stack:** Next.js API route, Ollama (local LLM), TypeScript

---

### Task 1: Update CHARACTERS_SYSTEM_LOCAL prompt

**Files:**
- Modify: `app/api/analyze/route.ts:148-149`

- [ ] **Step 1: Replace rules 3-4 in CHARACTERS_SYSTEM_LOCAL**

Change lines 148-149 from:

```typescript
3. Include every named character who appears by name in the text — protagonists, antagonists, and minor characters.
4. A character mentioned once by name still gets an entry.
```

To:

```typescript
3. Include all main and secondary characters who play a role in the chapter's events with full detail.
4. For minor characters (mentioned only in passing, no plot significance), include only their name and importance level — omit description, relationships, and recentEvents.
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx next build --no-lint 2>&1 | head -5`
Expected: No syntax errors (build may warn about other things, but no errors in route.ts)

- [ ] **Step 3: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "perf: focus local character extraction on main/secondary characters"
```

---

### Task 2: Update buildCharactersFullPrompt instruction text

**Files:**
- Modify: `app/api/analyze/route.ts:397`

- [ ] **Step 1: Replace the instruction text in buildCharactersFullPrompt**

Change line 397 from:

```typescript
Extract a COMPLETE character roster — every named character who appears, from major protagonists to characters who appear in a single scene. Do not skip anyone because they seem minor.
```

To:

```typescript
Extract characters who matter to this chapter's events. Include all main and secondary characters with full detail. Minor characters (mentioned once in passing, no significant action) need only name and importance — keep their entries brief.
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx next build --no-lint 2>&1 | head -5`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "perf: update full character prompt to prioritize important characters"
```

---

### Task 3: Update buildCharactersDeltaPrompt instruction 2

**Files:**
- Modify: `app/api/analyze/route.ts:428`

- [ ] **Step 1: Replace instruction 2 in buildCharactersDeltaPrompt**

Change line 428 from:

```typescript
2. For any BRAND NEW named character introduced in this chapter: include them in "updatedCharacters" with all fields filled in. NEVER group individuals — each person gets their own entry.
```

To:

```typescript
2. For any BRAND NEW main or secondary character introduced in this chapter: include them in "updatedCharacters" with all fields filled in. For new minor characters (mentioned only in passing), include only name, importance, and status. NEVER group individuals — each person gets their own entry.
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx next build --no-lint 2>&1 | head -5`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "perf: update delta character prompt to keep minor entries brief"
```

---

### Task 4: Reduce maxTokens for Ollama in runMultiPassFull

**Files:**
- Modify: `app/api/analyze/route.ts:1495,1538,1559`

- [ ] **Step 1: Reduce Pass 1 (characters) maxTokens from 16384 to 4096**

Change line 1495 from:

```typescript
    config, 'characters-full', text, contextWindow, config.provider === 'ollama' ? 16384 : undefined,
```

To:

```typescript
    config, 'characters-full', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
```

- [ ] **Step 2: Reduce Pass 2 (locations) maxTokens from 8192 to 2048**

Change line 1538 from:

```typescript
    config, 'locations-full', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
```

To:

```typescript
    config, 'locations-full', text, contextWindow, config.provider === 'ollama' ? 2048 : undefined,
```

- [ ] **Step 3: Reduce Pass 3 (arcs) maxTokens from 4096 to 2048**

Change line 1559 from:

```typescript
    config, 'arcs-full', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
```

To:

```typescript
    config, 'arcs-full', text, contextWindow, config.provider === 'ollama' ? 2048 : undefined,
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx next build --no-lint 2>&1 | head -5`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "perf: reduce Ollama maxTokens for full passes (16384/8192/4096 -> 4096/2048/2048)"
```

---

### Task 5: Reduce maxTokens for Ollama in runMultiPassDelta

**Files:**
- Modify: `app/api/analyze/route.ts:1631,1680,1700`

- [ ] **Step 1: Reduce delta Pass 1 (characters) maxTokens from 8192 to 4096**

Change line 1631 from:

```typescript
    config, 'characters-delta', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
```

To:

```typescript
    config, 'characters-delta', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
```

- [ ] **Step 2: Reduce delta Pass 2 (locations) maxTokens from 8192 to 2048**

Change line 1680 from:

```typescript
    config, 'locations-delta', text, contextWindow, config.provider === 'ollama' ? 8192 : undefined,
```

To:

```typescript
    config, 'locations-delta', text, contextWindow, config.provider === 'ollama' ? 2048 : undefined,
```

- [ ] **Step 3: Reduce delta Pass 3 (arcs) maxTokens from 4096 to 2048**

Change line 1700 from:

```typescript
    config, 'arcs-delta', text, contextWindow, config.provider === 'ollama' ? 4096 : undefined,
```

To:

```typescript
    config, 'arcs-delta', text, contextWindow, config.provider === 'ollama' ? 2048 : undefined,
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx next build --no-lint 2>&1 | head -5`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "perf: reduce Ollama maxTokens for delta passes (8192/8192/4096 -> 4096/2048/2048)"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Pull qwen2.5:14b via Ollama**

Run: `ollama pull qwen2.5:14b`
Expected: Model downloads successfully (~9GB)

- [ ] **Step 2: Update model in app settings**

In the app's AI settings UI, change:
- Model: `qwen2.5:14b`
- Context length override: `16384`

- [ ] **Step 3: Run analysis on a chapter**

Analyze a chapter (ideally "A Long Expected Party" or another long chapter) and verify:
- Processing completes in under 30 minutes
- Main/secondary characters are extracted with full detail
- Minor characters appear with name and importance only
- Locations and arcs are present and reasonable
- Console logs show pass timing

- [ ] **Step 4: Squash commits and push**

```bash
git push origin main
```
