import type { Character, LocationInfo, Snapshot } from '@/types';

/**
 * Build a map from any known location name / alias (lowercased) → canonical name.
 * The canonical name is the longest form seen across all snapshot location entries.
 * Use this to normalise location strings read from older snapshots where the AI
 * may have used a short alias before the full name was established.
 *
 * If `currentLocations` is provided, their names override the longest-name heuristic
 * so that user renames/merges are respected even when the chosen name is shorter.
 */
export function buildLocationAliasMap(
  snapshots: Snapshot[],
  currentLocations?: LocationInfo[],
): Map<string, string> {
  // group key (lowercased) → canonical name (longest form)
  const canonicalByKey = new Map<string, string>();

  function norm(s: string) { return s.toLowerCase().trim(); }

  function register(names: string[]) {
    // Find if any name is already known
    let existingKey: string | undefined;
    for (const n of names) {
      if (canonicalByKey.has(norm(n))) { existingKey = norm(n); break; }
    }
    // Canonical = longest name in this cluster
    const canonical = names.reduce((a, b) => a.length >= b.length ? a : b);
    const allKeys = [...new Set(names.map(norm))];
    if (existingKey) {
      // Merge: update all keys to point to the longer canonical
      const existing = canonicalByKey.get(existingKey)!;
      const merged = canonical.length >= existing.length ? canonical : existing;
      for (const k of allKeys) canonicalByKey.set(k, merged);
      // Also update any keys already pointing to the old canonical
      for (const [k, v] of canonicalByKey) {
        if (v === existing && merged !== existing) canonicalByKey.set(k, merged);
      }
    } else {
      for (const k of allKeys) canonicalByKey.set(k, canonical);
    }
  }

  for (const snap of snapshots) {
    for (const loc of snap.result.locations ?? []) {
      if (!loc.name) continue;
      register([loc.name, ...(loc.aliases ?? [])]);
    }
  }

  // Override canonical names with the current result's names (user intent)
  if (currentLocations) {
    for (const loc of currentLocations) {
      const key = loc.name.toLowerCase().trim();
      const current = canonicalByKey.get(key);
      if (current && current !== loc.name) {
        // Replace all references to the old canonical with the user's chosen name
        for (const [k, v] of canonicalByKey) {
          if (v === current) canonicalByKey.set(k, loc.name);
        }
      }
    }
  }

  return canonicalByKey;
}

/** Resolve a location string to its canonical name using the alias map. */
export function resolveLocationName(name: string | undefined, aliasMap: Map<string, string>): string | undefined {
  if (!name) return name;
  return aliasMap.get(name.toLowerCase().trim()) ?? name;
}

/**
 * For each character whose currentLocation is absent or 'Unknown',
 * scan backwards through snapshots to find their last confirmed location.
 * Returns a new array; characters with known locations are returned unchanged.
 */
export function withResolvedLocations(
  characters: Character[],
  snapshots: Snapshot[],
): Character[] {
  if (characters.length === 0 || snapshots.length === 0) return characters;

  // Sort newest-first so we find the most recent known location quickly
  const sorted = [...snapshots].sort((a, b) => b.index - a.index);

  return characters.map((c) => {
    const loc = c.currentLocation?.trim();
    if (loc && loc !== 'Unknown') return c;

    for (const snap of sorted) {
      const match = snap.result.characters.find((sc) => sc.name === c.name);
      if (match) {
        const ml = match.currentLocation?.trim();
        if (ml && ml !== 'Unknown') return { ...c, currentLocation: ml };
      }
    }
    return c;
  });
}

/**
 * Remap character currentLocation values that don't match any extracted location
 * to a matching extracted location, using description-based matching as fallback.
 * This catches cases where the LLM sets currentLocation to a generic sub-location
 * (e.g. "castle", "feast hall") instead of the canonical location name.
 */
export function resolveCharacterLocationsToExtracted(
  characters: Character[],
  locations: LocationInfo[],
): Character[] {
  if (!locations?.length) return characters;

  // Build a set of known location names and aliases (lowercased)
  const knownNames = new Set<string>();
  for (const loc of locations) {
    knownNames.add(loc.name.toLowerCase().trim());
    for (const alias of loc.aliases ?? []) {
      knownNames.add(alias.toLowerCase().trim());
    }
  }

  return characters.map((c) => {
    const curLoc = c.currentLocation?.trim();
    if (!curLoc || curLoc === 'Unknown') return c;

    // Already matches a known location name/alias
    if (knownNames.has(curLoc.toLowerCase())) return c;

    // Fallback 1: check if currentLocation appears in any location's description
    const curLocLower = curLoc.toLowerCase();
    const descMatches = locations.filter((l) =>
      l.description?.toLowerCase().includes(curLocLower),
    );
    if (descMatches.length === 1) {
      return { ...c, currentLocation: descMatches[0].name };
    }

    // Fallback 2: if only one location was extracted, use it
    if (locations.length === 1) {
      return { ...c, currentLocation: locations[0].name };
    }

    return c;
  });
}
