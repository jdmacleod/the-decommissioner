import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VerifyStage } from '../stages/VerifyStage'
import { renderWithProviders } from './helpers'
import type { Device, Snapshot, VerifyDiff } from '../types/api'

vi.mock('../lib/api', () => ({
  getSnapshots: vi.fn(),
  getVerifyDiff: vi.fn(),
}))

import { getSnapshots, getVerifyDiff } from '../lib/api'

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

const cleanDiff: VerifyDiff = {
  discrepancy: false,
  catalog_count: 5000,
  snapshot_count: 5000,
  missing_paths: [],
}

const discrepancyDiff: VerifyDiff = {
  discrepancy: true,
  catalog_count: 5000,
  snapshot_count: 4997,
  missing_paths: ['/src/lost_a.txt', '/src/lost_b.txt', '/src/lost_c.txt'],
}

beforeEach(() => {
  vi.mocked(getSnapshots).mockResolvedValue([])
  vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
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

  // --- verified + no discrepancy ---

  it('shows success banner when verified with no discrepancy', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/migration and verification complete/i))
  })

  it('shows catalog and snapshot counts when verified', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => expect(screen.getAllByText(/5,000 files/).length).toBeGreaterThan(0))
    expect(screen.getByText(/0 files ✓/)).toBeInTheDocument()
  })

  it('shows restic check passed message when no discrepancy', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/restic check passed/i))
  })

  it('shows snapshot ID and sizes when verified', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/abc12345/))
    expect(screen.getByText(/2.00 GB/)).toBeInTheDocument()
  })

  it('does not show missing paths table when no discrepancy', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(cleanDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/migration and verification complete/i))
    expect(screen.queryByText(/Missing files/)).not.toBeInTheDocument()
  })

  // --- verified + discrepancy ---

  it('shows amber warning banner when discrepancy detected', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/3 files not present in snapshot/i))
  })

  it('shows discrepancy count in difference row', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/3 files missing/i))
  })

  it('shows catalog vs snapshot counts on discrepancy', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/5,000 files/))
    expect(screen.getByText(/4,997 files/)).toBeInTheDocument()
  })

  it('renders missing paths in the table', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText('/src/lost_a.txt'))
    expect(screen.getByText('/src/lost_b.txt')).toBeInTheDocument()
    expect(screen.getByText('/src/lost_c.txt')).toBeInTheDocument()
  })

  it('does not show restic check passed message when discrepancy exists', async () => {
    vi.mocked(getSnapshots).mockResolvedValue([makeSnapshot()])
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText(/3 files not present in snapshot/i))
    expect(screen.queryByText(/restic check passed/i)).not.toBeInTheDocument()
  })

  it('filters missing paths by search term', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText('/src/lost_a.txt'))

    const filterInput = screen.getByPlaceholderText(/filter paths/i)
    await userEvent.type(filterInput, 'lost_a')

    await waitFor(() => expect(screen.queryByText('/src/lost_b.txt')).not.toBeInTheDocument())
    expect(screen.getByText('/src/lost_a.txt')).toBeInTheDocument()
  })

  it('shows no-match message when filter excludes all paths', async () => {
    vi.mocked(getVerifyDiff).mockResolvedValue(discrepancyDiff)
    render(makeDevice({ stage: 'verified' }))
    await waitFor(() => screen.getByText('/src/lost_a.txt'))

    const filterInput = screen.getByPlaceholderText(/filter paths/i)
    await userEvent.type(filterInput, 'zzznomatch')

    await waitFor(() => screen.getByText(/No paths match filter/i))
  })
})
