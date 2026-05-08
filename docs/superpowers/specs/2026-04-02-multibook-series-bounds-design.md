# Multi-Book Series Bounds Design

**Date:** 2026-04-02
**Status:** Approved

## Problem

BookBuddy detects omnibus/multi-book structure at parse time via NCX hierarchy, nav.xhtml, and chapter title patterns. However, the detected structure is spread across individual chapter fields (`bookIndex`, `bookTitle`) with no single source of truth. Users cannot correct misdetected bounds, manually segment single-file EPUBs into multiple books, or exclude per-book front/back matter. Arc grouping operates at the whole-file level with no concept of per-book vs series-wide themes. Navigation has no book-level filtering.

## Solution

Introduce a `SeriesDefinition` with `BookDefinition[]` as the canonical source of truth for book structure. This enables user-confirmed book bounds, per-book arc grouping with a series-level layer on top, and a multi-select book filter that all UI panels respect.

## Decisions

- **BookDefinition as first-class entity**: Replaces scattered `bookIndex`/`bookTitle` per-chapter fields and `excludedBooks`/`bookMeta` on state with a top-level structure
- **Two-tier arc grouping**: Per-book parent arcs (max 5 per book), then series-level arcs (max 5-7) spanning across books
- **Editor at upload and in Manage tab**: Book structure is presented for confirmation after parsing and is editable later from the Manage tab
- **Non-destructive post-edit**: Editing bounds after analysis warns about staleness and offers re-grouping; no automatic re-processing
- **Per-book exclusions**: Each book can have individual chapters excluded within its range (indexes, appendices, illustration plates, etc.)
- **Multi-select book filter**: Users can select any combination of books or "All" for series view; all panels respect this filter

## New Types

### `BookDefinition`

```typescript
interface BookDefinition {
  index: number;              // 0-based book order in series
  title: string;              // detected or user-provided book title
  chapterStart: number;       // first chapter order (inclusive)
  chapterEnd: number;         // last chapter order (inclusive)
  excludedChapters: number[]; // chapter orders excluded within this book
  confirmed: boolean;         // user has reviewed/confirmed this book's bounds
  parentArcs?: ParentArc[];   // per-book thematic arc groupings
  arcGroupingHash?: string;   // hash of bounds at last arc grouping, for staleness detection
}
```

### `SeriesDefinition`

```typescript
interface SeriesDefinition {
  books: BookDefinition[];
  seriesArcs?: ParentArc[];   // series-wide thematic arc groupings
  unassignedChapters: number[]; // chapter orders not belonging to any book (auto-derived)
}
```

### `BookFilter`

```typescript
type BookFilter =
  | { mode: 'all' }                     // series view — show everything
  | { mode: 'books'; indices: number[] } // show selected books only
```

## Changes to `StoredBookState`

```typescript
interface StoredBookState {
  // NEW
  series?: SeriesDefinition;

  // DEPRECATED (kept temporarily for migration)
  // excludedBooks?: number[];
  // bookMeta?: BookMeta;

  // KEPT
  // chapterRange — still serves as overall omnibus content range
  // parentArcs — fallback for non-series single-book mode
}
```

When `series` is present, it is authoritative. The chapter-level `bookIndex`/`bookTitle` fields become write-once parser hints only.

## Migration

When loading existing state that has `excludedBooks`/`bookMeta` but no `series`:

1. Create one `BookDefinition` per entry in `bookMeta.books`
2. Derive `chapterStart`/`chapterEnd` from chapter `bookIndex` values
3. Convert `excludedBooks` entries: for each excluded book index, populate that `BookDefinition`'s `excludedChapters` with all chapter orders in its range (effectively excluding the entire book)
4. Set `confirmed: false` on all auto-generated definitions
5. Copy existing `parentArcs` to `StoredBookState.parentArcs` (no per-book arcs yet)

This runs once on load; the migrated state is persisted immediately.

## Book Structure Detection

### `buildInitialSeriesDefinition()`

A new function that converts parser output into a `SeriesDefinition`:

- Groups parsed chapters by `bookIndex` to derive `chapterStart`/`chapterEnd` per book
- Uses detected `bookTitle` for each book's title
- Runs existing front/back matter detection scoped per book to populate `excludedChapters`
- Sets `confirmed: false` on all books
- Chapters with no `bookIndex` go into `unassignedChapters`

Called after `parseEpub()` completes, before analysis begins.

## Book Structure Editor

### Upload-Time Modal

Presented after EPUB parsing, before analysis begins. Displays:

1. **Detected books** as an ordered list, each showing:
   - Book title (editable text field)
   - Chapter range as first and last chapter titles (e.g., "Ch 1: Prologue -> Ch 24: The End")
   - Excluded chapters listed with toggles to re-include
   - Visual indicator when `confirmed: false`
2. **Unassigned chapters** section at the bottom
3. **Actions:**
   - Adjust chapter boundaries between adjacent books (drag or dropdown)
   - Create new book from unassigned chapters
   - Merge two adjacent books into one
   - Split a book at a specific chapter
   - Mark/unmark individual chapters as excluded within a book
   - "Confirm All" button to mark all books as confirmed

For EPUBs where no multi-book structure was detected, the modal shows one book spanning all chapters with the detected content range. The user can split it into multiple books if needed.

For user-created books (manual segmentation), titles default to "Book 1", "Book 2", etc.

### Manage Tab Section

Same editor component, accessible anytime from the Manage tab. When bounds are edited after analysis has run, a banner appears: "Book structure changed for [Book Title]. Arc groupings may be outdated." with a "Re-group arcs" button.

## Per-Book and Series Arc Grouping

### Two-Tier Architecture

1. **Per-book grouping**: After all analyzable chapters within a book complete, `group-arcs` runs scoped to that book's chapters. Produces `BookDefinition.parentArcs` (max 5 parent arcs per book).

2. **Series-level grouping**: After all books' per-book groupings complete, a `group-series-arcs` call runs. Takes per-book parent arcs as input and produces `SeriesDefinition.seriesArcs` (max 5-7 series-wide themes). The LLM prompt differs: it identifies cross-book narrative threads, not chapter-level arc clustering.

### Triggering

- Per-book: automatic when the last analyzable chapter in a book completes (extends current `maybeGenerateParentArcs` logic, scoped to book bounds)
- Series-level: automatic when the last book's per-book grouping completes
- Either tier can be manually re-triggered from the Manage tab or via the staleness banner

### Fallback

If `series` is undefined or has only one book, behavior is identical to today: `StoredBookState.parentArcs` is used as-is. No regression for non-series content.

## Book Filter & Navigation

### Filter State

UI-only state (not persisted). Default is `{ mode: 'all' }`.

### Book Selector UI

A compact multi-select in the header/toolbar area, visible across all tabs:

- Shows current selection (e.g., "Book 2", "Books 1-3", "All Books")
- Dropdown with checkboxes for each `BookDefinition.title`
- "All" option that switches to series view
- Only visible when `series` exists and has more than one book

### Panel Filtering

A single utility function `getFilteredChapterOrders(series, filter)` returns the set of chapter orders included by the current filter (respecting per-book exclusions). All panels use this:

- **Characters**: Aggregate only from snapshots within filtered chapters. Characters not appearing in selected books are hidden. Status/location reflects state as of the last chapter in the filtered range.
- **Locations**: Only locations mentioned in filtered chapters appear.
- **Arcs**: When filtering to specific books, show those books' `parentArcs`. In "All" mode, show `seriesArcs` with option to expand into per-book groupings. Arc status reflects state within filtered scope.
- **Map**: Pins filtered to locations present in selected books.
- **Timeline**: Chapter markers scoped to selected books. Unselected books' chapters shown dimmed as context.

## Staleness Detection

### Mechanism

Each `BookDefinition` stores an `arcGroupingHash` — a hash of `(chapterStart, chapterEnd, excludedChapters)` computed when `parentArcs` are generated for that book.

When the user edits book bounds:
- Current bounds hash is compared against stored `arcGroupingHash`
- Mismatches mark the book as stale

### User-Facing Behavior

- Banner on Arcs panel and Manage tab: "Book structure changed for [Book Title]. Arc groupings may be outdated." with "Re-group arcs" button
- Re-grouping runs per-book for affected books only, then re-runs series-level grouping if any per-book arcs changed
- No automatic re-processing
- No staleness warning if chapters haven't been analyzed yet

## Scope Boundary

This design covers the data model, detection, editing, arc grouping, filtering, and staleness. It does not cover:

- Visual design of the book structure editor (handled during implementation)
- Specific LLM prompt wording for series-level arc grouping (handled during implementation)
- Changes to the export/import `.bookbuddy` format (the new `series` field serializes naturally with the existing JSON export)
