import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddDevice } from '../pages/AddDevice'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  createDevice: vi.fn(),
}))

import { createDevice } from '../lib/api'

const newDevice = {
  id: 1, name: 'My Drive', device_type: 'hard_drive' as const, stage: 'registered' as const,
  source_path: null, serial_number: null, notes: null,
  created_at: '', updated_at: '',
}

beforeEach(() => {
  vi.mocked(createDevice).mockResolvedValue(newDevice)
})

describe('AddDevice form', () => {
  it('renders the form fields', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByPlaceholderText(/Jason's 2019 MBP/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('shows all device type options', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByRole('option', { name: 'Mac' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Hard Drive' })).toBeInTheDocument()
  })

  it('shows Create Device button', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByRole('button', { name: /create device/i })).toBeInTheDocument()
  })

  it('shows Cancel button', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('updates name field on input', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    const input = screen.getByPlaceholderText(/Jason's 2019 MBP/i)
    await userEvent.type(input, 'My MBP')
    expect(input).toHaveValue('My MBP')
  })

  it('updates device type select', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, 'mac')
    expect(select).toHaveValue('mac')
  })

  it('shows source path and serial number fields', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByPlaceholderText('/Volumes/MyDrive')).toBeInTheDocument()
  })

  it('calls createDevice on submit and navigates away', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.type(screen.getByPlaceholderText(/Jason's 2019 MBP/i), 'My Drive')
    fireEvent.submit(screen.getByRole('button', { name: /create device/i }).closest('form')!)
    await waitFor(() => expect(createDevice).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('navigated')).toBeInTheDocument())
  })

  it('shows error message on mutation failure', async () => {
    vi.mocked(createDevice).mockRejectedValue(new Error('Network error'))
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    fireEvent.submit(screen.getByRole('button', { name: /create device/i }).closest('form')!)
    await waitFor(() => expect(screen.getByText(/Network error/)).toBeInTheDocument())
  })

  it('cancel button navigates to dashboard', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.getByTestId('navigated')).toBeInTheDocument())
  })
})
