import type { BookDefinition, BookContainer, BookMeta, ParentArc, BookFilter } from '@/types';

/** Build a BookContainer from parsed EPUB data. Always returns a container, even for single-book EPUBs. */
export function buildContainer(
  bookMeta: BookMeta,
  detectRange: (chapters: Array<{ title: string; text: string }>) => { start: number; end: number },
  chapterTexts?: Map<number, { title: string; text: string }>,
  sourceEpub?: string,
): BookContainer {
  const hasMultipleBooks = bookMeta.books && bookMeta.books.length > 1;

  if (!hasMultipleBooks) {
    const allOrders = bookMeta.chapters.map((ch) => ch.order);
    if (allOrders.length === 0) {
      return { books: [{ index: 0, title: 'Book', chapterStart: 0, chapterEnd: 0, excludedChapters: [], confirmed: false, sourceEpub }], unassignedChapters: [] };
    }
    const chapterStart = Math.min(...allOrders);
    const chapterEnd = Math.max(...allOrders);
    let excludedChapters: number[] = [];

    if (chapterTexts) {
      const chapterData: Array<{ order: number; title: string; text: string }> = [];
      for (let o = chapterStart; o <= chapterEnd; o++) {
        const data = chapterTexts.get(o);
        if (data) chapterData.push({ order: o, ...data });
      }
      if (chapterData.length > 0) {
        const range = detectRange(chapterData);
        for (const ch of chapterData) {
          const relIdx = ch.order - chapterStart;
          if (relIdx < range.start || relIdx > range.end) {
            excludedChapters.push(ch.order);
          }
        }
      }
    }

    const bookTitle = bookMeta.books?.[0] ?? 'Book';
    return {
      books: [{ index: 0, title: bookTitle, chapterStart, chapterEnd, excludedChapters, confirmed: false, sourceEpub }],
      unassignedChapters: [],
    };
  }

  // Multi-book EPUB (omnibus)
  const bookChapters = new Map<number, number[]>();
  for (const ch of bookMeta.chapters) {
    if (ch.bookIndex === undefined) continue;
    if (!bookChapters.has(ch.bookIndex)) bookChapters.set(ch.bookIndex, []);
    bookChapters.get(ch.bookIndex)!.push(ch.order);
  }

  const books: BookDefinition[] = [];
  for (let i = 0; i < bookMeta.books!.length; i++) {
    const orders = bookChapters.get(i);
    if (!orders?.length) continue;
    orders.sort((a, b) => a - b);
    const chapterStart = orders[0];
    const chapterEnd = orders[orders.length - 1];

    let excludedChapters: number[] = [];
    if (chapterTexts) {
      const bookChapterData: Array<{ order: number; title: string; text: string }> = [];
      for (let o = chapterStart; o <= chapterEnd; o++) {
        const data = chapterTexts.get(o);
        if (data) bookChapterData.push({ order: o, ...data });
      }
      if (bookChapterData.length > 0) {
        const range = detectRange(bookChapterData);
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
      title: bookMeta.books![i],
      chapterStart,
      chapterEnd,
      excludedChapters,
      confirmed: false,
      sourceEpub,
    });
  }

  const assignedOrders = new Set<number>();
  for (const b of books) {
    for (let o = b.chapterStart; o <= b.chapterEnd; o++) assignedOrders.add(o);
  }
  const allOrders = bookMeta.chapters.map((ch) => ch.order);
  const unassignedChapters = allOrders.filter((o) => !assignedOrders.has(o));

  return { books, unassignedChapters };
}

/** Merge all books in a container into a single BookDefinition. */
export function mergeToSingleBook(container: BookContainer, title?: string): BookContainer {
  if (container.books.length <= 1) return container;
  const sorted = [...container.books].sort((a, b) => a.chapterStart - b.chapterStart);
  const allExcluded = sorted.flatMap((b) => b.excludedChapters);
  const merged: BookDefinition = {
    index: 0,
    title: title ?? sorted[0].title,
    chapterStart: sorted[0].chapterStart,
    chapterEnd: sorted[sorted.length - 1].chapterEnd,
    excludedChapters: allExcluded,
    confirmed: false,
    sourceEpub: sorted[0].sourceEpub,
  };
  return { books: [merged], unassignedChapters: container.unassignedChapters };
}

/** Per-book display chapter number (1-based, skips excluded). */
export function displayChapterNumber(
  container: BookContainer,
  bookIndex: number,
  chapterOrder: number,
): number {
  const book = container.books.find((b) => b.index === bookIndex);
  if (!book) return chapterOrder + 1;
  let num = 0;
  for (let o = book.chapterStart; o <= chapterOrder; o++) {
    if (!book.excludedChapters.includes(o)) num++;
  }
  return num;
}

/** User-facing chapter label. Single book: "Ch. N". Multi-book: "Title — Ch. N". */
export function getDisplayLabel(
  container: BookContainer,
  chapterOrder: number,
): string {
  const book = container.books.find(
    (b) => chapterOrder >= b.chapterStart && chapterOrder <= b.chapterEnd,
  );
  if (!book) return `Ch. ${chapterOrder + 1}`;
  const num = displayChapterNumber(container, book.index, chapterOrder);
  if (container.books.length === 1) return `Ch. ${num}`;
  return `${book.title} — Ch. ${num}`;
}

/** Build the set of excluded chapter orders from the container. */
export function getExcludedOrders(container: BookContainer): Set<number> {
  const excluded = new Set<number>();
  for (const b of container.books) {
    if (b.excluded) {
      for (let o = b.chapterStart; o <= b.chapterEnd; o++) excluded.add(o);
    } else {
      for (const ex of b.excludedChapters) excluded.add(ex);
    }
  }
  for (const uo of container.unassignedChapters) excluded.add(uo);
  return excluded;
}

export function computeArcGroupingHash(book: BookDefinition): string {
  const data = `${book.chapterStart}:${book.chapterEnd}:${book.excludedChapters.sort((a, b) => a - b).join(',')}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function isBookArcStale(book: BookDefinition): boolean {
  if (!book.parentArcs?.length) return false;
  if (!book.arcGroupingHash) return true;
  return computeArcGroupingHash(book) !== book.arcGroupingHash;
}

export function findBookForChapter(container: BookContainer, chapterOrder: number): BookDefinition | undefined {
  return container.books.find((b) => chapterOrder >= b.chapterStart && chapterOrder <= b.chapterEnd);
}

export function arcBookIndices(
  arcChapters: number[],
  container: BookContainer,
): number[] {
  const indices = new Set<number>();
  for (const ch of arcChapters) {
    const book = findBookForChapter(container, ch);
    if (book) indices.add(book.index);
  }
  return [...indices].sort((a, b) => a - b);
}

export function getActiveParentArcs(
  container: BookContainer,
  filter: BookFilter,
  fallbackParentArcs?: ParentArc[],
): ParentArc[] {
  if (filter.mode === 'all') {
    return container.seriesArcs ?? fallbackParentArcs ?? [];
  }
  const result: ParentArc[] = [];
  for (const b of container.books) {
    if (b.excluded) continue;
    if (filter.indices.includes(b.index) && b.parentArcs?.length) {
      result.push(...b.parentArcs);
    }
  }
  return result;
}

export function getStaleBooks(container: BookContainer): BookDefinition[] {
  return container.books.filter(isBookArcStale);
}
