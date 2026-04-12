# Mobile-First UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign BookBuddy's UI from desktop-first sidebar layout to mobile-first Explore/Workshop architecture with Tactile Paperback aesthetic.

**Architecture:** Replace the current sidebar + top-tab layout with a bottom-nav Explore mode (Characters/Locations/Arcs/Map) and a separate full-screen Workshop overlay (Chapters/Structure/Entities/Library/Settings). The 2485-line page.tsx monolith gets decomposed into focused components. The Tactile Paperback aesthetic (Newsreader serif, warm ecru palette) replaces the default Tailwind styling.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind CSS 3, next/font/google, framer-motion (new dependency for pull-up sheet gestures)

**Note:** This project has no automated tests. Each task ends with a visual verification step and a commit.

---

### Task 1: Design Tokens — CSS Custom Properties & Fonts

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `tailwind.config.js`

- [ ] **Step 1: Add CSS custom properties to globals.css**

Add the Tactile Paperback palette tokens after the existing `@tailwind` directives and before the `html` block:

```css
:root {
  --paper: #f3ebdd;
  --paper-raised: #faf5e8;
  --paper-dark: #e8dbc3;
  --ink: #2c2319;
  --ink-soft: #6b5740;
  --ink-dim: #8a7556;
  --rust: #b5542b;
  --rust-soft: #c97a4f;
  --teal: #4f7579;
  --teal-soft: #6a9a9e;
  --amber: #c19024;
  --amber-soft: #d4a83a;
  --danger: #a33a2a;
  --danger-soft: #c95a4a;
  --border: #d9c9ab;
}

html.dark {
  --paper: #1a1612;
  --paper-raised: #231e18;
  --paper-dark: #12100d;
  --ink: #e8dbc3;
  --ink-soft: #a89478;
  --ink-dim: #7a6b55;
  --rust: #c97a4f;
  --rust-soft: #b5542b;
  --teal: #6a9a9e;
  --teal-soft: #4f7579;
  --amber: #d4a83a;
  --amber-soft: #c19024;
  --danger: #c95a4a;
  --danger-soft: #a33a2a;
  --border: #3a3028;
}
```

Also update the existing `html` and `body` background colors to use the new tokens:

```css
html {
  background-color: var(--paper);
  /* ... rest unchanged */
}

body {
  background-color: var(--paper);
  color: var(--ink);
  /* ... rest unchanged */
}
```

Remove the existing `html.dark` background and `html.dark body` blocks (they're replaced by the CSS variable swapping above).

- [ ] **Step 2: Update tailwind.config.js with palette and font families**

```js
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'var(--paper)',
          raised: 'var(--paper-raised)',
          dark: 'var(--paper-dark)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          dim: 'var(--ink-dim)',
        },
        rust: {
          DEFAULT: 'var(--rust)',
          soft: 'var(--rust-soft)',
        },
        teal: {
          DEFAULT: 'var(--teal)',
          soft: 'var(--teal-soft)',
        },
        amber: {
          DEFAULT: 'var(--amber)',
          soft: 'var(--amber-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
        border: 'var(--border)',
      },
      fontFamily: {
        serif: ['var(--font-newsreader)', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Add Google Fonts to layout.tsx via next/font/google**

```tsx
import type { Metadata, Viewport } from 'next';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// ... metadata and viewport unchanged ...

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return (
    <html lang="en" suppressHydrationWarning className={`${newsreader.variable} ${jetbrainsMono.variable}`}>
      {/* ... head and body unchanged ... */}
    </html>
  );
}
```

The key change is adding the `className` with both font CSS variables to `<html>`, and importing the fonts. Keep all existing `<head>` scripts and `<body>` content unchanged.

- [ ] **Step 4: Verify fonts load and palette applies**

Run `npm run dev`, open http://localhost:3000 in browser. Verify:
- Page background should be warm ecru (#f3ebdd) in light mode, dark warm (#1a1612) in dark mode
- Text should be dark warm brown (#2c2319) in light mode
- No visual regressions in existing components (they still use Tailwind default colors until restyled)

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx tailwind.config.js
git commit -m "feat: add Tactile Paperback design tokens and Google Fonts"
```

---

### Task 2: Install framer-motion

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install framer-motion**

```bash
npm install framer-motion
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add framer-motion for gesture-driven pull-up sheet"
```

---

### Task 3: Shared UI Primitives — StatusBadge & BookCoverGradient

**Files:**
- Create: `components/ui/StatusBadge.tsx`
- Create: `components/ui/BookCoverGradient.tsx`

- [ ] **Step 1: Create components/ui directory**

```bash
mkdir -p components/ui
```

- [ ] **Step 2: Create StatusBadge.tsx**

A reusable badge for character status and arc status. Used across Explore cards and Workshop.

```tsx
'use client';

interface StatusBadgeProps {
  status: 'alive' | 'dead' | 'unknown' | 'uncertain' | 'active' | 'resolved' | 'dormant';
  size?: 'sm' | 'md';
}

const CONFIG: Record<string, { label: string; dot: string; bg: string }> = {
  alive:     { label: 'Alive',     dot: 'bg-emerald-500', bg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  dead:      { label: 'Dead',      dot: 'bg-danger',      bg: 'bg-danger/10 text-danger' },
  unknown:   { label: 'Unknown',   dot: 'bg-ink-dim',     bg: 'bg-ink-dim/10 text-ink-soft' },
  uncertain: { label: 'Uncertain', dot: 'bg-amber',       bg: 'bg-amber/10 text-amber' },
  active:    { label: 'Active',    dot: 'bg-teal',        bg: 'bg-teal/10 text-teal' },
  resolved:  { label: 'Resolved',  dot: 'bg-ink-soft',    bg: 'bg-ink-soft/10 text-ink-soft' },
  dormant:   { label: 'Dormant',   dot: 'bg-amber',       bg: 'bg-amber/10 text-amber' },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.unknown;
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5 gap-1'
    : 'text-xs px-2 py-0.5 gap-1.5';

  return (
    <span className={`inline-flex items-center font-mono font-bold uppercase rounded ${sizeClasses} ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
```

- [ ] **Step 3: Create BookCoverGradient.tsx**

Generates deterministic gradient "covers" for books in the Library tab based on title hash.

```tsx
'use client';

const PALETTES = [
  ['#b5542b', '#c97a4f', '#e8dbc3'],  // rust
  ['#4f7579', '#6a9a9e', '#e8dbc3'],  // teal
  ['#c19024', '#d4a83a', '#f3ebdd'],  // amber
  ['#2c2319', '#6b5740', '#d9c9ab'],  // espresso
  ['#a33a2a', '#c95a4a', '#f3ebdd'],  // danger
  ['#4f7579', '#c19024', '#f3ebdd'],  // teal-amber
  ['#b5542b', '#4f7579', '#e8dbc3'],  // rust-teal
  ['#6b5740', '#c19024', '#faf5e8'],  // warm
];

function hashString(str: string): number {
  let hash = 0;
  for (const c of str) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash);
}

interface BookCoverGradientProps {
  title: string;
  className?: string;
}

export default function BookCoverGradient({ title, className = '' }: BookCoverGradientProps) {
  const hash = hashString(title);
  const palette = PALETTES[hash % PALETTES.length];
  const angle = (hash % 360);

  return (
    <div
      className={`rounded-md flex items-end p-2 ${className}`}
      style={{
        background: `linear-gradient(${angle}deg, ${palette[0]}, ${palette[1]}, ${palette[2]})`,
        aspectRatio: '2/3',
      }}
    >
      <span
        className="text-[10px] font-serif font-semibold leading-tight line-clamp-2"
        style={{ color: palette[2] }}
      >
        {title}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/ui/StatusBadge.tsx components/ui/BookCoverGradient.tsx
git commit -m "feat: add StatusBadge and BookCoverGradient UI primitives"
```

---

### Task 4: ExploreHeader Component

**Files:**
- Create: `components/explore/ExploreHeader.tsx`

- [ ] **Step 1: Create components/explore directory**

```bash
mkdir -p components/explore
```

- [ ] **Step 2: Create ExploreHeader.tsx**

Compact single-line header with book title, chapter pill, and overflow menu.

```tsx
'use client';

import { useRef, useState, useEffect } from 'react';

interface ExploreHeaderProps {
  bookTitle: string;
  currentChapterIndex: number;
  totalChapters: number;
  onChapterPillTap: () => void;
  onOpenWorkshop: () => void;
  onOpenChat: () => void;
  onOpenSettings: () => void;
  onChangeBook: () => void;
  onToggleTheme: () => void;
  isDark: boolean;
  hasStoredState: boolean;
}

export default function ExploreHeader({
  bookTitle,
  currentChapterIndex,
  totalChapters,
  onChapterPillTap,
  onOpenWorkshop,
  onOpenChat,
  onOpenSettings,
  onChangeBook,
  onToggleTheme,
  isDark,
  hasStoredState,
}: ExploreHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="bg-paper-raised border-b border-border px-4 py-2 flex items-center justify-between gap-2 flex-shrink-0">
      {/* Left: book title */}
      <h1 className="font-serif italic text-ink text-sm truncate min-w-0 flex-1">
        {bookTitle}
      </h1>

      {/* Center: chapter pill */}
      <button
        onClick={onChapterPillTap}
        className="flex-shrink-0 px-3 py-1 rounded-full bg-paper-dark text-ink-soft font-mono text-xs font-medium transition-colors hover:bg-border"
      >
        Ch {currentChapterIndex + 1}
        <span className="text-ink-dim">/{totalChapters}</span>
      </button>

      {/* Right: overflow menu */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-8 h-8 flex items-center justify-center text-ink-soft hover:text-ink transition-colors rounded-lg"
          aria-label="More actions"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="2.5" r="1.5"/>
            <circle cx="8" cy="8" r="1.5"/>
            <circle cx="8" cy="13.5" r="1.5"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-paper-raised border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            {hasStoredState && (
              <button
                onClick={() => { onOpenWorkshop(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-dark transition-colors font-serif"
              >
                Workshop
              </button>
            )}
            {hasStoredState && (
              <button
                onClick={() => { onOpenChat(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-dark transition-colors"
              >
                Chat
              </button>
            )}
            <button
              onClick={() => { onOpenSettings(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-dark transition-colors"
            >
              Settings
            </button>
            <button
              onClick={() => { onToggleTheme(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-dark transition-colors"
            >
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              onClick={() => { onChangeBook(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-dark transition-colors"
            >
              Change book
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/explore/ExploreHeader.tsx
git commit -m "feat: add ExploreHeader with chapter pill and overflow menu"
```

---

### Task 5: BottomNav Component

**Files:**
- Create: `components/explore/BottomNav.tsx`

- [ ] **Step 1: Create BottomNav.tsx**

4-tab bar pinned to bottom with safe-area inset. Icons are inline SVGs.

```tsx
'use client';

type ExploreTab = 'characters' | 'locations' | 'arcs' | 'map';

interface BottomNavProps {
  activeTab: ExploreTab;
  onChange: (tab: ExploreTab) => void;
}

const TABS: { key: ExploreTab; label: string; icon: JSX.Element }[] = [
  {
    key: 'characters',
    label: 'Characters',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    key: 'locations',
    label: 'Locations',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    ),
  },
  {
    key: 'arcs',
    label: 'Arcs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    ),
  },
  {
    key: 'map',
    label: 'Map',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
];

export default function BottomNav({ activeTab, onChange }: BottomNavProps) {
  return (
    <nav className="flex-shrink-0 bg-paper-raised border-t border-border flex items-center justify-around" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {TABS.map(({ key, label, icon }) => {
        const active = activeTab === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[64px] transition-colors ${
              active ? 'text-rust' : 'text-ink-soft'
            }`}
          >
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
            {active && <span className="w-1 h-1 rounded-full bg-rust" />}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/explore/BottomNav.tsx
git commit -m "feat: add BottomNav with 4-tab bar for Explore mode"
```

---

### Task 6: PullUpSheet Component

**Files:**
- Create: `components/explore/PullUpSheet.tsx`

- [ ] **Step 1: Create PullUpSheet.tsx**

Draggable bottom sheet with three snap points (peek/half/full) for chapter navigation. Navigation-only — no analysis controls.

```tsx
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
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Peek content: current chapter */}
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

        {/* Half/Full content: chapter list */}
        {snap !== 'peek' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Search (full mode only) */}
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
              {filtered.map((ch, i) => {
                const idx = chapters.indexOf(ch);
                const isCurrent = idx === currentIndex;
                const hasSnapshot = snapshotSet.has(idx);
                return (
                  <button
                    key={ch.id}
                    onClick={() => handleChapterTap(idx)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                      isCurrent
                        ? 'bg-rust/10'
                        : 'hover:bg-paper-dark'
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
```

- [ ] **Step 2: Verify the sheet renders in isolation**

Temporarily import PullUpSheet in page.tsx (at the end, inside the main element) with the existing chapters data to verify it renders and drags correctly. Remove the temporary import after verification.

- [ ] **Step 3: Commit**

```bash
git add components/explore/PullUpSheet.tsx
git commit -m "feat: add PullUpSheet with three snap points for chapter navigation"
```

---

### Task 7: RecapStrip Component

**Files:**
- Create: `components/explore/RecapStrip.tsx`

- [ ] **Step 1: Create RecapStrip.tsx**

"Previously..." strip below the header showing last chapter summary.

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add components/explore/RecapStrip.tsx
git commit -m "feat: add RecapStrip component for chapter summary"
```

---

### Task 8: Restyle CharacterCard for Tactile Paperback

**Files:**
- Create: `components/cards/CharacterCard.tsx` (new location, restyled copy)
- Modify: `app/page.tsx` (update import path — done in Task 13)

- [ ] **Step 1: Create components/cards directory**

```bash
mkdir -p components/cards
```

- [ ] **Step 2: Create restyled CharacterCard**

The new card uses Tactile Paperback tokens, compact layout, and inline expand. It preserves the existing props interface and modal navigation logic from `components/CharacterCard.tsx`.

```tsx
'use client';

import { useState } from 'react';
import type { AnalysisResult, Character, Snapshot } from '@/types';
import type { SnapshotTransform } from '@/lib/propagate-edit';
import CharacterModal from '@/components/CharacterModal';
import LocationModal from '@/components/LocationModal';
import StatusBadge from '@/components/ui/StatusBadge';

const IMPORTANCE_CONFIG = {
  main:      { label: 'MAJOR',     color: 'bg-rust text-white' },
  secondary: { label: 'MINOR',     color: 'bg-paper-dark text-ink-soft' },
  minor:     { label: 'MENTIONED', color: 'bg-paper-dark text-ink-dim' },
};

function nameColor(name: string): string {
  const colors = [
    'bg-rust/15 text-rust',
    'bg-teal/15 text-teal',
    'bg-amber/15 text-amber',
    'bg-danger/15 text-danger',
    'bg-rust-soft/15 text-rust-soft',
    'bg-teal-soft/15 text-teal-soft',
    'bg-amber-soft/15 text-amber-soft',
    'bg-ink-soft/15 text-ink-soft',
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

interface Props {
  character: Character;
  snapshots?: Snapshot[];
  chapterTitles?: string[];
  currentResult?: AnalysisResult;
  onResultEdit?: (result: AnalysisResult, propagate?: SnapshotTransform) => void;
  currentChapterIndex?: number;
  onChapterJump?: (index: number) => void;
}

export default function CharacterCard({ character, snapshots, chapterTitles, currentResult, onResultEdit, currentChapterIndex, onChapterJump }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [navEntity, setNavEntity] = useState<{ type: 'character' | 'location'; name: string } | null>(null);

  const handleEntityClick = (type: 'character' | 'location' | 'arc', name: string) => {
    if (type === 'character' || type === 'location') {
      setModalOpen(false);
      setNavEntity({ type, name });
    }
  };

  const importance = IMPORTANCE_CONFIG[character.importance] ?? IMPORTANCE_CONFIG.minor;

  return (
    <>
      {modalOpen && <CharacterModal character={character} snapshots={snapshots} chapterTitles={chapterTitles} currentResult={currentResult} onResultEdit={onResultEdit} currentChapterIndex={currentChapterIndex} onClose={() => setModalOpen(false)} onEntityClick={handleEntityClick} onChapterJump={onChapterJump} />}
      {navEntity?.type === 'character' && (() => {
        const navChar = currentResult?.characters.find((c) => c.name === navEntity.name);
        return navChar ? (
          <CharacterModal character={navChar} snapshots={snapshots} chapterTitles={chapterTitles} currentResult={currentResult} onResultEdit={onResultEdit} currentChapterIndex={currentChapterIndex} onClose={() => setNavEntity(null)} onEntityClick={handleEntityClick} onChapterJump={onChapterJump} />
        ) : null;
      })()}
      {navEntity?.type === 'location' && (
        <LocationModal locationName={navEntity.name} snapshots={snapshots ?? []} chapterTitles={chapterTitles} currentResult={currentResult} onResultEdit={onResultEdit} currentChapterIndex={currentChapterIndex} onClose={() => setNavEntity(null)} onEntityClick={handleEntityClick} />
      )}
      <div
        onClick={() => setModalOpen(true)}
        className="bg-paper-raised rounded-xl border border-border overflow-hidden transition-all duration-200 cursor-pointer hover:border-rust/30"
      >
        {/* Compact header row */}
        <div className="p-3 flex items-center gap-3">
          <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${nameColor(character.name)}`}>
            {initials(character.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-[17px] font-medium text-ink leading-tight truncate">{character.name}</h3>
              <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${importance.color}`}>
                {importance.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={character.status} />
              {character.currentLocation && character.currentLocation !== 'Unknown' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleEntityClick('location', character.currentLocation); }}
                  className="text-xs font-mono text-ink-dim truncate hover:text-teal hover:underline transition-colors"
                >
                  {character.currentLocation}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Expandable details */}
        <div
          className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
        >
          <div className="px-3 pb-2">
            <p className="text-sm font-serif text-ink-soft leading-relaxed">{character.description}</p>
          </div>

          {character.recentEvents && (
            <div className="mx-3 mb-2 p-2.5 bg-paper rounded-lg border border-border">
              <p className="text-[10px] font-mono font-bold text-amber uppercase mb-0.5">Recent</p>
              <p className="text-xs font-serif text-ink-soft leading-relaxed">{character.recentEvents}</p>
            </div>
          )}

          {(character.relationships?.length ?? 0) > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[10px] font-mono font-bold text-ink-dim uppercase mb-1">Relationships</p>
              <ul className="space-y-1">
                {character.relationships.map((rel, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); handleEntityClick('character', rel.character); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleEntityClick('character', rel.character); } }}
                      className="font-serif font-medium text-ink hover:underline cursor-pointer"
                    >{rel.character}</span>
                    <span className="font-serif text-ink-dim">— {rel.relationship}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer: tap to expand / last seen */}
        <div
          className="px-3 py-2 border-t border-border flex items-center justify-between"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          <p className="text-xs font-mono text-ink-dim">
            Last seen:{' '}
            {(() => {
              const idx = chapterTitles?.findIndex((t) => t === character.lastSeen);
              return idx != null && idx >= 0 && onChapterJump ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onChapterJump(idx); }}
                  className="text-ink-dim hover:text-teal hover:underline transition-colors"
                >
                  {character.lastSeen}
                </button>
              ) : (
                <span>{character.lastSeen}</span>
              );
            })()}
          </p>
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
```

- [ ] **Step 3: Commit**

```bash
git add components/cards/CharacterCard.tsx
git commit -m "feat: add restyled CharacterCard with Tactile Paperback tokens"
```

---

### Task 9: Compact LocationCard

**Files:**
- Create: `components/cards/LocationCard.tsx`

- [ ] **Step 1: Create LocationCard.tsx**

A compact card for individual locations (the existing LocationBoard is a tree/grid, not individual cards). This card follows the same pattern as the restyled CharacterCard.

```tsx
'use client';

import { useState } from 'react';
import type { AnalysisResult, Character, LocationInfo, Snapshot } from '@/types';
import type { SnapshotTransform } from '@/lib/propagate-edit';
import LocationModal from '@/components/LocationModal';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function nameColor(name: string): string {
  const colors = [
    'bg-teal/15 text-teal',
    'bg-rust/15 text-rust',
    'bg-amber/15 text-amber',
    'bg-danger/15 text-danger',
    'bg-teal-soft/15 text-teal-soft',
    'bg-rust-soft/15 text-rust-soft',
    'bg-ink-soft/15 text-ink-soft',
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

interface Props {
  location: LocationInfo;
  characters: Character[];
  isCurrentChapter: boolean;
  snapshots?: Snapshot[];
  chapterTitles?: string[];
  currentResult?: AnalysisResult;
  onResultEdit?: (result: AnalysisResult, propagate?: SnapshotTransform) => void;
  currentChapterIndex?: number;
}

export default function LocationCard({ location, characters, isCurrentChapter, snapshots, chapterTitles, currentResult, onResultEdit, currentChapterIndex }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const residentsHere = characters.filter((c) => c.currentLocation === location.name);

  return (
    <>
      {modalOpen && (
        <LocationModal
          locationName={location.name}
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
          <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${nameColor(location.name)}`}>
            {initials(location.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-[17px] font-medium text-ink leading-tight truncate">{location.name}</h3>
              {isCurrentChapter && (
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold uppercase bg-teal text-white">
                  CURRENT
                </span>
              )}
            </div>
            {location.parentLocation && (
              <p className="text-xs font-mono text-ink-dim mt-0.5 truncate">{location.parentLocation}</p>
            )}
          </div>
          {residentsHere.length > 0 && (
            <span className="flex-shrink-0 text-xs font-mono text-ink-dim">
              {residentsHere.length} here
            </span>
          )}
        </div>

        <div className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-3 pb-2">
            <p className="text-sm font-serif text-ink-soft leading-relaxed">{location.description}</p>
          </div>
          {location.recentEvents && (
            <div className="mx-3 mb-2 p-2.5 bg-paper rounded-lg border border-border">
              <p className="text-[10px] font-mono font-bold text-amber uppercase mb-0.5">Recent</p>
              <p className="text-xs font-serif text-ink-soft leading-relaxed">{location.recentEvents}</p>
            </div>
          )}
          {residentsHere.length > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[10px] font-mono font-bold text-ink-dim uppercase mb-1">Characters here</p>
              <div className="flex flex-wrap gap-1">
                {residentsHere.map((c) => (
                  <span key={c.name} className="text-xs font-serif text-ink-soft bg-paper px-2 py-0.5 rounded">
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className="px-3 py-2 border-t border-border flex items-center justify-end"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
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
```

- [ ] **Step 2: Commit**

```bash
git add components/cards/LocationCard.tsx
git commit -m "feat: add compact LocationCard with Tactile Paperback styling"
```

---

### Task 10: Compact ArcCard

**Files:**
- Create: `components/cards/ArcCard.tsx`

- [ ] **Step 1: Create ArcCard.tsx**

Compact arc card with horizontal progress bar and status chip.

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add components/cards/ArcCard.tsx
git commit -m "feat: add compact ArcCard with status badge and inline expand"
```

---

### Task 11: WorkshopScreen Shell

**Files:**
- Create: `components/workshop/WorkshopScreen.tsx`

- [ ] **Step 1: Create components/workshop directory**

```bash
mkdir -p components/workshop
```

- [ ] **Step 2: Create WorkshopScreen.tsx**

Full-screen overlay with 5 tabs. This is a container that renders the appropriate tab content. For now, it imports the existing components directly.

```tsx
'use client';

import { useState } from 'react';
import type { AnalysisResult, EbookChapter, ParsedEbook, QueueJob, Snapshot, StoredBookState, SeriesDefinition, BookFilter } from '@/types';
import type { SnapshotTransform } from '@/lib/propagate-edit';
import ChapterSelector from '@/components/ChapterSelector';
import EntityManager from '@/components/EntityManager';
import SettingsModal from '@/components/SettingsModal';
import BookStructureEditor from '@/components/BookStructureEditor';
import BookCoverGradient from '@/components/ui/BookCoverGradient';
import type { DerivedEntities } from '@/lib/use-derived-entities';

type WorkshopTab = 'chapters' | 'structure' | 'entities' | 'library' | 'settings';

interface WorkshopScreenProps {
  book: ParsedEbook;
  stored: StoredBookState;
  result: AnalysisResult | null;
  currentIndex: number;
  onClose: () => void;

  // Chapter tab
  onChapterChange: (index: number) => void;
  onAnalyze: () => void;
  onCancelAnalyze: () => void;
  onRebuild: () => void;
  onCancelRebuild: () => void;
  onProcessBook: () => void;
  onDeleteSnapshot: (index: number) => void;
  onSetBookmark: (index: number | null) => void;
  onSetRange: (range: { start: number; end: number } | null) => void;
  analyzing: boolean;
  rebuilding: boolean;
  rebuildProgress: { current: number; total: number; chapterTitle?: string; chapterIndex?: number } | null;
  chapterRange: { start: number; end: number } | null;
  snapshotIndices: Set<number>;
  visibleChapterOrders: Set<number> | null;
  isMetaOnly: boolean;
  needsSetup: boolean;
  onCompleteSetup: (range: { start: number; end: number }) => void;

  // Entity tab
  derived: DerivedEntities;
  onResultEdit: (result: AnalysisResult, propagate?: SnapshotTransform) => void;
  currentChapterIndex: number;

  // Structure tab
  onSaveSeries: (series: SeriesDefinition) => void;
  onReextractTitles: () => Promise<void>;

  // Library tab
  savedBooks: Array<{ title: string; author: string; lastAnalyzedIndex: number; chapterCount?: number }>;
  onLoadBook: (title: string, author: string) => void;
  onDeleteBook: (title: string, author: string) => void;
  onImportFile: (file: File) => void;

  // Queue
  queue: QueueJob[];
  onRemoveJob: (id: string) => void;
  onCancelCurrentJob: () => void;
  onClearDone: () => void;
}

const TABS: { key: WorkshopTab; label: string }[] = [
  { key: 'chapters', label: 'Chapters' },
  { key: 'structure', label: 'Structure' },
  { key: 'entities', label: 'Entities' },
  { key: 'library', label: 'Library' },
  { key: 'settings', label: 'Settings' },
];

export default function WorkshopScreen(props: WorkshopScreenProps) {
  const [activeTab, setActiveTab] = useState<WorkshopTab>('chapters');
  const [showSettings, setShowSettings] = useState(false);
  const [showStructureEditor, setShowStructureEditor] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-paper flex flex-col animate-slide-up">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showStructureEditor && props.stored.series && (
        <BookStructureEditor
          series={props.stored.series}
          chapters={props.book.chapters.map(({ order, title, bookIndex, preview, contentType }) =>
            ({ order, title, bookIndex, preview, contentType }))}
          onSave={props.onSaveSeries}
          onClose={() => setShowStructureEditor(false)}
          mode="manage"
          onReextract={props.onReextractTitles}
        />
      )}

      {/* Workshop header */}
      <header className="bg-paper-raised border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={props.onClose}
          className="w-8 h-8 flex items-center justify-center text-ink-soft hover:text-ink transition-colors rounded-lg"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold text-ink">Workshop</h2>
          <p className="text-xs font-mono text-ink-dim truncate">{props.book.title}</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border bg-paper-raised flex-shrink-0 overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
              activeTab === key
                ? 'text-rust border-rust'
                : 'text-ink-soft border-transparent hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'chapters' && (
          <ChapterSelector
            chapters={props.book.chapters}
            currentIndex={props.currentIndex}
            onChange={props.onChapterChange}
            onAnalyze={props.onAnalyze}
            onCancelAnalyze={props.onCancelAnalyze}
            onRebuild={props.onRebuild}
            onCancelRebuild={props.onCancelRebuild}
            onProcessBook={props.onProcessBook}
            analyzing={props.analyzing}
            rebuilding={props.rebuilding}
            rebuildProgress={props.rebuildProgress}
            lastAnalyzedIndex={props.stored.lastAnalyzedIndex}
            snapshotIndices={props.snapshotIndices}
            visibleChapterOrders={props.visibleChapterOrders}
            chapterRange={props.chapterRange}
            onSetRange={props.onSetRange}
            onDeleteSnapshot={props.onDeleteSnapshot}
            readingBookmark={props.stored.readingBookmark}
            onSetBookmark={props.onSetBookmark}
            metaOnly={props.isMetaOnly}
            needsSetup={props.needsSetup}
            onCompleteSetup={props.onCompleteSetup}
          />
        )}

        {activeTab === 'structure' && (
          <div>
            {props.stored.series && props.stored.series.books.length > 1 && (
              <button
                onClick={() => setShowStructureEditor(true)}
                className="w-full px-4 py-3 rounded-xl border border-border text-left hover:border-rust/30 transition-colors"
              >
                <span className="text-sm font-serif text-ink">Edit Book Structure</span>
                <span className="text-xs font-mono text-ink-dim ml-2">
                  {props.stored.series.books.length} books
                </span>
              </button>
            )}
            {!props.stored.series && (
              <p className="text-sm font-serif text-ink-soft text-center py-12">
                No series structure detected for this book.
              </p>
            )}
          </div>
        )}

        {activeTab === 'entities' && props.result && (
          <EntityManager
            snapshots={props.stored.snapshots}
            currentResult={props.stored.result}
            chapterTitles={props.book.chapters.map((ch) => ch.title)}
            onResultEdit={props.onResultEdit}
            aggregated={props.derived.aggregated}
            bookTitle={props.book.title}
            bookAuthor={props.book.author}
            currentChapterIndex={props.currentChapterIndex}
          />
        )}

        {activeTab === 'library' && (
          <WorkshopLibrary
            savedBooks={props.savedBooks}
            currentBookTitle={props.book.title}
            onLoadBook={props.onLoadBook}
            onDeleteBook={props.onDeleteBook}
            onImportFile={props.onImportFile}
          />
        )}

        {activeTab === 'settings' && (
          <div>
            <button
              onClick={() => setShowSettings(true)}
              className="w-full px-4 py-3 rounded-xl border border-border text-left hover:border-rust/30 transition-colors"
            >
              <span className="text-sm font-serif text-ink">AI Provider Settings</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkshopLibrary({ savedBooks, currentBookTitle, onLoadBook, onDeleteBook, onImportFile }: {
  savedBooks: Array<{ title: string; author: string; lastAnalyzedIndex: number; chapterCount?: number }>;
  currentBookTitle: string;
  onLoadBook: (title: string, author: string) => void;
  onDeleteBook: (title: string, author: string) => void;
  onImportFile: (file: File) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = savedBooks.filter((b) =>
    !search || b.title.toLowerCase().includes(search.toLowerCase()) || b.author.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <input
        type="search"
        placeholder="Search library..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-paper border border-border rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim font-serif focus:outline-none focus:border-rust mb-4"
      />
      <div className="space-y-2">
        {filtered.map((book) => {
          const isCurrent = book.title === currentBookTitle;
          return (
            <div
              key={`${book.title}-${book.author}`}
              onClick={() => !isCurrent && onLoadBook(book.title, book.author)}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors ${
                isCurrent
                  ? 'bg-rust/5 border-rust/20'
                  : 'border-border hover:border-rust/30 cursor-pointer'
              }`}
            >
              <BookCoverGradient title={book.title} className="w-10 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-serif font-medium truncate ${isCurrent ? 'text-rust' : 'text-ink'}`}>
                  {book.title}
                </p>
                <p className="text-xs font-mono text-ink-dim">{book.author}</p>
                <div className="flex gap-3 mt-1 text-xs font-mono text-ink-dim">
                  {book.lastAnalyzedIndex >= 0 && (
                    <span>Ch. {book.lastAnalyzedIndex + 1}{book.chapterCount ? `/${book.chapterCount}` : ''}</span>
                  )}
                </div>
              </div>
              {!isCurrent && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteBook(book.title, book.author); }}
                  className="text-ink-dim hover:text-danger transition-colors p-1"
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3.5h8M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5.5 6v4M8.5 6v4M4 3.5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8"/>
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <label className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-rust text-white flex items-center justify-center shadow-lg cursor-pointer hover:bg-rust-soft transition-colors">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <input
          type="file"
          accept=".epub,.bookbuddy"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Add the slide-up animation to globals.css**

Add at the end of `app/globals.css`:

```css
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.animate-slide-up {
  animation: slide-up 0.25s ease-out;
}
```

- [ ] **Step 4: Commit**

```bash
git add components/workshop/WorkshopScreen.tsx app/globals.css
git commit -m "feat: add WorkshopScreen shell with 5-tab layout"
```

---

### Task 12: Snapshot Navigator Extraction

**Files:**
- Create: `components/explore/SnapshotNav.tsx`

- [ ] **Step 1: Create SnapshotNav.tsx**

Extract the snapshot navigator (currently inline in page.tsx lines 2038-2123) into its own component. This sits between the RecapStrip and content tabs in Explore mode.

```tsx
'use client';

import { useState } from 'react';
import type { AnalysisResult, Snapshot, StoredBookState, EbookChapter } from '@/types';
import { normalizeTitle } from '@/lib/normalize-title';

interface SnapshotNavProps {
  snapshots: Snapshot[];
  chapters: EbookChapter[];
  viewingSnapshotIndex: number | null;
  stored: StoredBookState;
  onNavigate: (snapshotIndex: number | null, chapterIndex: number, result: AnalysisResult) => void;
}

export default function SnapshotNav({ snapshots, chapters, viewingSnapshotIndex, stored, onNavigate }: SnapshotNavProps) {
  const [playSpeed, setPlaySpeed] = useState(2000);
  const [playing, setPlaying] = useState(false);

  if (snapshots.length === 0) return null;

  const snaps = [...snapshots].sort((a, b) => a.index - b.index);
  const pos = viewingSnapshotIndex === null
    ? snaps.length - 1
    : snaps.findIndex((s) => s.index === viewingSnapshotIndex);
  const atLatest = viewingSnapshotIndex === null || pos === snaps.length - 1;
  const snap = snaps[pos];
  const chTitle = normalizeTitle(chapters[snap?.index]?.title ?? `Chapter ${(snap?.index ?? 0) + 1}`);

  function goTo(newPos: number) {
    const target = snaps[newPos];
    if (newPos === snaps.length - 1) {
      onNavigate(null, stored.lastAnalyzedIndex, stored.result);
    } else {
      onNavigate(target.index, target.index, target.result);
    }
  }

  return (
    <div className="mx-4 mt-2 flex items-center gap-1 px-2 py-1.5 bg-paper-raised rounded-xl border border-border flex-shrink-0">
      <button
        onClick={() => goTo(Math.max(0, pos - 1))}
        disabled={pos <= 0 || playing}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-base text-ink-soft hover:text-ink hover:bg-paper-dark disabled:opacity-30 disabled:cursor-default transition-colors"
      >&#8249;</button>
      <span className="flex-1 text-center truncate px-1 font-serif text-sm">
        {atLatest
          ? <><span className="font-semibold text-ink">ch.{(snap?.index ?? 0) + 1} — {chTitle}</span> <span className="text-xs text-ink-dim">(latest)</span></>
          : <><span className="text-xs text-ink-dim">Viewing </span><span className="font-semibold text-ink">ch.{snap.index + 1} — {chTitle}</span> <span className="text-xs text-ink-dim">({pos + 1}/{snaps.length})</span></>
        }
      </span>
      <button
        onClick={() => goTo(Math.min(snaps.length - 1, pos + 1))}
        disabled={atLatest || playing}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-base text-ink-soft hover:text-ink hover:bg-paper-dark disabled:opacity-30 disabled:cursor-default transition-colors"
      >&#8250;</button>
      <div className="w-px h-4 bg-border mx-1" />
      <select
        value={playSpeed}
        onChange={(e) => setPlaySpeed(Number(e.target.value))}
        className="text-xs bg-transparent text-ink-dim border-none outline-none cursor-pointer hover:text-ink transition-colors font-mono"
      >
        <option value={3000}>Slow</option>
        <option value={2000}>Normal</option>
        <option value={1000}>Fast</option>
        <option value={400}>Very fast</option>
      </select>
      <button
        onClick={() => {
          if (playing) { setPlaying(false); return; }
          if (atLatest && snaps.length > 1) goTo(0);
          setPlaying(true);
        }}
        className="text-ink-soft hover:text-ink transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-paper-dark"
      >
        {playing
          ? <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3" height="12"/><rect x="7" y="0" width="3" height="12"/></svg>
          : <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12"/></svg>
        }
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/explore/SnapshotNav.tsx
git commit -m "feat: extract SnapshotNav component from page.tsx"
```

---

### Task 13: Integrate Explore Layout into page.tsx

This is the largest task. It rewires page.tsx to use the new Explore components while keeping all existing functionality working.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add new imports to page.tsx**

At the top of `app/page.tsx`, add imports for the new components. Keep all existing imports — we'll need them during the transition:

```tsx
import ExploreHeader from '@/components/explore/ExploreHeader';
import BottomNav from '@/components/explore/BottomNav';
import PullUpSheet from '@/components/explore/PullUpSheet';
import RecapStrip from '@/components/explore/RecapStrip';
import SnapshotNav from '@/components/explore/SnapshotNav';
import NewCharacterCard from '@/components/cards/CharacterCard';
import LocationCard from '@/components/cards/LocationCard';
import ArcCard from '@/components/cards/ArcCard';
import WorkshopScreen from '@/components/workshop/WorkshopScreen';
```

Also update the `MainTab` type to use the new Explore tabs and add Workshop state:

```tsx
type MainTab = 'characters' | 'locations' | 'map' | 'arcs';
```

Add new state variable for Workshop visibility:

```tsx
const [showWorkshop, setShowWorkshop] = useState(false);
const [showPullUpSheet, setShowPullUpSheet] = useState(false);
```

- [ ] **Step 2: Replace the header section**

Replace the current `<header>` block (lines ~1783-1936) with the new ExploreHeader:

```tsx
<ExploreHeader
  bookTitle={book.title}
  currentChapterIndex={currentIndex}
  totalChapters={book.chapters.length}
  onChapterPillTap={() => setShowPullUpSheet(true)}
  onOpenWorkshop={() => setShowWorkshop(true)}
  onOpenChat={() => setShowChat(true)}
  onOpenSettings={() => setShowSettings(true)}
  onChangeBook={() => { setBook(null); setResult(null); storedRef.current = null; seriesBaseRef.current = null; }}
  onToggleTheme={toggleTheme}
  isDark={isDark}
  hasStoredState={hasStoredState}
/>
```

- [ ] **Step 3: Replace the sidebar with PullUpSheet**

Remove the sidebar `<aside>` block (lines ~1947-1991) and the mobile backdrop. Replace with PullUpSheet rendered before BottomNav:

```tsx
<PullUpSheet
  chapters={book.chapters}
  currentIndex={currentIndex}
  snapshots={visibleSnapshots}
  onChapterSelect={(i) => handleChapterChange(i)}
  visibleChapterOrders={visibleChapterOrders}
/>
```

- [ ] **Step 4: Replace the tab bar with BottomNav**

Remove the inline tab bar (lines ~2015-2035). Add BottomNav at the bottom of the layout:

```tsx
<BottomNav activeTab={tab} onChange={setTab} />
```

Remove the `'manage'` tab from `MainTab` — it moves to Workshop.

- [ ] **Step 5: Add RecapStrip and SnapshotNav**

After ExploreHeader, add:

```tsx
{result?.summary && (
  <RecapStrip summary={result.summary} onOpenTimeline={() => setShowTimeline(true)} />
)}
{stored && (
  <SnapshotNav
    snapshots={visibleSnapshots}
    chapters={book.chapters}
    viewingSnapshotIndex={viewingSnapshotIndex}
    stored={stored}
    onNavigate={(snapIdx, chIdx, res) => {
      setViewingSnapshotIndex(snapIdx);
      setCurrentIndex(chIdx);
      setResult(res);
      setSpoilerDismissedIndex(null);
    }}
  />
)}
```

- [ ] **Step 6: Update Characters tab to use new CharacterCard**

Replace the CharacterCard import usage in the characters grid:

```tsx
{tab === 'characters' && (
  <>
    {/* Sort/filter controls — restyle with Tactile Paperback */}
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="search"
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-paper border border-border rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim font-serif focus:outline-none focus:border-rust min-w-36 flex-1"
      />
      <div className="flex gap-1.5 flex-wrap">
        {(['all', 'main', 'secondary', 'minor'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-rust/10 text-rust'
                : 'text-ink-soft border border-border hover:border-rust/30'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {displayed.map((character) => (
        <NewCharacterCard
          key={character.name}
          character={character}
          snapshots={visibleSnapshots}
          chapterTitles={book.chapters.map((ch) => ch.title)}
          currentResult={result}
          onResultEdit={applyResultEdit}
          currentChapterIndex={currentChapterIndex}
          onChapterJump={handleChapterChange}
        />
      ))}
    </div>
  </>
)}
```

- [ ] **Step 7: Update Locations tab to use LocationCard**

Replace the LocationBoard usage with a card grid using the new LocationCard:

```tsx
{tab === 'locations' && result?.locations && (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
    {result.locations.map((location) => (
      <LocationCard
        key={location.name}
        location={location}
        characters={characters}
        isCurrentChapter={false}
        snapshots={visibleSnapshots}
        chapterTitles={book.chapters.map((ch) => ch.title)}
        currentResult={result}
        onResultEdit={applyResultEdit}
        currentChapterIndex={currentChapterIndex}
      />
    ))}
  </div>
)}
```

Note: Keep the existing LocationBoard component — it is still used inside LocationModal. The LocationCard is an additional card view for the Explore tab.

- [ ] **Step 8: Update Arcs tab to use ArcCard**

Replace the ArcsPanel usage with a card grid using ArcCard:

```tsx
{tab === 'arcs' && result?.arcs && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {result.arcs.map((arc) => (
      <ArcCard
        key={arc.name}
        arc={arc}
        snapshots={visibleSnapshots}
        chapterTitles={book.chapters.map((ch) => ch.title)}
        currentResult={result}
        onResultEdit={applyResultEdit}
        currentChapterIndex={currentChapterIndex}
      />
    ))}
  </div>
)}
```

Note: Keep ArcsPanel component — it provides parent arc grouping and is used by Workshop.

- [ ] **Step 9: Add WorkshopScreen overlay**

Add WorkshopScreen rendering right after the header modals (SettingsModal, BookmarkModal, etc.), before the Explore layout:

```tsx
{showWorkshop && stored && (
  <WorkshopScreen
    book={book}
    stored={stored}
    result={result}
    currentIndex={currentIndex}
    onClose={() => setShowWorkshop(false)}
    onChapterChange={(i) => { handleChapterChange(i); }}
    onAnalyze={handleAnalyze}
    onCancelAnalyze={() => { analyzeCancelRef.current = true; }}
    onRebuild={handleRebuild}
    onCancelRebuild={() => { rebuildCancelRef.current = true; }}
    onProcessBook={handleProcessBook}
    onDeleteSnapshot={handleDeleteSnapshot}
    onSetBookmark={handleSetBookmark}
    onSetRange={setChapterRange}
    analyzing={analyzing}
    rebuilding={rebuilding}
    rebuildProgress={rebuildProgress}
    chapterRange={chapterRange}
    snapshotIndices={snapshotIndices}
    visibleChapterOrders={visibleChapterOrders}
    isMetaOnly={isMetaOnly}
    needsSetup={needsSetup}
    onCompleteSetup={completeSetup}
    derived={derived}
    onResultEdit={applyResultEdit}
    currentChapterIndex={currentChapterIndex}
    onSaveSeries={handleSaveSeries}
    onReextractTitles={handleReextractTitles}
    savedBooks={savedBooksForLibrary}
    onLoadBook={handleLoadBook}
    onDeleteBook={handleDeleteBookFromLibrary}
    onImportFile={handleFile}
    queue={queue}
    onRemoveJob={(id) => setQueue((q) => q.filter((j) => j.id !== id))}
    onCancelCurrentJob={() => { queueCancelRef.current = true; }}
    onClearDone={() => setQueue((q) => q.filter((j) => j.status !== 'done' && j.status !== 'error'))}
  />
)}
```

The exact prop names (`savedBooksForLibrary`, `handleLoadBook`, `handleDeleteBookFromLibrary`) will need to be derived from the existing page.tsx code. You will need to:
1. Extract the saved books list from the existing book picker section (around lines 1580-1710 where `savedBooks` state is used)
2. Map the existing book loading logic to `onLoadBook`
3. Map the existing book deletion to `onDeleteBook`

Look at how the book picker section works in the "no book loaded" state and reuse those handlers.

- [ ] **Step 10: Update the main layout structure**

The new layout for the book-loaded state should be:

```tsx
<main className="h-screen flex flex-col overflow-hidden bg-paper">
  {/* Modals (SettingsModal, BookmarkModal, StoryTimeline, etc.) — unchanged */}
  {/* WorkshopScreen overlay */}
  
  <ExploreHeader ... />
  <RecapStrip ... />
  
  <div className="flex-1 overflow-y-auto p-4">
    <SnapshotNav ... />
    {/* Tab content (characters/locations/arcs/map) */}
  </div>
  
  <PullUpSheet ... />
  <BottomNav ... />
</main>
```

Remove the old sidebar-based layout (`flex flex-1 overflow-hidden` wrapping aside + content area).

- [ ] **Step 11: Verify everything works**

Run `npm run dev`, open browser at http://localhost:3000. Test:
- Bottom nav switches between Characters, Locations, Arcs, Map tabs
- Chapter pill in header opens PullUpSheet — drag to expand, tap chapter to navigate
- Overflow menu opens Workshop
- Workshop shows all 5 tabs, Chapter tab has full analysis controls
- RecapStrip shows "Previously..." when a summary exists
- Character cards show new Tactile Paperback styling with inline expand
- Dark mode toggle still works (via Workshop overflow menu)
- Existing modals (CharacterModal, LocationModal, etc.) still open from cards

- [ ] **Step 12: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate Explore/Workshop layout with new components"
```

---

### Task 14: Restyle the Upload/Book Picker Screen

The "no book loaded" screen (UploadZone, book list, Calibre/GitHub integrations) also needs Tactile Paperback styling.

**Files:**
- Modify: `app/page.tsx` (the "no book loaded" section, approximately lines 1500-1717)

- [ ] **Step 1: Update the book picker section styling**

In the book picker render path (when `!book`), update the main wrapper and components to use Tactile Paperback tokens. The key changes:

- Background: `bg-paper` instead of `bg-stone-50 dark:bg-zinc-950`
- Text: `text-ink` instead of `text-stone-900 dark:text-zinc-100`
- Borders: `border-border` instead of `border-stone-200 dark:border-zinc-800`
- Cards: `bg-paper-raised` instead of `bg-white dark:bg-zinc-900`
- Title: Add `font-serif` class to headings
- Metadata: Add `font-mono` class to chapter counts and dates
- Upload zone border: `border-border hover:border-rust/30`

This is a styling pass — no structural changes to the upload flow.

- [ ] **Step 2: Verify the upload screen**

Open http://localhost:3000 with no book loaded. Verify:
- Warm ecru background
- Newsreader-style headings
- Book list items styled with Tactile Paperback tokens
- Upload zone accepts files correctly

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: restyle book picker screen with Tactile Paperback tokens"
```

---

### Task 15: Clean Up Old Imports & Desktop Responsiveness

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Remove unused imports**

After the integration is complete, remove imports that are no longer used in page.tsx:
- `ChapterSelector` (now only used inside WorkshopScreen)
- `EntityManager` (now only used inside WorkshopScreen)
- `BookFilterSelector` (moved to WorkshopScreen or header)
- Old `CharacterCard` import (replaced by the new one from `components/cards/`)

Keep all other imports — modals, storage functions, etc. are still used.

- [ ] **Step 2: Add desktop responsiveness**

The BottomNav should become a sidebar on desktop (>= lg breakpoint). Update `BottomNav.tsx`:

```tsx
// In the nav element, add responsive classes:
<nav className="flex-shrink-0 bg-paper-raised border-t border-border flex items-center justify-around lg:fixed lg:left-0 lg:top-0 lg:h-full lg:w-16 lg:flex-col lg:justify-start lg:pt-4 lg:gap-2 lg:border-t-0 lg:border-r" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
```

And in page.tsx, add left padding on desktop to account for the sidebar:

```tsx
<div className="flex-1 overflow-y-auto p-4 lg:pl-20">
```

- [ ] **Step 3: Update the content grid for desktop**

The character/location/arc card grids already use responsive columns (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`), so they work on desktop. The Map tab fills remaining height — this is unchanged.

- [ ] **Step 4: Verify desktop layout**

Open browser at full width. Verify:
- Bottom nav appears as a left sidebar on desktop (>= 1024px)
- Content area has proper left padding
- Card grids flow into 2-3 columns on wider screens
- Workshop overlay still covers full screen on desktop

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/explore/BottomNav.tsx
git commit -m "feat: add desktop responsiveness and clean up unused imports"
```

---

### Task 16: Final Visual Polish

**Files:**
- Modify: `app/globals.css`
- Modify: various components as needed

- [ ] **Step 1: Update scrollbar styling to match palette**

In globals.css, update the scrollbar styles:

```css
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}
```

Remove the separate `html.dark ::-webkit-scrollbar-thumb` block — it's handled by the CSS variable swapping.

- [ ] **Step 2: Verify all screens end-to-end**

Full walkthrough:
1. Open app with no book — verify upload screen styling
2. Upload an EPUB — verify parsing works
3. Check Characters tab — cards are compact with Tactile Paperback styling
4. Check Locations tab — location cards render
5. Check Arcs tab — arc cards with status badges
6. Check Map tab — map renders (restyled border colors)
7. Tap chapter pill — PullUpSheet opens, navigate chapters
8. Open Workshop from overflow menu — all 5 tabs work
9. Toggle dark mode — palette inverts correctly
10. Test on mobile viewport (Chrome DevTools responsive mode)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: final visual polish for Tactile Paperback redesign"
```

- [ ] **Step 4: Push to remote**

```bash
git push origin main
```
