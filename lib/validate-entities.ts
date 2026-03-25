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
    const allNames = [char.name, ...(char.aliases ?? [])];

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

    // Fallback for multi-word names: check individual significant words.
    // Require the LAST word (most likely a surname/distinctive identifier) to appear,
    // not just any word — otherwise generic titles like "Lord", "Sir", "Captain"
    // let hallucinated names through.
    if (!isGrounded && char.name.split(/\s+/).length > 1) {
      const words = char.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const surname = words[words.length - 1];
        const pattern = new RegExp(`\\b${escapeRegex(surname.toLowerCase())}\\b`, 'i');
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
    const allNames = [loc.name, ...(loc.aliases ?? [])];

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

    // Fallback for multi-word names: check last word (most distinctive part)
    if (!isGrounded && loc.name.split(/\s+/).length > 1) {
      const words = loc.name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        const lastWord = words[words.length - 1];
        const pattern = new RegExp(`\\b${escapeRegex(lastWord.toLowerCase())}\\b`, 'i');
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
