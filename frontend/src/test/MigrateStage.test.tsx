import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MigrateStage } from '../pages/MigrateStage'
import { renderWithProviders } from './helpers'
import type { Device, StorageTarget, Snapshot } from '../types/api'

vi.mock('../lib/api', () => ({
  getStorageTargets: vi.fn(),
  getSnapshots: vi.fn(),
  triggerJob: vi.fn(),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => (
    <div data-testid={`job-log-${jobId}`}>JobLog</div>
  ),
}))

import { getStorageTargets, getSnapshots, triggerJob } from '../lib/api'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test Drive',
  device_type: 'hard_drive',
  stage: 'analyzed',
  source_path: '/tmp/src',
  serial_number: null,
  notes: null,
  created_at: '',
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

const makeSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  id: 1,
  device_id: 1,
  job_id: 1,
  storage_target_id: 1,
  restic_snapshot_id: 'abc12345',
  file_count: 5000,
  total_bytes: 2_000_000_000,
  added_bytes: 1_800_000_000,
  tags: null,
  taken_at: '2024-01-01T00:00:00Z',
  verified_at: '2024-01-01T01:00:00Z',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
  vi.mocked(getSnapshots).mockResolvedValue([])
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 42, status: 'pending' })
})

const render = (device: Device) =>
  renderWithProviders(<MigrateStage device={device} deviceId={device.id} />)

describe('MigrateStage', () => {
  it('shows Start Migration button for analyzed device', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start migration/i }))
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
    await waitFor(() =>
      expect(triggerJob).toHaveBeenCalledWith(1, 'migrate', expect.anything())
    )
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

  it('shows migration complete verifying state when migrated', async () => {
    render(makeDevice({ stage: 'migrated' }))
    await waitFor(() => screen.getByText(/migration complete/i))
  })

  it('shows verifying spinner when verifying', async () => {
    render(makeDevice({ stage: 'verifying' }))
    await waitFor(() => screen.getByText(/verification in progress/i))
  })

  it('shows verified state with snapshot info', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/migration and verification complete/i))
    await waitFor(() => screen.getByText(/abc12345/))
  })

  it('shows verified state without snapshot when none exist', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([])
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/migration and verification complete/i))
    expect(screen.queryByText(/abc12345/)).not.toBeInTheDocument()
  })

  it('shows restic check passed message when verified', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/restic check passed/i))
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
})
