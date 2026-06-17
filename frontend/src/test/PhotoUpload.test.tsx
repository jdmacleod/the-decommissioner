import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { PhotoUpload } from '../components/PhotoUpload'
import { renderWithProviders } from './helpers'

const makeFile = (name: string, type: string, sizeBytes: number): File => {
  const buf = new Uint8Array(sizeBytes).fill(0)
  return new File([buf], name, { type })
}

const render = (props: Partial<Parameters<typeof PhotoUpload>[0]> = {}) =>
  renderWithProviders(<PhotoUpload value={null} existingUrl={null} onChange={vi.fn()} {...props} />)

describe('PhotoUpload', () => {
  it('renders upload area when no photo', () => {
    render()
    expect(screen.getByText(/drag & drop or click to browse/i)).toBeInTheDocument()
    expect(screen.getByText(/jpeg, png, or webp/i)).toBeInTheDocument()
  })

  it('shows preview when existingUrl is set', () => {
    render({ existingUrl: 'http://example.com/photo.jpg' })
    const img = screen.getByRole('img', { name: /device photo preview/i })
    expect(img).toHaveAttribute('src', 'http://example.com/photo.jpg')
  })

  it('shows Change photo button when existingUrl is set', () => {
    render({ existingUrl: 'http://example.com/photo.jpg' })
    expect(screen.getByText(/change photo/i)).toBeInTheDocument()
  })

  it('shows Remove photo button when existingUrl set and onDelete provided', () => {
    render({ existingUrl: 'http://example.com/photo.jpg', onDelete: vi.fn() })
    expect(screen.getByText(/remove photo/i)).toBeInTheDocument()
  })

  it('calls onDelete when Remove photo clicked', async () => {
    const onDelete = vi.fn()
    render({ existingUrl: 'http://example.com/photo.jpg', onDelete })
    await userEvent.click(screen.getByText(/remove photo/i))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('shows preview when value (pending file) is set', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 100)
    render({ value: file })
    expect(screen.getByRole('img', { name: /device photo preview/i })).toBeInTheDocument()
  })

  it('shows Clear selection button when pending file set', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 100)
    render({ value: file })
    expect(screen.getByText(/clear selection/i)).toBeInTheDocument()
  })

  it('calls onChange(null) when Clear selection clicked', async () => {
    const onChange = vi.fn()
    const file = makeFile('photo.jpg', 'image/jpeg', 100)
    render({ value: file, onChange })
    await userEvent.click(screen.getByText(/clear selection/i))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('rejects a file with unsupported type and shows error', async () => {
    const onChange = vi.fn()
    render({ onChange })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('doc.txt', 'text/plain', 100)
    // applyAccept: false bypasses the input's accept attribute so the file reaches our handler
    await userEvent.upload(input, file, { applyAccept: false })

    await waitFor(() => expect(screen.getByText(/only jpeg, png, or webp/i)).toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects a file exceeding 5 MB and shows error', async () => {
    const onChange = vi.fn()
    render({ onChange })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const bigFile = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024)
    await userEvent.upload(input, bigFile)

    await waitFor(() => expect(screen.getByText(/5 mb or smaller/i)).toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange with valid file', async () => {
    const onChange = vi.fn()
    render({ onChange })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('photo.jpg', 'image/jpeg', 1000)
    await userEvent.upload(input, file)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(file))
  })

  it('accepts file via drag and drop', async () => {
    const onChange = vi.fn()
    render({ onChange })

    const dropZone = screen.getByText(/drag & drop or click to browse/i).closest('button')!
    const file = makeFile('photo.png', 'image/png', 500)

    fireEvent.dragOver(dropZone)
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(file))
  })

  it('rejects invalid file via drag and drop', async () => {
    const onChange = vi.fn()
    render({ onChange })

    const dropZone = screen.getByText(/drag & drop or click to browse/i).closest('button')!
    const file = makeFile('bad.txt', 'text/plain', 100)

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/only jpeg, png, or webp/i)).toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })
})
