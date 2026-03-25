# Reading Bookmark: Spoiler-Free Chapter Navigation

## Problem

Users may want to analyze an entire book upfront but read it progressively. Today, entity panels (characters, locations, arcs) filter data based on either the viewed snapshot or the furthest analyzed chapter. There is no way to say "I've read up to chapter 5" and have the app hide spoilers from later chapters while still allowing full navigation.

## Solution

Add a user-controlled **reading bookmark** that acts as a spoiler gate. The bookmark defines "how far I've read" and is independent of which chapters have been analyzed. Entity panels filter their data to the bookmark by default, preventing accidental spoilers.

## Data Model

Add `readingBookmark?: number` to `StoredBookState` in `app/page.tsx`:

```typescript
interface StoredBookState {
  lastAnalyzedIndex: number;
  result: AnalysisResult;
  snapshots: Snapshot[];
  readingBookmark?: number; // user-set chapter index (inclusive), independent of analysis progress
  // ... existing fields unchanged
}
```

**Default behavior:** When `readingBookmark` is `undefined` (legacy data or first load), the app falls back to `lastAnalyzedIndex`. This preserves current behavior for existing users. Once the user explicitly sets the bookmark, it persists with the book state via `saveStored()`.

## Entity Panel Filtering

### Current behavior

```typescript
const currentChapterIndex = viewingSnapshotIndex ?? stored?.lastAnalyzedIndex ?? 0;
```

All entity panels receive `currentChapterIndex` and filter events/data to `<= currentChapterIndex`.

### New behavior

Introduce `effectiveBookmark`:

```typescript
const effectiveBookmark = stored?.readingBookmark ?? stored?.lastAnalyzedIndex ?? 0;
```

Entity panels receive a filtering index computed as:

- **Normal navigation (at or below bookmark):** filter to `effectiveBookmark`
- **Spoiler-dismissed navigation (viewing a chapter beyond bookmark):** filter to `max(effectiveBookmark, spoilerDismissedIndex)` where `spoilerDismissedIndex` is the chapter the user acknowledged the warning for

The existing `viewingSnapshotIndex` continues to control which snapshot's data is *loaded/displayed*. The bookmark controls the *spoiler ceiling* for filtering.

## Spoiler Gating

### Navigation behavior

All analyzed chapters remain clickable in the sidebar regardless of bookmark position:

- **At or below bookmark:** Navigate normally, load that chapter's snapshot.
- **Above bookmark:** Show an inline spoiler warning banner before revealing data.

### Spoiler warning

A non-modal inline banner at the top of the entity panel area:

> "This chapter is past your bookmark (Ch. X). Showing full chapter details."

With a dismiss/acknowledge button. Once dismissed, the full snapshot data for that chapter is shown unfiltered.

### State tracking

`spoilerDismissedIndex: number | null` — non-persisted state in `page.tsx`. Tracks which beyond-bookmark chapter the user has acknowledged. Reset to `null` when navigating to a chapter within the bookmark or when navigating to a different beyond-bookmark chapter (requiring re-acknowledgment).

## UI Controls

### Sidebar (ChapterSelector)

- **Bookmark icon per chapter row:** A small bookmark icon (e.g., `🔖` or SVG) appears on hover for each chapter row. Clicking it sets the reading bookmark to that chapter.
- **Active bookmark indicator:** The bookmarked chapter row displays a persistent bookmark icon, visually distinct from hover state.
- **Visual dimming:** Chapters beyond the bookmark are slightly dimmed (reduced opacity or muted text color) to signal they contain unread content. They remain clickable (unlike unanalyzed chapters which are disabled).

### Header (inline in `app/page.tsx`)

- **Bookmark indicator:** A compact element near the existing "Saved · ch.X" indicator showing the current bookmark position, e.g., `"📖 Ch. 5"` or `"Read to: Ch. 5"`.
- **Dropdown control:** Clicking the header indicator opens a small dropdown/popover listing chapters, allowing the user to change the bookmark without scrolling the sidebar.

## Props Changes

### ChapterSelector

Add to Props:

```typescript
readingBookmark?: number;
onSetBookmark?: (chapterIndex: number) => void;
```

### Entity panel components

No prop changes needed. The existing `currentChapterIndex` prop is already used for filtering. `page.tsx` will compute and pass the correct value based on the bookmark and spoiler state.

## Files to Modify

| File | Change |
|------|--------|
| `app/page.tsx` | Add `readingBookmark` to `StoredBookState`, compute `effectiveBookmark`, add `spoilerDismissedIndex` state, update `currentChapterIndex` computation, add bookmark handler, render spoiler banner, render header bookmark indicator + dropdown, pass bookmark props to `ChapterSelector` |
| `components/ChapterSelector.tsx` | Accept `readingBookmark` and `onSetBookmark` props, render bookmark icon per row, dim chapters beyond bookmark |

## Persistence

The bookmark is saved via the existing `saveStored()` function whenever the user sets it. It is loaded with the rest of `StoredBookState` on page load. Cross-tab sync works automatically via the existing `storage` event listener.

## Edge Cases

- **Bookmark beyond analyzed range:** Clamp display to `min(readingBookmark, lastAnalyzedIndex)` so the bookmark can't reference unanalyzed chapters.
- **New analysis extends past bookmark:** Bookmark stays where the user set it. The newly analyzed chapters appear dimmed in the sidebar.
- **Series continuation:** When carrying forward state to a new book, `readingBookmark` resets to `undefined` (defaults to `lastAnalyzedIndex` of -1).
- **Legacy data migration:** No migration needed. `undefined` falls back to current behavior.
