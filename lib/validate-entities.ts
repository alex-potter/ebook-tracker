/**
 * Text-grounding validation for AI-extracted entities.
 * Drops characters/locations whose names don't appear in the source text (likely hallucinations).
 */

import type { AnalysisResult } from '@/types';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate that each character's name (or at least one alias) actually appears in the chapter text.
 * Characters whose names don't appear are likely hallucinations and get dropped.
 */
export function validateCharactersAgainstText(
  chars: AnalysisResult['characters'],
  chapterText: string,
): { validated: AnalysisResult['characters']; dropped: string[] } {
  const textLower = chapterText.toLowerCase();
  const validated: AnalysisResult['characters'] = [];
  const dropped: string[] = [];

  for (const char of chars) {
    const allNames = [char.name, ...(char.aliases ?? [])].filter(Boolean);

    if (allNames.length === 0) { dropped.push('(unnamed)'); continue; }

    let isGrounded = allNames.some((name) => {
      const nameLower = name.toLowerCase().trim();
      if (nameLower.length < 2) return false;
      // Short names (<=5 chars): require word boundaries to avoid "Arin" matching "staring"
      if (nameLower.length <= 5) {
        const pattern = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'i');
        return pattern.test(chapterText);
      }
      // Longer names: substring containment is sufficient
      return textLower.includes(nameLower);
    });

    // Fallback for multi-word names: check the LONGEST word (most distinctive).
    // Generic titles like "Lord", "Sir", "Captain" are short and filtered by the
    // length >= 3 requirement, while distinctive identifiers like "Stormblessed"
    // or "Shattered" are typically the longest word in the name.
    if (!isGrounded && char.name.split(/\s+/).length > 1) {
      const words = char.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const longest = words.reduce((a, b) => (a.length >= b.length ? a : b));
        const pattern = new RegExp(`\\b${escapeRegex(longest.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }

    if (isGrounded) {
      validated.push(char);
    } else {
      dropped.push(char.name);
    }
  }

  return { validated, dropped };
}

/**
 * Validate that each location's name (or at least one alias) actually appears in the chapter text.
 * Locations whose names don't appear are likely hallucinations and get dropped.
 */
export function validateLocationsAgainstText(
  locs: NonNullable<AnalysisResult['locations']>,
  chapterText: string,
): { validated: NonNullable<AnalysisResult['locations']>; dropped: string[] } {
  const textLower = chapterText.toLowerCase();
  const validated: NonNullable<AnalysisResult['locations']> = [];
  const dropped: string[] = [];

  for (const loc of locs) {
    const allNames = [loc.name, ...(loc.aliases ?? [])].filter(Boolean);

    if (allNames.length === 0) { dropped.push('(unnamed)'); continue; }

    let isGrounded = allNames.some((name) => {
      const nameLower = name.toLowerCase().trim();
      if (nameLower.length < 2) return false;
      // Names ≤5 chars: require word boundaries to avoid false positives
      if (nameLower.length <= 5) {
        const pattern = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'i');
        return pattern.test(chapterText);
      }
      // Longer names: substring containment is sufficient
      return textLower.includes(nameLower);
    });

    // Fallback for multi-word names: check the LONGEST word (most distinctive).
    // Place-type suffixes like "Plains", "Hills", "City" are often generic,
    // while the longest word (e.g. "Shattered", "Unclaimed") is more distinctive.
    if (!isGrounded && loc.name.split(/\s+/).length > 1) {
      const words = loc.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const longest = words.reduce((a, b) => (a.length >= b.length ? a : b));
        const pattern = new RegExp(`\\b${escapeRegex(longest.toLowerCase())}\\b`, 'i');
        isGrounded = pattern.test(chapterText);
      }
    }

    if (isGrounded) {
      validated.push(loc);
    } else {
      dropped.push(loc.name);
    }
  }

  return { validated, dropped };
}
