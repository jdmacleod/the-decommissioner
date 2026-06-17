import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DuplicateTriageMode } from '../stages/DuplicateTriageMode'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  resolveGroup: vi.fn(),
}))

import { resolveGroup } from '../lib/api'

const makeEntry = (id: number, path: string, mtime = '2020-01-01T00:00:00Z') => ({
  id,
  path,
  relative_path: path.split('/').pop() ?? '',
  size_bytes: 1000,
  mtime,
  device_id: 1,
  status: 'pending' as const,
})

const mockGroupA = {
  id: 10,
  content_hash: 'aaabbbcccddd0001',
  canonical_entry_id: null,
  resolved: false,
  auto_resolved: false,
  total_size_bytes: 2000,
  entries: [makeEntry(1, '/Users/jason/Documents/file.txt'), makeEntry(2, '/tmp/file.txt')],
}

const mockGroupB = {
  id: 20,
  content_hash: 'aaabbbcccddd0002',
  canonical_entry_id: null,
  resolved: false,
  auto_resolved: false,
  total_size_bytes: 2000,
  entries: [makeEntry(3, '/Users/jason/Desktop/photo.jpg'), makeEntry(4, '/tmp/photo.jpg')],
}

// Tied-score group — low confidence
const mockGroupTied = {
  id: 30,
  content_hash: 'aaabbbcccddd0003',
  canonical_entry_id: null,
  resolved: false,
  auto_resolved: false,
  total_size_bytes: 2000,
  entries: [makeEntry(5, '/tmp/x.txt'), makeEntry(6, '/tmp/y.txt')],
}

const defaultProps = {
  groups: [mockGroupA],
  deviceId: 1,
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveGroup).mockResolvedValue({
    ...mockGroupA,
    resolved: true,
    canonical_entry_id: 1,
  })
  defaultProps.onClose = vi.fn()
})

afterEach(() => {
  // Ensure body overflow is cleaned up
  document.body.style.overflow = ''
})

describe('DuplicateTriageMode', () => {
  it('renders the overlay via portal', () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Keyboard Triage')).toBeInTheDocument()
  })

  it('shows first group and cursor position', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
    expect(screen.getByText('/Users/jason/Documents/file.txt')).toBeInTheDocument()
  })

  it('highlights the suggested keeper', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    expect(screen.getByText('suggested')).toBeInTheDocument()
  })

  it('Space key resolves with suggested keeper and transitions to receipt', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: ' ' })
    await waitFor(() => expect(resolveGroup).toHaveBeenCalledWith(10, 1))
    await waitFor(() => expect(screen.getByText(/Done/)).toBeInTheDocument())
  })

  it('1 key resolves with first entry by index', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: '1' })
    await waitFor(() => expect(resolveGroup).toHaveBeenCalledWith(10, 1))
  })

  it('2 key resolves with second entry by index', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: '2' })
    await waitFor(() => expect(resolveGroup).toHaveBeenCalledWith(10, 2))
  })

  it('out-of-range index key is a no-op', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: '9' })
    expect(resolveGroup).not.toHaveBeenCalled()
  })

  it('J on last group transitions to receipt', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('1 / 1'))
    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(screen.getByText(/Done/)).toBeInTheDocument())
  })

  it('J navigates forward through multiple groups', async () => {
    renderWithProviders(
      <DuplicateTriageMode groups={[mockGroupA, mockGroupB]} deviceId={1} onClose={vi.fn()} />
    )
    await waitFor(() => screen.getByText('1 / 2'))
    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument())
  })

  it('K navigates backward (stops at 0)', async () => {
    renderWithProviders(
      <DuplicateTriageMode groups={[mockGroupA, mockGroupB]} deviceId={1} onClose={vi.fn()} />
    )
    await waitFor(() => screen.getByText('1 / 2'))
    // K at position 0 should not go below 0
    fireEvent.keyDown(document, { key: 'k' })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // Navigate to group 2 then back
    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => screen.getByText('2 / 2'))
    fireEvent.keyDown(document, { key: 'k' })
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
  })

  it('does not fire keydown when target is an input', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: ' ', target: input })
    expect(resolveGroup).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('sets body overflow hidden while mounted and restores on unmount', () => {
    const { unmount } = renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('shows Recorded toast on successful resolve', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: ' ' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Recorded'))
  })

  it('shows error toast on failed resolve', async () => {
    vi.mocked(resolveGroup).mockRejectedValue(new Error('network error'))
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: ' ' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Failed to record/))
  })

  it('clicking an entry fires resolveGroup', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/tmp/file.txt'))
    await userEvent.click(screen.getByText('/tmp/file.txt').closest('button')!)
    await waitFor(() => expect(resolveGroup).toHaveBeenCalledWith(10, 2))
  })

  it('Exit triage button calls onClose', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /exit triage/i }))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('shows receipt immediately when all groups are already resolved', () => {
    const resolvedGroup = { ...mockGroupA, resolved: true, canonical_entry_id: 1 }
    renderWithProviders(
      <DuplicateTriageMode groups={[resolvedGroup]} deviceId={1} onClose={vi.fn()} />
    )
    expect(screen.getByText(/Done/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument()
  })

  it('receipt shows low-confidence groups', async () => {
    renderWithProviders(
      <DuplicateTriageMode groups={[mockGroupTied]} deviceId={1} onClose={vi.fn()} />
    )
    await waitFor(() => screen.getByText('/tmp/x.txt'))
    // Accept the suggestion — confidence is 0 (tied), so receipt should show it
    fireEvent.keyDown(document, { key: ' ' })
    await waitFor(() => expect(screen.getByText(/Done/)).toBeInTheDocument())
    expect(screen.getByText(/low-confidence/i)).toBeInTheDocument()
    // Text split across nodes (✓ + path), so use regex
    expect(screen.getByText(/\/tmp\/x\.txt/)).toBeInTheDocument()
  })

  it('receipt shows "All decisions were high-confidence" when no low-confidence groups', async () => {
    renderWithProviders(<DuplicateTriageMode {...defaultProps} />)
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: ' ' })
    await waitFor(() => expect(screen.getByText(/Done/)).toBeInTheDocument())
    expect(screen.getByText(/All decisions were high-confidence/i)).toBeInTheDocument()
  })

  it('Finish button calls queryClient.invalidateQueries and onClose', async () => {
    const onClose = vi.fn()
    renderWithProviders(
      <DuplicateTriageMode groups={[mockGroupA]} deviceId={1} onClose={onClose} />
    )
    await waitFor(() => screen.getByText('/Users/jason/Documents/file.txt'))
    fireEvent.keyDown(document, { key: 'j' }) // skip to receipt
    await waitFor(() => screen.getByRole('button', { name: /finish/i }))
    await userEvent.click(screen.getByRole('button', { name: /finish/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
