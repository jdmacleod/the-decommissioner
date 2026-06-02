import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { StorageTargetForm } from '../components/StorageTargetForm'
import { renderWithProviders } from './helpers'

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
})
