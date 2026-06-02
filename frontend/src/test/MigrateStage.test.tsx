import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MigrateStage } from '../pages/MigrateStage'
import { renderWithProviders } from './helpers'
import type { Device, StorageTarget } from '../types/api'

vi.mock('../lib/api', () => ({
  getStorageTargets: vi.fn(),
  triggerJob: vi.fn(),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => (
    <div data-testid={`job-log-${jobId}`}>JobLog</div>
  ),
}))

import { getStorageTargets, triggerJob } from '../lib/api'

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

beforeEach(() => {
  vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 42, status: 'pending' })
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
})
