import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDevice, getDupStats, getDevicePhotoUrl, uploadDevicePhoto, deleteDevicePhoto, deleteDevice } from '../lib/api'
import { StageProgress } from '../components/StageProgress'
import { PhotoUpload } from '../components/PhotoUpload'
import { CatalogStage } from '../stages/CatalogStage'
import { VerifyStage } from '../stages/VerifyStage'
import { MigrateStage } from '../stages/MigrateStage'
import { WipeStage } from '../stages/WipeStage'
import { RecycleStage } from '../stages/RecycleStage'
import type { DeviceStage } from '../types/api'

const ANALYZE_ACTIVE: DeviceStage[] = [
  'cataloged', 'analyzing', 'analyzed',
  'migrating', 'migrated', 'verifying', 'verified',
  'wiping', 'wiped', 'recycled',
]
const ANALYZE_DONE: DeviceStage[] = [
  'analyzed', 'migrating', 'migrated', 'verifying', 'verified',
  'wiping', 'wiped', 'recycled',
]
const MIGRATE_ACTIVE: DeviceStage[] = [
  'analyzed', 'migrating', 'migrated', 'verifying', 'verified',
  'wiping', 'wiped', 'recycled',
]
const VERIFY_ACTIVE: DeviceStage[] = [
  'verifying', 'verified', 'wiping', 'wiped', 'recycled',
]
const WIPE_ACTIVE: DeviceStage[] = ['verified', 'wiping', 'wiped', 'recycled']
const RECYCLE_ACTIVE: DeviceStage[] = ['wiped', 'recycled']

export function DeviceWizard() {
  const { id } = useParams<{ id: string }>()
  const deviceId = Number(id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editingPhoto, setEditingPhoto] = useState(false)
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const uploadingRef = useRef(false)

  const deleteMutation = useMutation({
    mutationFn: () => deleteDevice(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      navigate('/')
    },
  })

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => getDevice(deviceId),
    refetchInterval: 3000,
  })

  const { data: dupStats } = useQuery({
    queryKey: ['dup-stats', deviceId],
    queryFn: () => getDupStats(deviceId),
    enabled: !!device && ANALYZE_ACTIVE.includes(device.stage),
  })

  if (isLoading || !device) {
    return <div className="p-8 text-gray-500">Loading...</div>
  }

  const photoUrl = device.photo_path
    ? `${getDevicePhotoUrl(deviceId)}?v=${device.updated_at}`
    : null

  const handlePhotoChange = async (file: File | null) => {
    setPendingPhoto(file)
    if (file && !uploadingRef.current) {
      uploadingRef.current = true
      await uploadDevicePhoto(deviceId, file).catch(() => {})
      uploadingRef.current = false
      setPendingPhoto(null)
      setEditingPhoto(false)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
    }
  }

  const handlePhotoDelete = async () => {
    await deleteDevicePhoto(deviceId).catch(() => {})
    setEditingPhoto(false)
    queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
  }

  const panelClass = (active: boolean) =>
    `border rounded-lg p-5 mt-4 ${active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-50'}`

  const placeholder = (step: number, label: string, hint: string) => (
    <>
      <h3 className="font-semibold text-gray-400">Step {step} — {label}</h3>
      <div className="text-xs text-gray-400 mt-1">{hint}</div>
    </>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start gap-4">
        {/* Photo slot */}
        <div className="shrink-0">
          {editingPhoto ? (
            <div className="w-48">
              <PhotoUpload
                value={pendingPhoto}
                existingUrl={photoUrl}
                onChange={handlePhotoChange}
                onDelete={handlePhotoDelete}
              />
              {!pendingPhoto && (
                <button
                  type="button"
                  onClick={() => setEditingPhoto(false)}
                  className="mt-1 text-xs text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingPhoto(true)}
              title="Add or change photo"
              className="group relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={device.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center text-3xl">
                  {device.device_type === 'mac' ? '💻'
                    : device.device_type === 'linux' ? '🐧'
                    : device.device_type === 'iphone' ? '📱'
                    : device.device_type === 'ipad' ? '📱'
                    : '💾'}
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-xs font-medium">📷</span>
              </div>
            </button>
          )}
        </div>

        <div>
          <h2 className="text-xl font-bold text-gray-900">{device.name}</h2>
          <div className="text-sm text-gray-500 capitalize mt-1">
            {device.device_type.replace('_', ' ')}
            {device.source_path && (
              <span className="font-mono ml-2 text-gray-400">{device.source_path}</span>
            )}
          </div>

          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="mt-3 text-xs text-red-500 hover:text-red-700"
            >
              Delete device
            </button>
          ) : (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">Delete forever?</span>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="text-xs text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingDelete(false); deleteMutation.reset() }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
              {deleteMutation.isError && (
                <div className="mt-1 text-xs text-red-600">
                  {String(deleteMutation.error).includes('409')
                    ? 'Cannot delete: a job is currently running.'
                    : 'Delete failed. Please try again.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-8">
        <StageProgress stage={device.stage} />
      </div>

      {/* Step 1 — Catalog */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <CatalogStage device={device} deviceId={deviceId} dupStats={dupStats} />
      </div>

      {/* Step 2 — Analyze */}
      <div className={panelClass(ANALYZE_ACTIVE.includes(device.stage))}>
        {ANALYZE_ACTIVE.includes(device.stage) ? (
          <div>
            <h3 className="font-semibold text-gray-800 mb-3">Step 2 — Analyze Duplicates</h3>
            {ANALYZE_DONE.includes(device.stage) ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                ✓ Duplicate analysis complete
              </div>
            ) : (
              <div>
                {dupStats && dupStats.total > 0 && (
                  <div className="text-sm text-gray-600 mb-3">
                    {dupStats.unresolved.toLocaleString()} group
                    {dupStats.unresolved !== 1 ? 's' : ''} remaining ·{' '}
                    {dupStats.resolved.toLocaleString()} resolved
                  </div>
                )}
                <Link
                  to={`/devices/${deviceId}/duplicates`}
                  className="inline-block bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
                >
                  {device.stage === 'analyzing'
                    ? 'Continue Resolving →'
                    : 'Resolve Duplicates →'}
                </Link>
              </div>
            )}
          </div>
        ) : (
          placeholder(2, 'Analyze Duplicates', 'Available after cataloging')
        )}
      </div>

      {/* Step 3 — Migrate */}
      <div className={panelClass(MIGRATE_ACTIVE.includes(device.stage))}>
        {MIGRATE_ACTIVE.includes(device.stage) ? (
          <MigrateStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(3, 'Migrate to Storage', 'Available after duplicates are resolved')
        )}
      </div>

      {/* Step 4 — Verify */}
      <div className={panelClass(VERIFY_ACTIVE.includes(device.stage))}>
        {VERIFY_ACTIVE.includes(device.stage) ? (
          <VerifyStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(4, 'Verify', 'Available after migration completes')
        )}
      </div>

      {/* Step 5 — Wipe */}
      <div className={panelClass(WIPE_ACTIVE.includes(device.stage))}>
        {WIPE_ACTIVE.includes(device.stage) ? (
          <WipeStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(5, 'Wipe', 'Available after previous stage completes')
        )}
      </div>

      {/* Step 6 — Recycle */}
      <div className={panelClass(RECYCLE_ACTIVE.includes(device.stage))}>
        {RECYCLE_ACTIVE.includes(device.stage) ? (
          <RecycleStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(6, 'Recycle', 'Available after previous stage completes')
        )}
      </div>
    </div>
  )
}
