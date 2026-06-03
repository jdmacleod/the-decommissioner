import { describe, it, expect } from 'vitest'
import { formatBytes } from './utils'

describe('formatBytes', () => {
  it('formats bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats values in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(1024 ** 2 - 1)).toMatch(/ KB$/)
  })

  it('formats values in MB range', () => {
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(2000000)).toBe('1.9 MB')
  })

  it('formats values in GB range', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.00 GB')
  })
})
