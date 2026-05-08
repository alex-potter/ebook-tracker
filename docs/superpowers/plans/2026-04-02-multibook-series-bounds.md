# Multi-Book Series Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define and confirm book boundaries within an omnibus EPUB so that arc grouping, entity aggregation, and navigation can operate at per-book and series-wide scopes.

**Architecture:** New `BookDefinition` and `SeriesDefinition` types become the canonical source of truth for book structure. A `BookStructureEditor` modal handles editing at upload-time and from the Manage tab. Arc grouping becomes two-tier (per-book + series-level). A `BookFilter` component lets users scope all panels to selected books. Migration converts existing `excludedBooks`/`bookMeta` data on load.

**Tech Stack:** React 18, TypeScript, Next.js 14, Tailwind CSS, IndexedDB (via existing `book-storage.ts`)

---

### Task 1: Add New Types to `types/index.ts`

**Files:**
- Modify: `types/index.ts:66-127`

- [ ] **Step 1: Add BookDefinition, SeriesDefinition, and BookFilter types**

Add these interfaces after the existing `ParentArc` interface (after line 70):

```typescript
export interface BookDefinition {
  index: number;              // 0-based book order in series
  title: string;              // detected or user-provided book title
  chapterStart: number;       // first chapter order (inclusive)
  chapterEnd: number;         // last chapter order (inclusive)
  excludedChapters: number[]; // chapter orders excluded within this book
  confirmed: boolean;         // user has reviewed/confirmed this book's bounds
  parentArcs?: ParentArc[];   // per-book thematic arc groupings
  arcGroupingHash?: string;   // hash of bounds at last arc grouping, for staleness detection
}

export interface SeriesDefinition {
  books: BookDefinition[];
  seriesArcs?: ParentArc[];   // series-wide thematic arc groupings
  unassignedChapters: number[]; // chapter orders not belonging to any book (auto-derived)
}

export type BookFilter =
  | { mode: 'all' }
  | { mode: 'books'; indices: number[] };
```

- [ ] **Step 2: Add `series` field to `StoredBookState`**

Add `series?: SeriesDefinition;` to the `StoredBookState` interface, after the existing `parentArcs` field (line 126):

```typescript
export interface StoredBookState {
  lastAnalyzedIndex: number;
  result: AnalysisResult;
  snapshots: Snapshot[];
  excludedBooks?: number[];
  excludedChapters?: number[];
  chapterRange?: { start: number; end: number };
  bookMeta?: BookMeta;
  readingBookmark?: number;
  parentArcs?: ParentArc[];
  series?: SeriesDefinition;  // NEW
}
```

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add BookDefinition, SeriesDefinition, and BookFilter types"
```

---

### Task 2: Create `lib/series.ts` — Core Series Logic

**Files:**
- Create: `lib/series.ts`

This module contains all pure functions for building, migrating, querying, and hashing series definitions. No React, no IO.

- [ ] **Step 1: Create `lib/series.ts` with `buildInitialSeriesDefinition`**

```typescript
import type { BookDefinition, SeriesDefinition, BookMeta, ParentArc, BookFilter } from '@/types';

/**
 * Build a SeriesDefinition from parser output (bookMeta).
 * Groups chapters by bookIndex, detects per-book front/back matter ranges,
 * and marks all books as unconfirmed.
 */
export function buildInitialSeriesDefinition(
  bookMeta: BookMeta,
  detectRange: (chapters: Array<{ title: string; text: string }>) => { start: number; end: number },
  chapterTexts?: Map<number, { title: string; text: string }>,
): SeriesDefinition | null {
  if (!bookMeta.books?.length || bookMeta.books.length < 2) return null;

  // Group chapter orders by bookIndex
  const bookChapters = new Map<number, number[]>();
  for (const ch of bookMeta.chapters) {
    if (ch.bookIndex === undefined) continue;
    if (!bookChapters.has(ch.bookIndex)) bookChapters.set(ch.bookIndex, []);
    bookChapters.get(ch.bookIndex)!.push(ch.order);
  }

  const books: BookDefinition[] = [];
  for (let i = 0; i < bookMeta.books.length; i++) {
    const orders = bookChapters.get(i);
    if (!orders?.length) continue;
    orders.sort((a, b) => a - b);
    const chapterStart = orders[0];
    const chapterEnd = orders[orders.length - 1];

    // Detect front/back matter within this book's range if chapter texts are available
    let excludedChapters: number[] = [];
    if (chapterTexts) {
      const bookChapterData: Array<{ order: number; title: string; text: string }> = [];
      for (let o = chapterStart; o <= chapterEnd; o++) {
        const data = chapterTexts.get(o);
        if (data) bookChapterData.push({ order: o, ...data });
      }
      if (bookChapterData.length > 0) {
        const range = detectRange(bookChapterData);
        // Chapters before detected start or after detected end within this book are excluded
        for (const ch of bookChapterData) {
          const relIdx = ch.order - chapterStart;
          if (relIdx < range.start || relIdx > range.end) {
            excludedChapters.push(ch.order);
          }
        }
      }
    }

    books.push({
      index: i,
      title: bookMeta.books[i],
      chapterStart,
      chapterEnd,
      excludedChapters,
      confirmed: false,
    });
  }

  // Find unassigned chapters (not in any book's range)
  const assignedOrders = new Set<number>();
  for (const b of books) {
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) {
      assignedOrders.add(o);
    }
  }
  const allOrders = bookMeta.chapters.map((ch) => ch.order);
  const unassignedChapters = allOrders.filter((o) => !assignedOrders.has(o));

  return { books, unassignedChapters };
}

/**
 * Migrate legacy state (excludedBooks + bookMeta) into a SeriesDefinition.
 * Returns null if no multi-book structure exists.
 */
export function migrateToSeriesDefinition(
  bookMeta: BookMeta | undefined,
  excludedBooks: number[] | undefined,
): SeriesDefinition | null {
  if (!bookMeta?.books?.length || bookMeta.books.length < 2) return null;

  const bookChapters = new Map<number, number[]>();
  for (const ch of bookMeta.chapters) {
    if (ch.bookIndex === undefined) continue;
    if (!bookChapters.has(ch.bookIndex)) bookChapters.set(ch.bookIndex, []);
    bookChapters.get(ch.bookIndex)!.push(ch.order);
  }

  const excludedSet = new Set(excludedBooks ?? []);
  const books: BookDefinition[] = [];
  for (let i = 0; i < bookMeta.books.length; i++) {
    const orders = bookChapters.get(i);
    if (!orders?.length) continue;
    orders.sort((a, b) => a - b);
    const chapterStart = orders[0];
    const chapterEnd = orders[orders.length - 1];

    // If the entire book was excluded, mark all its chapters as excluded
    const excludedChapters = excludedSet.has(i)
      ? Array.from({ length: chapterEnd - chapterStart + 1 }, (_, j) => chapterStart + j)
      : [];

    books.push({
      index: i,
      title: bookMeta.books[i],
      chapterStart,
      chapterEnd,
      excludedChapters,
      confirmed: false,
    });
  }

  const assignedOrders = new Set<number>();
  for (const b of books) {
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) {
      assignedOrders.add(o);
    }
  }
  const allOrders = bookMeta.chapters.map((ch) => ch.order);
  const unassignedChapters = allOrders.filter((o) => !assignedOrders.has(o));

  return { books, unassignedChapters };
}

/**
 * Compute a hash string from a BookDefinition's bounds, used for staleness detection.
 */
export function computeArcGroupingHash(book: BookDefinition): string {
  const data = `${book.chapterStart}:${book.chapterEnd}:${book.excludedChapters.sort((a, b) => a - b).join(',')}`;
  // Simple string hash — no cryptographic need
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Check if a book's arc grouping is stale (bounds changed since last grouping).
 */
export function isBookArcStale(book: BookDefinition): boolean {
  if (!book.parentArcs?.length) return false; // never grouped — not stale, just ungrouped
  if (!book.arcGroupingHash) return true; // grouped but no hash — treat as stale
  return computeArcGroupingHash(book) !== book.arcGroupingHash;
}

/**
 * Get the set of chapter orders included by a BookFilter, respecting per-book exclusions.
 */
export function getFilteredChapterOrders(
  series: SeriesDefinition,
  filter: BookFilter,
): Set<number> {
  const result = new Set<number>();
  const targetBooks = filter.mode === 'all'
    ? series.books
    : series.books.filter((b) => filter.indices.includes(b.index));

  const excludedSet = new Set<number>();
  for (const b of targetBooks) {
    for (const ex of b.excludedChapters) excludedSet.add(ex);
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) {
      if (!excludedSet.has(o)) result.add(o);
    }
  }
  return result;
}

/**
 * Find which BookDefinition a chapter order belongs to, or undefined.
 */
export function findBookForChapter(series: SeriesDefinition, chapterOrder: number): BookDefinition | undefined {
  return series.books.find((b) => chapterOrder >= b.chapterStart && chapterOrder <= b.chapterEnd);
}

/**
 * Derive which book indices an arc spans, based on its chapter appearances.
 */
export function arcBookIndices(
  arcChapters: number[],
  series: SeriesDefinition,
): number[] {
  const indices = new Set<number>();
  for (const ch of arcChapters) {
    const book = findBookForChapter(series, ch);
    if (book) indices.add(book.index);
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Get the active parent arcs for a given filter context.
 * Returns per-book arcs when filtering to specific books, series arcs for 'all' mode.
 */
export function getActiveParentArcs(
  series: SeriesDefinition,
  filter: BookFilter,
  fallbackParentArcs?: ParentArc[],
): ParentArc[] {
  if (filter.mode === 'all') {
    return series.seriesArcs ?? fallbackParentArcs ?? [];
  }
  // Combine parent arcs from selected books
  const result: ParentArc[] = [];
  for (const b of series.books) {
    if (filter.indices.includes(b.index) && b.parentArcs?.length) {
      result.push(...b.parentArcs);
    }
  }
  return result;
}

/**
 * Get books whose arc grouping is stale.
 */
export function getStaleBooks(series: SeriesDefinition): BookDefinition[] {
  return series.books.filter(isBookArcStale);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/series.ts
git commit -m "feat: add lib/series.ts with core series logic functions"
```

---

### Task 3: Integrate Migration into State Loading

**Files:**
- Modify: `app/page.tsx:803-857` (activateBook function)
- Modify: `app/page.tsx:859-885` (loadBookFromMeta function)

- [ ] **Step 1: Add migration to `activateBook`**

At the top of `app/page.tsx`, add the import:

```typescript
import { buildInitialSeriesDefinition, migrateToSeriesDefinition } from '@/lib/series';
```

In the `activateBook` function (around line 803), after the `stateToSave` is constructed (line 810) and before `storedRef.current = stateToSave` (line 811), add migration logic:

Replace:
```typescript
    const stateToSave: StoredBookState = initialStored
      ? { ...initialStored, bookMeta }
      : { lastAnalyzedIndex: -2, result: { characters: [], summary: '' }, snapshots: [], bookMeta };
    storedRef.current = stateToSave;
```

With:
```typescript
    let stateToSave: StoredBookState = initialStored
      ? { ...initialStored, bookMeta }
      : { lastAnalyzedIndex: -2, result: { characters: [], summary: '' }, snapshots: [], bookMeta };

    // Build or migrate series definition
    if (!stateToSave.series && bookMeta.books && bookMeta.books.length >= 2) {
      if (initialStored?.excludedBooks || initialStored?.bookMeta) {
        // Migrate from legacy fields
        const series = migrateToSeriesDefinition(bookMeta, initialStored?.excludedBooks);
        if (series) stateToSave = { ...stateToSave, series };
      } else {
        // Fresh book — build from parser output
        const chapterTexts = new Map<number, { title: string; text: string }>();
        for (const ch of parsed.chapters) {
          chapterTexts.set(ch.order, { title: ch.title, text: ch.text });
        }
        const series = buildInitialSeriesDefinition(bookMeta, detectChapterRange, chapterTexts);
        if (series) stateToSave = { ...stateToSave, series };
      }
    }

    storedRef.current = stateToSave;
```

- [ ] **Step 2: Add migration to `loadBookFromMeta`**

In `loadBookFromMeta` (around line 859), after loading `stored` from IndexedDB (line 860), add migration before calling `activateBook`:

After `if (!stored) return;` (line 861), add:

```typescript
    // Migrate legacy state to series definition if needed
    if (!stored.series && stored.bookMeta?.books && stored.bookMeta.books.length >= 2) {
      const series = migrateToSeriesDefinition(stored.bookMeta, stored.excludedBooks);
      if (series) {
        stored = { ...stored, series };
        // Persist migrated state
        persistState(title, author, stored);
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate series definition migration into state loading"
```

---

### Task 4: Create `components/BookStructureEditor.tsx`

**Files:**
- Create: `components/BookStructureEditor.tsx`

This is the modal for viewing and editing book bounds. It renders as a full-screen modal (like BookmarkModal) and is used both at upload time and from the Manage tab.

- [ ] **Step 1: Create the BookStructureEditor component**

```typescript
'use client';

import { useState } from 'react';
import type { SeriesDefinition, BookDefinition, EbookChapter } from '@/types';

interface Props {
  series: SeriesDefinition;
  chapters: Array<{ order: number; title: string; bookIndex?: number }>;
  onSave: (series: SeriesDefinition) => void;
  onClose: () => void;
  mode: 'setup' | 'manage'; // setup = upload-time, manage = Manage tab
}

export default function BookStructureEditor({ series, chapters, onSave, onClose, mode }: Props) {
  const [books, setBooks] = useState<BookDefinition[]>(() => [...series.books].sort((a, b) => a.index - b.index));
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [expandedBook, setExpandedBook] = useState<number | null>(null);

  // Derive unassigned chapters
  const assignedOrders = new Set<number>();
  for (const b of books) {
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) assignedOrders.add(o);
  }
  const unassigned = chapters.filter((ch) => !assignedOrders.has(ch.order));

  function getChapterTitle(order: number): string {
    return chapters.find((ch) => ch.order === order)?.title ?? `Chapter ${order + 1}`;
  }

  function handleConfirmAll() {
    const confirmed = books.map((b) => ({ ...b, confirmed: true }));
    setBooks(confirmed);
    onSave({ ...series, books: confirmed, unassignedChapters: unassigned.map((ch) => ch.order) });
  }

  function handleUpdateBook(index: number, updates: Partial<BookDefinition>) {
    setBooks((prev) => prev.map((b) => b.index === index ? { ...b, ...updates } : b));
  }

  function handleToggleExcluded(bookIndex: number, chapterOrder: number) {
    setBooks((prev) => prev.map((b) => {
      if (b.index !== bookIndex) return b;
      const excluded = new Set(b.excludedChapters);
      if (excluded.has(chapterOrder)) excluded.delete(chapterOrder); else excluded.add(chapterOrder);
      return { ...b, excludedChapters: [...excluded] };
    }));
  }

  function handleSplitBook(bookIndex: number, splitAtOrder: number) {
    setBooks((prev) => {
      const book = prev.find((b) => b.index === bookIndex);
      if (!book || splitAtOrder <= book.chapterStart || splitAtOrder > book.chapterEnd) return prev;

      const maxIdx = Math.max(...prev.map((b) => b.index));
      const book1: BookDefinition = {
        ...book,
        chapterEnd: splitAtOrder - 1,
        excludedChapters: book.excludedChapters.filter((o) => o < splitAtOrder),
        parentArcs: undefined,
        arcGroupingHash: undefined,
      };
      const book2: BookDefinition = {
        index: maxIdx + 1,
        title: `${book.title} (Part 2)`,
        chapterStart: splitAtOrder,
        chapterEnd: book.chapterEnd,
        excludedChapters: book.excludedChapters.filter((o) => o >= splitAtOrder),
        confirmed: false,
      };
      return [...prev.filter((b) => b.index !== bookIndex), book1, book2].sort((a, b) => a.chapterStart - b.chapterStart);
    });
  }

  function handleMergeWithNext(bookIndex: number) {
    setBooks((prev) => {
      const sorted = [...prev].sort((a, b) => a.chapterStart - b.chapterStart);
      const idx = sorted.findIndex((b) => b.index === bookIndex);
      if (idx < 0 || idx >= sorted.length - 1) return prev;

      const current = sorted[idx];
      const next = sorted[idx + 1];
      const merged: BookDefinition = {
        ...current,
        chapterEnd: next.chapterEnd,
        excludedChapters: [...current.excludedChapters, ...next.excludedChapters],
        parentArcs: undefined,
        arcGroupingHash: undefined,
      };
      return prev.filter((b) => b.index !== next.index).map((b) => b.index === bookIndex ? merged : b);
    });
  }

  function handleCreateBookFromUnassigned() {
    if (unassigned.length === 0) return;
    const orders = unassigned.map((ch) => ch.order).sort((a, b) => a - b);
    const maxIdx = books.length > 0 ? Math.max(...books.map((b) => b.index)) + 1 : 0;
    const newBook: BookDefinition = {
      index: maxIdx,
      title: `Book ${maxIdx + 1}`,
      chapterStart: orders[0],
      chapterEnd: orders[orders.length - 1],
      excludedChapters: [],
      confirmed: false,
    };
    setBooks((prev) => [...prev, newBook].sort((a, b) => a.chapterStart - b.chapterStart));
  }

  function handleSave() {
    const reindexed = [...books].sort((a, b) => a.chapterStart - b.chapterStart).map((b, i) => ({ ...b, index: i }));
    const assignedSet = new Set<number>();
    for (const b of reindexed) {
      for (let o = b.chapterStart; o <= b.chapterEnd; o++) assignedSet.add(o);
    }
    const newUnassigned = chapters.filter((ch) => !assignedSet.has(ch.order)).map((ch) => ch.order);
    onSave({ ...series, books: reindexed, unassignedChapters: newUnassigned });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-stone-200 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-stone-900 dark:text-zinc-100 text-base">
              {mode === 'setup' ? 'Confirm Book Structure' : 'Edit Book Structure'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-zinc-500 mt-0.5">
              {books.length} book{books.length !== 1 ? 's' : ''} detected · {unassigned.length} unassigned chapter{unassigned.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Book List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {[...books].sort((a, b) => a.chapterStart - b.chapterStart).map((book) => {
            const chapterCount = book.chapterEnd - book.chapterStart + 1 - book.excludedChapters.length;
            const isExpanded = expandedBook === book.index;

            return (
              <div key={book.index} className="border border-stone-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                {/* Book Header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50 dark:hover:bg-zinc-800/50 transition-colors"
                  onClick={() => setExpandedBook(isExpanded ? null : book.index)}
                >
                  <svg
                    className={`w-3 h-3 text-stone-400 dark:text-zinc-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    viewBox="0 0 6 10" fill="currentColor"
                  >
                    <path d="M0 0l6 5-6 5V0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    {editingTitle === book.index ? (
                      <input
                        autoFocus
                        className="w-full bg-transparent text-sm font-medium text-stone-900 dark:text-zinc-100 outline-none border-b border-amber-500"
                        defaultValue={book.title}
                        onBlur={(e) => { handleUpdateBook(book.index, { title: e.target.value }); setEditingTitle(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p
                        className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate"
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(book.index); }}
                        title="Double-click to rename"
                      >
                        {book.title}
                      </p>
                    )}
                    <p className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5">
                      {getChapterTitle(book.chapterStart)} &rarr; {getChapterTitle(book.chapterEnd)}
                      <span className="ml-2">&middot; {chapterCount} ch.</span>
                    </p>
                  </div>
                  {!book.confirmed && (
                    <span className="text-xs text-amber-500 font-medium flex-shrink-0">Unconfirmed</span>
                  )}
                </div>

                {/* Expanded: Chapter List + Actions */}
                {isExpanded && (
                  <div className="border-t border-stone-200 dark:border-zinc-800 px-4 py-3 space-y-2">
                    {/* Per-chapter toggles */}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {Array.from({ length: book.chapterEnd - book.chapterStart + 1 }, (_, j) => {
                        const order = book.chapterStart + j;
                        const isExcluded = book.excludedChapters.includes(order);
                        return (
                          <label key={order} className="flex items-center gap-2 text-xs cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => handleToggleExcluded(book.index, order)}
                              className="rounded border-stone-300 dark:border-zinc-600 text-amber-500 focus:ring-amber-500/30"
                            />
                            <span className={`truncate ${isExcluded ? 'text-stone-300 dark:text-zinc-600 line-through' : 'text-stone-600 dark:text-zinc-400'}`}>
                              {getChapterTitle(order)}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-stone-100 dark:border-zinc-800">
                      <button
                        onClick={(e) => { e.stopPropagation(); const mid = Math.ceil((book.chapterStart + book.chapterEnd) / 2); handleSplitBook(book.index, mid); }}
                        className="text-xs text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors"
                      >
                        Split
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMergeWithNext(book.index); }}
                        className="text-xs text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors"
                      >
                        Merge with next
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUpdateBook(book.index, { confirmed: !book.confirmed }); }}
                        className={`text-xs transition-colors ${book.confirmed ? 'text-green-500 hover:text-green-600' : 'text-amber-500 hover:text-amber-600'}`}
                      >
                        {book.confirmed ? 'Confirmed' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned chapters */}
          {unassigned.length > 0 && (
            <div className="border border-dashed border-stone-300 dark:border-zinc-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-stone-400 dark:text-zinc-500 uppercase tracking-wider">Unassigned Chapters</p>
                <button
                  onClick={handleCreateBookFromUnassigned}
                  className="text-xs text-amber-500 hover:text-amber-600 font-medium transition-colors"
                >
                  Create book
                </button>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {unassigned.map((ch) => (
                  <p key={ch.order} className="text-xs text-stone-400 dark:text-zinc-500 truncate">
                    {ch.title}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 pt-3 border-t border-stone-200 dark:border-zinc-800">
          {mode === 'setup' ? (
            <button
              onClick={handleConfirmAll}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              Confirm All &amp; Start
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              Save Changes
            </button>
          )}
          <button
            onClick={onClose}
            className="text-sm text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors"
          >
            {mode === 'setup' ? 'Skip' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BookStructureEditor.tsx
git commit -m "feat: add BookStructureEditor modal component"
```

---

### Task 5: Wire BookStructureEditor into `page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add state and handler for the book structure editor**

Add import at top of `page.tsx`:

```typescript
import BookStructureEditor from '@/components/BookStructureEditor';
```

After the existing state declarations (around line 520), add:

```typescript
const [showBookStructureEditor, setShowBookStructureEditor] = useState(false);
const [bookStructureMode, setBookStructureMode] = useState<'setup' | 'manage'>('setup');
```

Add a handler function after `handleUpdateParentArcs` (around line 505):

```typescript
  function handleSaveSeries(updatedSeries: SeriesDefinition) {
    if (!book || !storedRef.current) return;
    const updated = { ...storedRef.current, series: updatedSeries };
    storedRef.current = updated;
    persistState(book.title, book.author, updated);
    setShowBookStructureEditor(false);
  }
```

- [ ] **Step 2: Show editor at upload time for omnibus books**

In the `activateBook` function, after the existing `setNeedsSetup` logic (around line 850-856), add a check to show the book structure editor for multi-book EPUBs:

After the existing block:
```typescript
    if (isNewBook && hasNoRange && hasText) {
      const detected = detectChapterRange(parsed.chapters);
      setChapterRangeState(detected);
      setNeedsSetup(true);
    } else {
      setNeedsSetup(false);
    }
```

Add:
```typescript
    // Show book structure editor for multi-book EPUBs with unconfirmed structure
    if (stateToSave.series && stateToSave.series.books.some((b) => !b.confirmed)) {
      setBookStructureMode('setup');
      setShowBookStructureEditor(true);
    }
```

- [ ] **Step 3: Render the modal**

In the JSX return, before the closing `</div>` of the main layout (find an appropriate spot near other modals, e.g., near the BookmarkModal rendering), add:

```typescript
        {showBookStructureEditor && book && storedRef.current?.series && (
          <BookStructureEditor
            series={storedRef.current.series}
            chapters={book.chapters.map(({ order, title, bookIndex }) => ({ order, title, bookIndex }))}
            onSave={handleSaveSeries}
            onClose={() => setShowBookStructureEditor(false)}
            mode={bookStructureMode}
          />
        )}
```

- [ ] **Step 4: Add "Edit Book Structure" button to Manage tab**

Find the Manage tab content rendering in `page.tsx`. Search for `tab === 'manage'`. Add a button to open the editor:

In the Manage tab section, add at the top of the manage panel content:

```typescript
          {storedRef.current?.series && storedRef.current.series.books.length > 1 && (
            <button
              onClick={() => { setBookStructureMode('manage'); setShowBookStructureEditor(true); }}
              className="mb-4 px-4 py-2 rounded-xl border border-stone-200 dark:border-zinc-700 text-sm text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200 hover:border-stone-400 dark:hover:border-zinc-500 transition-colors w-full text-left"
            >
              Edit Book Structure
              <span className="text-xs text-stone-400 dark:text-zinc-500 ml-2">
                {storedRef.current.series.books.length} books
              </span>
            </button>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire BookStructureEditor into page.tsx for upload and manage tab"
```

---

### Task 6: Create `components/BookFilterSelector.tsx`

**Files:**
- Create: `components/BookFilterSelector.tsx`

- [ ] **Step 1: Create the BookFilterSelector component**

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import type { BookFilter, SeriesDefinition } from '@/types';

interface Props {
  series: SeriesDefinition;
  filter: BookFilter;
  onChange: (filter: BookFilter) => void;
}

export default function BookFilterSelector({ series, filter, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedIndices = filter.mode === 'all' ? null : new Set(filter.indices);

  function getLabel(): string {
    if (filter.mode === 'all') return 'All Books';
    if (filter.indices.length === 1) {
      const book = series.books.find((b) => b.index === filter.indices[0]);
      return book?.title ?? 'Book';
    }
    return `${filter.indices.length} Books`;
  }

  function handleToggle(bookIndex: number) {
    if (filter.mode === 'all') {
      // Switch from all to single book
      onChange({ mode: 'books', indices: [bookIndex] });
      return;
    }
    const next = new Set(filter.indices);
    if (next.has(bookIndex)) {
      next.delete(bookIndex);
      if (next.size === 0) {
        onChange({ mode: 'all' });
        return;
      }
    } else {
      next.add(bookIndex);
      if (next.size === series.books.length) {
        onChange({ mode: 'all' });
        return;
      }
    }
    onChange({ mode: 'books', indices: [...next] });
  }

  function handleSelectAll() {
    onChange({ mode: 'all' });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200 transition-colors px-2 py-1 rounded-lg border border-stone-200 dark:border-zinc-700 hover:border-stone-400 dark:hover:border-zinc-500"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="1" width="8" height="8" rx="1" />
          <path d="M1 4h8" />
          <path d="M1 7h8" />
        </svg>
        <span className="max-w-[120px] truncate">{getLabel()}</span>
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="currentColor">
          <path d="M0 0l5 6 5-6H0z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl shadow-lg z-50 min-w-[180px] py-1">
          <button
            onClick={handleSelectAll}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              filter.mode === 'all'
                ? 'text-amber-500 font-medium bg-amber-50 dark:bg-amber-500/10'
                : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800'
            }`}
          >
            All Books
          </button>
          <div className="border-t border-stone-100 dark:border-zinc-800 my-1" />
          {[...series.books].sort((a, b) => a.index - b.index).map((book) => {
            const isSelected = filter.mode === 'all' || selectedIndices?.has(book.index);
            return (
              <button
                key={book.index}
                onClick={() => handleToggle(book.index)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                  isSelected && filter.mode !== 'all'
                    ? 'text-amber-500 font-medium'
                    : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800'
                }`}
              >
                <span className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-stone-300 dark:border-zinc-600'
                }`}>
                  {isSelected && (
                    <svg width="8" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4l3 3 5-6" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{book.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BookFilterSelector.tsx
git commit -m "feat: add BookFilterSelector dropdown component"
```

---

### Task 7: Wire BookFilter Into Page State and Header

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add BookFilter state and import**

Add import at top of `page.tsx`:

```typescript
import BookFilterSelector from '@/components/BookFilterSelector';
import { getFilteredChapterOrders, getActiveParentArcs, getStaleBooks } from '@/lib/series';
```

After the existing state declarations (near `showBookStructureEditor`), add:

```typescript
const [bookFilter, setBookFilter] = useState<BookFilter>({ mode: 'all' });
```

- [ ] **Step 2: Add BookFilterSelector to the header**

In the header JSX (around line 1500, inside the `<div className="flex items-center gap-3 flex-shrink-0">` block), add the filter selector before the ProcessingQueue component:

```typescript
          {storedRef.current?.series && storedRef.current.series.books.length > 1 && (
            <BookFilterSelector
              series={storedRef.current.series}
              filter={bookFilter}
              onChange={setBookFilter}
            />
          )}
```

- [ ] **Step 3: Compute filtered snapshots for downstream use**

Add a `useMemo` after the `bookFilter` state, which computes filtered snapshots based on the active book filter:

```typescript
  const filteredSnapshots = useMemo(() => {
    const stored = storedRef.current;
    if (!stored?.snapshots?.length || !stored.series || bookFilter.mode === 'all') {
      return stored?.snapshots ?? [];
    }
    const allowedOrders = getFilteredChapterOrders(stored.series, bookFilter);
    return stored.snapshots.filter((s) => allowedOrders.has(s.index));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedRef.current?.snapshots, storedRef.current?.series, bookFilter]);
```

- [ ] **Step 4: Reset filter when switching books**

In `activateBook`, reset the filter when a new book is loaded. Add after `setBook(parsed)` (around line 823):

```typescript
    setBookFilter({ mode: 'all' });
```

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire BookFilter state into header and compute filtered snapshots"
```

---

### Task 8: Pass Filtered Data to Panels

**Files:**
- Modify: `app/page.tsx`
- Modify: `lib/use-derived-entities.ts`

- [ ] **Step 1: Update useDerivedEntities to accept an optional snapshot filter**

In `lib/use-derived-entities.ts`, modify the `useDerivedEntities` hook signature to accept an optional `filteredSnapshots` parameter. The hook already takes `snapshots` — we'll use `filteredSnapshots` for the arc chapter map and aggregation when a filter is active.

Replace the function signature (line 25-28):

```typescript
export function useDerivedEntities(
  snapshots: Snapshot[],
  currentResult: AnalysisResult | null,
  filteredSnapshots?: Snapshot[],
): DerivedEntities {
```

Then on line 39, use filtered snapshots for the sorted array when available:

Replace:
```typescript
    const sorted = [...snapshots].sort((a, b) => a.index - b.index);
```

With:
```typescript
    const effectiveSnapshots = filteredSnapshots ?? snapshots;
    const sorted = [...effectiveSnapshots].sort((a, b) => a.index - b.index);
    // Keep full snapshots for alias map building (needs all data)
    const allSorted = filteredSnapshots ? [...snapshots].sort((a, b) => a.index - b.index) : sorted;
```

Update the `buildLocationAliasMap` call (line 42) to use `allSorted` (alias map needs full data):

```typescript
    const locationAliasMap = buildLocationAliasMap(allSorted, currentResult.locations);
```

Update the `aggregateEntities` call (line 84) to use `sorted` (filtered):

```typescript
    const aggregated = aggregateEntities(sorted, currentResult, locationAliasMap);
```

Update the dependency array (line 102) to include `filteredSnapshots`:

```typescript
  }, [snapshots, currentResult, filteredSnapshots]);
```

- [ ] **Step 2: Pass filteredSnapshots where useDerivedEntities is called in page.tsx**

Find the call to `useDerivedEntities` in `page.tsx` and add the `filteredSnapshots` argument. Search for `useDerivedEntities(` in page.tsx:

Replace:
```typescript
  const derived = useDerivedEntities(storedRef.current?.snapshots ?? [], result);
```

With:
```typescript
  const derived = useDerivedEntities(storedRef.current?.snapshots ?? [], result, filteredSnapshots.length !== (storedRef.current?.snapshots ?? []).length ? filteredSnapshots : undefined);
```

- [ ] **Step 3: Pass filter-aware parentArcs to ArcsPanel**

Find where `parentArcs` is passed to `ArcsPanel` in page.tsx. Replace the `parentArcs` prop to use the filter-aware version:

Replace:
```typescript
parentArcs={storedRef.current?.parentArcs}
```

With:
```typescript
parentArcs={storedRef.current?.series
  ? getActiveParentArcs(storedRef.current.series, bookFilter, storedRef.current?.parentArcs)
  : storedRef.current?.parentArcs}
```

- [ ] **Step 4: Commit**

```bash
git add lib/use-derived-entities.ts app/page.tsx
git commit -m "feat: pass filtered snapshots and filter-aware parentArcs to panels"
```

---

### Task 9: Create `app/api/group-series-arcs/route.ts` — Series-Level Arc Grouping

**Files:**
- Create: `app/api/group-series-arcs/route.ts`

- [ ] **Step 1: Create the series-level arc grouping API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { callLLM, resolveConfig } from '@/lib/llm';
import type { ParentArc } from '@/types';

const SERIES_ARC_SCHEMA = `{
  "seriesArcs": [
    {
      "name": "Series-wide theme name",
      "children": ["per-book parent arc 1", "per-book parent arc 2"],
      "summary": "1-2 sentences about this cross-book narrative thread"
    }
  ]
}`;

function buildGroupSeriesArcsPrompt(
  bookTitle: string,
  bookAuthor: string,
  bookArcs: Array<{ bookTitle: string; parentArcs: ParentArc[] }>,
): string {
  const sections = bookArcs.map(({ bookTitle: bt, parentArcs }) => {
    const arcLines = parentArcs
      .map((pa) => `  - ${pa.name}: ${pa.summary} (contains: ${pa.children.join(', ')})`)
      .join('\n');
    return `${bt}:\n${arcLines}`;
  }).join('\n\n');

  return `Given the following per-book arc groupings from the series "${bookTitle}" by ${bookAuthor}, identify the major cross-book narrative threads that span multiple books.

PER-BOOK ARC GROUPINGS:
${sections}

RULES:
- Create at most 7 series-wide themes. Fewer is better if themes naturally cluster.
- Each series theme should span at least 2 books.
- Use the EXACT per-book parent arc names in the "children" arrays.
- A per-book parent arc can belong to multiple series themes if it genuinely spans multiple threads.
- Per-book arcs that only appear in one book and don't connect to broader themes can be omitted.
- Write a 1-2 sentence summary for each series theme describing the overarching cross-book narrative.

Return ONLY a JSON object (no markdown fences, no explanation):
${SERIES_ARC_SCHEMA}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookTitle: string;
      bookAuthor: string;
      bookArcs: Array<{ bookTitle: string; parentArcs: ParentArc[] }>;
      _provider?: string;
      _apiKey?: string;
      _model?: string;
      _ollamaUrl?: string;
      _geminiKey?: string;
      _openaiCompatibleUrl?: string;
      _openaiCompatibleKey?: string;
    };
    const { bookTitle, bookAuthor, bookArcs } = body;

    // Need at least 2 books with arcs to do series grouping
    const booksWithArcs = bookArcs.filter((ba) => ba.parentArcs.length > 0);
    if (booksWithArcs.length < 2) {
      return NextResponse.json({ seriesArcs: [] });
    }

    const prompt = buildGroupSeriesArcsPrompt(bookTitle, bookAuthor, booksWithArcs);
    const allArcNames = new Set(booksWithArcs.flatMap((ba) => ba.parentArcs.map((pa) => pa.name)));
    const arcNamesLower = new Map<string, string>();
    for (const name of allArcNames) arcNamesLower.set(name.toLowerCase(), name);

    const config = resolveConfig(body, { defaultAnthropicModel: 'claude-sonnet-4-20250514' });
    const { text } = await callLLM({
      ...config,
      system: '',
      userPrompt: prompt,
      maxTokens: 4096,
      jsonMode: true,
    });

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned) as { seriesArcs: ParentArc[] };

    // Validate: resolve child names to exact arc names
    const validated: ParentArc[] = (parsed.seriesArcs ?? []).map((sa) => {
      const resolvedChildren = sa.children
        .map((child) => arcNamesLower.get(child.toLowerCase()) ?? (allArcNames.has(child) ? child : null))
        .filter((c): c is string => c !== null);
      return { name: sa.name, children: resolvedChildren, summary: sa.summary };
    }).filter((sa) => sa.children.length > 0);

    return NextResponse.json({ seriesArcs: validated });
  } catch (err) {
    console.error('[group-series-arcs] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to group series arcs' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/group-series-arcs/route.ts
git commit -m "feat: add /api/group-series-arcs endpoint for series-level arc grouping"
```

---

### Task 10: Implement Per-Book Arc Grouping Trigger

**Files:**
- Modify: `app/page.tsx:204-222` (maybeGenerateParentArcs)
- Create: `lib/generate-arcs.ts` (extract arc generation helpers)

- [ ] **Step 1: Create `lib/generate-arcs.ts` to hold arc generation helpers**

Extract the `generateParentArcs` function from `page.tsx` and add a new `generateSeriesArcs` function:

```typescript
import type { NarrativeArc, ParentArc } from '@/types';

export async function generateParentArcs(
  bookTitle: string,
  bookAuthor: string,
  arcs: NarrativeArc[],
): Promise<ParentArc[]> {
  let aiSettings: Record<string, string> = {};
  try {
    const { loadAiSettings } = await import('@/lib/ai-client');
    const s = loadAiSettings();
    if (s.provider) aiSettings._provider = s.provider;
    if (s.anthropicKey) aiSettings._apiKey = s.anthropicKey;
    if (s.ollamaUrl) aiSettings._ollamaUrl = s.ollamaUrl;
    if (s.model) aiSettings._model = s.model;
    if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
    if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
    if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
  } catch { /* ignore */ }

  const res = await fetch('/api/group-arcs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTitle, bookAuthor, arcs, ...aiSettings }),
  });
  if (!res.ok) throw new Error('Failed to group arcs');
  const data = await res.json() as { parentArcs: ParentArc[] };
  return data.parentArcs;
}

export async function generateSeriesArcs(
  bookTitle: string,
  bookAuthor: string,
  bookArcs: Array<{ bookTitle: string; parentArcs: ParentArc[] }>,
): Promise<ParentArc[]> {
  let aiSettings: Record<string, string> = {};
  try {
    const { loadAiSettings } = await import('@/lib/ai-client');
    const s = loadAiSettings();
    if (s.provider) aiSettings._provider = s.provider;
    if (s.anthropicKey) aiSettings._apiKey = s.anthropicKey;
    if (s.ollamaUrl) aiSettings._ollamaUrl = s.ollamaUrl;
    if (s.model) aiSettings._model = s.model;
    if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
    if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
    if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
  } catch { /* ignore */ }

  const res = await fetch('/api/group-series-arcs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTitle, bookAuthor, bookArcs, ...aiSettings }),
  });
  if (!res.ok) throw new Error('Failed to group series arcs');
  const data = await res.json() as { seriesArcs: ParentArc[] };
  return data.seriesArcs;
}
```

- [ ] **Step 2: Update `maybeGenerateParentArcs` in page.tsx to support per-book grouping**

Replace the existing `maybeGenerateParentArcs` function (lines 204-222) with a version that handles both per-book and series-level grouping:

```typescript
import { generateParentArcs, generateSeriesArcs } from '@/lib/generate-arcs';
import { computeArcGroupingHash } from '@/lib/series';
```

Remove the old `generateParentArcs` inline function from page.tsx (search for `async function generateParentArcs` around line 175-202) and the old `maybeGenerateParentArcs`.

Replace with:

```typescript
/** Fire parent arc grouping if the book (or a specific book within a series) is fully analyzed. */
async function maybeGenerateParentArcs(
  stored: StoredBookState,
  bookTitle: string,
  bookAuthor: string,
  rangeEnd: number,
  cancelled: boolean,
): Promise<StoredBookState> {
  if (cancelled) return stored;
  if (stored.lastAnalyzedIndex < rangeEnd) return stored;
  if (!stored.result.arcs?.length) return stored;

  // If we have a series, do per-book grouping
  if (stored.series && stored.series.books.length > 1) {
    let series = { ...stored.series, books: [...stored.series.books] };
    let anyBookGrouped = false;

    for (let bi = 0; bi < series.books.length; bi++) {
      const bookDef = series.books[bi];
      // Check if all chapters in this book are analyzed
      const bookEnd = bookDef.chapterEnd;
      if (stored.lastAnalyzedIndex < bookEnd) continue;
      // Skip if already grouped and not stale
      const currentHash = computeArcGroupingHash(bookDef);
      if (bookDef.arcGroupingHash === currentHash && bookDef.parentArcs?.length) continue;

      // Gather arcs from snapshots within this book's range
      const bookSnapshots = stored.snapshots.filter(
        (s) => s.index >= bookDef.chapterStart && s.index <= bookDef.chapterEnd
          && !bookDef.excludedChapters.includes(s.index),
      );
      const lastSnap = bookSnapshots.sort((a, b) => b.index - a.index)[0];
      const bookArcs = lastSnap?.result.arcs ?? [];
      if (!bookArcs.length) continue;

      try {
        const parentArcs = await generateParentArcs(bookTitle, bookAuthor, bookArcs);
        series.books[bi] = {
          ...bookDef,
          parentArcs,
          arcGroupingHash: currentHash,
        };
        anyBookGrouped = true;
      } catch (e) {
        console.warn(`[parent-arcs] Per-book generation failed for "${bookDef.title}":`, e);
      }
    }

    let result = { ...stored, series };

    // If all books have per-book arcs, generate series-level arcs
    if (anyBookGrouped) {
      const booksWithArcs = series.books
        .filter((b) => b.parentArcs?.length)
        .map((b) => ({ bookTitle: b.title, parentArcs: b.parentArcs! }));
      if (booksWithArcs.length >= 2) {
        try {
          const seriesArcs = await generateSeriesArcs(bookTitle, bookAuthor, booksWithArcs);
          result = { ...result, series: { ...result.series!, seriesArcs } };
        } catch (e) {
          console.warn('[parent-arcs] Series-level generation failed:', e);
        }
      }
    }

    return result;
  }

  // Non-series fallback: original behavior
  try {
    const parentArcs = await generateParentArcs(bookTitle, bookAuthor, stored.result.arcs);
    return { ...stored, parentArcs };
  } catch (e) {
    console.warn('[parent-arcs] Generation failed:', e);
    return stored;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/generate-arcs.ts app/page.tsx
git commit -m "feat: implement per-book and series-level arc grouping triggers"
```

---

### Task 11: Add Staleness Banner to ArcsPanel

**Files:**
- Modify: `components/ArcsPanel.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add staleness props to ArcsPanel**

In `components/ArcsPanel.tsx`, add new props to the Props interface (around line 10-20):

Add these props:

```typescript
  staleBooks?: string[];    // names of books with stale arc groupings
  onRegroupArcs?: () => void; // callback to re-run arc grouping
```

- [ ] **Step 2: Render staleness banner in ArcsPanel**

After the opening of the ArcsPanel component's return statement, before the arc list rendering, add:

```typescript
      {staleBooks && staleBooks.length > 0 && onRegroupArcs && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-300/50 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Book structure changed for {staleBooks.join(', ')}. Arc groupings may be outdated.
          </p>
          <button
            onClick={onRegroupArcs}
            className="flex-shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
          >
            Re-group arcs
          </button>
        </div>
      )}
```

- [ ] **Step 3: Add staleness banner to the Manage tab**

In `page.tsx`, find the Manage tab section where the "Edit Book Structure" button was added in Task 5. Add a staleness banner right after the button:

```typescript
          {storedRef.current?.series && getStaleBooks(storedRef.current.series).length > 0 && (
            <div className="mb-4 px-4 py-3 rounded-xl border border-amber-300/50 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Book structure changed for {getStaleBooks(storedRef.current.series).map((b) => b.title).join(', ')}. Arc groupings may be outdated.
              </p>
              <button
                onClick={async () => {
                  if (!book || !storedRef.current) return;
                  const rEnd = chapterRange?.end ?? (book.chapters.length - 1);
                  const withParents = await maybeGenerateParentArcs(storedRef.current, book.title, book.author, rEnd, false);
                  storedRef.current = withParents;
                  persistState(book.title, book.author, withParents);
                  setParentArcsRev((r) => r + 1);
                }}
                className="flex-shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
              >
                Re-group arcs
              </button>
            </div>
          )}
```

- [ ] **Step 4: Pass staleness data from page.tsx to ArcsPanel**

In `page.tsx`, where ArcsPanel is rendered, add the staleness props:

```typescript
  staleBooks={storedRef.current?.series ? getStaleBooks(storedRef.current.series).map((b) => b.title) : undefined}
  onRegroupArcs={async () => {
    if (!book || !storedRef.current) return;
    const rEnd = chapterRange?.end ?? (book.chapters.length - 1);
    const withParents = await maybeGenerateParentArcs(storedRef.current, book.title, book.author, rEnd, false);
    storedRef.current = withParents;
    persistState(book.title, book.author, withParents);
    setParentArcsRev((r) => r + 1);
  }}
```

- [ ] **Step 5: Commit**

```bash
git add components/ArcsPanel.tsx app/page.tsx
git commit -m "feat: add staleness banners to ArcsPanel and Manage tab with re-group action"
```

---

### Task 12: Update `analyzableIndices` to Use Series Definition

**Files:**
- Modify: `app/page.tsx:988-999` (analyzableIndices function)

- [ ] **Step 1: Update `analyzableIndices` to prefer series-based exclusions**

Replace the existing `analyzableIndices` function:

```typescript
  /** Indices of chapters in [from, to] that are neither excluded nor front-matter. */
  function analyzableIndices(from: number, to: number): number[] {
    if (!book) return [];
    const stored = storedRef.current;
    const result: number[] = [];

    // Build exclusion set from series definition if available
    const seriesExcluded = new Set<number>();
    if (stored?.series) {
      for (const b of stored.series.books) {
        for (const ex of b.excludedChapters) seriesExcluded.add(ex);
      }
      for (const uo of stored.series.unassignedChapters) seriesExcluded.add(uo);
    }

    for (let i = from; i <= to; i++) {
      const ch = book.chapters[i];
      if (!ch) continue;
      if (stored?.series) {
        // Series-aware exclusion
        if (seriesExcluded.has(i)) continue;
      } else {
        // Legacy exclusion
        if (ch.bookIndex !== undefined && excludedBooks.has(ch.bookIndex)) continue;
        if (excludedChapters.has(i) || isFrontMatter(ch)) continue;
      }
      result.push(i);
    }
    return result;
  }
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: update analyzableIndices to use series-based exclusions"
```

---

### Task 13: Update `handleUpdateParentArcs` for Series-Aware Edits

**Files:**
- Modify: `app/page.tsx:499-505` (handleUpdateParentArcs)
- Modify: `app/page.tsx:591-630` (parentArcs sync in applyResultEdit)

- [ ] **Step 1: Update `handleUpdateParentArcs` to save to series when applicable**

Replace the existing `handleUpdateParentArcs` function:

```typescript
  function handleUpdateParentArcs(parentArcs: ParentArc[]) {
    if (!book || !storedRef.current) return;
    const stored = storedRef.current;

    if (stored.series && bookFilter.mode === 'books' && bookFilter.indices.length === 1) {
      // Save to the specific book's parentArcs
      const bookIndex = bookFilter.indices[0];
      const updatedBooks = stored.series.books.map((b) =>
        b.index === bookIndex ? { ...b, parentArcs: parentArcs.length > 0 ? parentArcs : undefined } : b,
      );
      const updated = { ...stored, series: { ...stored.series, books: updatedBooks } };
      storedRef.current = updated;
      persistState(book.title, book.author, updated);
    } else if (stored.series && bookFilter.mode === 'all') {
      // Save to series-level arcs
      const updated = { ...stored, series: { ...stored.series, seriesArcs: parentArcs.length > 0 ? parentArcs : undefined } };
      storedRef.current = updated;
      persistState(book.title, book.author, updated);
    } else {
      // Non-series fallback
      const updated = { ...stored, parentArcs: parentArcs.length > 0 ? parentArcs : undefined };
      storedRef.current = updated;
      persistState(book.title, book.author, updated);
    }
    setParentArcsRev((r) => r + 1);
  }
```

- [ ] **Step 2: Update `applyResultEdit` parentArcs sync to handle series**

In the `applyResultEdit` callback (around line 591-630), the parentArcs sync logic needs to also update series-level arcs. After the existing parentArcs sync block, add a similar sync for series books:

After the existing `if (updated.parentArcs?.length)` block (ending around line 630), add:

```typescript
      // Also sync per-book parentArcs in series
      if (updated.series) {
        const syncedBooks = updated.series.books.map((b) => {
          if (!b.parentArcs?.length) return b;
          let bookParentArcs: ParentArc[];
          if (removed.length === 1 && added.length === 1) {
            bookParentArcs = b.parentArcs.map((pa) => ({
              ...pa,
              children: pa.children.map((c) => c === removed[0] ? added[0] : c),
            }));
          } else {
            bookParentArcs = b.parentArcs.map((pa) => ({
              ...pa,
              children: pa.children.filter((c) => !removed.includes(c)),
            }));
            if (added.length > 0 && removed.length === 0) {
              const newArcs = (newResult.arcs ?? []).filter((a) => added.includes(a.name));
              for (const na of newArcs) {
                const placed = bookParentArcs.find((pa) =>
                  pa.children.some((c) => {
                    const existing = (newResult.arcs ?? []).find((a) => a.name === c);
                    return existing?.characters.some((ch) => na.characters.includes(ch));
                  })
                );
                if (placed) placed.children.push(na.name);
                else bookParentArcs[bookParentArcs.length - 1]?.children.push(na.name);
              }
            }
          }
          bookParentArcs = bookParentArcs.filter((pa) => pa.children.length > 0);
          return { ...b, parentArcs: bookParentArcs.length > 0 ? bookParentArcs : undefined };
        });
        updated = { ...updated, series: { ...updated.series, books: syncedBooks } };
      }
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: make parentArcs editing series-aware"
```

---

### Task 14: End-to-End Verification

**Files:**
- All modified files

- [ ] **Step 1: Verify TypeScript compilation**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Verify the dev server starts**

Run:
```bash
npm run dev
```

Expected: Server starts without errors. Visit `http://localhost:3000` and verify the app loads.

- [ ] **Step 3: Test with a single-book EPUB**

Upload a standalone EPUB (not an omnibus). Verify:
- No book structure editor appears
- No book filter appears in header
- Analysis and arc grouping work as before

- [ ] **Step 4: Test with an omnibus EPUB**

Upload an omnibus EPUB (e.g., one with multiple books detected). Verify:
- Book Structure Editor modal appears after upload
- Books are listed with correct titles and chapter ranges
- "Confirm All & Start" saves and closes the modal
- Book filter appears in header after confirmation
- Selecting individual books filters the displayed entities
- "All Books" shows everything

- [ ] **Step 5: Test book structure editing from Manage tab**

Navigate to the Manage tab. Verify:
- "Edit Book Structure" button appears
- Clicking it opens the editor in 'manage' mode
- Editing book bounds (split, merge, exclude chapters) works
- After editing, the staleness banner appears on the Arcs panel

- [ ] **Step 6: Test migration of existing state**

Load a previously analyzed omnibus book (one with existing `excludedBooks`/`bookMeta`). Verify:
- The series definition is auto-generated from legacy fields
- Book filter appears in header
- Existing analysis data is preserved

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: complete multi-book series bounds implementation"
```
