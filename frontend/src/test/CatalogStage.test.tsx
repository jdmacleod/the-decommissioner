import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CatalogStage } from '../stages/CatalogStage'
import { renderWithProviders } from './helpers'
import type { Device, DupStats } from '../types/api'

vi.mock('../lib/api', () => ({
  getDependencies: vi.fn(),
  getFileEntries: vi.fn(),
  triggerJob: vi.fn(),
  clearStaging: vi.fn(),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => <div data-testid={`job-log-${jobId}`}>JobLog</div>,
}))

import { getDependencies, getFileEntries, triggerJob, clearStaging } from '../lib/api'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test Drive',
  device_type: 'hard_drive',
  stage: 'registered',
  source_path: '/tmp/src',
  serial_number: null,
  notes: null,
  staging_path: null,
  created_at: '',
  storage_type: 'unknown',
  updated_at: '',
  ...overrides,
})

const makeDupStats = (overrides: Partial<DupStats> = {}): DupStats => ({
  total: 0,
  resolved: 0,
  unresolved: 0,
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getDependencies).mockResolvedValue([
    {
      id: 1,
      name: 'czkawka_cli',
      status: 'found',
      version: '6.0.0',
      required_for: '[]',
      install_hint: '',
      checked_at: '',
    },
  ])
  vi.mocked(getFileEntries).mockResolvedValue({ items: [], total: 1204, page: 0, limit: 1 })
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 42, status: 'pending' })
  vi.mocked(clearStaging).mockResolvedValue(makeDevice())
})

const render = (device: Device, dupStats?: DupStats) =>
  renderWithProviders(<CatalogStage device={device} deviceId={device.id} dupStats={dupStats} />, {
    initialPath: '/devices/1',
    routePath: '/devices/:id',
  })

describe('CatalogStage', () => {
  it('shows Step 1 heading', () => {
    render(makeDevice())
    expect(screen.getByText(/Step 1 — Catalog Files/)).toBeInTheDocument()
  })

  it('shows Start Catalog button for registered device with source', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start catalog/i }))
  })

  it('shows tool info when czkawka is found', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText(/czkawka/))
  })

  it('shows source path', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText('/tmp/src'))
  })

  it('shows no source path warning when source_path is null', async () => {
    render(makeDevice({ source_path: null }))
    await waitFor(() => screen.getByText(/No source path set/))
  })

  it('triggers catalog job on button click', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start catalog/i }))
    await userEvent.click(screen.getByRole('button', { name: /start catalog/i }))
    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith(1, 'catalog'))
  })

  it('shows Starting... text when cataloging without activeJobId', async () => {
    render(makeDevice({ stage: 'cataloging' }))
    await waitFor(() => screen.getByText(/Starting catalog job/i))
  })

  it('shows catalog complete for cataloged stage', async () => {
    render(makeDevice({ stage: 'cataloged' }))
    await waitFor(() => screen.getByText(/Catalog complete/))
  })

  it('shows file count after cataloging', async () => {
    render(makeDevice({ stage: 'cataloged' }))
    await waitFor(() => screen.getByText(/1,204 files/))
  })

  it('shows duplicate group count when stats available', async () => {
    render(makeDevice({ stage: 'cataloged' }), makeDupStats({ total: 5 }))
    await waitFor(() => screen.getByText(/5 duplicate groups found/))
  })

  it('shows Review Files link after catalog', async () => {
    render(makeDevice({ stage: 'cataloged' }))
    await waitFor(() => screen.getByText(/Review Files/))
  })

  it('shows Resolve Duplicates link after catalog', async () => {
    render(makeDevice({ stage: 'cataloged' }))
    await waitFor(() => screen.getByText(/Resolve Duplicates/))
  })

  it('shows Re-catalog button after catalog', async () => {
    render(makeDevice({ stage: 'cataloged' }))
    await waitFor(() => screen.getByRole('button', { name: /re-catalog/i }))
  })

  it('shows staging path and Free space button for iOS with staging', async () => {
    render(makeDevice({ stage: 'cataloged', staging_path: '/tmp/staging/1' }))
    await waitFor(() => screen.getByText(/Staging dir/))
    expect(screen.getByRole('button', { name: /free space/i })).toBeInTheDocument()
  })

  it('calls clearStaging on Free space click', async () => {
    render(makeDevice({ stage: 'cataloged', staging_path: '/tmp/staging/1' }))
    await waitFor(() => screen.getByRole('button', { name: /free space/i }))
    await userEvent.click(screen.getByRole('button', { name: /free space/i }))
    await waitFor(() => expect(clearStaging).toHaveBeenCalledWith(1))
  })

  it('shows View Duplicates for analyzed stage', async () => {
    render(makeDevice({ stage: 'analyzed' }))
    await waitFor(() => screen.getByText(/View Duplicates/))
  })
})
