import { create } from 'zustand'

interface AppStore {
  selectedDeviceId: number | null
  setSelectedDeviceId: (id: number | null) => void
}

export const useAppStore = create<AppStore>((set) => ({
  selectedDeviceId: null,
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
}))
