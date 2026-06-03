import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DuplicateResolver } from '../pages/DuplicateResolver'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDevice: vi.fn(),
  getDuplicateGroups: vi.fn(),
  getDupStats: vi.fn(),
  resolveGroup: vi.fn(),
  autoResolveGroups: vi.fn(),
}))

vi.mock('../pages/DuplicateTriageMode', () => ({
  DuplicateTriageMode: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="triage-overlay">
      <button onClick={onClose}>Exit triage</button>
    </div>
  ),
}))

import { getDevice, getDuplicateGroups, getDupStats, resolveGroup, autoResolveGroups } from '../lib/api'

const mockDevice = {
  id: 1, name: 'Test Drive', device_type: 'hard_drive' as const, stage: 'analyzing' as const,
  source_path: '/data', serial_number: null, notes: null, created_at: '', updated_at: '',
}

const mockGroup = {
  id: 10, content_hash: 'abc123deadbeef001234', canonical_entry_id: null, resolved: false,
  auto_resolved: false, total_size_bytes: 2000,
  entries: [
    { id: 1, path: '/data/file_a.txt', relative_path: 'file_a.txt', size_bytes: 1000, mtime: '', device_id: 1, status: 'pending' as const },
    { id: 2, path: '/data/file_b.txt', relative_path: 'file_b.txt', size_bytes: 1000, mtime: '', device_id: 1, status: 'pending' as const },
  ],
}

beforeEach(() => {
  vi.mocked(getDevice).mockResolvedValue(mockDevice)
  vi.mocked(getDuplicateGroups).mockResolvedValue([mockGroup])
  vi.mocked(getDupStats).mockResolvedValue({ total: 1, resolved: 0, unresolved: 1 })
  vi.mocked(resolveGroup).mockResolvedValue({ ...mockGroup, resolved: true, canonical_entry_id: 1 })
  vi.mocked(autoResolveGroups).mockResolvedValue({ resolved: 1, remaining: 0 })
})

describe('DuplicateResolver', () => {
  it('shows loading initially', () => {
    vi.mocked(getDuplicateGroups).mockImplementation(() => new Promise(() => {}))
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    expect(screen.getByText(/Loading groups/i)).toBeInTheDocument()
  })

  it('shows device name in breadcrumb', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText(/Test Drive/)).toBeInTheDocument())
  })

  it('shows Resolve Duplicates heading', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText('Resolve Duplicates')).toBeInTheDocument())
  })

  it('shows file paths in the current group', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText('/data/file_a.txt')).toBeInTheDocument())
    expect(screen.getByText('/data/file_b.txt')).toBeInTheDocument()
  })

  it('shows auto-resolve button', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    expect(screen.getByRole('button', { name: /auto-resolve all/i })).toBeInTheDocument()
  })

  it('calls autoResolveGroups on auto-resolve click', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByRole('button', { name: /auto-resolve all/i }))
    await userEvent.click(screen.getByRole('button', { name: /auto-resolve all/i }))
    await waitFor(() => expect(autoResolveGroups).toHaveBeenCalledWith(1))
  })

  it('shows all-resolved state when stats show all resolved', async () => {
    vi.mocked(getDuplicateGroups).mockResolvedValue([])
    vi.mocked(getDupStats).mockResolvedValue({ total: 2, resolved: 2, unresolved: 0 })
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText(/All duplicates resolved/i)).toBeInTheDocument())
  })

  it('shows "No unresolved" when no groups and stats has 0 total', async () => {
    vi.mocked(getDuplicateGroups).mockResolvedValue([])
    vi.mocked(getDupStats).mockResolvedValue({ total: 0, resolved: 0, unresolved: 0 })
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText(/No unresolved duplicate groups/i)).toBeInTheDocument())
  })

  it('shows "Keep this copy" button for each entry', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    const keepButtons = screen.getAllByTitle(/Keep this copy/i)
    expect(keepButtons.length).toBe(2)
  })

  it('calls resolveGroup when keep button is clicked', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getAllByTitle(/Keep this copy/i))
    const keepButtons = screen.getAllByTitle(/Keep this copy/i)
    await userEvent.click(keepButtons[0])
    await waitFor(() => expect(resolveGroup).toHaveBeenCalled())
  })

  it('shows resolved/remaining stats', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByText(/0 resolved/i)).toBeInTheDocument())
    expect(screen.getByText(/1 remaining/i)).toBeInTheDocument()
  })

  it('shows Show unresolved only checkbox', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.getByText(/Show unresolved only/)).toBeInTheDocument()
  })

  it('shows Skip button for unresolved group', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
  })

  it('shows Keep top button for unresolved group', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    expect(screen.getByRole('button', { name: /keep top/i })).toBeInTheDocument()
  })

  it('calls resolveGroup with first entry on Keep top click', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByRole('button', { name: /keep top/i }))
    await userEvent.click(screen.getByRole('button', { name: /keep top/i }))
    await waitFor(() => expect(resolveGroup).toHaveBeenCalledWith(10, 1))
  })

  it('shows Continue to Migration button when all resolved', async () => {
    vi.mocked(getDuplicateGroups).mockResolvedValue([])
    vi.mocked(getDupStats).mockResolvedValue({ total: 3, resolved: 3, unresolved: 0 })
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to Migration/i })).toBeInTheDocument())
  })

  it('shows Keyboard triage button in header', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    expect(screen.getByRole('button', { name: /keyboard triage/i })).toBeInTheDocument()
  })

  it('clicking Keyboard triage button mounts the triage overlay', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    await userEvent.click(screen.getByRole('button', { name: /keyboard triage/i }))
    expect(screen.getByTestId('triage-overlay')).toBeInTheDocument()
  })

  it('triage overlay is dismissed when onClose is called', async () => {
    renderWithProviders(<DuplicateResolver />, { initialPath: '/devices/1/duplicates', routePath: '/devices/:id/duplicates' })
    await waitFor(() => screen.getByText('/data/file_a.txt'))
    await userEvent.click(screen.getByRole('button', { name: /keyboard triage/i }))
    expect(screen.getByTestId('triage-overlay')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /exit triage/i }))
    expect(screen.queryByTestId('triage-overlay')).not.toBeInTheDocument()
  })
})
