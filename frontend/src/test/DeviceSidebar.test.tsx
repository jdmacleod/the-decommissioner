import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceSidebar } from '../components/DeviceSidebar'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDevices: vi.fn(),
  getDependencies: vi.fn(),
  getStorageTargets: vi.fn(),
  getDevicePhotoUrl: (id: number) => `/api/devices/${id}/photo`,
}))

import { getDevices, getDependencies, getStorageTargets } from '../lib/api'

const mockDep = (name: string, status: 'found' | 'missing') => ({
  id: 1,
  name,
  status,
  version: null,
  required_for: '[]',
  install_hint: `install ${name}`,
  checked_at: '',
})

import type { DeviceStage, DeviceType } from '../types/api'

const makeDevice = (
  id: number,
  name: string,
  stage: DeviceStage = 'registered',
  device_type: DeviceType = 'mac'
) => ({
  id,
  name,
  stage,
  device_type,
  source_path: null,
  serial_number: null,
  notes: null,
  storage_type: 'unknown' as const,
  created_at: '',
  updated_at: '',
})

beforeEach(() => {
  vi.mocked(getDevices).mockResolvedValue([])
  vi.mocked(getDependencies).mockResolvedValue([])
  vi.mocked(getStorageTargets).mockResolvedValue([])
})

describe('DeviceSidebar', () => {
  it('renders the logo link', () => {
    renderWithProviders(<DeviceSidebar />)
    expect(screen.getByText(/the-decommissioner/)).toBeInTheDocument()
  })

  it('shows "No devices yet" when empty', async () => {
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText(/No devices yet/i)).toBeInTheDocument())
  })

  it('shows device names', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice(1, 'My MBP')])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText('My MBP')).toBeInTheDocument())
  })

  it('highlights active device', async () => {
    vi.mocked(getDevices).mockResolvedValue([makeDevice(3, 'Active')])
    renderWithProviders(<DeviceSidebar />, { initialPath: '/devices/3', routePath: '/devices/:id' })
    await waitFor(() => {
      const link = screen.getByText('Active').closest('a')
      expect(link?.className).toContain('bg-gray-800')
    })
  })

  it('shows Add Device link', async () => {
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText(/Add Device/i)).toBeInTheDocument())
  })

  it('shows Settings link', async () => {
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText(/Settings/i)).toBeInTheDocument())
  })

  it('shows Help link with correct href', async () => {
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText('? Help')).toBeInTheDocument())
    const helpLink = screen.getByText('? Help').closest('a')
    expect(helpLink).toHaveAttribute('href', 'https://github.com/jdmacleod/the-decommissioner')
    expect(helpLink).toHaveAttribute('target', '_blank')
  })

  it('shows dep names in health footer', async () => {
    vi.mocked(getDependencies).mockResolvedValue([mockDep('restic', 'missing')])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText('restic')).toBeInTheDocument())
    expect(screen.getByText('Health')).toBeInTheDocument()
  })

  it('shows found deps in health section', async () => {
    vi.mocked(getDependencies).mockResolvedValue([mockDep('restic', 'found')])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText('restic')).toBeInTheDocument())
    expect(screen.getByText('Health')).toBeInTheDocument()
  })

  it('shows different stage dots', async () => {
    vi.mocked(getDevices).mockResolvedValue([
      makeDevice(1, 'Cataloging', 'cataloging'),
      makeDevice(2, 'Wiped', 'wiped'),
      makeDevice(3, 'Registered', 'registered'),
    ])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => screen.getByText('Cataloging'))
    expect(screen.getByText('Wiped')).toBeInTheDocument()
  })

  it('shows photo thumbnail in sidebar when photo_path is set', async () => {
    vi.mocked(getDevices).mockResolvedValue([
      { ...makeDevice(1, 'My MBP'), photo_path: '/data/photos/device_1.jpg' },
    ])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => screen.getByText('My MBP'))
    const img = screen.getByRole('img', { name: 'My MBP' })
    expect(img).toHaveAttribute('src', expect.stringContaining('/api/devices/1/photo'))
  })

  it('shows emoji icon when no photo_path', async () => {
    vi.mocked(getDevices).mockResolvedValue([{ ...makeDevice(1, 'My MBP'), photo_path: null }])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => screen.getByText('My MBP'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows network_volume device in sidebar', async () => {
    vi.mocked(getDevices).mockResolvedValue([
      makeDevice(1, 'NAS Share', 'cataloged', 'network_volume'),
    ])
    renderWithProviders(<DeviceSidebar />)
    await waitFor(() => expect(screen.getByText('NAS Share')).toBeInTheDocument())
  })
})
