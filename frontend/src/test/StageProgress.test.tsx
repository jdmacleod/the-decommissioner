import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StageProgress } from '../components/StageProgress'

describe('StageProgress', () => {
  it('shows all stage labels', () => {
    render(<StageProgress stage="registered" />)
    expect(screen.getByText('Catalog')).toBeInTheDocument()
    expect(screen.getByText('Analyze')).toBeInTheDocument()
    expect(screen.getByText('Migrate')).toBeInTheDocument()
    expect(screen.getByText('Verify')).toBeInTheDocument()
    expect(screen.getByText('Wipe')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('highlights Catalog as active for registered stage', () => {
    render(<StageProgress stage="registered" />)
    const catalog = screen.getByText('Catalog')
    expect(catalog.className).toContain('bg-blue-600')
  })

  it('marks Catalog as done when migrating', () => {
    render(<StageProgress stage="migrating" />)
    const catalog = screen.getByText('Catalog')
    expect(catalog.className).toContain('bg-green-600')
    const migrate = screen.getByText('Migrate')
    expect(migrate.className).toContain('bg-blue-600')
  })

  it('marks all stages done when recycled', () => {
    render(<StageProgress stage="recycled" />)
    const done = screen.getByText('Done')
    expect(done.className).toContain('bg-blue-600')
  })

  it('shows inactive stages in gray', () => {
    render(<StageProgress stage="registered" />)
    const migrate = screen.getByText('Migrate')
    expect(migrate.className).toContain('bg-gray-200')
  })
})
