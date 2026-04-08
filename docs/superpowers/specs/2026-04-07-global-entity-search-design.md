# Global Entity Search Design

**Date:** 2026-04-07
**Status:** Draft

## Problem

Users encounter characters, locations, and narrative arcs while reading and want to quickly look up details. The existing search is scoped to the EntityManager tab and requires navigating there first. The top nav is already crowded on mobile, so adding a search bar there isn't viable.

## Solution

A floating action button (FAB) that opens a bottom sheet search panel. Users type a query to find entities across all three types (characters, locations, arcs) in the current book. Results show as compact cards; tapping a card shows a preview; tapping "View Details" opens the full modal.

## Decisions

- **Bottom sheet pattern**: Avoids the crowded top nav; feels native on mobile; new UI pattern for the codebase but justified by the use case
- **FAB trigger**: Fixed bottom-right search icon, always visible regardless of current tab
- **Two-step reveal**: Result card -> preview card -> full modal. Prevents accidental deep navigation and gives users a quick glance without committing to the full modal
- **Current book only**: No cross-book search; keeps implementation simple and results focused
- **No new data fetching**: All search runs client-side against already-loaded entity data from snapshots
- **Parent owns modals**: SearchSheet calls back to page.tsx which renders the modal, preserving existing onEntityClick cross-linking

## Components

### SearchFAB

A fixed-position button at the bottom-right of the viewport.

- Fixed position: `bottom-6 right-6` (adjustable for safe areas on mobile)
- High z-index to float above page content
- Search icon (magnifying glass)
- Tapping opens the bottom sheet
- Hidden when the bottom sheet is open or when any entity modal is open

### SearchSheet

A bottom sheet overlay that handles all three states: results, preview, and empty.

**Layout:**
- Slides up from the bottom, covering ~70% of screen height
- Backdrop dims content behind it (tap to dismiss)
- Close via: backdrop tap, swipe down, or X button
- Search input at top, auto-focused on open (keyboard opens immediately on mobile)

**Internal state machine:**
- `idle` — empty input, shows hint text: "Search characters, locations, arcs..."
- `results` — user has typed a query, matching results displayed as scrollable list
- `preview` — user tapped a result, preview card shown with back arrow

**Closing behavior:**
- From any state, closing dismisses the entire sheet
- State resets on next open (clean slate)

### Result Cards

Displayed in the `results` state as a flat scrollable list.

Each card shows:
- Entity name (bold)
- Type badge — small colored pill: "Character", "Location", "Arc"
- One-line description, truncated with `line-clamp-1`

**Ordering:** Characters first, then Locations, then Arcs. Alphabetical within each group. No section headers — the type badge distinguishes them.

**No results:** "No matches found" message centered in the sheet.

### Preview Card

Displayed when a result card is tapped. Replaces the results list in the sheet.

**Common elements:**
- Back arrow at top to return to results (preserves query and scroll position)
- "View Details" button at the bottom
- Uses existing hash-based entity colors and status badge patterns

**Character preview:**
- Name + status badge (alive/dead/unknown/uncertain)
- Importance level (main/secondary/minor)
- Current location
- Description (2-3 lines, truncated)

**Location preview:**
- Name + parent location (if any)
- Arc association (if any)
- Description (2-3 lines, truncated)

**Arc preview:**
- Name + status badge (active/resolved/dormant)
- Character count (e.g. "5 characters")
- Summary (2-3 lines, truncated)

## Search Logic

- Substring matching on entity name and aliases, case-insensitive
- Same approach used in EntityManager today: `name.toLowerCase().includes(query) || aliases.some(a => a.toLowerCase().includes(query))`
- Runs on each keystroke against in-memory entities
- Uses output from `useDerivedEntities` hook (aggregated entities from snapshots)
- No API calls, no debouncing needed (small dataset)

## Data Flow

```
page.tsx
  ├── isSearchOpen state
  ├── SearchFAB (onClick -> open sheet)
  ├── SearchSheet
  │     ├── receives: derived entities (characters, locations, arcs)
  │     ├── internal: query, view state (results/preview), selected entity
  │     └── calls: onEntitySelect(type, name) -> parent
  └── CharacterModal / LocationModal / NarrativeArcModal
        └── rendered by page.tsx when entity selected (same as EntityManager pattern)
```

**Props for SearchSheet:**
- `characters` — aggregated character list from useDerivedEntities
- `locations` — aggregated location list from useDerivedEntities
- `arcs` — aggregated arc list (from currentResult + snapshots)
- `onEntitySelect(type: 'character' | 'location' | 'arc', name: string)` — callback to parent
- `onClose()` — callback to dismiss sheet
- `isOpen: boolean` — controls visibility

**Modal rendering:** page.tsx handles `onEntitySelect` by closing the sheet, setting the selected entity type and name, and rendering the appropriate modal with all required props (snapshots, chapterTitles, currentResult, onResultEdit, currentChapterIndex, onEntityClick).

## Styling

- Follows existing TailwindCSS patterns: `dark:` prefix for dark mode, stone/zinc palette
- Bottom sheet: `fixed inset-x-0 bottom-0 z-50`, `rounded-t-2xl`, backdrop blur
- FAB: `fixed z-40`, `rounded-full`, `shadow-lg`, consistent with app's color scheme
- Result cards: `rounded-lg`, `p-3`, hover/tap states
- Type badges: small pills using entity-type colors (rose for characters, sky for locations, violet for arcs)
- Transition: slide-up animation for sheet, fade for backdrop
- Swipe-to-dismiss: CSS transform + touch event handling

## Scope

**In scope:**
- SearchFAB component
- SearchSheet component (results, preview, empty states)
- Integration in page.tsx (state, modal rendering)
- Mobile-optimized touch interactions (swipe to dismiss)

**Out of scope:**
- Cross-book search
- Keyboard shortcut (Cmd+K) — can be added later
- Search history / recent searches
- Fuzzy matching — substring is sufficient for entity names
