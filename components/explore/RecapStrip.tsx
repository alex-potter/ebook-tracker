'use client';

interface RecapStripProps {
  summary: string;
  onOpenTimeline?: () => void;
}

export default function RecapStrip({ summary, onOpenTimeline }: RecapStripProps) {
  if (!summary) return null;

  return (
    <div
      className="bg-paper border-b border-border px-4 py-2 cursor-pointer transition-colors hover:bg-paper-raised lg:pl-20"
      onClick={onOpenTimeline}
    >
      <p className="text-sm text-ink-soft leading-relaxed">
        <span className="font-serif italic text-ink-dim">Previously... </span>
        {summary}
      </p>
    </div>
  );
}
