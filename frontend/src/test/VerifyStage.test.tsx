import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VerifyStage } from '../stages/VerifyStage'
import { renderWithProviders } from './helpers'
import type { Device, Snapshot } from '../types/api'

vi.mock('../lib/api', () => ({
  getSnapshots: vi.fn(),
}))

import { getSnapshots } from '../lib/api'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test Drive',
  device_type: 'hard_drive',
  stage: 'verifying',
  source_path: '/tmp/src',
  serial_number: null,
  notes: null,
  created_at: '',
  updated_at: '',
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
  vi.mocked(getSnapshots).mockResolvedValue([])
})

const render = (device: Device) =>
  renderWithProviders(<VerifyStage device={device} deviceId={device.id} />, {
    initialPath: '/devices/1',
    routePath: '/devices/:id',
  })

describe('VerifyStage', () => {
  it('shows Step 4 heading when verifying', () => {
    render(makeDevice())
    expect(screen.getByText(/Step 4 — Verify/)).toBeInTheDocument()
  })

  it('shows verifying spinner when verifying', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText(/Verification in progress/i))
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

  it('shows restic check passed message when verified with snapshot', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/restic check passed/i))
  })

  it('shows snapshot file count and sizes', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/5,000/))
    expect(screen.getByText(/2.00 GB/)).toBeInTheDocument()
  })

  it('shows complete state for wiping stage', async () => {
    render(makeDevice({ stage: 'wiping' }))
    await waitFor(() => screen.getByText(/Verification complete/))
  })

  it('shows complete state for wiped stage', async () => {
    render(makeDevice({ stage: 'wiped' }))
    await waitFor(() => screen.getByText(/Verification complete/))
  })

  it('shows complete state for recycled stage', async () => {
    render(makeDevice({ stage: 'recycled' }))
    await waitFor(() => screen.getByText(/Verification complete/))
  })

  it('returns null for non-verify stages', () => {
    const { container } = render(makeDevice({ stage: 'analyzed' }))
    expect(container.firstChild).toBeNull()
  })
})
