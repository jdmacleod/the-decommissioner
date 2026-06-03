import { describe, it, expect } from 'vitest'
import { pathScore, confidence, suggestedKeeper, LOW_CONFIDENCE_THRESHOLD } from './dupHeuristic'
import type { DuplicateGroup } from '../types/api'

function makeGroup(paths: string[], mtimes?: string[]): DuplicateGroup {
  return {
    id: 1,
    content_hash: 'abc',
    canonical_entry_id: null,
    resolved: false,
    auto_resolved: false,
    total_size_bytes: paths.length * 1000,
    entries: paths.map((path, i) => ({
      id: i + 1,
      path,
      relative_path: path.split('/').pop() ?? '',
      size_bytes: 1000,
      mtime: mtimes?.[i] ?? '2020-01-01T00:00:00Z',
      device_id: 1,
      status: 'pending' as const,
    })),
  }
}

describe('pathScore', () => {
  it('returns 10 for Documents segment', () => {
    expect(pathScore('/Users/jason/Documents/report.pdf')).toBe(10)
  })

  it('returns max across all segments, not first-match', () => {
    // Users=5, Documents=10 — should return 10, not 5
    expect(pathScore('/Users/jason/Documents/report.pdf')).toBe(10)
  })

  it('returns 8 for Desktop', () => {
    expect(pathScore('/Users/jason/Desktop/file.txt')).toBe(8)
  })

  it('returns 1 for tmp segment', () => {
    expect(pathScore('/tmp/file.txt')).toBe(1)
  })

  it('scores by segment name, not substring — /var/folders/.../tmp/file returns 1', () => {
    expect(pathScore('/var/folders/xyz/tmp/file.dat')).toBe(1)
  })

  it('returns default 4 when no segment matches', () => {
    expect(pathScore('/some/random/path/file.txt')).toBe(4)
  })

  it('handles paths with only the segment name', () => {
    expect(pathScore('Documents')).toBe(10)
  })
})

describe('confidence', () => {
  it('returns 10 for single-entry group', () => {
    const group = makeGroup(['/tmp/file.txt'])
    expect(confidence(group)).toBe(10)
  })

  it('returns 0 for tied paths', () => {
    const group = makeGroup(['/tmp/a.txt', '/tmp/b.txt'])
    expect(confidence(group)).toBe(0)
  })

  it('returns high delta for clear winner', () => {
    const group = makeGroup([
      '/Users/jason/Documents/report.pdf', // score 10
      '/tmp/report.pdf',                   // score 1
    ])
    expect(confidence(group)).toBe(9)
  })

  it('returns low delta for close paths', () => {
    const group = makeGroup([
      '/Users/jason/Documents/file.txt', // 10
      '/Users/jason/Desktop/file.txt',   // 8
    ])
    expect(confidence(group)).toBe(2)
  })
})

describe('LOW_CONFIDENCE_THRESHOLD', () => {
  it('is 1', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(1)
  })
})

describe('suggestedKeeper', () => {
  it('returns single entry for single-entry group', () => {
    const group = makeGroup(['/tmp/file.txt'])
    expect(suggestedKeeper(group).id).toBe(1)
  })

  it('prefers Documents over Downloads', () => {
    const group = makeGroup([
      '/Users/jason/Downloads/report.pdf', // score 6
      '/Users/jason/Documents/report.pdf', // score 10
    ])
    expect(suggestedKeeper(group).id).toBe(2)
  })

  it('uses mtime as tie-break when scores are equal', () => {
    const group = makeGroup(
      ['/tmp/a.txt', '/tmp/b.txt'],
      ['2020-01-01T00:00:00Z', '2023-06-15T12:00:00Z'],
    )
    // both score 1; newer mtime wins
    expect(suggestedKeeper(group).id).toBe(2)
  })

  it('handles equal score and equal mtime by returning whichever comes first via reduce', () => {
    const group = makeGroup(
      ['/tmp/a.txt', '/tmp/b.txt'],
      ['2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'],
    )
    // identical score and mtime — reduce keeps first (id=1)
    expect(suggestedKeeper(group).id).toBe(1)
  })
})
