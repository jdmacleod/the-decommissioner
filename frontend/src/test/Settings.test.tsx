import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Settings } from '../pages/Settings'
import { renderWithProviders } from './helpers'
import type { StorageTarget } from '../types/api'

vi.mock('../lib/api', () => ({
  getDependencies: vi.fn(),
  recheckDependencies: vi.fn(),
  getStorageTargets: vi.fn(),
  createStorageTarget: vi.fn(),
  deleteStorageTarget: vi.fn(),
  testStorageTarget: vi.fn(),
  initStorageTarget: vi.fn(),
}))

import {
  getDependencies, recheckDependencies,
  getStorageTargets, createStorageTarget, deleteStorageTarget,
  testStorageTarget, initStorageTarget,
} from '../lib/api'

const mockDeps = [
  { id: 1, name: 'restic', status: 'found' as const, version: '0.16.0', required_for: '[]', install_hint: 'brew install restic', checked_at: '' },
  { id: 2, name: 'czkawka_cli', status: 'missing' as const, version: null, required_for: '[]', install_hint: 'brew install czkawka', checked_at: '' },
]

const makeTarget = (overrides: Partial<StorageTarget> = {}): StorageTarget => ({
  id: 1, name: 'My Repo', backend: 'local', path: '/Volumes/repo',
  restic_password_env: 'RESTIC_PASSWORD', is_default: true,
  initialized: false, created_at: '',
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getDependencies).mockResolvedValue(mockDeps)
  vi.mocked(recheckDependencies).mockResolvedValue(mockDeps)
  vi.mocked(getStorageTargets).mockResolvedValue([])
  vi.mocked(createStorageTarget).mockResolvedValue(makeTarget())
  vi.mocked(deleteStorageTarget).mockResolvedValue(new Response(null, { status: 204 }))
  vi.mocked(testStorageTarget).mockResolvedValue({ ok: true, output: '' })
  vi.mocked(initStorageTarget).mockResolvedValue({ ok: true, output: 'initialized' })
})

describe('Settings page', () => {
  it('renders the page heading', () => {
    renderWithProviders(<Settings />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows dependency rows after loading', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => expect(screen.getByText('restic')).toBeInTheDocument())
    expect(screen.getByText('czkawka_cli')).toBeInTheDocument()
  })

  it('shows checkmark for found deps, X for missing', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('restic'))
    expect(screen.getByText(/✓ found/)).toBeInTheDocument()
    expect(screen.getByText(/✗ missing/)).toBeInTheDocument()
  })

  it('shows version when available', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('0.16.0'))
  })

  it('shows install hint for missing deps', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('brew install czkawka'))
  })

  it('calls recheckDependencies on button click', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('restic'))
    await userEvent.click(screen.getByRole('button', { name: /re-check/i }))
    expect(recheckDependencies).toHaveBeenCalled()
  })

  // ── Storage target section ─────────────────────────────────────────────────

  it('shows storage target section heading', () => {
    renderWithProviders(<Settings />)
    expect(screen.getByText('Storage Target')).toBeInTheDocument()
  })

  it('shows no targets message when list is empty', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText(/no storage targets configured/i))
  })

  it('shows existing targets', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('My Repo'))
    expect(screen.getByText('/Volumes/repo')).toBeInTheDocument()
  })

  it('shows default badge on default target', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ is_default: true })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText('default'))
  })

  it('shows initialized status', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ initialized: true })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText(/✓ initialized/))
  })

  it('shows not initialized status', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ initialized: false })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText(/not initialized/))
  })

  it('opens add form on + Add click', async () => {
    renderWithProviders(<Settings />)
    await userEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    expect(screen.getByPlaceholderText(/my backup repo/i)).toBeInTheDocument()
  })

  it('closes add form on Cancel click', async () => {
    renderWithProviders(<Settings />)
    await userEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByPlaceholderText(/my backup repo/i)).not.toBeInTheDocument()
  })

  it('submits add form with correct data', async () => {
    renderWithProviders(<Settings />)
    await userEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    await userEvent.type(screen.getByPlaceholderText(/my backup repo/i), 'Test Repo')
    await userEvent.type(screen.getByPlaceholderText(/volumes\/backupdrive\/repo/i), '/tmp/repo')
    await userEvent.click(screen.getByRole('button', { name: /add target/i }))
    await waitFor(() => expect(createStorageTarget).toHaveBeenCalled())
  })

  it('calls deleteStorageTarget on remove click', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByLabelText(/remove my repo/i))
    await userEvent.click(screen.getByLabelText(/remove my repo/i))
    expect(deleteStorageTarget).toHaveBeenCalledWith(1)
  })

  it('calls testStorageTarget on Test click', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /test/i }))
    await userEvent.click(screen.getByRole('button', { name: /test/i }))
    expect(testStorageTarget).toHaveBeenCalledWith(1)
  })

  it('shows test result after test', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
    vi.mocked(testStorageTarget).mockResolvedValue({ ok: true, output: '[]' })
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /test/i }))
    await userEvent.click(screen.getByRole('button', { name: /test/i }))
    await waitFor(() => screen.getByText(/✓ Connected/))
  })

  it('shows Init button for uninitialized targets', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ initialized: false })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /init/i }))
  })

  it('hides Init button for initialized targets', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ initialized: true })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByText(/✓ initialized/))
    expect(screen.queryByRole('button', { name: /init/i })).not.toBeInTheDocument()
  })

  it('calls initStorageTarget on Init click', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget({ initialized: false })])
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /init/i }))
    await userEvent.click(screen.getByRole('button', { name: /init/i }))
    expect(initStorageTarget).toHaveBeenCalledWith(1)
  })

  it('shows failed test result', async () => {
    vi.mocked(getStorageTargets).mockResolvedValue([makeTarget()])
    vi.mocked(testStorageTarget).mockResolvedValue({ ok: false, output: 'Fatal: no repo' })
    renderWithProviders(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /test/i }))
    await userEvent.click(screen.getByRole('button', { name: /test/i }))
    await waitFor(() => screen.getByText(/✗ Failed/))
  })
})
