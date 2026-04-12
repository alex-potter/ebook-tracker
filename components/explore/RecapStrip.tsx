'use client';

import { useState } from 'react';

interface RecapStripProps {
  summary: string;
  onOpenTimeline?: () => void;
}

export default function RecapStrip({ summary, onOpenTimeline }: RecapStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (!summary) return null;

  return (
    <div
      className="bg-paper border-b border-border px-4 py-2 cursor-pointer transition-colors hover:bg-paper-raised"
      onClick={() => onOpenTimeline ? onOpenTimeline() : setExpanded(!expanded)}
    >
      <p className={`text-sm text-ink-soft leading-relaxed ${expanded ? '' : 'line-clamp-1'}`}>
        <span className="font-serif italic text-ink-dim">Previously... </span>
        {summary}
      </p>
    </div>
  );
}
