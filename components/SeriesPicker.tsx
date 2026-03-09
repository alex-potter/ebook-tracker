'use client';

interface SavedBook {
  title: string;
  author: string;
  lastAnalyzedIndex: number;
  chapterCount?: number;
}

interface Props {
  newBookTitle: string;
  newBookAuthor: string;
  savedBooks: SavedBook[];
  onContinueFrom: (title: string, author: string) => void;
  onStartFresh: () => void;
}

export default function SeriesPicker({
  newBookTitle,
  newBookAuthor,
  savedBooks,
  onContinueFrom,
  onStartFresh,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="text-center mb-5">
          <span className="text-4xl">📚</span>
          <h2 className="mt-3 font-serif font-bold text-amber-900 text-xl leading-snug">
            {newBookTitle}
          </h2>
          <p className="text-xs text-amber-600 mt-0.5">{newBookAuthor}</p>
          <p className="mt-3 text-sm text-stone-600">
            Is this a continuation of a series? Carry your characters forward from a previous book.
          </p>
        </div>

        <div className="space-y-2 mb-4">
          {savedBooks.map((book) => (
            <button
              key={`${book.title}::${book.author}`}
              onClick={() => onContinueFrom(book.title, book.author)}
              className="w-full text-left px-4 py-3 rounded-xl border border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-colors group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-800 text-sm truncate group-hover:text-amber-900">
                    {book.title}
                  </p>
                  <p className="text-xs text-stone-400 truncate">{book.author}</p>
                </div>
                <span className="flex-shrink-0 text-xs text-amber-500 font-medium">
                  Continue →
                </span>
              </div>
              <p className="text-xs text-amber-400 mt-1">
                {book.lastAnalyzedIndex + 1} chapter{book.lastAnalyzedIndex !== 0 ? 's' : ''} analyzed
              </p>
            </button>
          ))}
        </div>

        <button
          onClick={onStartFresh}
          className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stone-200 text-stone-500 hover:bg-stone-50 transition-colors"
        >
          Start fresh — this is a standalone book
        </button>
      </div>
    </div>
  );
}
