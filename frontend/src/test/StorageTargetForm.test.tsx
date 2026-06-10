import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StorageTargetForm } from '../components/StorageTargetForm'
import { renderWithProviders } from './helpers'

vi.mock('../lib/api', () => ({
  listDirs: vi.fn(),
}))

import { listDirs } from '../lib/api'

const mockListing = {
  path: '/Volumes',
  parent: '/',
  entries: [
    { name: 'BackupDrive', path: '/Volumes/BackupDrive' },
    { name: 'External', path: '/Volumes/External' },
  ],
}

beforeEach(() => {
  vi.mocked(listDirs).mockResolvedValue(mockListing)
})

const render = (props = {}) =>
  renderWithProviders(
    <StorageTargetForm
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
      submitLabel="Add Target"
      {...props}
    />
  )

describe('StorageTargetForm', () => {
  it('renders name, path, and password env fields', () => {
    render()
    expect(screen.getByPlaceholderText(/My Backup Repo/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Volumes\/BackupDrive/i)).toBeInTheDocument()
  })

  it('shows submit and cancel buttons', () => {
    render()
    expect(screen.getByRole('button', { name: /Add Target/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
  })

  it('pre-fills fields from initial prop', () => {
    render({
      initial: { name: 'My Repo', path: '/tmp/repo', restic_password_env: 'MY_PWD' },
    })
    expect(screen.getByDisplayValue('My Repo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/tmp/repo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('MY_PWD')).toBeInTheDocument()
  })

  it('calls onSubmit with form values', async () => {
    const onSubmit = vi.fn()
    render({ onSubmit })
    await userEvent.type(screen.getByPlaceholderText(/My Backup Repo/i), 'Test Repo')
    await userEvent.type(screen.getByPlaceholderText(/Volumes\/BackupDrive/i), '/tmp/repo')
    await userEvent.click(screen.getByRole('button', { name: /Add Target/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Repo', path: '/tmp/repo' })
    )
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn()
    render({ onCancel })
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables submit button when isPending', () => {
    render({ isPending: true })
    expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled()
  })

  it('shows backend dropdown with local/sftp/s3 options', () => {
    render()
    expect(screen.getByRole('option', { name: 'Local' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'SFTP' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'S3' })).toBeInTheDocument()
  })

  it('shows Browse button for local backend', () => {
    render()
    expect(screen.getByRole('button', { name: /Browse/i })).toBeInTheDocument()
  })

  it('does not show Browse button for sftp backend', async () => {
    render()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'sftp')
    expect(screen.queryByRole('button', { name: /Browse/i })).not.toBeInTheDocument()
  })

  it('shows directory list when Browse is clicked', async () => {
    render({ initial: { path: '/Volumes' } })
    await userEvent.click(screen.getByRole('button', { name: /Browse/i }))
    await waitFor(() => screen.getByText('BackupDrive'))
    expect(screen.getByText('External')).toBeInTheDocument()
  })

  it('sets path when Use this folder is clicked', async () => {
    const onSubmit = vi.fn()
    render({ onSubmit, initial: { path: '/Volumes' } })
    await userEvent.click(screen.getByRole('button', { name: /Browse/i }))
    await waitFor(() => screen.getByRole('button', { name: /Use this folder/i }))
    await userEvent.click(screen.getByRole('button', { name: /Use this folder/i }))
    // Browser closes and path is set — submit to verify
    await userEvent.type(screen.getByPlaceholderText(/My Backup Repo/i), 'Repo')
    await userEvent.click(screen.getByRole('button', { name: /Add Target/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/Volumes' }))
  })

  it('navigates into a subdirectory when a dir entry is clicked', async () => {
    vi.mocked(listDirs).mockResolvedValueOnce(mockListing).mockResolvedValueOnce({
      path: '/Volumes/BackupDrive',
      parent: '/Volumes',
      entries: [],
    })
    render({ initial: { path: '/Volumes' } })
    await userEvent.click(screen.getByRole('button', { name: /Browse/i }))
    await waitFor(() => screen.getByText('BackupDrive'))
    await userEvent.click(screen.getByText('BackupDrive'))
    await waitFor(() => screen.getByText('No subdirectories'))
  })

  it('hides directory browser when Browse is clicked again', async () => {
    render({ initial: { path: '/Volumes' } })
    await userEvent.click(screen.getByRole('button', { name: /Browse/i }))
    await waitFor(() => screen.getByText('BackupDrive'))
    await userEvent.click(screen.getByRole('button', { name: /Browse/i }))
    expect(screen.queryByText('BackupDrive')).not.toBeInTheDocument()
  })
})
