# Book Container: Unified Structure Editing & Multi-EPUB Series

**Date:** 2026-04-13
**Approach:** Unified BookContainer model (Approach C — "a single item is a collection of one")

## Problem

The current system conflates EPUB internal divisions with books in a series, causing three failures:

1. **Single-book EPUBs get no structure editor.** The parser returns `books: undefined` when only 1 book is detected (`epub-parser.ts:138`). `buildInitialSeriesDefinition` and the page-level gating both require `books.length >= 2`. Users cannot exclude front/back matter through the book structure system.

2. **Internal "Part" divisions are misinterpreted as separate books.** An EPUB like *The Way of Kings* with Part 1-5 divisions gets parsed as 7 separate books. Even after manually merging all parts in the editor, the system still treats it as a multi-book series.

3. **No way to build a series from separate EPUB files.** `SeriesPicker` carries forward the character roster but keeps each EPUB as an independent `StoredBookState`. There is no unified series view, no shared arcs, and no single exportable file.

## Design

### 1. Data Model

Replace `SeriesDefinition` with `BookContainer` as the universal wrapper. Every stored book gets a container, even single-novel EPUBs.

```typescript
interface BookContainer {
  books: BookDefinition[];          // always >= 1 entry
  seriesArcs?: ParentArc[];         // only meaningful when books.length > 1
  unassignedChapters: number[];     // chapter orders not in any book
}

interface BookDefinition {
  index: number;              // 0-based book order in container
  title: string;              // detected or user-provided
  chapterStart: number;       // global order (flat index), inclusive
  chapterEnd: number;         // global order, inclusive
  excludedChapters: number[]; // chapter orders excluded within this book
  confirmed: boolean;         // user has reviewed/confirmed bounds
  excluded?: boolean;         // entire book excluded from analysis
  parentArcs?: ParentArc[];   // per-book thematic arc groupings
  arcGroupingHash?: string;   // hash of bounds at last arc grouping
  sourceEpub?: string;        // which EPUB file these chapters came from
}
```

On `StoredBookState`, the `series?: SeriesDefinition` field becomes `container: BookContainer` (required, not optional).

### 2. Per-Book Display Numbering

Chapter numbers shown in the UI are computed per-book, not stored. Each book starts at Ch. 1, and excluded chapters are skipped in the count.

```typescript
function displayChapterNumber(
  container: BookContainer,
  bookIndex: number,
  chapterOrder: number
): number {
  const book = container.books[bookIndex];
  let num = 0;
  for (let o = book.chapterStart; o <= chapterOrder; o++) {
    if (!book.excludedChapters.includes(o)) num++;
  }
  return num;
}

function getDisplayLabel(
  container: BookContainer,
  chapterOrder: number
): string {
  const book = container.books.find(
    b => chapterOrder >= b.chapterStart && chapterOrder <= b.chapterEnd
  );
  if (!book) return `Ch. ${chapterOrder + 1}`;
  const num = displayChapterNumber(container, book.index, chapterOrder);
  if (container.books.length === 1) return `Ch. ${num}`;
  return `${book.title} — Ch. ${num}`;
}
```

The flat `order` field remains the internal key for storage, snapshot indexing, and all lookups. It is never displayed to the user.

### 3. Import Flow

#### Scenario A — Fresh EPUB import

1. Parse EPUB as usual (parser logic unchanged)
2. Always create a `BookContainer`:
   - If parser finds 1 book (or no book divisions): container with 1 `BookDefinition` spanning all chapters
   - If parser finds N books: container with N `BookDefinition` entries
3. Auto-detect front/back matter content types (existing logic)
4. Always show the structure editor for confirmation
5. If multiple books detected, show a "Treat as single book" button that merges all entries into one `BookDefinition`

#### Scenario B — Appending a new EPUB to existing series

1. User imports a new EPUB
2. App detects existing books in storage, shows a choice: "Start fresh" or "Add to [existing book] series"
3. If "Add to series":
   - Parse the new EPUB
   - Rebase chapter orders: new chapters start at `existingContainer.books[last].chapterEnd + 1`
   - Append new chapters to `bookMeta.chapters` with remapped `bookIndex` values
   - Create new `BookDefinition`(s) with `sourceEpub` set to new filename, `confirmed: false`
   - Store new chapter texts in IndexedDB under the same book key
   - Open structure editor scoped to the newly added book(s) — previous books remain collapsed/locked
4. When transitioning from 1 to 2 books, prompt user for a series title (auto-derived from first book as default)

#### Scenario C — Omnibus with internal "Part" divisions

1. Parser detects N divisions (e.g., 7 "Parts" in Way of Kings)
2. Structure editor opens showing N entries
3. "Treat as single book" button at top collapses all entries into one `BookDefinition` spanning the full range
4. User excludes front/back matter chapters, confirms
5. Container has 1 confirmed book

### 4. Structure Editor Changes

The existing `BookStructureEditor` component is modified:

- **Always shown on first import** — remove the `books.length >= 2` gate in `page.tsx`
- **"Treat as single book" button** — visible when `books.length > 1`, merges all entries into one `BookDefinition` preserving the overall `chapterStart`/`chapterEnd` range and combining all `excludedChapters`
- **"Add to series" mode** — when appending an EPUB, the editor shows previous books as read-only collapsed entries and only the new book(s) are editable
- **Auto-excluded chapters** — front/back matter content types are pre-checked as excluded but the user can override by unchecking

### 5. Context Carry-Forward for AI Analysis

When analyzing chapters in Book 2+:
- The cumulative `AnalysisResult` from the last analyzed chapter of the previous book is available as context (characters, locations, arcs, summary)
- All historical snapshots are available for rollback/timeline
- Raw chapter text from previous books is NOT retained or sent to the AI
- The AI receives only the current chapter text plus the cumulative snapshot

### 6. UI Behavior by Book Count

**1 book in container:**
- Structure editor title: "Book Structure"
- No book filter selector
- No series-level arcs section
- Chapter labels: "Ch. 1", "Ch. 2" (no book prefix)
- No "Merge with next" button
- Settings/manage shows "Add next book in series" option

**2+ books in container:**
- Structure editor title: "Series Structure"
- Book filter selector appears
- Series-level arc grouping enabled
- Chapter labels: "Way of Kings — Ch. 1" (abbreviated based on space)
- Full split/merge/reorder controls
- Export includes series arcs

Transition from 1 to 2+ books is automatic — no manual "create series" step.

### 7. Export Format

Version bump from 2 to 3:

```typescript
interface BookBuddyExport {
  version: 3;
  title: string;                 // series title or book title
  author: string;
  container: BookContainer;
  bookMeta: BookMeta;
  snapshots: Snapshot[];
  result: AnalysisResult;
}
```

**Included:** Complete container with all book definitions, exclusions, per-book arcs, series arcs. All snapshots across all books. Chapter metadata (titles, content types, order mappings).

**Not included:** Raw chapter text, provider settings, API keys, reading position.

**Import behavior:** Importing a v3 file creates the full stored state. The user can browse all analysis without the EPUB. To continue analyzing new chapters, they load the EPUB and it appends normally.

Only v3 is supported — no backward compatibility with v2.

### 8. Storage Key Strategy

Books are currently keyed in IndexedDB and localStorage by `title::author`. When appending a new EPUB to an existing container:

- The storage key remains the **original book's** `title::author` (e.g., `The Way of Kings::Brandon Sanderson`)
- When transitioning from 1 to 2+ books and the user provides a series title, the storage key is updated to `seriesTitle::author` (e.g., `The Stormlight Archive::Brandon Sanderson`)
- The localStorage book list entry is updated to reflect the series title
- The old key's data is migrated to the new key in a single IndexedDB transaction

This means a series is stored as one entry, not scattered across multiple keys.

### 9. Migration

No migration code. `SeriesDefinition` is replaced entirely by `BookContainer`. Legacy fields (`series`, `excludedBooks`, `migrateToSeriesDefinition`, `buildInitialSeriesDefinition`) are removed. Existing IndexedDB data is overwritten when books are re-imported.

## Files Affected

- `types/index.ts` — replace `SeriesDefinition` with `BookContainer`, add `sourceEpub` to `BookDefinition`, update `StoredBookState`, bump export version
- `lib/series.ts` — rewrite: remove migration functions, add container construction helpers, keep arc grouping logic, add `displayChapterNumber`/`getDisplayLabel`
- `lib/epub-parser.ts` — one-line change: line 138 returns `books` array even when length is 1 (currently returns `undefined` for single-book EPUBs). Parser detection logic is unchanged.
- `components/BookStructureEditor.tsx` — add "Treat as single book" button, add read-only mode for previous books, add "Add to series" scoped editing
- `components/SeriesPicker.tsx` — extend to show "Add to existing series" option with container context
- `app/page.tsx` — remove `books.length >= 2` gates, always create container, always show structure editor on first import, implement append-EPUB flow
- `components/BookFilterSelector.tsx` — conditionally render based on `container.books.length > 1`
- `components/ChapterSelector.tsx` — use `getDisplayLabel` for chapter numbering, group by book
- `components/StoryTimeline.tsx` — use per-book numbering
- `components/ArcsPanel.tsx` — respect container for series vs per-book arcs
- `lib/book-storage.ts` — update save/load to use `container` field
- `lib/ai-shared.ts` — no changes expected (operates on flat chapter orders)
- `lib/ai-client.ts` — no changes expected
