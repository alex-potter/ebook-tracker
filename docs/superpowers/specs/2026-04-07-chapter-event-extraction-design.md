# Chapter Event Extraction Design

**Date:** 2026-04-07
**Status:** Draft

## Problem

When processing long chapters on local models with small context windows (e.g. 16K tokens), chapters are split into multiple chunks. The current pipeline processes each chunk via `runMultiPassDelta` and merges results using `mergeDelta`, which overwrites fields like `recentEvents`, `currentLocation`, and `summary` with each successive chunk. Only the last chunk's data survives — earlier chunks' narrative content is lost.

## Goal

Preserve all narrative content from every chunk by capturing each chunk's extraction output as a discrete **chapter event**. A single chapter can produce multiple events, each with its own summary, entity state, and position within the chapter. Users can filter the timeline to their reading position at sub-chapter granularity.

## Data Model

### New types

```typescript
interface ChapterEvent {
  summary: string;                    // this chunk's narrative summary
  characters: string[];               // character names active in this event
  locations: string[];                // location names where action happens
  characterSnapshots: Character[];    // character state from this chunk's delta
  locationSnapshots: LocationInfo[];  // location state from this chunk's delta
  arcSnapshots?: NarrativeArc[];      // arc state from this chunk's delta
  chapterProgress: number;            // 0.0–1.0 position within chapter
  textAnchor?: string;               // first ~100 chars of chunk text (word-boundary trimmed)
}

interface ReadingPosition {
  chapterIndex: number;               // which chapter
  progress?: number;                  // 0.0–1.0 within chapter (optional)
}
```

### Modified types

```typescript
interface Snapshot {
  index: number;
  result: AnalysisResult;             // final accumulated state (last event's merged output)
  events?: ChapterEvent[];            // per-chunk events, ordered by chapterProgress
  model?: string;
  appVersion?: string;
}

interface StoredBookState {
  // ... existing fields ...
  readingBookmark?: number;           // kept for backward compat
  readingPosition?: ReadingPosition;  // new sub-chapter position
}
```

### Design notes

- `characterSnapshots` and `locationSnapshots` capture the chunk's own delta contributions (the `updatedCharacters` / `updatedLocations` arrays from the delta result), NOT the full accumulated entity list.
- For single-chunk chapters (short chapters or large-context models), `events` contains one entry with `chapterProgress: 0.5`.
- `snapshot.result` remains the fully merged end-of-chapter state, used for next-chapter delta analysis. Nothing changes about how downstream consumers (entity modals, map, pins) read entity state.

## Chunk Processing Pipeline

### Current behavior (lossy)

```
Previous chapter result (base)
  └─ for each chunk:
       delta against accumulated → merge into accumulated → discard delta
  └─ snapshot.result = final accumulated
```

### New behavior (preserving events)

```
Previous chapter result (base)
  ├─ Chunk 1: delta against base       → capture Event 1 → merge into state₁
  ├─ Chunk 2: delta against state₁     → capture Event 2 → merge into state₂
  ├─ Chunk 3: delta against state₂     → capture Event 3 → merge into state₃
  └─ snapshot.result = state₃
     snapshot.events = [Event 1, Event 2, Event 3]
```

Each chunk still processes through the existing 3-pass delta pipeline (`runMultiPassDelta`). The entity state merge (`mergeDelta`) still runs between chunks so that each subsequent chunk has full context of prior chunks' discoveries (new characters, locations, etc.). The change is that we also capture each chunk's individual delta output as a `ChapterEvent` before merging forward.

### Event capture details

After `runMultiPassDelta` returns for a chunk, but before merging into accumulated state:

1. Extract `summary` from the chunk's location delta result
2. Extract `characters` = names from `updatedCharacters`
3. Extract `locations` = names from `updatedLocations`
4. Store `characterSnapshots` = the chunk's `updatedCharacters` array
5. Store `locationSnapshots` = the chunk's `updatedLocations` array
6. Store `arcSnapshots` = the chunk's `updatedArcs` array
7. Compute `chapterProgress = (chunk.index + 0.5) / chunk.total`
8. Compute `textAnchor` = first ~100 chars of `chunk.text`, trimmed to word boundary

### Full analysis path

The same approach applies to the full-analysis path (first chapter or reanalysis). The first chunk uses `runMultiPassFull`, subsequent chunks use `runMultiPassDelta`. Each produces an event.

## Position Tracking

### Event positioning

- `chapterProgress` is derived from the chunk's position: `(chunk.index + 0.5) / chunk.total`
- For single-chunk chapters, `chapterProgress` is `0.5`
- `textAnchor` is the first ~100 characters of the chunk text, trimmed to a word boundary — used for debugging and potential future position matching

### User reading position

Users set their reading position in two ways:

1. **Chapter-level** (existing): "I'm on chapter 12" — shows all events through chapter 12. The existing `readingBookmark` integer continues to work.
2. **Sub-chapter** (new): via `ReadingPosition` with `progress` — shows events from all prior chapters, plus current chapter events where `chapterProgress <= progress`.

The UI offers:
- Tapping on a specific event to set "I've read up to here"
- A slider within the current chapter
- Chapter-level navigation (existing behavior preserved)

### Kindle / page number mapping

Not in scope for this iteration. The chapter + progress model provides sufficient granularity. The event descriptions and `textAnchor` let users identify where they are in the text.

## Timeline UI Changes

### Layout

The `StoryTimeline` component changes from one card per chapter to **multiple event cards grouped under chapter headers**.

```
Ch 12 — The Battle of Ceres
  ● Holden and Naomi arrive at Ceres docks...
    [Holden] [Naomi] [Ceres Station]
  ● Miller confronts the detective squad...
    [Miller] [Ceres Station]
  ● Explosion in the tunnels, Holden separated...
    [Holden] [Miller] [Ceres Station]

Ch 13 — Aftermath
  ● Single event for short chapter...
    [Amos] [Rocinante]
```

### Rendering rules

- Chapter heading is a group header (title + chapter number), not a clickable card
- Each event gets its own dot marker on the timeline vertical line
- Entity tags on each event show only characters/locations from THAT event's delta
- Clicking an event card jumps to that chapter (same `onJumpToChapter` behavior)
- Clicking entity tags opens existing modals (CharacterModal, LocationModal, NarrativeArcModal)

### Reading position filtering

- Events beyond the user's `ReadingPosition` are **hidden** (not greyed out — hidden to avoid spoilers)
- The last visible event gets the "current" amber highlight
- If no sub-chapter progress is set, all events in the bookmarked chapter are shown

### Backward compatibility

- Snapshots without `events` (pre-existing data) render as today: single card with `result.summary` and entity tags derived by diffing against the previous snapshot
- No data migration required — old snapshots just have coarser granularity

## Scope

### In scope

1. New `ChapterEvent` and `ReadingPosition` types in `types/index.ts`
2. Pipeline change in `app/api/analyze/route.ts`: capture chunk deltas as events in the processing loop
3. `Snapshot.events` populated during analysis
4. `StoryTimeline` component updated to render multiple events per chapter
5. Reading position extended from chapter index to chapter + progress
6. Position filtering in timeline

### Out of scope

- No new extraction prompts or schemas — reuses existing 3-pass delta pipeline
- No changes to entity modals (CharacterModal, LocationModal, NarrativeArcModal) — they use `snapshot.result` as before
- No Kindle location parsing
- No migration of existing snapshots
- No changes to the map or pin system
- No event type taxonomy (movement/conflict/revelation)
- No changes to cloud model behavior — single-chunk chapters still produce one event
