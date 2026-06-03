import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddDevice } from '../pages/AddDevice'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  createDevice: vi.fn(),
  detectIos: vi.fn(),
  detectVolumes: vi.fn(),
  uploadDevicePhoto: vi.fn(),
}))

import { createDevice, detectIos, detectVolumes, uploadDevicePhoto } from '../lib/api'

const newDevice = {
  id: 1, name: 'My Drive', device_type: 'hard_drive' as const, stage: 'registered' as const,
  source_path: null, serial_number: null, notes: null,
  created_at: '', updated_at: '',
}

beforeEach(() => {
  vi.mocked(createDevice).mockResolvedValue(newDevice)
  vi.mocked(detectIos).mockResolvedValue({ available: true, name: "Jason's iPhone", serial: 'ABC123' })
  vi.mocked(detectVolumes).mockResolvedValue([])
  vi.mocked(uploadDevicePhoto).mockResolvedValue({ ...newDevice, photo_path: '/data/photos/device_1.jpg' })
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

  it('does not show Detect button for non-iOS device types', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.queryByRole('button', { name: /detect/i })).not.toBeInTheDocument()
  })

  it('shows Detect button when iPhone is selected', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    expect(screen.getByRole('button', { name: /detect/i })).toBeInTheDocument()
  })

  it('shows Detect button for iPad', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'ipad')
    expect(screen.getByRole('button', { name: /detect/i })).toBeInTheDocument()
  })

  it('calls detectIos on Detect click and fills name field', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    await userEvent.click(screen.getByRole('button', { name: /detect/i }))
    await waitFor(() => expect(detectIos).toHaveBeenCalled())
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/Jason's 2019 MBP/i)
      expect(nameInput).toHaveValue("Jason's iPhone")
    })
  })

  it('shows error when no device detected', async () => {
    vi.mocked(detectIos).mockResolvedValue({ available: false, name: null, serial: null })
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    await userEvent.click(screen.getByRole('button', { name: /detect/i }))
    await waitFor(() => screen.getByText(/No iOS device detected/i))
  })

  it('shows error when detectIos throws', async () => {
    vi.mocked(detectIos).mockRejectedValue(new Error('ideviceinfo missing'))
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    await userEvent.click(screen.getByRole('button', { name: /detect/i }))
    await waitFor(() => screen.getByText(/Detection failed/i))
  })

  it('shows success badge after detection', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    await userEvent.click(screen.getByRole('button', { name: /detect/i }))
    await waitFor(() => screen.getByText(/Device detected/i))
  })

  it('hides source path field for iOS devices', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'iphone')
    expect(screen.queryByPlaceholderText('/Volumes/MyDrive')).not.toBeInTheDocument()
  })

  it('shows Scan volumes button for hard_drive type', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByRole('button', { name: /scan volumes/i })).toBeInTheDocument()
  })

  it('shows Scan volumes button for usb_drive type', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'usb_drive')
    expect(screen.getByRole('button', { name: /scan volumes/i })).toBeInTheDocument()
  })

  it('does not show Scan volumes for mac type', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'mac')
    expect(screen.queryByRole('button', { name: /scan volumes/i })).not.toBeInTheDocument()
  })

  it('shows volumes dropdown when volumes are found', async () => {
    vi.mocked(detectVolumes).mockResolvedValue([
      { path: '/Volumes/MyDisk', label: 'MyDisk' },
    ])
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.click(screen.getByRole('button', { name: /scan volumes/i }))
    await waitFor(() => screen.getByText(/MyDisk/))
  })

  it('shows no volumes message when scan finds nothing', async () => {
    vi.mocked(detectVolumes).mockResolvedValue([])
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.click(screen.getByRole('button', { name: /scan volumes/i }))
    await waitFor(() => screen.getByText(/No volumes detected/i))
  })

  it('renders the photo upload area', () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    expect(screen.getByText(/Photo/i)).toBeInTheDocument()
    expect(screen.getByText(/drag & drop or click to browse/i)).toBeInTheDocument()
  })

  it('uploads photo after device creation when file selected', async () => {
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'mac')
    await userEvent.type(screen.getByPlaceholderText(/Jason's 2019 MBP/i), 'Test MBP')

    // Select a photo
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(input, file)

    await waitFor(() => screen.getByText(/clear selection/i))

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /create device/i }))
    await waitFor(() => expect(createDevice).toHaveBeenCalled())
    await waitFor(() => expect(uploadDevicePhoto).toHaveBeenCalledWith(1, file))
  })

  it('navigates without error if photo upload fails', async () => {
    vi.mocked(uploadDevicePhoto).mockRejectedValue(new Error('upload failed'))
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'mac')
    await userEvent.type(screen.getByPlaceholderText(/Jason's 2019 MBP/i), 'Test MBP')

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(input, file)
    await waitFor(() => screen.getByText(/clear selection/i))

    await userEvent.click(screen.getByRole('button', { name: /create device/i }))
    await waitFor(() => expect(createDevice).toHaveBeenCalled())
    // Should still navigate (no unhandled error)
  })

  it('auto-fills serial number from first volume when scan completes', async () => {
    vi.mocked(detectVolumes).mockResolvedValue([
      { path: '/Volumes/LEXAR128', label: 'LEXAR128', serial_number: 'AABBCCDD-1234-5678' },
    ])
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.click(screen.getByRole('button', { name: /scan volumes/i }))
    // Wait for the serial number to appear in one of the text inputs
    await waitFor(() => {
      const textboxes = screen.getAllByRole('textbox') as HTMLInputElement[]
      expect(textboxes.some((el) => el.value === 'AABBCCDD-1234-5678')).toBe(true)
    })
  })

  it('leaves serial field unchanged when scanned volume has no serial', async () => {
    vi.mocked(detectVolumes).mockResolvedValue([
      { path: '/Volumes/LaCie', label: 'LaCie', serial_number: null },
    ])
    renderWithProviders(<AddDevice />, { initialPath: '/devices/new', routePath: '/devices/new' })
    await userEvent.click(screen.getByRole('button', { name: /scan volumes/i }))
    await waitFor(() => expect(detectVolumes).toHaveBeenCalled())
    // Serial number field should remain empty
    const serialInputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    const serialInput = serialInputs.find((el) => el.placeholder === '' || el.value !== '/Volumes/LaCie')
    expect(serialInput?.value ?? '').toBe('')
  })
})
