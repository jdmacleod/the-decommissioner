import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecycleStage } from '../stages/RecycleStage'
import { renderWithProviders } from './helpers'
import type { Device } from '../types/api'

vi.mock('../lib/api', () => ({
  markRecycled: vi.fn(),
  getCertificateUrl: vi.fn((id: number) => `/api/devices/${id}/certificate`),
}))

import { markRecycled, getCertificateUrl } from '../lib/api'

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: 'Test MBP',
  device_type: 'mac',
  stage: 'wiped',
  source_path: null,
  serial_number: null,
  notes: null,
  created_at: '',
  storage_type: 'unknown',
  updated_at: '',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(markRecycled).mockResolvedValue(makeDevice({ stage: 'recycled' }))
  vi.mocked(getCertificateUrl).mockImplementation((id) => `/api/devices/${id}/certificate`)
})

const render = (device: Device) =>
  renderWithProviders(<RecycleStage device={device} deviceId={device.id} />)

describe('RecycleStage', () => {
  it('shows Step 6 heading', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText(/step 6/i))
  })

  it('shows recycling options for wiped device', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByText('Apple Trade In'))
    expect(screen.getByText('Best Buy Electronics Recycling')).toBeInTheDocument()
  })

  it('shows certificate download link', async () => {
    render(makeDevice())
    await waitFor(() => {
      const link = screen.getAllByText(/download certificate/i)[0]
      expect(link).toBeInTheDocument()
    })
  })

  it('certificate link points to the correct URL', async () => {
    render(makeDevice())
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /download certificate/i })
      expect(links[0]).toHaveAttribute('href', '/api/devices/1/certificate')
    })
  })

  it('shows Mark as Recycled button for wiped device', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /mark as recycled/i }))
  })

  it('calls markRecycled when button is clicked', async () => {
    render(makeDevice())
    await waitFor(() => screen.getByRole('button', { name: /mark as recycled/i }))
    await userEvent.click(screen.getByRole('button', { name: /mark as recycled/i }))
    await waitFor(() => expect(markRecycled).toHaveBeenCalledWith(1))
  })

  it('shows complete state for recycled device', async () => {
    render(makeDevice({ stage: 'recycled' }))
    await waitFor(() => screen.getByText(/fully decommissioned/i))
  })

  it('shows certificate download in recycled state', async () => {
    render(makeDevice({ stage: 'recycled' }))
    await waitFor(() => screen.getByRole('link', { name: /download certificate/i }))
  })

  it('does not show Mark as Recycled button in recycled state', async () => {
    render(makeDevice({ stage: 'recycled' }))
    await waitFor(() => screen.getByText(/fully decommissioned/i))
    expect(screen.queryByRole('button', { name: /mark as recycled/i })).not.toBeInTheDocument()
  })
})
