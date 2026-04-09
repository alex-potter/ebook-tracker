# Unified Book/Chapter Filtering Design

**Date:** 2026-04-06
**Status:** Approved

## Problem

When a user defines which books and chapters to include via BookStructureEditor, those exclusions are not consistently reflected across the app. Excluded books still appear in the BookFilterSelector dropdown. The active book filter doesn't propagate to the sidebar chapter list, "Currently at" combobox, StoryTimeline, or entity panels.

## Goal

1. Excluded books/chapters are hidden **everywhere** except BookStructureEditor
2. BookFilterSelector only shows non-excluded books
3. Active book filter selection filters content across the entire app: sidebar, "Currently at", StoryTimeline, character/location/arc panels
4. When the active filter causes the current chapter position to fall outside the visible set, auto-navigate to the last analyzed chapter within the visible set

## Approach: Centralized `visibleChapterOrders` set

Replace the existing dual-layer filtering (`seriesHiddenChapters` + `filteredSnapshots`) with a single `visibleChapterOrders: Set<number> | null` computed in `page.tsx`.

- `null` = standalone book, no series — all chapters visible
- `Set<number>` = only these chapter orders are visible

The set combines both layers:
- **Series exclusions:** books with `excluded: true`, chapters in `excludedChapters`, unassigned chapters
- **Active book filter:** when the user selects specific books, only those books' chapters are included

### Core computation

```ts
const visibleChapterOrders = useMemo(() => {
  const series = storedRef.current?.series;
  if (!series) return null;

  const targetBooks = bookFilter.mode === 'all'
    ? series.books
    : series.books.filter(b => bookFilter.indices.includes(b.index));

  const visible = new Set<number>();
  for (const b of targetBooks) {
    if (b.excluded) continue;
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) {
      if (!b.excludedChapters.includes(o)) visible.add(o);
    }
  }
  return visible;
}, [storedRef.current?.series, bookFilter]);
```

### Derived: `visibleSnapshots`

```ts
const visibleSnapshots = useMemo(() => {
  const snaps = storedRef.current?.snapshots ?? [];
  if (!visibleChapterOrders) return snaps;
  return snaps.filter(s => visibleChapterOrders.has(s.index));
}, [storedRef.current?.snapshots, visibleChapterOrders]);
```

## Changes by file

### `page.tsx`

- **Remove:** `seriesHiddenChapters` useMemo, `filteredSnapshots` useMemo
- **Add:** `visibleChapterOrders` useMemo, `visibleSnapshots` useMemo
- **Add:** auto-navigate `useEffect` — when `currentIndex` is not in `visibleChapterOrders`, jump to the last analyzed chapter within the visible set (or first visible chapter if no snapshots)
- **ChapterSelector props:** remove `seriesHiddenChapters`, `excludedBooks`, `onToggleBook`, `excludedChapters`, `onToggleChapter`; add `visibleChapterOrders`
- **StoryTimeline:** `snapshots={visibleSnapshots}`
- **CharacterCard:** `snapshots={visibleSnapshots}`
- **LocationBoard:** `snapshots={visibleSnapshots}`
- **ArcsPanel:** `snapshots={visibleSnapshots}`
- **useDerivedEntities:** pass `visibleSnapshots` instead of `filteredSnapshots`

### `BookFilterSelector.tsx`

- Filter out `b.excluded` books from the dropdown list
- Use non-excluded book count for the "select all" threshold in `handleToggle`

### `ChapterSelector.tsx`

- **Remove props:** `excludedBooks`, `onToggleBook`, `excludedChapters`, `onToggleChapter`, `seriesHiddenChapters`
- **Add prop:** `visibleChapterOrders: Set<number> | null`
- Book groups building: skip chapters not in `visibleChapterOrders`
- Flat chapter list: skip chapters not in `visibleChapterOrders`
- Remove inline book toggle buttons (exclusion management stays in BookStructureEditor)

### Not changed

- `BookStructureEditor.tsx` — still shows everything for exclusion management
- `series.ts` — no changes
- `types/index.ts` — no new types needed
- API routes, storage layer, data model — no changes

## Auto-navigate behavior

When `visibleChapterOrders` changes and `currentIndex` is outside the visible set:

1. If `visibleChapterOrders` is null, empty, or contains `currentIndex` → do nothing
2. Find the last analyzed snapshot within the visible set → navigate there
3. If no visible snapshots exist → navigate to the first visible chapter
