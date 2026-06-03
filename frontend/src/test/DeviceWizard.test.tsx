import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceWizard } from '../pages/DeviceWizard'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDevice: vi.fn(),
  getDupStats: vi.fn(),
  triggerJob: vi.fn(),
  getDependencies: vi.fn(),
  getFileEntries: vi.fn(),
  clearStaging: vi.fn(),
  uploadDevicePhoto: vi.fn(),
  deleteDevicePhoto: vi.fn(),
  getDevicePhotoUrl: (id: number) => `/api/devices/${id}/photo`,
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => <div data-testid={`job-log-${jobId}`}>JobLog</div>,
}))

vi.mock('../stages/CatalogStage', () => ({
  CatalogStage: ({ device }: { device: { stage: string } }) => (
    <div data-testid="catalog-stage" data-stage={device.stage}>
      CatalogStage
    </div>
  ),
}))

vi.mock('../stages/VerifyStage', () => ({
  VerifyStage: ({ device }: { device: { stage: string } }) => (
    <div data-testid="verify-stage" data-stage={device.stage}>
      VerifyStage
    </div>
  ),
}))

vi.mock('../pages/MigrateStage', () => ({
  MigrateStage: ({ device }: { device: { stage: string } }) => (
    <div data-testid="migrate-stage" data-stage={device.stage}>
      MigrateStage
    </div>
  ),
}))

vi.mock('../pages/WipeStage', () => ({
  WipeStage: ({ device }: { device: { stage: string } }) => (
    <div data-testid="wipe-stage" data-stage={device.stage}>
      WipeStage
    </div>
  ),
}))

vi.mock('../pages/RecycleStage', () => ({
  RecycleStage: ({ device }: { device: { stage: string } }) => (
    <div data-testid="recycle-stage" data-stage={device.stage}>
      RecycleStage
    </div>
  ),
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
    expect(screen.getByText('Analyze')).toBeInTheDocument()
  })

  it('renders CatalogStage', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('catalog-stage'))
  })

  it('shows analyze placeholder when not yet analyzed', async () => {
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText('Test MBP'))
    expect(screen.getByText(/Step 2 — Analyze Duplicates/)).toBeInTheDocument()
  })

  it('shows analyze active section for cataloged device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Resolve Duplicates/))
  })

  it('shows analyze complete for analyzed device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'analyzed' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Duplicate analysis complete/))
  })

  it('shows migrate section as active when analyzed', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'analyzed' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('migrate-stage'))
  })

  it('shows MigrateStage for migrating device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'migrating' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('migrate-stage'))
  })

  it('shows MigrateStage for verified device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'verified' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('migrate-stage'))
  })

  it('shows VerifyStage for verifying device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'verifying' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('verify-stage'))
  })

  it('shows VerifyStage for verified device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'verified' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('verify-stage'))
  })

  it('shows migrate placeholder when not yet in migrate stage', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/available after duplicates/i))
  })

  it('shows WipeStage for verified device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'verified' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('wipe-stage'))
  })

  it('shows WipeStage for wiping device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'wiping' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('wipe-stage'))
  })

  it('shows RecycleStage for wiped device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'wiped' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('recycle-stage'))
  })

  it('shows RecycleStage for recycled device', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'recycled' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByTestId('recycle-stage'))
  })

  it('shows wipe placeholder when not yet in wipe stage', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Step 5 — Wipe/))
  })

  it('shows recycle placeholder when not yet in recycle stage', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ stage: 'cataloged' }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText(/Step 6 — Recycle/))
  })

  it('shows photo thumbnail when device has photo_path', async () => {
    vi.mocked(getDevice).mockResolvedValue(
      makeDevice({ photo_path: '/data/photos/device_1.jpg' })
    )
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText('Test MBP'))
    const img = screen.getByRole('img', { name: 'Test MBP' })
    expect(img).toHaveAttribute('src', expect.stringContaining('/api/devices/1/photo'))
  })

  it('shows emoji icon when device has no photo', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ photo_path: null }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText('Test MBP'))
    expect(screen.queryByRole('img', { name: 'Test MBP' })).not.toBeInTheDocument()
  })

  it('shows photo upload area when edit button clicked', async () => {
    vi.mocked(getDevice).mockResolvedValue(makeDevice({ photo_path: null }))
    renderWithProviders(<DeviceWizard />, { initialPath: '/devices/1', routePath: '/devices/:id' })
    await waitFor(() => screen.getByText('Test MBP'))
    // Click the photo slot button (title="Add or change photo")
    const photoBtn = screen.getByTitle(/add or change photo/i)
    await import('@testing-library/user-event').then(({ default: userEvent }) =>
      userEvent.click(photoBtn)
    )
    await waitFor(() => screen.getByText(/drag & drop or click to browse/i))
  })
})
