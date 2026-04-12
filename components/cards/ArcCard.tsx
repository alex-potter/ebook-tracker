'use client';

import { useState } from 'react';
import type { AnalysisResult, NarrativeArc, Snapshot } from '@/types';
import type { SnapshotTransform } from '@/lib/propagate-edit';
import NarrativeArcModal from '@/components/NarrativeArcModal';
import StatusBadge from '@/components/ui/StatusBadge';

interface Props {
  arc: NarrativeArc;
  snapshots?: Snapshot[];
  chapterTitles?: string[];
  currentResult?: AnalysisResult;
  onResultEdit?: (result: AnalysisResult, propagate?: SnapshotTransform) => void;
  currentChapterIndex?: number;
}

export default function ArcCard({ arc, snapshots, chapterTitles, currentResult, onResultEdit, currentChapterIndex }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      {modalOpen && (
        <NarrativeArcModal
          arcName={arc.name}
          snapshots={snapshots ?? []}
          chapterTitles={chapterTitles}
          currentResult={currentResult}
          onResultEdit={onResultEdit}
          currentChapterIndex={currentChapterIndex}
          onClose={() => setModalOpen(false)}
        />
      )}
      <div
        onClick={() => setModalOpen(true)}
        className="bg-paper-raised rounded-xl border border-border overflow-hidden transition-all duration-200 cursor-pointer hover:border-teal/30"
      >
        <div className="p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-serif text-[17px] font-medium text-ink leading-tight truncate">{arc.name}</h3>
              <StatusBadge status={arc.status} />
            </div>
            <p className="text-xs font-serif text-ink-soft line-clamp-1">{arc.summary}</p>
          </div>
        </div>

        <div className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-3 pb-2">
            <p className="text-sm font-serif text-ink-soft leading-relaxed">{arc.summary}</p>
          </div>
          {arc.characters.length > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[10px] font-mono font-bold text-ink-dim uppercase mb-1">Characters</p>
              <div className="flex flex-wrap gap-1">
                {arc.characters.map((name) => (
                  <span key={name} className="text-xs font-serif text-ink-soft bg-paper px-2 py-0.5 rounded">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className="px-3 py-2 border-t border-border flex items-center justify-between"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          <span className="text-xs font-mono text-ink-dim">{arc.characters.length} character{arc.characters.length !== 1 ? 's' : ''}</span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`text-ink-dim transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <path d="M3 4.5l3 3 3-3"/>
          </svg>
        </div>
      </div>
    </>
  );
}
