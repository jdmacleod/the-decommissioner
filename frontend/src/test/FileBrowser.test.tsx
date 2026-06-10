import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileBrowser } from '../stages/FileBrowser'
import { renderWithProviders } from './helpers'

// TanStack Virtual needs ResizeObserver in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('../lib/api', () => ({
  getDevice: vi.fn(),
  getFileEntries: vi.fn(),
  bulkUpdateFileStatus: vi.fn(),
}))

import { getDevice, getFileEntries, bulkUpdateFileStatus } from '../lib/api'

const mockDevice = {
  id: 1, name: 'My Drive', device_type: 'hard_drive' as const, stage: 'cataloged' as const,
  source_path: '/data', serial_number: null, notes: null, storage_type: 'unknown' as const, created_at: '', updated_at: '',
}

import type { FileStatus } from '../types/api'

const makeEntry = (id: number, path: string, status: FileStatus = 'pending') => ({
  id, path, relative_path: path.replace('/data/', ''),
  size_bytes: 1024, sha256: 'abc', mime_type: null, status, device_id: 1,
  duplicate_group_id: null,
})

const mockPage = {
  items: [makeEntry(1, '/data/file1.txt'), makeEntry(2, '/data/photo.jpg', 'keep')],
  total: 2, page: 0, limit: 500,
}

beforeEach(() => {
  vi.mocked(getDevice).mockResolvedValue(mockDevice)
  vi.mocked(getFileEntries).mockResolvedValue(mockPage)
  vi.mocked(bulkUpdateFileStatus).mockResolvedValue({ updated: 1 })
})

describe('FileBrowser', () => {
  it('shows File Browser heading', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => expect(screen.getByText('File Browser')).toBeInTheDocument())
  })

  it('shows device name breadcrumb', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => expect(screen.getByText(/My Drive/)).toBeInTheDocument())
  })

  it('shows file count', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => expect(screen.getByText(/2 files/)).toBeInTheDocument())
  })

  it('shows search input', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('shows Save button', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows Go to Duplicates button', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    expect(screen.getByRole('button', { name: /Duplicates/i })).toBeInTheDocument()
  })

  it('debounces search and calls getFileEntries', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByPlaceholderText(/search/i))
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'photo')
    await waitFor(() => expect(getFileEntries).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'photo' })
    ), { timeout: 1000 })
  })

  it('shows Go to Duplicates and Save buttons', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    // Clicking Save with no pending changes — should not throw
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows 0 files when empty', async () => {
    vi.mocked(getFileEntries).mockResolvedValue({ items: [], total: 0, page: 0, limit: 500 })
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => expect(screen.getByText(/0 files/)).toBeInTheDocument())
  })

  it('filters by status when select changes', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    const select = screen.getByRole('combobox')
    await import('@testing-library/user-event').then(({ default: u }) => u.selectOptions(select, 'keep'))
    await waitFor(() => expect(getFileEntries).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'keep' })
    ))
  })

  it('shows Go to Duplicates button navigates', async () => {
    renderWithProviders(<FileBrowser />, { initialPath: '/devices/1/files', routePath: '/devices/:id/files' })
    await waitFor(() => screen.getByText('File Browser'))
    expect(screen.getByRole('button', { name: /Duplicates/i })).toBeInTheDocument()
    await import('@testing-library/user-event').then(({ default: u }) =>
      u.click(screen.getByRole('button', { name: /Duplicates/i }))
    )
    await waitFor(() => expect(screen.getByTestId('navigated')).toBeInTheDocument())
  })
})
