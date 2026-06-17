import type { DuplicateGroup, FileEntryBrief } from '../types/api'

const FOLDER_SCORES: Record<string, number> = {
  Documents: 10,
  Desktop: 8,
  Pictures: 7,
  Movies: 7,
  Music: 7,
  Downloads: 6,
  home: 5,
  Users: 5,
  private: 2,
  var: 1,
  tmp: 1,
}

export function pathScore(path: string): number {
  // Take the MAX score across all recognized segments.
  // Reason: macOS paths like /Users/jason/Documents/... must score as 'Documents' (10),
  // not 'Users' (5) which appears earlier in the path.
  // Use null accumulator so that explicitly-bad segments (tmp=1, var=1) can score below
  // the default-4 for unrecognized paths. With Math.max(4, 1), /tmp would incorrectly
  // return 4 instead of 1.
  let best: number | null = null
  for (const segment of path.split('/')) {
    const score = FOLDER_SCORES[segment]
    if (score !== undefined) best = best === null ? score : Math.max(best, score)
  }
  return best ?? 4 // default: somewhere on disk, not a recognized location
}

export function confidence(group: DuplicateGroup): number {
  if (group.entries.length < 2) return 10 // no ambiguity
  const scores = group.entries.map((e) => pathScore(e.path))
  scores.sort((a, b) => b - a)
  return scores[0] - scores[1] // 0 = tied, higher = clearer winner
}

export const LOW_CONFIDENCE_THRESHOLD = 1

export function suggestedKeeper(group: DuplicateGroup): FileEntryBrief {
  if (group.entries.length < 2) return group.entries[0]
  return group.entries.reduce((best, entry) => {
    const bScore = pathScore(best.path)
    const eScore = pathScore(entry.path)
    if (eScore > bScore) return entry
    // ISO string comparison: lexicographic order is correct for ISO 8601
    if (eScore === bScore && entry.mtime > best.mtime) return entry
    return best
  })
}
