'use client';

import { useCallback, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  parsing: boolean;
}

export default function UploadZone({ onFile, parsing }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith('.epub')) onFile(file);
    },
    [onFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-serif font-bold text-amber-900 mb-2">Chapter Companion</h1>
        <p className="text-amber-700 text-lg">Track characters as you read — spoiler-free</p>
      </div>

      <label
        htmlFor="epub-upload"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`
          relative flex flex-col items-center justify-center w-80 h-52 rounded-2xl border-2 border-dashed
          cursor-pointer transition-all duration-200
          ${dragging
            ? 'border-amber-500 bg-amber-50 scale-105'
            : 'border-amber-300 bg-white hover:border-amber-400 hover:bg-amber-50'
          }
          ${parsing ? 'pointer-events-none opacity-70' : ''}
        `}
      >
        {parsing ? (
          <>
            <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-amber-700 font-medium">Parsing EPUB…</p>
          </>
        ) : (
          <>
            <span className="text-5xl mb-3">📖</span>
            <p className="text-amber-800 font-semibold text-center px-4">
              Drop your EPUB here
            </p>
            <p className="text-amber-500 text-sm mt-1">or click to browse</p>
          </>
        )}
        <input
          id="epub-upload"
          type="file"
          accept=".epub"
          className="sr-only"
          onChange={handleChange}
          disabled={parsing}
        />
      </label>

      <div className="text-center text-sm text-amber-600 max-w-xs">
        <p>Your book is processed entirely in your browser.</p>
        <p className="mt-1">Only the text <em>you&apos;ve already read</em> is sent to Claude — no spoilers, ever.</p>
      </div>
    </div>
  );
}
