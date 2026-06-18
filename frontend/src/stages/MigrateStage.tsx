import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStorageTargets, triggerJob, getDeviceJobs, getSnapshots } from '../lib/api'
import { JobLog } from '../components/JobLog'
import { useJobStream } from '../lib/stream'
import { formatBytes } from '../lib/utils'
import type { Device } from '../types/api'

interface MigrateStageProps {
  device: Device
  deviceId: number
}

function ProgressBar({ percent, etaSeconds }: { percent: number; etaSeconds?: number | null }) {
  const etaStr =
    etaSeconds == null
      ? 'estimating…'
      : etaSeconds < 60
        ? `${etaSeconds}s remaining`
        : `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s remaining`

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>{Math.round(percent * 100)}%</span>
        <span>{etaStr}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          role="progressbar"
          aria-valuenow={Math.round(percent * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-blue-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.round(percent * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function MigrateStage({ device, deviceId }: MigrateStageProps) {
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: targets = [] } = useQuery({
    queryKey: ['storage-targets'],
    queryFn: getStorageTargets,
  })

  // Recover job ID on page refresh when stage is migrating
  const { data: deviceJobs = [] } = useQuery({
    queryKey: ['device-jobs', deviceId],
    queryFn: () => getDeviceJobs(deviceId),
    enabled: device.stage === 'migrating',
    refetchInterval: device.stage === 'migrating' ? 2000 : false,
  })

  const migrateJob = deviceJobs.find((j) => j.job_type === 'migrate') ?? null
  const effectiveJobId = activeJobId ?? migrateJob?.id ?? null

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots', deviceId],
    queryFn: () => getSnapshots(deviceId),
    enabled: ['migrated', 'verifying', 'verified', 'wiping', 'wiped', 'recycled'].includes(
      device.stage
    ),
  })

  const latestSnapshot = snapshots[0] ?? null

  const { progress } = useJobStream(device.stage === 'migrating' ? effectiveJobId : null)

  const migrateMutation = useMutation({
    mutationFn: () => triggerJob(deviceId, 'migrate', selectedTargetId ?? targets[0]?.id ?? null),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['snapshots', deviceId] })
    },
  })

  const effectiveTargetId =
    selectedTargetId ?? targets.find((t) => t.is_default)?.id ?? targets[0]?.id

  // Once verification starts (or device moves past migrated), show complete state
  if (['verifying', 'verified', 'wiping', 'wiped', 'recycled'].includes(device.stage)) {
    return (
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Migrate to Storage</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          ✓ Migration complete
        </div>
      </div>
    )
  }

  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Migrate to Storage</h3>

      {device.stage === 'analyzed' && (
        <div>
          {targets.length === 0 ? (
            <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mb-3">
              No storage target configured.{' '}
              <a href="/settings" className="underline">
                Add one in Settings →
              </a>
            </div>
          ) : (
            <div className="mb-3">
              <label className="text-sm text-gray-600 block mb-1">Storage target</label>
              <select
                value={effectiveTargetId ?? ''}
                onChange={(e) => setSelectedTargetId(Number(e.target.value))}
                className="text-sm border border-gray-300 rounded px-2 py-1.5 w-full max-w-xs"
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.path}
                    {t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={() => migrateMutation.mutate()}
            disabled={targets.length === 0 || migrateMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {migrateMutation.isPending ? 'Starting…' : 'Start Migration'}
          </button>
          {activeJobId && (
            <div className="mt-4">
              <JobLog jobId={activeJobId} />
            </div>
          )}
        </div>
      )}

      {device.stage === 'migrating' && (
        <div>
          <div className="text-sm text-blue-600 mb-2">Migrating files…</div>
          {progress && (
            <ProgressBar percent={progress.percent_done ?? 0} etaSeconds={progress.eta_seconds} />
          )}
          {effectiveJobId && <JobLog jobId={effectiveJobId} />}
        </div>
      )}

      {device.stage === 'migrated' && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex-wrap">
          <span>✓ Migration complete</span>
          {latestSnapshot && (
            <>
              <span className="text-green-600">
                · {latestSnapshot.file_count.toLocaleString()} files
              </span>
              <span className="text-green-600">· {formatBytes(latestSnapshot.total_bytes)}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
