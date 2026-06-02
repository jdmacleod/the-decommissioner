import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Dashboard } from '../pages/Dashboard'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDevices: vi.fn(),
}))

import { getDevices } from '../lib/api'

const makeDevice = (overrides = {}) => ({
  id: 1, name: 'Test MBP', device_type: 'mac' as const, stage: 'registered' as const,
  source_path: '/Users/test', serial_number: null, notes: null, staging_path: null,
  created_at: '2024-01-01', updated_at: '2024-01-01',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getDevices).mockResolvedValue([])
})

describe('Dashboard', () => {
  it('shows empty state when no devices', async () => {
    renderWithProviders(<Dashboard />)
    await waitFor(() => expect(screen.getByText(/No devices yet/)).toBeInTheDocument())
  })

  it('shows Add Device link', async () => {
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText(/No devices yet/))
    expect(screen.getAllByText(/Add/i).length).toBeGreaterThan(0)
  })

  it('renders device cards when devices exist', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice()])
    renderWithProviders(<Dashboard />)
    await waitFor(() => expect(screen.getByText('Test MBP')).toBeInTheDocument())
  })

  it('shows device stage label in card', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice()])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText('Not started'))
  })

  it('shows next action button for cataloged device', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice({ stage: 'cataloged' })])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText(/Review Files/i))
  })

  it('shows source path when present', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice({ source_path: '/Volumes/Disk' })])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText('/Volumes/Disk'))
  })

  it('shows device without source path', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice({ source_path: null })])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText('Test MBP'))
    expect(screen.queryByText(/Volumes/)).not.toBeInTheDocument()
  })

  it('groups devices by stage', async () => {
    vi.mocked(getDevices).mockResolvedValue([
      makeDevice({ id: 1, name: 'A', stage: 'registered' }),
      makeDevice({ id: 2, name: 'B', stage: 'migrating' }),
    ])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText('A'))
    // Catalog column should show (1)
    expect(screen.getByText('Catalog (1)')).toBeInTheDocument()
    // Migrate column should show (1)
    expect(screen.getByText('Migrate (1)')).toBeInTheDocument()
  })

  it('shows empty column label for empty stage group', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice()])
    renderWithProviders(<Dashboard />)
    await waitFor(() => screen.getByText('Test MBP'))
    expect(screen.getByText('Wipe (0)')).toBeInTheDocument()
  })
})
