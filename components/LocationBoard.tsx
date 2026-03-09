'use client';

import { useRef, useState } from 'react';
import type { Character } from '@/types';

interface LocationGroup {
  location: string;
  characters: Character[];
}

const STATUS_DOT: Record<Character['status'], string> = {
  alive: 'bg-green-400',
  dead: 'bg-red-400',
  unknown: 'bg-gray-400',
  uncertain: 'bg-orange-400',
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function nameColor(name: string): string {
  const colors = [
    'bg-rose-200 text-rose-700',
    'bg-sky-200 text-sky-700',
    'bg-violet-200 text-violet-700',
    'bg-emerald-200 text-emerald-700',
    'bg-amber-200 text-amber-700',
    'bg-pink-200 text-pink-700',
    'bg-teal-200 text-teal-700',
    'bg-indigo-200 text-indigo-700',
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

interface Props {
  characters: Character[];
  bookTitle?: string;
}

export default function LocationBoard({ characters, bookTitle }: Props) {
  const [mapImage, setMapImage] = useState<string | null>(null);
  const [mapLabel, setMapLabel] = useState('');
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Group characters by currentLocation
  const groups: LocationGroup[] = [];
  const seen = new Map<string, Character[]>();
  for (const c of characters) {
    const loc = c.currentLocation?.trim() || 'Unknown';
    if (!seen.has(loc)) seen.set(loc, []);
    seen.get(loc)!.push(c);
  }
  for (const [loc, chars] of seen.entries()) {
    groups.push({ location: loc, characters: chars });
  }
  groups.sort((a, b) => {
    if (a.location === 'Unknown') return 1;
    if (b.location === 'Unknown') return -1;
    return b.characters.length - a.characters.length;
  });

  function loadFile(file: File) {
    setMapLabel(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = (ev) => setMapImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith('image/')) {
      loadFile(file);
    } else {
      // Maybe they dropped an image URL from a browser
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url?.match(/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)/i)) {
        setMapImage(url);
        setMapLabel('Map');
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    // Image copied from browser (right-click → Copy Image)
    const imageFile = Array.from(e.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile();
    if (imageFile) { loadFile(imageFile); return; }

    // URL pasted as text
    const text = e.clipboardData.getData('text');
    if (text?.startsWith('http')) { setMapImage(text); setMapLabel('Map'); }
  }

  function handleUrlSubmit() {
    if (urlInput.trim()) {
      setMapImage(urlInput.trim());
      setMapLabel('Map');
      setUrlInput('');
      setShowUrlInput(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Map image section */}
      <div className="bg-white rounded-2xl border border-amber-100 overflow-hidden shadow-sm">
        {mapImage ? (
          <div>
            <div className="relative">
              <img
                src={mapImage}
                alt={mapLabel || 'Book map'}
                className="w-full max-h-96 object-contain bg-stone-50"
              />
              <button
                onClick={() => { setMapImage(null); setMapLabel(''); }}
                className="absolute top-2 right-2 bg-white/80 hover:bg-white text-stone-500 hover:text-red-500 rounded-full w-7 h-7 flex items-center justify-center text-sm shadow transition-colors"
                title="Remove map"
              >
                ✕
              </button>
            </div>
            {mapLabel && (
              <p className="text-xs text-center text-stone-400 py-2 border-t border-stone-100">
                {mapLabel}
              </p>
            )}
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onPaste={handlePaste}
            tabIndex={0}
            className={`flex flex-col items-center justify-center gap-3 py-8 outline-none transition-colors ${
              dragging ? 'bg-amber-50 border-amber-300' : ''
            }`}
          >
            <span className="text-3xl">🗺️</span>
            <p className="text-sm font-medium text-amber-700">Add your book&apos;s map</p>

            <div className="flex gap-2 flex-wrap justify-center">
              <label
                htmlFor="map-upload"
                className="px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-xl cursor-pointer hover:bg-amber-600 transition-colors"
              >
                Upload file
              </label>
              {bookTitle && (
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(bookTitle + ' map')}&tbm=isch`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white border border-amber-200 text-amber-700 text-xs font-semibold rounded-xl hover:bg-amber-50 transition-colors"
                >
                  Search Google Images
                </a>
              )}
              <button
                onClick={() => setShowUrlInput((v) => !v)}
                className="px-4 py-2 bg-white border border-amber-200 text-amber-700 text-xs font-semibold rounded-xl hover:bg-amber-50 transition-colors"
              >
                Paste URL
              </button>
            </div>

            {showUrlInput && (
              <div className="flex gap-2 w-full max-w-sm px-4">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                  placeholder="https://..."
                  autoFocus
                  className="flex-1 bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <button
                  onClick={handleUrlSubmit}
                  className="px-3 py-2 bg-amber-500 text-white text-xs font-semibold rounded-xl hover:bg-amber-600"
                >
                  Load
                </button>
              </div>
            )}

            <p className="text-xs text-amber-400">
              or drag &amp; drop · or <kbd className="bg-stone-100 px-1 rounded text-stone-500">Ctrl+V</kbd> to paste a copied image
            </p>

            <input
              id="map-upload"
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleFileInput}
            />
          </div>
        )}
      </div>

      {/* Location groups */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-3">
          Character Locations · {groups.filter(g => g.location !== 'Unknown').length} known locations
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groups.map(({ location, characters: chars }) => (
            <div
              key={location}
              className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                location === 'Unknown' ? 'border-stone-200 opacity-75' : 'border-amber-100'
              }`}
            >
              {/* Location header */}
              <div className={`px-4 py-3 border-b ${
                location === 'Unknown' ? 'bg-stone-50 border-stone-100' : 'bg-amber-50 border-amber-100'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{location === 'Unknown' ? '❓' : '📍'}</span>
                  <h3 className="font-bold text-stone-800 text-sm leading-tight">{location}</h3>
                  <span className="ml-auto text-xs text-stone-400">{chars.length}</span>
                </div>
              </div>

              {/* Characters at this location */}
              <ul className="divide-y divide-stone-50">
                {chars.map((c) => (
                  <li key={c.name} className="px-4 py-2.5 flex items-center gap-3">
                    {/* Avatar */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${nameColor(c.name)}`}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-800 truncate">{c.name}</p>
                      <p className="text-xs text-stone-400 truncate">{c.description.split('.')[0]}</p>
                    </div>
                    {/* Status dot */}
                    <span
                      className={`flex-shrink-0 w-2 h-2 rounded-full ${STATUS_DOT[c.status]}`}
                      title={c.status}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
