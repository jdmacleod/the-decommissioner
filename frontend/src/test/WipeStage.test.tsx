import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WipeStage } from '../pages/WipeStage'
import { renderWithProviders } from './helpers'
import type { Device, Job } from '../types/api'

vi.mock('../lib/api', () => ({
  getDeviceJobs: vi.fn(),
  triggerJob: vi.fn(),
  updateChecklist: vi.fn(),
  markWiped: vi.fn(),
}))

vi.mock('../components/JobLog', () => ({
  JobLog: ({ jobId }: { jobId: number }) => (
    <div data-testid={`job-log-${jobId}`}>JobLog</div>
  ),
}))

import { getDeviceJobs, triggerJob, updateChecklist, markWiped } from '../lib/api'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test Drive',
  device_type: 'hard_drive',
  stage: 'verified',
  source_path: '/dev/sdb',
  serial_number: null,
  notes: null,
  created_at: '',
  updated_at: '',
  ...overrides,
})

const makeWipeJob = (overrides: Partial<Job> = {}): Job => ({
  id: 10,
  device_id: 1,
  job_type: 'wipe',
  status: 'completed',
  started_at: null,
  completed_at: null,
  exit_code: null,
  error_message: null,
  log_path: '',
  job_metadata: JSON.stringify({
    method: 'apple_checklist',
    checklist_items: [
      { label: 'Sign out of iCloud', done: false },
      { label: 'Erase All Content', done: false },
    ],
  }),
  created_at: '',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getDeviceJobs).mockResolvedValue([])
  vi.mocked(triggerJob).mockResolvedValue({ job_id: 99, status: 'pending' })
  vi.mocked(updateChecklist).mockResolvedValue(makeWipeJob())
  vi.mocked(markWiped).mockResolvedValue(makeDevice({ stage: 'wiped' }))
})

const render = (device: Device) =>
  renderWithProviders(<WipeStage device={device} deviceId={device.id} />)

describe('WipeStage — HDD device', () => {
  it('shows Start Wipe button for verified HDD device', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /start wipe/i }))
  })

  it('Start Wipe button is disabled before confirmation', async () => {
    render(makeDevice())
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /start wipe/i })
      expect(btn).toBeDisabled()
    })
  })

  it('Start Wipe button enables after checking confirmation', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /start wipe/i })).not.toBeDisabled()
  })

  it('calls triggerJob on Start Wipe click', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /start wipe/i }))
    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith(1, 'wipe'))
  })

  it('shows job log when HDD device is wiping', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([makeWipeJob({ job_metadata: null })])
    render(makeDevice({ stage: 'wiping' }))
    // effectiveJobId comes from wipeJob.id (10)
    await waitFor(() => screen.getByTestId('job-log-10'))
  })

  it('shows wipe complete for wiped stage', async () => {
    render(makeDevice({ stage: 'wiped' }))
    await waitFor(() => screen.getByText(/wipe complete/i))
  })

  it('shows wipe complete for recycled stage too', async () => {
    render(makeDevice({ stage: 'recycled' }))
    await waitFor(() => screen.getByText(/wipe complete/i))
  })
})

describe('WipeStage — Apple device', () => {
  it('shows Begin Checklist button for verified iPhone', async () => {
    render(makeDevice({ device_type: 'iphone', stage: 'verified' }))
    await waitFor(() => screen.getByRole('button', { name: /begin checklist/i }))
  })

  it('shows Begin Checklist button for verified Mac', async () => {
    render(makeDevice({ device_type: 'mac', stage: 'verified' }))
    await waitFor(() => screen.getByRole('button', { name: /begin checklist/i }))
  })

  it('shows checklist items for wiping Apple device', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([makeWipeJob()])
    render(makeDevice({ device_type: 'iphone', stage: 'wiping' }))
    await waitFor(() => screen.getByText('Sign out of iCloud'))
    expect(screen.getByText('Erase All Content')).toBeInTheDocument()
  })

  it('Mark as Wiped disabled when not all items checked', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([makeWipeJob()])
    render(makeDevice({ device_type: 'iphone', stage: 'wiping' }))
    await waitFor(() => screen.getByRole('button', { name: /mark as wiped/i }))
    expect(screen.getByRole('button', { name: /mark as wiped/i })).toBeDisabled()
  })

  it('Mark as Wiped enabled when all items checked', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([
      makeWipeJob({
        job_metadata: JSON.stringify({
          method: 'apple_checklist',
          checklist_items: [
            { label: 'Sign out of iCloud', done: true },
            { label: 'Erase All Content', done: true },
          ],
        }),
      }),
    ])
    render(makeDevice({ device_type: 'iphone', stage: 'wiping' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark as wiped/i })).not.toBeDisabled()
    })
  })

  it('calls updateChecklist when a checklist item is toggled', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([makeWipeJob()])
    render(makeDevice({ device_type: 'iphone', stage: 'wiping' }))
    await waitFor(() => screen.getByText('Sign out of iCloud'))
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0])
    await waitFor(() =>
      expect(updateChecklist).toHaveBeenCalledWith(10, 0, true)
    )
  })

  it('calls markWiped when Mark as Wiped clicked', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([
      makeWipeJob({
        job_metadata: JSON.stringify({
          method: 'apple_checklist',
          checklist_items: [{ label: 'Step', done: true }],
        }),
      }),
    ])
    render(makeDevice({ device_type: 'iphone', stage: 'wiping' }))
    await waitFor(() => screen.getByRole('button', { name: /mark as wiped/i }))
    await userEvent.click(screen.getByRole('button', { name: /mark as wiped/i }))
    await waitFor(() => expect(markWiped).toHaveBeenCalledWith(1))
  })

  it('shows loading message when checklist is empty', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([
      makeWipeJob({ job_metadata: null }),
    ])
    render(makeDevice({ device_type: 'mac', stage: 'wiping' }))
    await waitFor(() => screen.getByText(/loading checklist/i))
  })
})

// Regression: ISSUE-QA-001 — network_volume wipe stage showed log stream instead of checklist
// Found by /qa on 2026-06-04
// network_volume was missing from APPLE_TYPES in WipeStage.tsx
describe('WipeStage — network_volume device', () => {
  it('shows Begin Checklist button for verified network_volume device', async () => {
    render(makeDevice({ device_type: 'network_volume', stage: 'verified', source_path: '/Volumes/MyShare' }))
    await waitFor(() => screen.getByRole('button', { name: /begin checklist/i }))
  })

  it('does NOT show Start Wipe button for verified network_volume', async () => {
    render(makeDevice({ device_type: 'network_volume', stage: 'verified', source_path: '/Volumes/MyShare' }))
    await waitFor(() => screen.getByRole('button', { name: /begin checklist/i }))
    expect(screen.queryByRole('button', { name: /start wipe/i })).not.toBeInTheDocument()
  })

  it('shows checklist items for wiping network_volume device', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([
      makeWipeJob({
        job_metadata: JSON.stringify({
          method: 'apple_checklist',
          checklist_items: [
            { label: 'Backup complete and verified', done: false },
            { label: 'Disconnect the share', done: false },
          ],
        }),
      }),
    ])
    render(makeDevice({ device_type: 'network_volume', stage: 'wiping', source_path: '/Volumes/MyShare' }))
    await waitFor(() => screen.getByText('Backup complete and verified'))
    expect(screen.getByText('Disconnect the share')).toBeInTheDocument()
    expect(screen.queryByTestId('job-log-10')).not.toBeInTheDocument()
  })

  it('shows Mark as Wiped button for wiping network_volume', async () => {
    vi.mocked(getDeviceJobs).mockResolvedValue([makeWipeJob()])
    render(makeDevice({ device_type: 'network_volume', stage: 'wiping', source_path: '/Volumes/MyShare' }))
    await waitFor(() => screen.getByRole('button', { name: /mark as wiped/i }))
  })
})
