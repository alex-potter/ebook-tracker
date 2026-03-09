'use client';

import { useState } from 'react';
import type { Character } from '@/types';

const STATUS_CONFIG = {
  alive: { label: 'Alive', color: 'bg-green-100 text-green-800 border-green-200', dot: 'bg-green-400' },
  dead: { label: 'Dead', color: 'bg-red-100 text-red-800 border-red-200', dot: 'bg-red-400' },
  unknown: { label: 'Unknown', color: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
  uncertain: { label: 'Uncertain', color: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-400' },
};

const IMPORTANCE_CONFIG = {
  main: { label: 'Main', color: 'bg-amber-500 text-white' },
  secondary: { label: 'Secondary', color: 'bg-amber-200 text-amber-800' },
  minor: { label: 'Minor', color: 'bg-stone-100 text-stone-600' },
};

// Generate a deterministic pastel color from a character name
function nameColor(name: string): string {
  const colors = [
    'bg-rose-100 text-rose-700',
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-pink-100 text-pink-700',
    'bg-teal-100 text-teal-700',
    'bg-indigo-100 text-indigo-700',
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

interface Props {
  character: Character;
}

export default function CharacterCard({ character }: Props) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_CONFIG[character.status] ?? STATUS_CONFIG.unknown;
  const importance = IMPORTANCE_CONFIG[character.importance] ?? IMPORTANCE_CONFIG.minor;

  return (
    <div
      className={`
        bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md
        transition-shadow duration-200 overflow-hidden
        ${character.importance === 'main' ? 'ring-1 ring-amber-300' : ''}
      `}
    >
      {/* Card header */}
      <div className="p-4 flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`
            flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center
            text-lg font-bold font-serif ${nameColor(character.name)}
          `}
        >
          {initials(character.name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-stone-800 leading-tight">{character.name}</h3>
              {character.aliases.length > 0 && (
                <p className="text-xs text-stone-400 truncate">
                  also: {character.aliases.join(', ')}
                </p>
              )}
            </div>
            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${importance.color}`}>
              {importance.label}
            </span>
          </div>

          {/* Status + location row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${status.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
            <span className="text-xs text-stone-500 truncate">
              📍 {character.currentLocation}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 pb-3">
        <p className="text-sm text-stone-600 leading-relaxed">{character.description}</p>
      </div>

      {/* Recent events */}
      {character.recentEvents && (
        <div className="mx-4 mb-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
          <p className="text-xs font-semibold text-amber-700 mb-1">Recent events</p>
          <p className="text-xs text-amber-800 leading-relaxed">{character.recentEvents}</p>
        </div>
      )}

      {/* Relationships (expandable) */}
      {character.relationships.length > 0 && (
        <div className="px-4 pb-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-amber-600 font-medium hover:text-amber-800 flex items-center gap-1 transition-colors"
          >
            <span>{expanded ? '▾' : '▸'}</span>
            Relationships ({character.relationships.length})
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {character.relationships.map((rel, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="flex-shrink-0 w-5 h-5 bg-stone-100 rounded-full flex items-center justify-center text-stone-500 font-medium">
                    {initials(rel.character)}
                  </span>
                  <div>
                    <span className="font-semibold text-stone-700">{rel.character}</span>
                    <span className="text-stone-500 ml-1">— {rel.relationship}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Last seen footer */}
      <div className="px-4 py-2 bg-stone-50 border-t border-stone-100">
        <p className="text-xs text-stone-400">
          Last seen: <span className="text-stone-500 font-medium">{character.lastSeen}</span>
        </p>
      </div>
    </div>
  );
}
