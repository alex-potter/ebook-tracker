# Book Split & Boundary Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the book structure setup UX so users can accurately define book boundaries, identify non-story content, and split books at precise chapter points — even when chapter titles are poorly parsed.

**Architecture:** Two-pronged approach — (1) improve the EPUB parser's title extraction with extended heading scans, first-line previews, and content-type detection, and (2) upgrade BookStructureEditor with an interactive split-point picker and boundary stepper controls. A re-extraction callback enables title recovery after boundary changes.

**Tech Stack:** React (Next.js), TypeScript, IndexedDB (chapter-storage), JSZip (EPUB parsing)

---

### Task 1: Data Model Changes

**Files:**
- Modify: `types/index.ts:11-18` (EbookChapter interface)
- Modify: `types/index.ts:134-137` (BookMeta interface)
- Modify: `lib/chapter-storage.ts:25-28` (ChapterTextEntry interface)

- [ ] **Step 1: Add `preview` and `contentType` to `EbookChapter`**

In `types/index.ts`, update the `EbookChapter` interface:

```typescript
export interface EbookChapter {
  id: string;
  title: string;
  text: string;
  order: number;
  bookIndex?: number;   // which book in an omnibus (0-based); undefined for standalone
  bookTitle?: string;   // title of that book within the omnibus
  preview?: string;     // first meaningful line of content (~80 chars)
  contentType?: 'story' | 'front-matter' | 'back-matter' | 'structural';
}
```

- [ ] **Step 2: Add `preview` and `contentType` to `BookMeta.chapters`**

In `types/index.ts`, update the `BookMeta` interface:

```typescript
export interface BookMeta {
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    bookIndex?: number;
    bookTitle?: string;
    preview?: string;
    contentType?: 'story' | 'front-matter' | 'back-matter' | 'structural';
  }>;
  books?: string[];
}
```

- [ ] **Step 3: Add `htmlHead` to `ChapterTextEntry`**

In `lib/chapter-storage.ts`, update the interface:

```typescript
export interface ChapterTextEntry {
  id: string;
  text: string;
  htmlHead?: string;  // first ~1KB of raw HTML for title re-extraction
}
```

- [ ] **Step 4: Commit**

```bash
git add types/index.ts lib/chapter-storage.ts
git commit -m "feat: add preview, contentType, and htmlHead to data models"
```

---

### Task 2: Parser — Content Type Detection

**Files:**
- Modify: `lib/epub-parser.ts` (add `detectContentType` function, export it)

Content type detection identifies front-matter, back-matter, and structural chapters by title pattern and text length. This consolidates the existing `FRONT_MATTER_RE`/`BACK_MATTER_RE` patterns from `app/page.tsx:73-83` into the parser so the classification happens at parse time.

- [ ] **Step 1: Add content type detection function**

Add this after the `isGenericTitle` function (after line 176) in `lib/epub-parser.ts`:

```typescript
const FRONT_MATTER_TITLE_RE = /^\s*(acknowledgements?|acknowledgments?|foreword|fore\s*word|preface|dedication|about\s+the\s+author|author'?s?\s+note|note\s+(from|by)\s+the\s+author|copyright|contents|table\s+of\s+contents|cast\s+of\s+characters|dramatis\s+personae|maps?|epigraph|title\s+page)\s*$/i;

const BACK_MATTER_TITLE_RE = /^\s*(acknowledgements?|acknowledgments?|about\s+the\s+author|author'?s?\s+note|note\s+(from|by)\s+the\s+author|also\s+by|other\s+books|bibliography|glossary|index|appendix|afterword|bonus|excerpt|preview|sneak\s+peek|reading\s+group|book\s+club|discussion\s+questions?)\s*$/i;

export function detectContentType(
  title: string,
  textLength: number,
): 'story' | 'front-matter' | 'back-matter' | 'structural' {
  if (textLength < 50) return 'structural';
  if (FRONT_MATTER_TITLE_RE.test(title)) return 'front-matter';
  if (BACK_MATTER_TITLE_RE.test(title)) return 'back-matter';
  return 'story';
}
```

- [ ] **Step 2: Apply content type during chapter extraction**

In the chapter extraction loop in `parseEpub()`, after the title resolution block (after line 79), add content type detection. Change the `chapters.push(...)` call at line 83 to:

```typescript
    const contentType = detectContentType(chapterTitle, text.trim().length);

    chapters.push({
      id: itemId,
      title: chapterTitle,
      text: text.trim(),
      order: order++,
      contentType,
      _href: candidates[0],
    } as EbookChapter & { _href: string });
```

- [ ] **Step 3: Verify** — Run `npm run dev`, upload an EPUB, and check browser console for chapter objects to confirm `contentType` is populated.

- [ ] **Step 4: Commit**

```bash
git add lib/epub-parser.ts
git commit -m "feat: add content type detection to EPUB parser"
```

---

### Task 3: Parser — Improved Title Extraction & Preview

**Files:**
- Modify: `lib/epub-parser.ts` (enhance title resolution, add preview extraction)

- [ ] **Step 1: Add extended heading scan function**

Add this helper after `extractText` (after line 352) in `lib/epub-parser.ts`:

```typescript
/** Scan the first portion of HTML for heading-like elements beyond h1-h3.
 *  Looks for h4-h6, bold/strong-only paragraphs, and elements with title-like classes. */
function extractExtendedHeading(html: string): string {
  const head = html.slice(0, 2000);

  // Try h4-h6
  const hMatch = head.match(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/i);
  if (hMatch) {
    const t = extractText(hMatch[1]).trim();
    if (t.length > 0 && t.length < 100) return t;
  }

  // Look for a <p> or <div> whose only meaningful child is <b>, <strong>, or <em>
  const boldParaRe = /<(?:p|div)[^>]*>\s*<(?:b|strong|em)>([\s\S]*?)<\/(?:b|strong|em)>\s*<\/(?:p|div)>/gi;
  for (const m of head.matchAll(boldParaRe)) {
    const t = extractText(m[1]).trim();
    if (t.length > 0 && t.length < 100) return t;
  }

  // Look for elements with title-like class names
  const classRe = /<(?:p|div|span)[^>]+class="[^"]*(?:title|heading|chapter|ct)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/gi;
  for (const m of head.matchAll(classRe)) {
    const t = extractText(m[1]).trim();
    if (t.length > 0 && t.length < 100 && !isGenericTitle(t)) return t;
  }

  return '';
}

/** Extract a short preview from the chapter's plain text — first non-empty line, capped at 80 chars. */
function extractPreview(text: string): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= 10) {
      return trimmed.length <= 80 ? trimmed : trimmed.slice(0, 77) + '...';
    }
  }
  return '';
}
```

- [ ] **Step 2: Update the title resolution chain to use extended heading scan**

In `parseEpub()`, replace the title resolution block (lines 71-79) with:

```typescript
    const basename = href.split('/').pop()!;
    const ncxTitle = ncxTitleMap.get(basename) ?? ncxTitleMap.get(href);
    let chapterTitle: string;
    if (ncxTitle) {
      chapterTitle = ncxTitle;
    } else {
      // Priority: h1-h3 heading → extended heading scan → "Part N" fallback
      const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      const rawTitle = headingMatch?.[1] ? extractText(headingMatch[1]) : '';
      if (rawTitle.trim()) {
        chapterTitle = rawTitle.trim();
      } else {
        const extended = extractExtendedHeading(html);
        chapterTitle = extended || `Part ${order + 1}`;
      }
    }

    const preview = extractPreview(text);
```

- [ ] **Step 3: Include preview and htmlHead in the chapter push**

Update the `chapters.push(...)` call (the one modified in Task 2) to also include `preview` and store `htmlHead` for later re-extraction:

```typescript
    const contentType = detectContentType(chapterTitle, text.trim().length);

    chapters.push({
      id: itemId,
      title: chapterTitle,
      text: text.trim(),
      order: order++,
      preview,
      contentType,
      _href: candidates[0],
      _htmlHead: html.slice(0, 1024),
    } as EbookChapter & { _href: string; _htmlHead: string });
```

- [ ] **Step 4: Clean up internal fields before returning**

Update the cleanup block (line 117) to also remove `_htmlHead`:

```typescript
  for (const ch of chapters) {
    delete (ch as unknown as Record<string, unknown>)._href;
    delete (ch as unknown as Record<string, unknown>)._htmlHead;
  }
```

But we need the `_htmlHead` data to survive long enough to be saved by `page.tsx`. Instead, keep `_htmlHead` on the chapter objects and add a new export to extract it:

Actually, the simpler approach: save `_htmlHead` into a Map before cleanup, and export a function. But that's awkward. Instead, just keep `_htmlHead` as a temporary field and have page.tsx read it before it's cleaned up.

**Revised approach:** Don't clean up `_htmlHead` in the parser. Let `page.tsx` extract it when saving chapters. Update the cleanup to only remove `_href`:

```typescript
  for (const ch of chapters) delete (ch as unknown as Record<string, unknown>)._href;
```

The `_htmlHead` field will be read by page.tsx during `saveChapters` and then naturally dropped since `EbookChapter` doesn't declare it (it won't be persisted in bookMeta).

- [ ] **Step 5: Verify** — Run `npm run dev`, upload an EPUB. Check that chapters with previously "Part N" titles now have better names, and that `preview` is populated on chapter objects.

- [ ] **Step 6: Commit**

```bash
git add lib/epub-parser.ts
git commit -m "feat: add extended heading scan and preview extraction to parser"
```

---

### Task 4: Thread New Fields Through page.tsx

**Files:**
- Modify: `app/page.tsx:943-944` (activateBook — bookMeta construction)
- Modify: `app/page.tsx:970-973` (activateBook — saveChapters call)
- Modify: `app/page.tsx:1636` (BookStructureEditor chapters prop)
- Modify: `app/page.tsx:1047` (loadBookFromMeta — chapter reconstruction)

- [ ] **Step 1: Include preview and contentType in bookMeta construction**

In `activateBook()`, update line 943-944:

```typescript
    const bookMeta: BookMeta = {
      chapters: parsed.chapters.map(({ id, title, order, bookIndex, bookTitle, preview, contentType }) =>
        ({ id, title, order, bookIndex, bookTitle, preview, contentType })),
      books: parsed.books,
    };
```

- [ ] **Step 2: Include htmlHead in saveChapters call**

In `activateBook()`, update lines 970-973 to pass `_htmlHead`:

```typescript
    const chaptersWithText = parsed.chapters.filter((ch) => ch.text).map((ch) => ({
      id: ch.id,
      text: ch.text,
      htmlHead: (ch as unknown as Record<string, string>)._htmlHead,
    }));
    if (chaptersWithText.length > 0) {
      saveChapters(parsed.title, parsed.author, chaptersWithText).catch(() => {});
    }
```

- [ ] **Step 3: Pass preview and contentType to BookStructureEditor**

Update line 1636:

```typescript
          chapters={book.chapters.map(({ order, title, bookIndex, preview, contentType }) =>
            ({ order, title, bookIndex, preview, contentType }))}
```

- [ ] **Step 4: Reconstruct preview and contentType in loadBookFromMeta**

Update line 1047 (the chapter reconstruction in `loadBookFromMeta`):

```typescript
          chapters: stored.bookMeta.chapters.map((ch) => ({
            ...ch,
            text: textMap?.get(ch.id) ?? '',
          })),
```

This already spreads all bookMeta chapter fields (including `preview` and `contentType`) since we're spreading `ch`. No change needed here — just verify it works.

- [ ] **Step 5: Verify** — Run the app, load a previously parsed book from the library. Confirm BookStructureEditor renders without errors and chapters still display correctly.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: thread preview and contentType through page.tsx"
```

---

### Task 5: BookStructureEditor — Non-Story Visual Treatment

**Files:**
- Modify: `components/BookStructureEditor.tsx`

- [ ] **Step 1: Update the Props interface to accept new chapter fields**

Update the `Props` interface and `chapters` type (lines 6-8):

```typescript
interface Props {
  series: SeriesDefinition;
  chapters: Array<{
    order: number;
    title: string;
    bookIndex?: number;
    preview?: string;
    contentType?: 'story' | 'front-matter' | 'back-matter' | 'structural';
  }>;
  onSave: (series: SeriesDefinition) => void;
  onClose: () => void;
  mode: 'setup' | 'manage';
}
```

- [ ] **Step 2: Add a helper to get content type label**

Add after the `getChapterTitle` function (after line 27):

```typescript
  function getContentTypeLabel(order: number): string | null {
    const ch = chapters.find((c) => c.order === order);
    if (!ch?.contentType || ch.contentType === 'story') return null;
    return ch.contentType.replace('-', ' ');
  }

  function getChapterPreview(order: number): string | null {
    return chapters.find((c) => c.order === order)?.preview ?? null;
  }
```

- [ ] **Step 3: Update chapter list rendering to show content type and preview**

In the expanded chapter list (lines 200-217), update the chapter label rendering:

```typescript
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {Array.from({ length: book.chapterEnd - book.chapterStart + 1 }, (_, j) => {
                        const order = book.chapterStart + j;
                        const isExcluded = book.excludedChapters.includes(order);
                        const typeLabel = getContentTypeLabel(order);
                        const preview = getChapterPreview(order);
                        return (
                          <label key={order} className="flex items-start gap-2 text-xs cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => handleToggleExcluded(book.index, order)}
                              className="rounded border-stone-300 dark:border-zinc-600 text-amber-500 focus:ring-amber-500/30 mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <span className={`truncate block ${isExcluded ? 'text-stone-300 dark:text-zinc-600 line-through' : typeLabel ? 'text-stone-400 dark:text-zinc-500 italic' : 'text-stone-600 dark:text-zinc-400'}`}>
                                {getChapterTitle(order)}
                                {typeLabel && (
                                  <span className="ml-1.5 text-[10px] text-stone-300 dark:text-zinc-600 font-medium uppercase tracking-wider">
                                    {typeLabel}
                                  </span>
                                )}
                              </span>
                              {preview && /^Part \d+$/.test(getChapterTitle(order)) && (
                                <span className="text-[11px] text-stone-400 dark:text-zinc-500 truncate block">
                                  {preview}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
```

The preview line only shows for "Part N" chapters — chapters with real titles don't need it.

- [ ] **Step 4: Auto-exclude non-story chapters during setup**

In the `handleConfirmAll` function (line 29-33), add auto-exclusion of non-story chapters:

```typescript
  function handleConfirmAll() {
    const confirmed = books.map((b) => {
      const nonStoryOrders: number[] = [];
      for (let o = b.chapterStart; o <= b.chapterEnd; o++) {
        const ch = chapters.find((c) => c.order === o);
        if (ch?.contentType && ch.contentType !== 'story' && !b.excludedChapters.includes(o)) {
          nonStoryOrders.push(o);
        }
      }
      return {
        ...b,
        confirmed: true,
        excludedChapters: [...b.excludedChapters, ...nonStoryOrders],
      };
    });
    setBooks(confirmed);
    onSave({ ...series, books: confirmed, unassignedChapters: unassigned.map((ch) => ch.order) });
  }
```

- [ ] **Step 5: Verify** — Run the app, upload a WoT-style EPUB. Confirm that glossary/maps chapters show dimmed with content type labels, and that "Confirm All" auto-excludes them.

- [ ] **Step 6: Commit**

```bash
git add components/BookStructureEditor.tsx
git commit -m "feat: add non-story content visual treatment in BookStructureEditor"
```

---

### Task 6: BookStructureEditor — Split Picker Mode

**Files:**
- Modify: `components/BookStructureEditor.tsx`

- [ ] **Step 1: Add split mode state**

Add a new state variable after `expandedBook` (after line 17):

```typescript
  const [splitMode, setSplitMode] = useState<number | null>(null); // bookIndex being split
```

- [ ] **Step 2: Update handleSplitBook default title**

In `handleSplitBook` (line 48), change the new book title from `${book.title} (Part 2)` to a generic name:

```typescript
      const book2: BookDefinition = {
        index: maxIdx + 1,
        title: `Book ${maxIdx + 2}`,
        chapterStart: splitAtOrder,
        chapterEnd: book.chapterEnd,
        excludedChapters: book.excludedChapters.filter((o) => o >= splitAtOrder),
        confirmed: false,
      };
```

- [ ] **Step 3: Replace the split button with split mode toggle**

In the actions bar (lines 220-239), replace the existing split button `onClick`:

```typescript
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (splitMode === book.index) {
                            setSplitMode(null);
                          } else {
                            setSplitMode(book.index);
                            setExpandedBook(book.index);
                          }
                        }}
                        className={`text-xs transition-colors ${splitMode === book.index ? 'text-amber-500 font-medium' : 'text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300'}`}
                      >
                        {splitMode === book.index ? 'Cancel split' : 'Split'}
                      </button>
```

- [ ] **Step 4: Add split mode header and tappable chapter rows**

In the expanded chapter section (the `{isExpanded && (...)}` block starting at line 198), add a split mode header above the chapter list, and make chapters tappable in split mode:

```typescript
                {isExpanded && (
                  <div className="border-t border-stone-200 dark:border-zinc-800 px-4 py-3 space-y-2">
                    {splitMode === book.index && (
                      <p className="text-xs text-amber-500 font-medium pb-1">
                        Tap where the next book starts
                      </p>
                    )}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {Array.from({ length: book.chapterEnd - book.chapterStart + 1 }, (_, j) => {
                        const order = book.chapterStart + j;
                        const isExcluded = book.excludedChapters.includes(order);
                        const typeLabel = getContentTypeLabel(order);
                        const preview = getChapterPreview(order);
                        const isSplittable = splitMode === book.index && order > book.chapterStart;
                        return (
                          <label
                            key={order}
                            className={`flex items-start gap-2 text-xs cursor-pointer group ${isSplittable ? 'hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded px-1 -mx-1 py-0.5' : ''}`}
                            onClick={(e) => {
                              if (isSplittable) {
                                e.preventDefault();
                                handleSplitBook(book.index, order);
                                setSplitMode(null);
                              }
                            }}
                          >
                            {splitMode !== book.index && (
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                onChange={() => handleToggleExcluded(book.index, order)}
                                className="rounded border-stone-300 dark:border-zinc-600 text-amber-500 focus:ring-amber-500/30 mt-0.5"
                              />
                            )}
                            {isSplittable && (
                              <span className="text-amber-400 mt-0.5 flex-shrink-0">&#x2192;</span>
                            )}
                            {splitMode === book.index && order === book.chapterStart && (
                              <span className="text-stone-300 dark:text-zinc-600 mt-0.5 flex-shrink-0">&middot;</span>
                            )}
                            <div className="flex-1 min-w-0">
                              <span className={`truncate block ${isExcluded ? 'text-stone-300 dark:text-zinc-600 line-through' : typeLabel ? 'text-stone-400 dark:text-zinc-500 italic' : 'text-stone-600 dark:text-zinc-400'}`}>
                                {getChapterTitle(order)}
                                {typeLabel && (
                                  <span className="ml-1.5 text-[10px] text-stone-300 dark:text-zinc-600 font-medium uppercase tracking-wider">
                                    {typeLabel}
                                  </span>
                                )}
                              </span>
                              {preview && /^Part \d+$/.test(getChapterTitle(order)) && (
                                <span className="text-[11px] text-stone-400 dark:text-zinc-500 truncate block">
                                  {preview}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
```

Note: In split mode, checkboxes are hidden (they're irrelevant — the user is picking a split point, not toggling exclusions). The first chapter shows a dot (can't split before the first chapter). All other chapters show an arrow indicating they're tappable.

- [ ] **Step 5: Verify** — Run the app, open BookStructureEditor, expand a book, click "Split". Confirm the prompt appears, chapters become tappable, and tapping one correctly splits the book.

- [ ] **Step 6: Commit**

```bash
git add components/BookStructureEditor.tsx
git commit -m "feat: add interactive split-point picker to BookStructureEditor"
```

---

### Task 7: BookStructureEditor — Boundary Steppers

**Files:**
- Modify: `components/BookStructureEditor.tsx`

- [ ] **Step 1: Add boundary adjustment handlers**

Add these functions after `handleCreateBookFromUnassigned` (after line 105):

```typescript
  function handleExpandEnd(bookIndex: number) {
    setBooks((prev) => {
      const sorted = [...prev].sort((a, b) => a.chapterStart - b.chapterStart);
      const idx = sorted.findIndex((b) => b.index === bookIndex);
      if (idx < 0) return prev;
      const book = sorted[idx];
      const nextBook = sorted[idx + 1];
      const newEnd = book.chapterEnd + 1;

      // Check there's a chapter to absorb
      const chapterExists = chapters.some((ch) => ch.order === newEnd);
      if (!chapterExists) return prev;

      if (nextBook && newEnd >= nextBook.chapterStart) {
        // Steal from next book's start
        if (nextBook.chapterStart >= nextBook.chapterEnd) return prev; // next book would become empty
        return prev.map((b) => {
          if (b.index === bookIndex) return { ...b, chapterEnd: newEnd, parentArcs: undefined, arcGroupingHash: undefined };
          if (b.index === nextBook.index) return { ...b, chapterStart: newEnd + 1, excludedChapters: b.excludedChapters.filter((o) => o > newEnd), parentArcs: undefined, arcGroupingHash: undefined };
          return b;
        });
      }
      // Absorb from unassigned
      return prev.map((b) => b.index === bookIndex ? { ...b, chapterEnd: newEnd, parentArcs: undefined, arcGroupingHash: undefined } : b);
    });
  }

  function handleShrinkEnd(bookIndex: number) {
    setBooks((prev) => {
      const book = prev.find((b) => b.index === bookIndex);
      if (!book || book.chapterStart >= book.chapterEnd) return prev; // can't shrink to 0
      const released = book.chapterEnd;
      return prev.map((b) => b.index === bookIndex ? {
        ...b,
        chapterEnd: released - 1,
        excludedChapters: b.excludedChapters.filter((o) => o < released),
        parentArcs: undefined,
        arcGroupingHash: undefined,
      } : b);
    });
  }

  function handleExpandStart(bookIndex: number) {
    setBooks((prev) => {
      const sorted = [...prev].sort((a, b) => a.chapterStart - b.chapterStart);
      const idx = sorted.findIndex((b) => b.index === bookIndex);
      if (idx < 0) return prev;
      const book = sorted[idx];
      const prevBook = sorted[idx - 1];
      const newStart = book.chapterStart - 1;

      const chapterExists = chapters.some((ch) => ch.order === newStart);
      if (!chapterExists || newStart < 0) return prev;

      if (prevBook && newStart <= prevBook.chapterEnd) {
        // Steal from previous book's end
        if (prevBook.chapterStart >= prevBook.chapterEnd) return prev;
        return prev.map((b) => {
          if (b.index === bookIndex) return { ...b, chapterStart: newStart, parentArcs: undefined, arcGroupingHash: undefined };
          if (b.index === prevBook.index) return { ...b, chapterEnd: newStart - 1, excludedChapters: b.excludedChapters.filter((o) => o < newStart), parentArcs: undefined, arcGroupingHash: undefined };
          return b;
        });
      }
      return prev.map((b) => b.index === bookIndex ? { ...b, chapterStart: newStart, parentArcs: undefined, arcGroupingHash: undefined } : b);
    });
  }

  function handleShrinkStart(bookIndex: number) {
    setBooks((prev) => {
      const book = prev.find((b) => b.index === bookIndex);
      if (!book || book.chapterStart >= book.chapterEnd) return prev;
      const released = book.chapterStart;
      return prev.map((b) => b.index === bookIndex ? {
        ...b,
        chapterStart: released + 1,
        excludedChapters: b.excludedChapters.filter((o) => o > released),
        parentArcs: undefined,
        arcGroupingHash: undefined,
      } : b);
    });
  }
```

- [ ] **Step 2: Add stepper controls to the chapter list boundaries**

In the expanded chapter list, add boundary controls before the first chapter and after the last chapter. Wrap the chapter list `div.max-h-40` with boundary controls:

```typescript
                    {splitMode !== book.index && (
                      <div className="flex items-center gap-1 pb-1">
                        <button
                          onClick={() => handleExpandStart(book.index)}
                          className="text-[10px] text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors px-1"
                          title="Absorb previous chapter"
                        >
                          &#x25B2; Expand start
                        </button>
                        <button
                          onClick={() => handleShrinkStart(book.index)}
                          className="text-[10px] text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors px-1"
                          title="Release first chapter"
                        >
                          &#x25BC; Shrink start
                        </button>
                      </div>
                    )}
                    {/* ... chapter list here ... */}
                    {splitMode !== book.index && (
                      <div className="flex items-center gap-1 pt-1">
                        <button
                          onClick={() => handleShrinkEnd(book.index)}
                          className="text-[10px] text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors px-1"
                          title="Release last chapter"
                        >
                          &#x25B2; Shrink end
                        </button>
                        <button
                          onClick={() => handleExpandEnd(book.index)}
                          className="text-[10px] text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors px-1"
                          title="Absorb next chapter"
                        >
                          &#x25BC; Expand end
                        </button>
                      </div>
                    )}
```

These controls are hidden during split mode (the user is picking a split point, not adjusting boundaries).

- [ ] **Step 3: Verify** — Run the app, expand a book in the editor, click the stepper buttons. Confirm:
  - "Expand end" absorbs the next chapter (from unassigned or next book)
  - "Shrink end" releases the last chapter
  - "Expand start" absorbs the previous chapter
  - "Shrink start" releases the first chapter
  - A book can't be shrunk below 1 chapter
  - Chapter count and range in the header update immediately

- [ ] **Step 4: Commit**

```bash
git add components/BookStructureEditor.tsx
git commit -m "feat: add boundary stepper controls to BookStructureEditor"
```

---

### Task 8: Title Re-extraction After Boundary Changes

**Files:**
- Modify: `components/BookStructureEditor.tsx` (add `onReextract` prop, trigger after splits/adjustments)
- Modify: `app/page.tsx` (implement `onReextract` callback)
- Modify: `lib/epub-parser.ts` (export `extractExtendedHeading` and `extractText` for reuse)

- [ ] **Step 1: Export parser functions for reuse**

In `lib/epub-parser.ts`, add `export` to `extractExtendedHeading`, `extractText`, and `extractPreview`:

```typescript
export function extractExtendedHeading(html: string): string {
```

```typescript
export function extractText(html: string): string {
```

```typescript
export function extractPreview(text: string): string {
```

- [ ] **Step 2: Add `onReextract` callback to BookStructureEditor props**

Update the `Props` interface:

```typescript
interface Props {
  series: SeriesDefinition;
  chapters: Array<{
    order: number;
    title: string;
    bookIndex?: number;
    preview?: string;
    contentType?: 'story' | 'front-matter' | 'back-matter' | 'structural';
  }>;
  onSave: (series: SeriesDefinition) => void;
  onClose: () => void;
  mode: 'setup' | 'manage';
  onReextract?: (chapterOrders: number[]) => Promise<Map<number, { title: string; preview?: string }>>;
}
```

Update the component signature to destructure it:

```typescript
export default function BookStructureEditor({ series, chapters, onSave, onClose, mode, onReextract }: Props) {
```

- [ ] **Step 3: Add local chapters state for title updates**

Add mutable chapter state so re-extracted titles can update the display. After the existing state declarations:

```typescript
  const [localChapters, setLocalChapters] = useState(chapters);
```

Update `getChapterTitle`, `getContentTypeLabel`, and `getChapterPreview` to use `localChapters` instead of `chapters`:

```typescript
  function getChapterTitle(order: number): string {
    return localChapters.find((ch) => ch.order === order)?.title ?? `Chapter ${order + 1}`;
  }

  function getContentTypeLabel(order: number): string | null {
    const ch = localChapters.find((c) => c.order === order);
    if (!ch?.contentType || ch.contentType === 'story') return null;
    return ch.contentType.replace('-', ' ');
  }

  function getChapterPreview(order: number): string | null {
    return localChapters.find((c) => c.order === order)?.preview ?? null;
  }
```

Also update `assignedOrders` and `unassigned` to use `localChapters`:

```typescript
  const unassigned = localChapters.filter((ch) => !assignedOrders.has(ch.order));
```

- [ ] **Step 4: Trigger re-extraction after boundary changes**

Add a helper that collects "Part N" chapter orders from affected books and calls `onReextract`:

```typescript
  async function triggerReextract(affectedBookIndices: number[]) {
    if (!onReextract) return;
    const partNOrders: number[] = [];
    for (const bi of affectedBookIndices) {
      const book = books.find((b) => b.index === bi);
      if (!book) continue;
      for (let o = book.chapterStart; o <= book.chapterEnd; o++) {
        const title = getChapterTitle(o);
        if (/^Part \d+$/.test(title)) partNOrders.push(o);
      }
    }
    if (partNOrders.length === 0) return;

    const newTitles = await onReextract(partNOrders);
    if (newTitles.size === 0) return;
    setLocalChapters((prev) => prev.map((ch) => {
      const update = newTitles.get(ch.order);
      if (!update) return ch;
      return { ...ch, title: update.title, preview: update.preview ?? ch.preview };
    }));
  }
```

Call `triggerReextract` at the end of `handleSplitBook` — update the function to track affected indices. Wrap the `setBooks` call:

```typescript
  function handleSplitBook(bookIndex: number, splitAtOrder: number) {
    let newBookIndex: number | null = null;
    setBooks((prev) => {
      const book = prev.find((b) => b.index === bookIndex);
      if (!book || splitAtOrder <= book.chapterStart || splitAtOrder > book.chapterEnd) return prev;

      const maxIdx = Math.max(...prev.map((b) => b.index));
      newBookIndex = maxIdx + 1;
      const book1: BookDefinition = {
        ...book,
        chapterEnd: splitAtOrder - 1,
        excludedChapters: book.excludedChapters.filter((o) => o < splitAtOrder),
        parentArcs: undefined,
        arcGroupingHash: undefined,
      };
      const book2: BookDefinition = {
        index: newBookIndex,
        title: `Book ${newBookIndex + 1}`,
        chapterStart: splitAtOrder,
        chapterEnd: book.chapterEnd,
        excludedChapters: book.excludedChapters.filter((o) => o >= splitAtOrder),
        confirmed: false,
      };
      return [...prev.filter((b) => b.index !== bookIndex), book1, book2].sort((a, b) => a.chapterStart - b.chapterStart);
    });
    if (newBookIndex !== null) {
      triggerReextract([bookIndex, newBookIndex]);
    }
  }
```

Also trigger after boundary adjustments — add `triggerReextract([bookIndex])` at the end of each boundary handler (`handleExpandEnd`, `handleShrinkEnd`, `handleExpandStart`, `handleShrinkStart`). For brevity, wrap the state update and reextract call:

After each `setBooks(...)` call in the four boundary handlers, add:

```typescript
    triggerReextract([bookIndex]);
```

- [ ] **Step 5: Implement `onReextract` in page.tsx**

In `app/page.tsx`, add the re-extraction function and pass it as a prop. Add this function inside the component, near `handleSaveSeries`:

```typescript
  async function handleReextractTitles(
    chapterOrders: number[],
  ): Promise<Map<number, { title: string; preview?: string }>> {
    if (!book) return new Map();

    const { loadChapters } = await import('@/lib/chapter-storage');
    const { extractExtendedHeading, extractText, extractPreview } = await import('@/lib/epub-parser');

    const entries = await loadChapters(book.title, book.author);
    if (!entries) return new Map();

    const orderToId = new Map<number, string>();
    if (storedRef.current?.bookMeta) {
      for (const ch of storedRef.current.bookMeta.chapters) {
        orderToId.set(ch.order, ch.id);
      }
    }

    const result = new Map<number, { title: string; preview?: string }>();
    for (const order of chapterOrders) {
      const id = orderToId.get(order);
      if (!id) continue;
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;

      let newTitle: string | undefined;

      // Try re-extraction from stored HTML head
      if (entry.htmlHead) {
        const headingMatch = entry.htmlHead.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
        const rawTitle = headingMatch?.[1] ? extractText(headingMatch[1]) : '';
        if (rawTitle.trim()) {
          newTitle = rawTitle.trim();
        } else {
          const extended = extractExtendedHeading(entry.htmlHead);
          if (extended) newTitle = extended;
        }
      }

      // Fallback: use first line of plain text as title
      if (!newTitle) {
        const firstLine = entry.text.split('\n').find((l) => l.trim().length > 0)?.trim();
        if (firstLine && firstLine.length < 100) {
          newTitle = firstLine;
        }
      }

      if (newTitle) {
        const preview = extractPreview(entry.text);
        result.set(order, { title: newTitle, preview: preview || undefined });
      }
    }

    // Update bookMeta with new titles
    if (result.size > 0 && storedRef.current?.bookMeta) {
      const updatedChapters = storedRef.current.bookMeta.chapters.map((ch) => {
        const update = result.get(ch.order);
        if (!update) return ch;
        return { ...ch, title: update.title, preview: update.preview ?? ch.preview };
      });
      const updatedMeta = { ...storedRef.current.bookMeta, chapters: updatedChapters };
      storedRef.current = { ...storedRef.current, bookMeta: updatedMeta };
      persistState(book.title, book.author, storedRef.current);
    }

    return result;
  }
```

- [ ] **Step 6: Pass `onReextract` to BookStructureEditor**

Update the BookStructureEditor JSX invocation (around line 1634):

```typescript
        <BookStructureEditor
          series={storedRef.current.series}
          chapters={book.chapters.map(({ order, title, bookIndex, preview, contentType }) =>
            ({ order, title, bookIndex, preview, contentType }))}
          onSave={handleSaveSeries}
          onClose={() => setShowBookStructureEditor(false)}
          mode={bookStructureMode}
          onReextract={handleReextractTitles}
        />
```

- [ ] **Step 7: Verify** — Run the app with the WoT omnibus. Expand Crossroads of Twilight, use the split picker to split at the correct boundary. Confirm that "Part N" chapters in the newly created book attempt re-extraction, and titles update if better ones are found.

- [ ] **Step 8: Commit**

```bash
git add lib/epub-parser.ts components/BookStructureEditor.tsx app/page.tsx
git commit -m "feat: add title re-extraction after boundary changes"
```
