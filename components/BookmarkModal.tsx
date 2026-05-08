'use client';

import { Fragment } from 'react';
import { normalizeTitle } from '@/lib/normalize-title';
import BookBuddyIcon from '@/components/BookBuddyIcon';
import type { EbookChapter } from '@/types';

interface Props {
  chapters: EbookChapter[];
  currentBookmark: number | null;
  mode: 'import' | 'update';
  onSelect: (chapterIndex: number | null) => void;
  onClose: () => void;
  visibleChapterOrders?: Set<number> | null;
}

export default function BookmarkModal({ chapters, currentBookmark, mode, onSelect, onClose, visibleChapterOrders }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-paper-raised border border-border rounded-2xl w-full max-w-md p-6 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-ink text-base font-serif">
            {mode === 'import' ? 'Where are you in this book?' : 'Update your bookmark'}
          </h2>
          <button
            onClick={onClose}
            className="text-ink-dim hover:text-ink transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-ink-dim mb-3">
          {mode === 'import'
            ? 'Set your reading position to avoid spoilers.'
            : 'Tap the chapter you\'ve read up to.'}
        </p>

        {/* Chapter list */}
        <div className="overflow-y-auto flex-1 -mx-2">
          {/* "I haven't started yet" option */}
          <button
            onClick={() => onSelect(0)}
            className={`w-full text-left px-3 py-3 text-sm rounded-lg transition-colors flex items-center gap-2 font-serif ${
              currentBookmark === 0
                ? 'bg-amber-500/15 text-amber font-medium'
                : 'text-ink-soft hover:bg-paper-dark'
            }`}
          >
            <BookBuddyIcon className="w-5 h-5 flex-shrink-0 text-rust" />
            I haven&apos;t started yet
          </button>

          {(() => {
            const isOmnibus =
              chapters.some((c) => c.bookIndex !== undefined) &&
              new Set(chapters.map((c) => c.bookIndex)).size > 1;
            let lastBookIdx: number | undefined;
            return chapters.map((ch, i) => {
              if (visibleChapterOrders && !visibleChapterOrders.has(i)) return null;
              const showHeader = isOmnibus && ch.bookIndex !== lastBookIdx;
              lastBookIdx = ch.bookIndex;
              return (
                <Fragment key={i}>
                  {showHeader && ch.bookTitle && (
                    <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
                      {ch.bookTitle}
                    </div>
                  )}
                  <button
                    onClick={() => onSelect(i)}
                    className={`w-full text-left px-3 py-3 text-sm rounded-lg transition-colors truncate font-serif ${
                      i === currentBookmark
                        ? 'bg-amber-500/15 text-amber font-medium'
                        : 'text-ink-soft hover:bg-paper-dark'
                    }`}
                  >
                    <span className="text-ink-dim mr-1.5 tabular-nums font-mono text-xs">{i + 1}.</span>
                    {normalizeTitle(ch.title)}
                  </button>
                </Fragment>
              );
            });
          })()}

          {/* Clear bookmark — update mode only */}
          {mode === 'update' && currentBookmark != null && (
            <button
              onClick={() => onSelect(null)}
              className="w-full text-left px-3 py-3 text-sm rounded-lg transition-colors text-danger hover:bg-danger/10 mt-2 border-t border-border pt-3 font-serif"
            >
              Clear bookmark
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
