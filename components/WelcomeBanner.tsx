'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'bookbuddy::welcome-dismissed';

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const steps = [
    { label: 'Upload an EPUB', detail: 'Drag and drop or tap to browse' },
    { label: 'Pick your chapter', detail: 'Select how far you\u2019ve read' },
    { label: 'Hit Analyze', detail: 'AI reads only what you\u2019ve read' },
    { label: 'Explore your dashboard', detail: 'Characters, locations, arcs, and more' },
  ];

  return (
    <div className="relative max-w-sm mx-auto mb-6 p-5 rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-stone-400 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        &#10005;
      </button>

      <h3 className="text-sm font-semibold text-stone-800 dark:text-zinc-200 mb-3">
        Getting started
      </h3>

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-stone-700 dark:text-zinc-300">{step.label}</p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
