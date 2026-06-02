import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StorageTargetCard } from '../components/StorageTargetCard'
import { renderWithProviders } from './helpers'
import type { StorageTarget } from '../types/api'

const makeTarget = (overrides: Partial<StorageTarget> = {}): StorageTarget => ({
  id: 1,
  name: 'My Repo',
  backend: 'local',
  path: '/Volumes/repo',
  restic_password_env: 'RESTIC_PASSWORD',
  is_default: false,
  initialized: false,
  created_at: '',
  ...overrides,
})

const defaultProps = {
  isEditing: false,
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onTest: vi.fn(),
  onInit: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  isTestPending: false,
  isInitPending: false,
  isEditPending: false,
}

beforeEach(() => vi.clearAllMocks())

const render = (target: StorageTarget, props = {}) =>
  renderWithProviders(
    <StorageTargetCard target={target} {...defaultProps} {...props} />
  )

describe('StorageTargetCard', () => {
  it('shows target name and path', () => {
    render(makeTarget())
    expect(screen.getByText('My Repo')).toBeInTheDocument()
    expect(screen.getByText('/Volumes/repo')).toBeInTheDocument()
  })

  it('shows default badge when is_default', () => {
    render(makeTarget({ is_default: true }))
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('shows initialized status', () => {
    render(makeTarget({ initialized: true }))
    expect(screen.getByText(/initialized/)).toBeInTheDocument()
  })

  it('shows not initialized status', () => {
    render(makeTarget({ initialized: false }))
    expect(screen.getByText(/not initialized/)).toBeInTheDocument()
  })

  it('shows Init button for uninitialized target', () => {
    render(makeTarget({ initialized: false }))
    expect(screen.getByRole('button', { name: /Init/i })).toBeInTheDocument()
  })

  it('hides Init button for initialized target', () => {
    render(makeTarget({ initialized: true }))
    expect(screen.queryByRole('button', { name: /Init/i })).not.toBeInTheDocument()
  })

  it('calls onTest when Test is clicked', async () => {
    const onTest = vi.fn()
    render(makeTarget(), { onTest })
    await userEvent.click(screen.getByRole('button', { name: /Test/i }))
    expect(onTest).toHaveBeenCalled()
  })

  it('calls onRemove when remove button is clicked', async () => {
    const onRemove = vi.fn()
    render(makeTarget(), { onRemove })
    await userEvent.click(screen.getByLabelText(/Remove My Repo/i))
    expect(onRemove).toHaveBeenCalled()
  })

  it('calls onEdit when edit button is clicked', async () => {
    const onEdit = vi.fn()
    render(makeTarget(), { onEdit })
    await userEvent.click(screen.getByLabelText(/Edit My Repo/i))
    expect(onEdit).toHaveBeenCalled()
  })

  it('shows edit form when isEditing', () => {
    render(makeTarget(), { isEditing: true })
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
  })

  it('shows test result when provided', async () => {
    render(makeTarget(), { testResult: { ok: true, output: 'ok' } })
    await waitFor(() => screen.getByText(/Connected/))
  })

  it('shows failed test result', async () => {
    render(makeTarget(), { testResult: { ok: false, output: 'error' } })
    await waitFor(() => screen.getByText(/Failed/))
  })
})
