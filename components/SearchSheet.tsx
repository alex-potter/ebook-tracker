'use client';

import { useEffect, useRef, useState } from 'react';
import type { Character, NarrativeArc } from '@/types';
import type { AggregatedCharacter, AggregatedLocation, AggregatedArc } from '@/lib/aggregate-entities';

type SheetView = 'results' | 'preview';
type EntityType = 'character' | 'location' | 'arc';

interface SearchResult {
  type: EntityType;
  name: string;
  aliases: string[];
  description: string;
  status?: Character['status'];
  importance?: Character['importance'];
  currentLocation?: string;
  parentLocation?: string;
  arc?: string;
  arcStatus?: NarrativeArc['status'];
  characterCount?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onEntitySelect: (type: EntityType, name: string) => void;
  characters: AggregatedCharacter[];
  locations: AggregatedLocation[];
  arcs: AggregatedArc[];
}

const TYPE_BADGE: Record<EntityType, { label: string; className: string }> = {
  character: { label: 'Character', className: 'bg-rose-500/15 text-rose-400' },
  location:  { label: 'Location',  className: 'bg-sky-500/15 text-sky-400' },
  arc:       { label: 'Arc',       className: 'bg-violet-500/15 text-violet-400' },
};

const STATUS_BADGE_STYLES: Record<string, string> = {
  alive:     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  dead:      'bg-red-500/10 text-red-400 border-red-500/20',
  unknown:   'bg-stone-200/50 dark:bg-zinc-700/50 text-stone-500 dark:text-zinc-400 border-stone-400/30 dark:border-zinc-600/30',
  uncertain: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

const ARC_STATUS_STYLES: Record<string, string> = {
  active:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  resolved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  dormant:  'bg-stone-400/15 text-stone-400 border-stone-400/25 dark:bg-zinc-600/15 dark:text-zinc-400',
};

function buildSearchItems(
  characters: AggregatedCharacter[],
  locations: AggregatedLocation[],
  arcs: AggregatedArc[],
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const c of characters) {
    results.push({
      type: 'character',
      name: c.character.name,
      aliases: c.character.aliases ?? [],
      description: c.character.description,
      status: c.character.status,
      importance: c.character.importance,
      currentLocation: c.character.currentLocation,
    });
  }
  for (const l of locations) {
    results.push({
      type: 'location',
      name: l.location.name,
      aliases: l.location.aliases ?? [],
      description: l.location.description,
      parentLocation: l.location.parentLocation,
      arc: l.location.arc,
    });
  }
  for (const a of arcs) {
    results.push({
      type: 'arc',
      name: a.arc.name,
      aliases: [],
      description: a.arc.summary,
      arcStatus: a.arc.status,
      characterCount: a.arc.characters.length,
    });
  }
  return results;
}

function matchesQuery(item: SearchResult, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (item.name.toLowerCase().includes(q)) return true;
  return item.aliases.some((a) => a.toLowerCase().includes(q));
}

export default function SearchSheet({ isOpen, onClose, onEntitySelect, characters, locations, arcs }: Props) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<SheetView>('results');
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset state when sheet opens + body scroll lock
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setView('results');
      setSelected(null);
      setTimeout(() => inputRef.current?.focus(), 100);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Swipe-to-dismiss tracking
  const touchStartY = useRef(0);
  const touchCurrentY = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    touchCurrentY.current = e.touches[0].clientY;
    const delta = touchCurrentY.current - touchStartY.current;
    if (delta > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const delta = touchCurrentY.current - touchStartY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    if (delta > 100) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const allItems = buildSearchItems(characters, locations, arcs);
  const filtered = allItems.filter((item) => matchesQuery(item, query));

  // Sort: characters first, then locations, then arcs; alpha within each group
  const typeOrder: Record<EntityType, number> = { character: 0, location: 1, arc: 2 };
  filtered.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.name.localeCompare(b.name));

  const handleResultTap = (item: SearchResult) => {
    setSelected(item);
    setView('preview');
  };

  const handleBack = () => {
    setView('results');
    setSelected(null);
  };

  const handleViewDetails = () => {
    if (!selected) return;
    onEntitySelect(selected.type, selected.name);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white dark:bg-zinc-900 rounded-t-2xl shadow-2xl transition-transform duration-300"
        style={{ maxHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-stone-300 dark:bg-zinc-700" />
        </div>

        {view === 'results' ? (
          <>
            {/* Search input */}
            <div className="px-4 pb-3">
              <input
                ref={inputRef}
                type="search"
                placeholder="Search characters, locations, arcs\u2026"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent outline-none transition-colors border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 placeholder-stone-400 dark:placeholder-zinc-600 focus:border-stone-400 dark:focus:border-zinc-500"
              />
            </div>

            {/* Results list */}
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {allItems.length === 0 && (
                <p className="text-sm text-stone-400 dark:text-zinc-600 text-center py-8">No entities to search yet</p>
              )}
              {allItems.length > 0 && !query && (
                <p className="text-sm text-stone-400 dark:text-zinc-600 text-center py-8">Type to search\u2026</p>
              )}
              {allItems.length > 0 && query && filtered.length === 0 && (
                <p className="text-sm text-stone-400 dark:text-zinc-600 text-center py-8">No matches found</p>
              )}
              {query && filtered.map((item) => (
                <button
                  key={`${item.type}-${item.name}`}
                  onClick={() => handleResultTap(item)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 active:bg-stone-200 dark:active:bg-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-800 dark:text-zinc-200">{item.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[item.type].className}`}>
                      {TYPE_BADGE[item.type].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-400 dark:text-zinc-600 line-clamp-1 mt-0.5">{item.description}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          /* Preview card */
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Back button */}
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-stone-500 dark:text-zinc-400 mb-3 active:text-stone-700 dark:active:text-zinc-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
              Back to results
            </button>

            {selected && (
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 p-4">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base font-semibold text-stone-800 dark:text-zinc-200">{selected.name}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[selected.type].className}`}>
                    {TYPE_BADGE[selected.type].label}
                  </span>
                </div>

                {/* Character preview */}
                {selected.type === 'character' && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {selected.status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE_STYLES[selected.status]}`}>
                          {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                        </span>
                      )}
                      {selected.importance && (
                        <span className="text-xs text-stone-400 dark:text-zinc-500 capitalize">{selected.importance}</span>
                      )}
                    </div>
                    {selected.currentLocation && (
                      <p className="text-stone-500 dark:text-zinc-400">
                        <span className="text-stone-400 dark:text-zinc-600 text-xs uppercase tracking-wider">Location </span>
                        {selected.currentLocation}
                      </p>
                    )}
                    <p className="text-stone-600 dark:text-zinc-400 line-clamp-3">{selected.description}</p>
                  </div>
                )}

                {/* Location preview */}
                {selected.type === 'location' && (
                  <div className="space-y-2 text-sm">
                    {selected.parentLocation && (
                      <p className="text-stone-500 dark:text-zinc-400">
                        <span className="text-stone-400 dark:text-zinc-600 text-xs uppercase tracking-wider">Part of </span>
                        {selected.parentLocation}
                      </p>
                    )}
                    {selected.arc && (
                      <p className="text-stone-500 dark:text-zinc-400">
                        <span className="text-stone-400 dark:text-zinc-600 text-xs uppercase tracking-wider">Arc </span>
                        {selected.arc}
                      </p>
                    )}
                    <p className="text-stone-600 dark:text-zinc-400 line-clamp-3">{selected.description}</p>
                  </div>
                )}

                {/* Arc preview */}
                {selected.type === 'arc' && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {selected.arcStatus && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${ARC_STATUS_STYLES[selected.arcStatus]}`}>
                          {selected.arcStatus.charAt(0).toUpperCase() + selected.arcStatus.slice(1)}
                        </span>
                      )}
                      {selected.characterCount !== undefined && (
                        <span className="text-xs text-stone-400 dark:text-zinc-500">
                          {selected.characterCount} character{selected.characterCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-stone-600 dark:text-zinc-400 line-clamp-3">{selected.description}</p>
                  </div>
                )}

                {/* View Details button */}
                <button
                  onClick={handleViewDetails}
                  className="mt-4 w-full py-2 rounded-lg bg-stone-800 dark:bg-zinc-700 text-white text-sm font-medium active:scale-[0.98] transition-transform"
                >
                  View Details
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
