import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDevice,
  getDupStats,
  getDevicePhotoUrl,
  uploadDevicePhoto,
  deleteDevicePhoto,
  deleteDevice,
} from '../lib/api'
import { StageProgress } from '../components/StageProgress'
import { PhotoUpload } from '../components/PhotoUpload'
import { DeviceIcon } from '../components/DeviceIcon'
import { Button } from '@/components/ui/button'
import { CatalogStage } from '../stages/CatalogStage'
import { VerifyStage } from '../stages/VerifyStage'
import { MigrateStage } from '../stages/MigrateStage'
import { WipeStage } from '../stages/WipeStage'
import { RecycleStage } from '../stages/RecycleStage'
import type { DeviceStage } from '../types/api'

const ANALYZE_ACTIVE: DeviceStage[] = [
  'cataloged',
  'analyzing',
  'analyzed',
  'migrating',
  'migrated',
  'verifying',
  'verified',
  'wiping',
  'wiped',
  'recycled',
]
const ANALYZE_DONE: DeviceStage[] = [
  'analyzed',
  'migrating',
  'migrated',
  'verifying',
  'verified',
  'wiping',
  'wiped',
  'recycled',
]
const MIGRATE_ACTIVE: DeviceStage[] = [
  'analyzed',
  'migrating',
  'migrated',
  'verifying',
  'verified',
  'wiping',
  'wiped',
  'recycled',
]
const VERIFY_ACTIVE: DeviceStage[] = ['verifying', 'verified', 'wiping', 'wiped', 'recycled']
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
    return (
      <div className="p-8 flex items-center gap-2 text-gray-400">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        Loading…
      </div>
    )
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
    `border rounded-lg mt-3 ${active ? 'bg-white border-gray-200 p-5' : 'bg-gray-50 border-gray-100'}`

  const placeholder = (step: number, label: string) => (
    <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-400">
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <span>
        Step {step} — {label}
      </span>
    </div>
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
                <img src={photoUrl} alt={device.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                  <DeviceIcon type={device.device_type} className="w-8 h-8 text-gray-400" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              className="mt-2 text-red-500 hover:text-red-700 hover:bg-red-50 h-auto px-0 text-xs"
            >
              Delete device
            </Button>
          ) : (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">Delete forever?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setConfirmingDelete(false)
                    deleteMutation.reset()
                  }}
                >
                  Cancel
                </Button>
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
                  {device.stage === 'analyzing' ? 'Continue Resolving →' : 'Resolve Duplicates →'}
                </Link>
              </div>
            )}
          </div>
        ) : (
          placeholder(2, 'Analyze Duplicates')
        )}
      </div>

      {/* Step 3 — Migrate */}
      <div className={panelClass(MIGRATE_ACTIVE.includes(device.stage))}>
        {MIGRATE_ACTIVE.includes(device.stage) ? (
          <MigrateStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(3, 'Migrate to Storage')
        )}
      </div>

      {/* Step 4 — Verify */}
      <div className={panelClass(VERIFY_ACTIVE.includes(device.stage))}>
        {VERIFY_ACTIVE.includes(device.stage) ? (
          <VerifyStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(4, 'Verify')
        )}
      </div>

      {/* Step 5 — Wipe */}
      <div className={panelClass(WIPE_ACTIVE.includes(device.stage))}>
        {WIPE_ACTIVE.includes(device.stage) ? (
          <WipeStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(5, 'Wipe')
        )}
      </div>

      {/* Step 6 — Recycle */}
      <div className={panelClass(RECYCLE_ACTIVE.includes(device.stage))}>
        {RECYCLE_ACTIVE.includes(device.stage) ? (
          <RecycleStage device={device} deviceId={deviceId} />
        ) : (
          placeholder(6, 'Recycle')
        )}
      </div>
    </div>
  )
}
