import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDevice } from '../lib/api'
import type { DeviceType } from '../types/api'

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: 'mac', label: 'Mac' },
  { value: 'linux', label: 'Linux Machine' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'ipad', label: 'iPad' },
  { value: 'usb_drive', label: 'USB Drive' },
  { value: 'hard_drive', label: 'Hard Drive' },
]

export function AddDevice() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [deviceType, setDeviceType] = useState<DeviceType>('hard_drive')
  const [sourcePath, setSourcePath] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (device) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      navigate(`/devices/${device.id}`)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutation.mutate({
      name,
      device_type: deviceType,
      source_path: sourcePath || null,
      serial_number: serialNumber || null,
      notes: notes || null,
    })
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Add Device</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Jason's 2019 MBP"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
          <select
            value={deviceType}
            onChange={(e) => setDeviceType(e.target.value as DeviceType)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source Path</label>
          <input
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder="/Volumes/MyDrive"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
          <input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        {mutation.error && (
          <div className="text-red-600 text-sm">{String(mutation.error)}</div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Device'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="border border-gray-300 px-4 py-2 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
