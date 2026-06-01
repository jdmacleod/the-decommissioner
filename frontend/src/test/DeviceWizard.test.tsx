import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceWizard } from '../pages/DeviceWizard'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDevice: vi.fn(),
  getDupStats: vi.fn(),
  triggerJob: vi.fn(),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => <div data-testid={`job-log-${jobId}`}>JobLog</div>,
}))

import { getDevice, getDupStats, triggerJob } from '../lib/api'

const makeDevice = (overrides = {}) => ({
  id: 1, name: 'Test MBP', device_type: 'mac' as const, stage: 'registered' as const,
  source_path: '/Users/test', serial_number: null, notes: null,
  created_at: '', updated_at: '',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getDevice).mockResolvedValue(makeDevice())
  vi.mocked(getDupStats).mockResolvedValue({ total: 0, resolved: 0, unresolved: 0 })
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 99, status: 'pending' })
})

describe('DeviceWizard', () => {
  it('shows loading state initially', () => {
    vi.mocked(getDevice).mockImplementation(() => new Promise(() => {}))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
  })

  it('shows device name after loading', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => expect(screen.getByText('Test MBP')).toBeInTheDocument())
  })

  it('shows stage progress bar', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText('Test MBP'))
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })

  it('shows Start Catalog button for registered device with source', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByRole('button', { name: /start catalog/i }))
  })

  it('triggers catalog job on button click', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByRole('button', { name: /start catalog/i }))
    await userEvent.click(screen.getByRole('button', { name: /start catalog/i }))
    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith(1, 'catalog'))
  })

  it('shows no source path warning when source_path is null', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ source_path: null }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/No source path set/))
  })

  it('shows catalog complete for cataloged stage', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Catalog complete/))
  })

  it('shows duplicate count when stats are available', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    vi.mocked(getDupStats).mockResolvedValue({ total: 3, resolved: 1, unresolved: 2 })
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/3 duplicate groups found/))
  })

  it('shows migrate section as active when analyzed', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'analyzed' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/configure a storage target/i))
  })

  it('shows cataloging state when device is cataloging', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloging' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Starting catalog job/i))
  })
})
