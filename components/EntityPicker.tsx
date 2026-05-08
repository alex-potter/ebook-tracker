'use client';

import { useState } from 'react';

interface PickerItem {
  name: string;
  aliases?: string[];
  description?: string;
}

interface Props {
  items: PickerItem[];
  onSelect: (name: string) => void;
  onClose: () => void;
  label: string;
}

export default function EntityPicker({ items, onSelect, onClose, label }: Props) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        return item.name.toLowerCase().includes(q)
          || (item.aliases ?? []).some((a) => a.toLowerCase().includes(q));
      })
    : items;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm max-h-[70vh] flex flex-col bg-paper-raised rounded-xl border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-border">
          <p className="text-xs font-semibold text-ink-dim uppercase tracking-wider mb-2">{label}</p>
          <input
            type="search"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="w-full text-sm px-3 py-1.5 rounded-lg border bg-paper outline-none transition-colors border-border text-ink placeholder-ink-dim focus:border-rust"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-sm text-ink-dim text-center py-6">No matches</p>
          )}
          {filtered.map((item) => (
            <button
              key={item.name}
              onClick={() => onSelect(item.name)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper transition-colors"
            >
              <p className="text-sm font-medium text-ink">{item.name}</p>
              {(item.aliases?.length ?? 0) > 0 && (
                <p className="text-[11px] text-ink-dim">{item.aliases!.join(', ')}</p>
              )}
              {item.description && (
                <p className="text-[11px] text-ink-dim line-clamp-1">{item.description}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
