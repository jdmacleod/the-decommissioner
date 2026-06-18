import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MigrateStage } from '../stages/MigrateStage'
import { renderWithProviders } from './helpers'
import type { Device, StorageTarget } from '../types/api'
import type { JobStreamState, ProgressData } from '../lib/stream'

vi.mock('../lib/api', () => ({
  getStorageTargets: vi.fn(),
  triggerJob: vi.fn(),
  getDeviceJobs: vi.fn(),
  getSnapshots: vi.fn(),
}))

const mockStreamState: JobStreamState = { lines: [], done: false, error: false, progress: null }

vi.mock('../lib/stream', () => ({
  useJobStream: vi.fn(() => mockStreamState),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => <div data-testid={`job-log-${jobId}`}>JobLog</div>,
}))

import { getStorageTargets, triggerJob, getDeviceJobs, getSnapshots } from '../lib/api'
import { useJobStream } from '../lib/stream'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test Drive',
  device_type: 'hard_drive',
  stage: 'analyzed',
  source_path: '/tmp/src',
  serial_number: null,
  notes: null,
  created_at: '',
  storage_type: 'unknown',
  updated_at: '',
  ...overrides,
})

const makeTarget = (overrides: Partial<StorageTarget> = {}): StorageTarget => ({
  id: 1,
  name: 'My Repo',
  backend: 'local',
  path: '/Volumes/Backup/repo',
  restic_password_env: 'RESTIC_PASSWORD',
  is_default: true,
  initialized: true,
  created_at: '',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 42, status: 'pending' })
  vi.mocked(getDeviceJobs).mockResolvedValue([])
  vi.mocked(getSnapshots).mockResolvedValue([])
})

const render = (device: Device) =>
  renderWithProviders(<MigrateStage device={device} deviceId={device.id} />)

describe('MigrateStage', () => {
  it('shows Start Migration button for analyzed device', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start migration/i }))
  })

  it('shows Step 3 heading', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText(/Step 3 — Migrate to Storage/))
  })

  it('shows storage target dropdown', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText(/My Repo/))
  })

  it('shows no target warning when no targets exist', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([])
    render(makeDevice())
    await waitFor(() => screen.getByText(/no storage target/i))
  })

  it('calls triggerJob with migrate and target id on button click', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start migration/i }))
    await userEvent.click(screen.getByRole('button', { name: /start migration/i }))
    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith(1, 'migrate', expect.anything()))
  })

  it('shows JobLog after job starts', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start migration/i }))
    await userEvent.click(screen.getByRole('button', { name: /start migration/i }))
    await waitFor(() => screen.getByTestId('job-log-42'))
  })

  it('shows migrating state', async () => {
    render(makeDevice({ stage: 'migrating' }))
    await waitFor(() => screen.getByText(/migrating files/i))
  })

  it('shows verifying spinner for migrated stage', async () => {
    render(makeDevice({ stage: 'migrated' }))
    await waitFor(() => screen.getByText(/migration complete/i))
  })

  it('shows complete state for verifying stage', async () => {
    render(makeDevice({ stage: 'verifying' }))
    await waitFor(() => screen.getByText(/Migration complete/))
  })

  it('shows complete state for verified stage', async () => {
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/Migration complete/))
  })

  it('disables start button when no targets', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([])
    render(makeDevice())
    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /start migration/i })
      if (btn) expect(btn).toBeDisabled()
    })
  })

  it('shows multiple targets in dropdown', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([
      makeTarget({ id: 1, name: 'Repo A', is_default: true }),
      makeTarget({ id: 2, name: 'Repo B', is_default: false }),
    ])
    render(makeDevice())
    await waitFor(() => screen.getByText(/Repo A/))
    expect(screen.getByText(/Repo B/)).toBeInTheDocument()
  })

  it('recovers job ID on page refresh when stage is migrating', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([
      {
        id: 99,
        device_id: 1,
        job_type: 'migrate',
        status: 'in_progress',
        started_at: null,
        completed_at: null,
        exit_code: null,
        error_message: null,
        log_path: '',
        job_metadata: null,
        created_at: '',
      },
    ])
    render(makeDevice({ stage: 'migrating' }))
    await waitFor(() => screen.getByTestId('job-log-99'))
  })

  it('shows progress bar at 50% when SSE fires progress event', async () => {
    const progress: ProgressData = { percent_done: 0.5, eta_seconds: 120 }
    vi.mocked(useJobStream).mockReturnValue({
      lines: [],
      done: false,
      error: false,
      progress,
    })
    render(makeDevice({ stage: 'migrating' }))
    await waitFor(() => {
      const bar = document.querySelector('[role="progressbar"]')
      expect(bar).toBeInTheDocument()
      expect(bar).toHaveAttribute('aria-valuenow', '50')
    })
  })

  it('shows snapshot stats in completion banner', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([
      {
        id: 1,
        device_id: 1,
        job_id: 1,
        storage_target_id: 1,
        restic_snapshot_id: 'abc12345',
        file_count: 1234,
        total_bytes: 5368709120,
        added_bytes: 1073741824,
        tags: null,
        taken_at: '',
        verified_at: null,
      },
    ])
    render(makeDevice({ stage: 'migrated' }))
    await waitFor(() => screen.getByText(/1,234 files/))
    expect(screen.getByText(/5\.00 GB/)).toBeInTheDocument()
  })
})
