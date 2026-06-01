import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Settings } from '../pages/Settings'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  getDependencies: vi.fn(),
  recheckDependencies: vi.fn(),
}))

import { getDependencies, recheckDependencies } from '../lib/api'

const mockDeps = [
  { id: 1, name: 'restic', status: 'found' as const, version: '0.16.0', required_for: '[]', install_hint: 'brew install restic', checked_at: '' },
  { id: 2, name: 'czkawka_cli', status: 'missing' as const, version: null, required_for: '[]', install_hint: 'brew install czkawka', checked_at: '' },
]

beforeEach(() => {
  vi.mocked(getDependencies).mockResolvedValue(mockDeps)
  vi.mocked(recheckDependencies).mockResolvedValue(mockDeps)
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
})
