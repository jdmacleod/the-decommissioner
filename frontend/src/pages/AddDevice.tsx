import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDevice, detectIos, detectVolumes } from '../lib/api'
import type { DeviceType } from '../types/api'

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: 'mac', label: 'Mac' },
  { value: 'linux', label: 'Linux Machine' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'ipad', label: 'iPad' },
  { value: 'usb_drive', label: 'USB Drive' },
  { value: 'hard_drive', label: 'Hard Drive' },
]

const IOS_TYPES: DeviceType[] = ['iphone', 'ipad']
const VOLUME_TYPES: DeviceType[] = ['hard_drive', 'usb_drive']

export function AddDevice() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [deviceType, setDeviceType] = useState<DeviceType>('hard_drive')
  const [sourcePath, setSourcePath] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [detectError, setDetectError] = useState<string | null>(null)
  const [volumes, setVolumes] = useState<{ path: string; label: string }[]>([])
  const [volumeScanDone, setVolumeScanDone] = useState(false)

  const mutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (device) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      navigate(`/devices/${device.id}`)
    },
  })

  const detectMutation = useMutation({
    mutationFn: detectIos,
    onSuccess: (result) => {
      if (result.available) {
        if (result.name) setName(result.name)
        if (result.serial) setSerialNumber(result.serial)
        setDetectError(null)
      } else {
        setDetectError('No iOS device detected. Make sure the device is connected and unlocked.')
      }
    },
    onError: () => {
      setDetectError('Detection failed. Check that ideviceinfo is installed.')
    },
  })

  const volumeMutation = useMutation({
    mutationFn: detectVolumes,
    onSuccess: (result) => {
      setVolumes(result)
      setVolumeScanDone(true)
      if (result.length > 0 && !sourcePath) {
        setSourcePath(result[0].path)
      }
    },
    onError: () => {
      setVolumeScanDone(true)
      setVolumes([])
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

  const isIos = IOS_TYPES.includes(deviceType)
  const isVolumeBased = VOLUME_TYPES.includes(deviceType)

  return (
    <div className="max-w-lg mx-auto p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Add Device</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
          <select
            value={deviceType}
            onChange={(e) => {
              setDeviceType(e.target.value as DeviceType)
              setDetectError(null)
              setVolumes([])
              setVolumeScanDone(false)
            }}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {isIos && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => detectMutation.mutate()}
              disabled={detectMutation.isPending}
              className="text-sm border border-blue-300 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-50 disabled:opacity-50"
            >
              {detectMutation.isPending ? 'Detecting…' : 'Detect Connected Device'}
            </button>
            {detectError && <span className="text-xs text-red-600">{detectError}</span>}
            {detectMutation.isSuccess && !detectError && (
              <span className="text-xs text-green-600">✓ Device detected</span>
            )}
          </div>
        )}

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

        {!isIos && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">Source Path</label>
              {isVolumeBased && (
                <button
                  type="button"
                  onClick={() => volumeMutation.mutate()}
                  disabled={volumeMutation.isPending}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {volumeMutation.isPending ? 'Scanning…' : 'Scan volumes'}
                </button>
              )}
            </div>
            {isVolumeBased && volumeScanDone && volumes.length > 0 ? (
              <select
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
              >
                {volumes.map((v) => (
                  <option key={v.path} value={v.path}>
                    {v.label} — {v.path}
                  </option>
                ))}
                <option value="">Enter manually…</option>
              </select>
            ) : (
              <input
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="/Volumes/MyDrive"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            )}
            {isVolumeBased && volumeScanDone && volumes.length === 0 && (
              <div className="text-xs text-gray-400 mt-1">No volumes detected. Enter path manually.</div>
            )}
          </div>
        )}

        {isIos && (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            iOS devices are extracted to a local staging directory automatically. Connect the
            device and use &ldquo;Detect&rdquo; above to auto-fill fields.
          </div>
        )}

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
