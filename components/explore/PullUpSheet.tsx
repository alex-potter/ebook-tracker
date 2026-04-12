'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate, PanInfo } from 'framer-motion';
import type { EbookChapter, Snapshot } from '@/types';

type SnapPoint = 'peek' | 'half' | 'full';

interface PullUpSheetProps {
  chapters: EbookChapter[];
  currentIndex: number;
  snapshots: Snapshot[];
  onChapterSelect: (index: number) => void;
  visibleChapterOrders?: Set<number> | null;
}

const PEEK_HEIGHT = 56;

export default function PullUpSheet({ chapters, currentIndex, snapshots, onChapterSelect, visibleChapterOrders }: PullUpSheetProps) {
  const [snap, setSnap] = useState<SnapPoint>('peek');
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);

  const snapshotSet = new Set(snapshots.map((s) => s.index));

  const getSnapHeight = useCallback((point: SnapPoint) => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    switch (point) {
      case 'peek': return PEEK_HEIGHT;
      case 'half': return vh * 0.45;
      case 'full': return vh * 0.85;
    }
  }, []);

  useEffect(() => {
    const target = getSnapHeight(snap);
    animate(y, -(target - PEEK_HEIGHT), {
      type: 'spring',
      stiffness: 400,
      damping: 35,
    });
  }, [snap, y, getSnapHeight]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const velocity = info.velocity.y;
    const currentY = y.get();
    const halfH = getSnapHeight('half');
    const fullH = getSnapHeight('full');

    if (velocity > 300) {
      setSnap(snap === 'full' ? 'half' : 'peek');
    } else if (velocity < -300) {
      setSnap(snap === 'peek' ? 'half' : 'full');
    } else {
      const absY = Math.abs(currentY) + PEEK_HEIGHT;
      if (absY > (halfH + fullH) / 2) setSnap('full');
      else if (absY > (PEEK_HEIGHT + halfH) / 2) setSnap('half');
      else setSnap('peek');
    }
  };

  const handleChapterTap = (index: number) => {
    onChapterSelect(index);
    setSnap('peek');
  };

  const backdrop = useTransform(y, [0, -(getSnapHeight('full') - PEEK_HEIGHT)], [0, 0.3]);

  const filtered = chapters.filter((ch) => {
    if (visibleChapterOrders && !visibleChapterOrders.has(ch.order)) return false;
    if (!search) return true;
    return ch.title.toLowerCase().includes(search.toLowerCase()) ||
           `chapter ${ch.order + 1}`.includes(search.toLowerCase());
  });

  const currentChapter = chapters[currentIndex];

  return (
    <>
      {snap !== 'peek' && (
        <motion.div
          className="fixed inset-0 z-30 bg-black"
          style={{ opacity: backdrop }}
          onClick={() => setSnap('peek')}
        />
      )}
      <motion.div
        ref={containerRef}
        className="fixed bottom-0 left-0 right-0 z-40 bg-paper-raised rounded-t-2xl border-t border-border shadow-lg"
        style={{
          y,
          height: getSnapHeight('full'),
          bottom: 'env(safe-area-inset-bottom)',
          marginBottom: 56,
        }}
        drag="y"
        dragConstraints={{ top: -(getSnapHeight('full') - PEEK_HEIGHT), bottom: 0 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
      >
        <div className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div
          className="px-4 pb-2 flex items-center justify-between"
          onClick={() => setSnap(snap === 'peek' ? 'half' : 'peek')}
        >
          <div className="min-w-0">
            <p className="text-xs font-mono text-ink-dim">Ch {currentIndex + 1}</p>
            <p className="text-sm font-serif font-medium text-ink truncate">
              {currentChapter?.title ?? `Chapter ${currentIndex + 1}`}
            </p>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`text-ink-dim flex-shrink-0 transition-transform ${snap !== 'peek' ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4"/>
          </svg>
        </div>

        {snap !== 'peek' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {snap === 'full' && (
              <div className="px-4 pb-2">
                <input
                  type="search"
                  placeholder="Search chapters..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-paper border border-border rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim font-serif focus:outline-none focus:border-rust"
                />
              </div>
            )}
            <div ref={listRef} className="flex-1 overflow-y-auto px-2 pb-4">
              {filtered.map((ch) => {
                const idx = chapters.indexOf(ch);
                const isCurrent = idx === currentIndex;
                const hasSnapshot = snapshotSet.has(idx);
                return (
                  <button
                    key={ch.id}
                    onClick={() => handleChapterTap(idx)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                      isCurrent ? 'bg-rust/10' : 'hover:bg-paper-dark'
                    }`}
                  >
                    <span className={`font-mono text-xs w-8 text-right flex-shrink-0 ${isCurrent ? 'text-rust font-bold' : 'text-ink-dim'}`}>
                      {idx + 1}
                    </span>
                    <span className={`text-sm font-serif truncate flex-1 ${isCurrent ? 'text-rust font-medium' : 'text-ink'}`}>
                      {ch.title}
                    </span>
                    {hasSnapshot && (
                      <span className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" title="Snapshot" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
