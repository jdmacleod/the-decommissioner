import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DeviceIcon } from '../components/DeviceIcon'

describe('DeviceIcon', () => {
  const allTypes = [
    'mac',
    'linux',
    'iphone',
    'ipad',
    'usb_drive',
    'hard_drive',
    'network_volume',
  ] as const

  it.each(allTypes)('renders an SVG for type "%s"', (type) => {
    const { container } = render(<DeviceIcon type={type} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders default document icon for unknown type', () => {
    const { container } = render(<DeviceIcon type="unknown_device" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('applies custom className to the svg', () => {
    const { container } = render(<DeviceIcon type="mac" className="w-10 h-10" />)
    // SVG className is SVGAnimatedString in jsdom; use getAttribute instead
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('w-10')
  })

  it('falls back to default size class when className omitted', () => {
    const { container } = render(<DeviceIcon type="linux" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('w-5')
  })
})
