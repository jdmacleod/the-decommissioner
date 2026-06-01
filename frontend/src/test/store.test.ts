import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../lib/store'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ selectedDeviceId: null })
  })

  it('initialises with no device selected', () => {
    expect(useAppStore.getState().selectedDeviceId).toBeNull()
  })

  it('setSelectedDeviceId updates the selection', () => {
    useAppStore.getState().setSelectedDeviceId(42)
    expect(useAppStore.getState().selectedDeviceId).toBe(42)
  })

  it('setSelectedDeviceId accepts null to clear', () => {
    useAppStore.getState().setSelectedDeviceId(7)
    useAppStore.getState().setSelectedDeviceId(null)
    expect(useAppStore.getState().selectedDeviceId).toBeNull()
  })
})
