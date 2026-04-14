'use client';

import { useState, useRef, useEffect } from 'react';
import type { BookFilter, BookContainer } from '@/types';

interface Props {
  container: BookContainer;
  filter: BookFilter;
  onChange: (filter: BookFilter) => void;
}

export default function BookFilterSelector({ container, filter, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      const book = container.books.find((b) => b.index === filter.indices[0]);
      return book?.title ?? 'Book';
    }
    return `${filter.indices.length} Books`;
  }

  function handleToggle(bookIndex: number) {
    if (filter.mode === 'all') {
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
      const nonExcludedCount = container.books.filter((b) => !b.excluded).length;
      if (next.size === nonExcludedCount) {
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
          {[...container.books].filter((b) => !b.excluded).sort((a, b) => a.index - b.index).map((book) => {
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
