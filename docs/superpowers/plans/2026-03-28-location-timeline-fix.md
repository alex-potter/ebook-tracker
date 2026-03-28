# Location Timeline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix empty location timelines in LocationModal for early book chapters, and improve grounding validation so fewer valid locations are dropped.

**Architecture:** Three targeted fixes across UI (LocationModal filter), AI prompts (recentEvents schema wording), and validation logic (multi-word name fallback). Each fix is independent and can be verified in isolation.

**Tech Stack:** Next.js, TypeScript, React

---

### Task 1: Relax LocationModal timeline filter

**Files:**
- Modify: `components/LocationModal.tsx:142`

- [ ] **Step 1: Change the timeline filter condition**

In `components/LocationModal.tsx`, find the timeline-building loop (around line 142). Change the condition from requiring characters present to allowing events-only entries:

```typescript
// BEFORE (line 142):
    if (present.length > 0 && (charsChanged || hasEvents)) {
      timeline.push({
        chapterIndex: snap.index,
        locationEvents: locInfo?.recentEvents,
        characters: present.map((c) => ({ name: c.name, status: c.status })),
      });
    }
    prevCharNames = present.length > 0 ? curNames : new Set();

// AFTER:
    if (hasEvents || (present.length > 0 && charsChanged)) {
      timeline.push({
        chapterIndex: snap.index,
        locationEvents: locInfo?.recentEvents,
        characters: present.map((c) => ({ name: c.name, status: c.status })),
      });
    }
    if (present.length > 0) prevCharNames = curNames;
```

Note: The `prevCharNames` update also changes. Previously it reset to empty set when `present.length === 0`. Now we only update when characters are actually present, so character-change detection stays correct across chapters where only events (no characters) appear.

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Manual verification**

Open the app, load a book that has been processed. Click a location tag in the StoryTimeline for an early chapter. The LocationModal should now show timeline entries with event text even if no characters have `currentLocation` set to that location.

- [ ] **Step 4: Commit**

```bash
git add components/LocationModal.tsx
git commit -m "fix: show location timeline entries when recentEvents exist without characters present"
```

---

### Task 2: Make recentEvents always-provide in location schemas

**Files:**
- Modify: `app/api/analyze/route.ts:116,131`

- [ ] **Step 1: Update LOCATION_SCHEMA recentEvents instruction**

In `app/api/analyze/route.ts`, find `LOCATION_SCHEMA` (line 116). Change the `recentEvents` field description:

```typescript
// BEFORE (line 116):
      "recentEvents": "1–2 sentences describing what happened at this location in the current chapter. Omit if nothing notable occurred here.",

// AFTER:
      "recentEvents": "1–2 sentences describing what happened at this location in the current chapter. Always provide this — if you extracted this location, something relevant happened here.",
```

- [ ] **Step 2: Update LOCATION_DELTA_SCHEMA recentEvents instruction**

In the same file, find `LOCATION_DELTA_SCHEMA` (line 131). Apply the same change:

```typescript
// BEFORE (line 131):
      "recentEvents": "1–2 sentences describing what happened at this location in this chapter. Omit if nothing notable occurred here.",

// AFTER:
      "recentEvents": "1–2 sentences describing what happened at this location in this chapter. Always provide this — if you extracted this location, something relevant happened here.",
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds (these are string literals, no type changes).

- [ ] **Step 4: Commit**

```bash
git add app/api/analyze/route.ts
git commit -m "fix: make recentEvents always-provide in location extraction schemas"
```

---

### Task 3: Improve grounding validation multi-word fallback

**Files:**
- Modify: `lib/validate-entities.ts:43-50,89-97`

- [ ] **Step 1: Update character validation fallback to use longest word**

In `lib/validate-entities.ts`, find the character multi-word fallback (lines 39-50). Change from checking the last word to checking the longest word:

```typescript
// BEFORE (lines 39-50):
    // Fallback for multi-word names: check individual significant words.
    // Require the LAST word (most likely a surname/distinctive identifier) to appear,
    // not just any word — otherwise generic titles like "Lord", "Sir", "Captain"
    // let hallucinated names through.
    if (!isGrounded && char.name.split(/\s+/).length > 1) {
      const words = char.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const surname = words[words.length - 1];
        const pattern = new RegExp(`\\b${escapeRegex(surname.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }

// AFTER:
    // Fallback for multi-word names: check the LONGEST word (most distinctive).
    // Generic titles like "Lord", "Sir", "Captain" are short and filtered by the
    // length >= 3 requirement, while distinctive identifiers like "Stormblessed"
    // or "Shattered" are typically the longest word in the name.
    if (!isGrounded && char.name.split(/\s+/).length > 1) {
      const words = char.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const longest = words.reduce((a, b) => (a.length >= b.length ? a : b));
        const pattern = new RegExp(`\\b${escapeRegex(longest.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }
```

- [ ] **Step 2: Update location validation fallback to use longest word**

In the same file, find the location multi-word fallback (lines 89-97). Apply the same change:

```typescript
// BEFORE (lines 89-97):
    // Fallback for multi-word names: check last word (most distinctive part)
    if (!isGrounded && loc.name.split(/\s+/).length > 1) {
      const words = loc.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const lastWord = words[words.length - 1];
        const pattern = new RegExp(`\\b${escapeRegex(lastWord.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }

// AFTER:
    // Fallback for multi-word names: check the LONGEST word (most distinctive).
    // Place-type suffixes like "Plains", "Hills", "City" are often generic,
    // while the longest word (e.g. "Shattered", "Unclaimed") is more distinctive.
    if (!isGrounded && loc.name.split(/\s+/).length > 1) {
      const words = loc.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const longest = words.reduce((a, b) => (a.length >= b.length ? a : b));
        const pattern = new RegExp(`\\b${escapeRegex(longest.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/validate-entities.ts
git commit -m "fix: use longest word for grounding fallback instead of last word"
```

---

### Task 4: End-to-end verification

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual integration test**

1. Start the dev server: `npm run dev`
2. Load a book (ideally *The Way of Kings* or a book where early chapters had missing locations)
3. Re-process at least the first 3 chapters using "Process Entire Book" or individually
4. Check the StoryTimeline: locations should still appear tagged on early chapters
5. Click a location tag in the timeline: the LocationModal should now show a non-empty timeline with event descriptions
6. Check the server console: "Dropped N ungrounded locations" count should be lower (or zero) for chapters with multi-word location names
7. Check the LocationBoard tab: locations with recentEvents should appear for early chapters

- [ ] **Step 3: Final commit with all changes**

If any adjustments were needed during verification, commit them:

```bash
git add -A
git commit -m "fix: location timeline and grounding validation improvements"
```

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```
