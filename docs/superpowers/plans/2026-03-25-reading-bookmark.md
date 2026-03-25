# Reading Bookmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-controlled reading bookmark that acts as a spoiler gate, allowing full book analysis upfront while progressively revealing entity data.

**Architecture:** A `readingBookmark` field on `StoredBookState` persists the user's reading position. `page.tsx` computes an `effectiveBookmark` that controls `currentChapterIndex` passed to all entity panels. Navigation beyond the bookmark triggers an inline spoiler banner that must be dismissed before data loads.

**Tech Stack:** React (Next.js), TypeScript, localStorage persistence. No test infrastructure — verification via `npx tsc --noEmit` and `npm run build`.

**Spec:** `docs/superpowers/specs/2026-03-25-reading-bookmark-design.md`

---

## File Map

| File | Role |
|------|------|
| `app/page.tsx` | Data model, state, computed values, navigation gating, spoiler banner, header indicator, bookmark handler |
| `components/ChapterSelector.tsx` | Bookmark icon per chapter row, visual dimming beyond bookmark |

---

### Task 1: Data model, state, and initialization

**Files:**
- Modify: `app/page.tsx:42-50` (StoredBookState interface)
- Modify: `app/page.tsx:306-309` (state declarations)
- Modify: `app/page.tsx:1207` (currentChapterIndex computation)
- Modify: `app/page.tsx:645-686` (activateBook)
- Modify: `app/page.tsx:768-776` (series continuation)

- [ ] **Step 1: Add `readingBookmark` to `StoredBookState`**

In `app/page.tsx`, add the field to the interface at line 49:

```typescript
interface StoredBookState {
  lastAnalyzedIndex: number;
  result: AnalysisResult;
  snapshots: Snapshot[];
  excludedBooks?: number[];
  excludedChapters?: number[];
  chapterRange?: { start: number; end: number };
  bookMeta?: BookMeta;
  readingBookmark?: number; // user-set "read up to" chapter index (inclusive)
}
```

- [ ] **Step 2: Add `spoilerDismissedIndex` state**

After the `viewingSnapshotIndex` declaration at line 309, add:

```typescript
const [spoilerDismissedIndex, setSpoilerDismissedIndex] = useState<number | null>(null);
```

- [ ] **Step 3: Compute `effectiveBookmark` and update `currentChapterIndex`**

Replace line 1207:

```typescript
const currentChapterIndex = viewingSnapshotIndex ?? stored?.lastAnalyzedIndex ?? 0;
```

With:

```typescript
const effectiveBookmark = Math.min(
  stored?.readingBookmark ?? stored?.lastAnalyzedIndex ?? 0,
  stored?.lastAnalyzedIndex ?? 0,
); // clamp bookmark to analyzed range
// viewingSnapshotIndex is deliberately excluded: the bookmark is the spoiler ceiling.
// When viewing a snapshot below the bookmark, panels still show data up to the bookmark.
// When viewing beyond the bookmark (spoiler dismissed), spoilerDismissedIndex takes over.
const currentChapterIndex = spoilerDismissedIndex ?? effectiveBookmark;
```

- [ ] **Step 4: Update `activateBook` to load bookmark snapshot**

In `activateBook`, replace lines 666-673 (the `setViewingSnapshotIndex(null)` + `setCurrentIndex(0)` + `if` block):

```typescript
    setViewingSnapshotIndex(null);
    setCurrentIndex(0);
    if (initialStored && initialStored.lastAnalyzedIndex >= 0) {
      setResult(initialStored.result);
      // Default to the next unanalyzed chapter so Analyze is ready to go immediately
      const nextIdx = Math.min(initialStored.lastAnalyzedIndex + 1, parsed.chapters.length - 1);
      setCurrentIndex(nextIdx);
    }
```

With:

```typescript
    if (initialStored && initialStored.lastAnalyzedIndex >= 0) {
      const bookmark = initialStored.readingBookmark;
      if (bookmark != null && bookmark < initialStored.lastAnalyzedIndex) {
        // Load the bookmark's snapshot as the default view
        const snap = bestSnapshot(initialStored.snapshots, bookmark);
        setResult(snap?.result ?? initialStored.result);
        setViewingSnapshotIndex(snap?.index ?? null);
        setCurrentIndex(bookmark);
      } else {
        setResult(initialStored.result);
        setViewingSnapshotIndex(null);
        const nextIdx = Math.min(initialStored.lastAnalyzedIndex + 1, parsed.chapters.length - 1);
        setCurrentIndex(nextIdx);
      }
    } else {
      setViewingSnapshotIndex(null);
      setCurrentIndex(0);
    }
```

Note: The pre-existing `setViewingSnapshotIndex(null)` and `setCurrentIndex(0)` at lines 666-667 are moved into the branches to avoid redundant double-sets.

- [ ] **Step 5: Reset bookmark on series continuation**

In `handleContinueFrom` (line 772), update the carried state:

```typescript
const carried: StoredBookState = { lastAnalyzedIndex: -1, result: prevStored.result, snapshots: [] };
```

The `readingBookmark` field is intentionally omitted (defaults to `undefined`), so no code change needed here. Just verify it is NOT carried forward.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add readingBookmark to StoredBookState and wire up effectiveBookmark"
```

---

### Task 2: Bookmark handler and persistence

**Files:**
- Modify: `app/page.tsx` (add handler function, near line 400 with other handlers)

- [ ] **Step 1: Add `handleSetBookmark` function**

Add after the `setChapterRange` handler (~line 400):

```typescript
function handleSetBookmark(index: number | null) {
  if (!book || !storedRef.current) return;
  const stored = storedRef.current;
  const updated: StoredBookState = { ...stored, readingBookmark: index ?? undefined };
  // Clean up: if readingBookmark is undefined, delete the key entirely
  if (index == null) delete (updated as any).readingBookmark;
  storedRef.current = updated;
  saveStored(book.title, book.author, updated);

  // Load the appropriate snapshot for the new bookmark position
  const bookmark = index ?? stored.lastAnalyzedIndex;
  setSpoilerDismissedIndex(null);
  if (bookmark >= stored.lastAnalyzedIndex) {
    setResult(stored.result);
    setViewingSnapshotIndex(null);
  } else {
    const snap = bestSnapshot(stored.snapshots, bookmark);
    if (snap) {
      setResult(snap.result);
      setViewingSnapshotIndex(snap.index);
    }
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: Clean compile (handler not yet wired to UI).

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add handleSetBookmark handler with persistence"
```

---

### Task 3: Navigation gating and spoiler dismiss

**Files:**
- Modify: `app/page.tsx:716-734` (handleChapterChange)
- Modify: `app/page.tsx:1405-1416` (snapshot stepper goTo)

- [ ] **Step 1: Update `handleChapterChange` for spoiler gating**

Replace the `handleChapterChange` function (lines 716-734):

```typescript
function handleChapterChange(i: number) {
  setCurrentIndex(i);
  const stored = storedRef.current;
  if (!stored || stored.lastAnalyzedIndex < 0) return;

  const bookmark = Math.min(
    stored.readingBookmark ?? stored.lastAnalyzedIndex,
    stored.lastAnalyzedIndex,
  );

  if (i > bookmark) {
    // Beyond bookmark — don't load snapshot yet, show spoiler warning
    setSpoilerDismissedIndex(null);
    return;
  }

  // Within bookmark — clear spoiler state and load snapshot
  setSpoilerDismissedIndex(null);

  if (i >= stored.lastAnalyzedIndex) {
    setResult(stored.result);
    setViewingSnapshotIndex(null);
  } else {
    const snap = bestSnapshot(stored.snapshots, i);
    if (snap) {
      setResult(snap.result);
      setViewingSnapshotIndex(snap.index);
    }
  }
}
```

- [ ] **Step 2: Add `handleDismissSpoiler` function**

Add after `handleChapterChange`:

```typescript
function handleDismissSpoiler() {
  const stored = storedRef.current;
  if (!stored) return;
  setSpoilerDismissedIndex(currentIndex);
  if (currentIndex >= stored.lastAnalyzedIndex) {
    setResult(stored.result);
    setViewingSnapshotIndex(null);
  } else {
    const snap = bestSnapshot(stored.snapshots, currentIndex);
    if (snap) {
      setResult(snap.result);
      setViewingSnapshotIndex(snap.index);
    }
  }
}
```

- [ ] **Step 3: Add spoiler gating to snapshot stepper `goTo`**

In the snapshot navigator (~line 1405), update `goTo` to check the bookmark. Note: the auto-playback effect (lines 420-442) does NOT call `goTo` — it manages state directly in a `setInterval` callback, so playback is unaffected by this gating (matching the spec's scope exclusion).

```typescript
function goTo(newPos: number) {
  const target = snaps[newPos];
  const bookmark = Math.min(
    storedRef.current?.readingBookmark ?? stored!.lastAnalyzedIndex,
    stored!.lastAnalyzedIndex,
  );
  const targetIndex = newPos === snaps.length - 1 ? stored!.lastAnalyzedIndex : target.index;

  if (targetIndex > bookmark) {
    // Beyond bookmark — move sidebar position but don't load data
    setCurrentIndex(targetIndex);
    setSpoilerDismissedIndex(null);
    return;
  }

  setSpoilerDismissedIndex(null);
  if (newPos === snaps.length - 1) {
    setCurrentIndex(stored!.lastAnalyzedIndex);
    setResult(stored!.result);
    setViewingSnapshotIndex(null);
  } else {
    setCurrentIndex(target.index);
    setResult(target.result);
    setViewingSnapshotIndex(target.index);
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: gate chapter navigation and snapshot stepper on reading bookmark"
```

---

### Task 4: Spoiler warning banner

**Files:**
- Modify: `app/page.tsx` (~after line 1468, between snapshot navigator and tab content)

- [ ] **Step 1: Compute banner visibility**

After the `currentChapterIndex` computation (~line 1209), add:

```typescript
const isBeyondBookmark = stored?.readingBookmark != null && currentIndex > effectiveBookmark;
const showSpoilerBanner = isBeyondBookmark && spoilerDismissedIndex !== currentIndex;
```

- [ ] **Step 2: Render spoiler banner**

After the snapshot navigator closing `})()}` (line 1468), add the banner JSX:

```tsx
          {showSpoilerBanner && (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex-shrink-0">
              <span className="text-amber-500 text-sm flex-shrink-0">&#9888;</span>
              <p className="flex-1 text-sm text-stone-600 dark:text-zinc-400">
                Chapter {currentIndex + 1} is past your bookmark (Ch. {effectiveBookmark + 1}).
              </p>
              <button
                onClick={handleDismissSpoiler}
                className="flex-shrink-0 px-3 py-1 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 rounded-lg transition-colors"
              >
                Show anyway
              </button>
            </div>
          )}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: render spoiler warning banner when navigating past bookmark"
```

---

### Task 5: ChapterSelector bookmark controls

**Files:**
- Modify: `components/ChapterSelector.tsx:7-31` (Props interface)
- Modify: `components/ChapterSelector.tsx:72-172` (ChapterItem rendering)
- Modify: `app/page.tsx:1324-1347` (ChapterSelector props)

- [ ] **Step 1: Add bookmark props to ChapterSelector**

In `components/ChapterSelector.tsx`, add to the Props interface (after `onDeleteSnapshot`):

```typescript
readingBookmark?: number;
onSetBookmark?: (chapterIndex: number | null) => void;
```

Destructure them in the component function signature.

- [ ] **Step 2: Dim chapters beyond bookmark**

In the `ChapterItem` component, compute dimming based on the bookmark. Add before the `marker` computation (~line 85):

```typescript
const isBeyondBookmark = readingBookmark != null && globalIndex > readingBookmark;
```

Add an opacity modifier to the chapter button's className. Find the `className` string on the button (~line 116) and append:

```typescript
${isBeyondBookmark ? ' opacity-50' : ''}
```

- [ ] **Step 3: Add bookmark icon to chapter rows**

Add `readingBookmark` and `onSetBookmark` to the `ChapterItemProps` interface (~line 51) and to the `ChapterItem` destructuring (~line 72).

In the `ChapterItem` rendering, add a bookmark toggle button inside the wrapper `<div className="flex items-center group">` (line 106), after the main `<button>` (line 121) and before the range-start button (line 122). The wrapper already has the `group` class so `group-hover` works.

Follow the same pattern as the existing range/toggle/delete buttons:

```tsx
{onSetBookmark && (
  <button
    onClick={(e) => { e.stopPropagation(); onSetBookmark(globalIndex === readingBookmark ? null : globalIndex); }}
    className={`flex-shrink-0 ml-0.5 w-4 h-4 flex items-center justify-center rounded text-[9px] transition-opacity ${
      globalIndex === readingBookmark
        ? 'text-amber-500 opacity-100'
        : 'text-stone-300 dark:text-zinc-700 hover:text-amber-500 opacity-0 group-hover:opacity-100'
    }`}
    title={globalIndex === readingBookmark ? 'Clear bookmark' : 'Bookmark here'}
  >
    <svg width="8" height="11" viewBox="0 0 10 14" fill="currentColor">
      <path d="M0 0h10v14L5 10.5 0 14V0z"/>
    </svg>
  </button>
)}

Pass `readingBookmark` and `onSetBookmark` through to `ChapterItem` in each place `ChapterItem` is rendered inside `ChapterSelector`. Use the component-level `readingBookmark` and `onSetBookmark` props.

- [ ] **Step 4: Pass bookmark props from `page.tsx`**

In `app/page.tsx`, update the `<ChapterSelector>` call (~line 1324) to include:

```tsx
readingBookmark={stored?.readingBookmark}
onSetBookmark={handleSetBookmark}
```

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/ChapterSelector.tsx app/page.tsx
git commit -m "feat: add bookmark icon and visual dimming to ChapterSelector"
```

---

### Task 6: Header bookmark indicator and dropdown

**Files:**
- Modify: `app/page.tsx:1250-1251` (header indicators area)

- [ ] **Step 1: Add bookmark indicator in header**

After the "Saved · ch.X" span (line 1251), add a bookmark indicator. This uses a small dropdown for changing the bookmark:

```tsx
{stored?.readingBookmark != null && (
  <div className="relative hidden md:inline-block">
    <button
      onClick={() => setShowBookmarkDropdown((v) => !v)}
      className="text-xs text-amber-500/80 hover:text-amber-500 transition-colors flex items-center gap-1"
      title="Reading bookmark"
    >
      <svg width="8" height="11" viewBox="0 0 10 14" fill="currentColor" className="flex-shrink-0">
        <path d="M0 0h10v14L5 10.5 0 14V0z"/>
      </svg>
      Ch.{stored.readingBookmark + 1}
    </button>
    {showBookmarkDropdown && (
      <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700 rounded-xl shadow-xl p-2 max-h-64 overflow-y-auto min-w-36">
        <div className="flex items-center justify-between px-2 py-1 mb-1">
          <span className="text-[10px] font-medium text-stone-400 dark:text-zinc-500 uppercase tracking-wider">Bookmark</span>
          <button
            onClick={() => { handleSetBookmark(null); setShowBookmarkDropdown(false); }}
            className="text-[10px] text-stone-400 dark:text-zinc-600 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        </div>
        {book.chapters.map((ch, i) => (
          <button
            key={i}
            onClick={() => { handleSetBookmark(i); setShowBookmarkDropdown(false); }}
            className={`w-full text-left px-2 py-1 text-xs rounded-md transition-colors truncate ${
              i === stored?.readingBookmark
                ? 'bg-amber-500/15 text-amber-500 font-medium'
                : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800'
            }`}
          >
            {i + 1}. {normalizeTitle(ch.title)}
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Add dropdown state**

Near the other UI state declarations in `page.tsx`, add:

```typescript
const [showBookmarkDropdown, setShowBookmarkDropdown] = useState(false);
```

- [ ] **Step 3: Close dropdown on outside click**

Add a click-outside handler. After the dropdown state, add an effect:

```typescript
useEffect(() => {
  if (!showBookmarkDropdown) return;
  const close = () => setShowBookmarkDropdown(false);
  document.addEventListener('click', close);
  return () => document.removeEventListener('click', close);
}, [showBookmarkDropdown]);
```

And add `e.stopPropagation()` on the dropdown container's `onClick` to prevent self-closing:

```tsx
<div className="absolute ..." onClick={(e) => e.stopPropagation()}>
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Manual verification checklist**

1. Load a book with multiple analyzed chapters
2. Click a bookmark icon in the sidebar on a mid-range chapter — entity panels should filter to that chapter
3. Navigate to a chapter beyond the bookmark — spoiler banner appears, entity panels still show bookmark data
4. Click "Show anyway" — banner disappears, full chapter data loads
5. Navigate back below the bookmark — spoiler state clears, bookmark filtering resumes
6. Header shows bookmark indicator with correct chapter number
7. Click header indicator — dropdown opens with chapter list
8. Select a different chapter in dropdown — bookmark updates
9. Click "Clear" in dropdown — bookmark removed, default behavior resumes
10. Reload page — bookmark persists
11. Set bookmark at an excluded chapter — verify `bestSnapshot` gracefully finds the nearest available snapshot
12. Run analysis while bookmark is set — bookmark stays fixed, newly analyzed chapters appear dimmed

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add bookmark indicator and dropdown to header"
```
