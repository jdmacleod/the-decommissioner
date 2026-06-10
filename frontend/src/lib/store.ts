import { create } from 'zustand'

interface AppStore {
  selectedDeviceId: number | null
  setSelectedDeviceId: (id: number | null) => void

  // Wizard step tracks which stage panel is expanded when a device is open.
  // null means the wizard derives the active step from device.stage automatically.
  wizardStep: number | null
  setWizardStep: (step: number | null) => void
}

export const useAppStore = create<AppStore>((set) => ({
  selectedDeviceId: null,
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),

  wizardStep: null,
  setWizardStep: (step) => set({ wizardStep: step }),
}))
