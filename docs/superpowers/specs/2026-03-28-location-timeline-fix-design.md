# Fix: Location Timeline Empty for Early Chapters

## Problem

When processing a book (e.g. *The Way of Kings*), locations appear tagged in the StoryTimeline for early chapters (Kholinar, Shattered Plains, Unclaimed Hills) but clicking those tags opens a LocationModal with an empty timeline. The LocationBoard tab may also show no locations for those chapters. Additionally, the grounding validation drops valid locations when the LLM uses a canonical name that doesn't literally appear in the text.

## Root Cause

Two compounding issues:

### 1. LocationModal timeline filter is too strict

`LocationModal.tsx` line 142:
```typescript
if (present.length > 0 && (charsChanged || hasEvents))
```

This requires at least one character to have `currentLocation` set to the location name. If no character is physically stationed there (e.g. a character is *traveling through* rather than *at* a location), the entry is skipped even when `recentEvents` describes what happened.

The StoryTimeline uses a different, looser filter (only checks `recentEvents` changed from previous snapshot), which is why it displays locations correctly.

### 2. Location `recentEvents` is optional and grounding drops valid locations

- The schema says "Omit if nothing notable occurred here" -- so the LLM sometimes extracts a location without any `recentEvents`, making it invisible in both timeline views.
- The grounding validation multi-word fallback only checks the **last word** of a location name. For names like "The Shattered Plains", this checks `plains` but not `shattered` (the more distinctive word). This can cause valid locations to be dropped when neither the full name nor the last word appears verbatim.

## Design

### Part A: Relax LocationModal timeline filter

**File:** `components/LocationModal.tsx` line 142

Change:
```typescript
// Before: requires characters present AND (character change OR events)
if (present.length > 0 && (charsChanged || hasEvents))

// After: show if events exist, OR if characters changed at this location
if (hasEvents || (present.length > 0 && charsChanged))
```

This means:
- A location with `recentEvents` but no characters present: shows the event text (no character pills)
- A location with characters but no events: shows when characters change (existing behavior)
- A location with both: shows both (existing behavior)

**No changes to LocationBoard.tsx** -- its filter at line 68 already uses OR logic (`!locEntry?.recentEvents && charsHere.length === 0` means "skip only if BOTH are missing").

### Part B1: Make `recentEvents` non-optional in location schemas

**Files:** `app/api/analyze/route.ts` lines 116 and 131

Change the `recentEvents` field instruction in both `LOCATION_SCHEMA` and `LOCATION_DELTA_SCHEMA` from:

> "1-2 sentences describing what happened at this location in the current chapter. Omit if nothing notable occurred here."

To:

> "1-2 sentences describing what happened at this location in the current chapter. Always provide this -- if you extracted this location, something relevant happened here."

Rationale: If the LLM decided a location is significant enough to extract, there must be something to say about it. Making this always-provide ensures every extracted location has timeline content.

### Part B2: Improve grounding validation multi-word fallback

**File:** `lib/validate-entities.ts` lines 90-97

Change the multi-word name fallback from checking only the **last word** to checking the **longest word** (most distinctive). For location names, the longest word is typically the most unique identifier.

Current behavior:
- "The Shattered Plains" -> checks `\bplains\b` (last word)
- "Unclaimed Hills" -> checks `\bhills\b` (last word)

New behavior:
- "The Shattered Plains" -> checks `\bshattered\b` (longest word, 9 chars)
- "Unclaimed Hills" -> checks `\bunclaimed\b` (longest word, 9 chars)

This is more resilient because the longest word in a place name is almost always the most distinctive part, while last words like "Plains", "Hills", "City" are generic.

Apply the same change to `validateCharactersAgainstText` (lines 43-50) for consistency, since the same logic applies to character names.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `components/LocationModal.tsx` | 142 | Relax filter: `hasEvents \|\| (present.length > 0 && charsChanged)` |
| `app/api/analyze/route.ts` | 116 | `recentEvents` instruction: always provide |
| `app/api/analyze/route.ts` | 131 | Same for delta schema |
| `lib/validate-entities.ts` | 90-97 | Multi-word fallback: longest word instead of last word |
| `lib/validate-entities.ts` | 43-50 | Same change for character validation (consistency) |

## Testing

- Process a book with early chapters that reference locations indirectly (e.g. *The Way of Kings*)
- Verify locations appear in LocationModal timeline for early chapters
- Verify clicking location tags in StoryTimeline shows non-empty modal timelines
- Verify the "Dropped N ungrounded locations" log count decreases for books with multi-word location names
- Verify no false-positive locations are introduced by the grounding change (longest word should be more distinctive, not less)

## Out of Scope

- Automatic `currentLocation` inference from location data (separate concern)
- Changes to the StoryTimeline display (already works correctly)
- Client-side analysis schemas in `lib/ai-shared.ts` (no `recentEvents` field there; separate feature)
