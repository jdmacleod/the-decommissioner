import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getDevices, getDevice, createDevice, updateDevice, deleteDevice,
  getJob, triggerJob, cancelJob,
  getFileEntries, bulkUpdateFileStatus,
  getDuplicateGroups, resolveGroup, autoResolveGroups, getDupStats,
  getDependencies, recheckDependencies,
} from '../lib/api'

function mockFetch(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('api request helper', () => {
  it('throws on non-ok response', async () => {
    mockFetch({ detail: 'Not found' }, false, 404)
    await expect(getDevice(99)).rejects.toThrow('404')
  })
})

describe('devices API', () => {
  it('getDevices calls /api/devices', async () => {
    mockFetch([])
    const result = await getDevices()
    expect(result).toEqual([])
    expect(fetch).toHaveBeenCalledWith('/api/devices', expect.any(Object))
  })

  it('getDevice calls /api/devices/:id', async () => {
    mockFetch({ id: 1, name: 'Test' })
    const result = await getDevice(1)
    expect(result).toMatchObject({ id: 1 })
  })

  it('createDevice POSTs to /api/devices', async () => {
    mockFetch({ id: 2, name: 'New', device_type: 'mac' })
    const result = await createDevice({ name: 'New', device_type: 'mac' })
    expect(result).toMatchObject({ id: 2 })
    expect(fetch).toHaveBeenCalledWith('/api/devices', expect.objectContaining({ method: 'POST' }))
  })

  it('updateDevice PATCHes /api/devices/:id', async () => {
    mockFetch({ id: 1, name: 'Updated' })
    await updateDevice(1, { name: 'Updated' })
    expect(fetch).toHaveBeenCalledWith('/api/devices/1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('deleteDevice calls DELETE on /api/devices/:id', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    await deleteDevice(1)
    expect(fetch).toHaveBeenCalledWith('/api/devices/1', expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('jobs API', () => {
  it('getJob calls /api/jobs/:id', async () => {
    mockFetch({ id: 5, status: 'pending' })
    const result = await getJob(5)
    expect(result).toMatchObject({ id: 5 })
  })

  it('triggerJob POSTs to /api/devices/:id/jobs', async () => {
    mockFetch({ job_id: 10, status: 'pending' })
    const result = await triggerJob(3, 'catalog')
    expect(result.job_id).toBe(10)
    expect(fetch).toHaveBeenCalledWith('/api/devices/3/jobs', expect.objectContaining({ method: 'POST' }))
  })

  it('cancelJob POSTs to /api/jobs/:id/cancel', async () => {
    mockFetch({ job_id: 5, status: 'cancellation_requested' })
    await cancelJob(5)
    expect(fetch).toHaveBeenCalledWith('/api/jobs/5/cancel', expect.objectContaining({ method: 'POST' }))
  })
})

describe('file entries API', () => {
  it('getFileEntries builds correct query string', async () => {
    mockFetch({ items: [], total: 0, page: 1, limit: 50 })
    await getFileEntries({ device_id: 1, page: 2, limit: 100, status: 'keep', search: 'img' })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('device_id=1')
    expect(url).toContain('page=2')
    expect(url).toContain('status=keep')
    expect(url).toContain('search=img')
  })

  it('getFileEntries without optional params', async () => {
    mockFetch({ items: [], total: 0, page: 1, limit: 50 })
    await getFileEntries({ device_id: 2 })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('device_id=2')
    expect(url).not.toContain('status=')
  })

  it('bulkUpdateFileStatus PATCHes /api/file-entries', async () => {
    mockFetch({ updated: 3 })
    const result = await bulkUpdateFileStatus([{ id: 1, status: 'keep' }])
    expect(result.updated).toBe(3)
    expect(fetch).toHaveBeenCalledWith('/api/file-entries', expect.objectContaining({ method: 'PATCH' }))
  })
})

describe('duplicate groups API', () => {
  it('getDuplicateGroups builds query with resolved param', async () => {
    mockFetch([])
    await getDuplicateGroups(1, false)
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('resolved=false')
  })

  it('getDuplicateGroups without resolved param', async () => {
    mockFetch([])
    await getDuplicateGroups(1)
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).not.toContain('resolved=')
  })

  it('resolveGroup PATCHes /api/duplicate-groups/:id', async () => {
    mockFetch({ id: 1, resolved: true })
    await resolveGroup(1, 5)
    expect(fetch).toHaveBeenCalledWith('/api/duplicate-groups/1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('autoResolveGroups POSTs to /api/duplicate-groups/:id/auto-resolve', async () => {
    mockFetch({ resolved: 2, remaining: 0 })
    await autoResolveGroups(3)
    expect(fetch).toHaveBeenCalledWith('/api/duplicate-groups/3/auto-resolve', expect.objectContaining({ method: 'POST' }))
  })

  it('getDupStats calls /api/duplicate-groups/stats/:id', async () => {
    mockFetch({ total: 5, resolved: 3, unresolved: 2 })
    const result = await getDupStats(1)
    expect(result.total).toBe(5)
  })
})

describe('dependencies API', () => {
  it('getDependencies calls /api/dependencies', async () => {
    mockFetch([{ id: 1, name: 'restic', status: 'found' }])
    const result = await getDependencies()
    expect(result[0].name).toBe('restic')
  })

  it('recheckDependencies POSTs to /api/dependencies/recheck', async () => {
    mockFetch([])
    await recheckDependencies()
    expect(fetch).toHaveBeenCalledWith('/api/dependencies/recheck', expect.objectContaining({ method: 'POST' }))
  })
})
