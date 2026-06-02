import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStorageTargets, getSnapshots, triggerJob } from '../lib/api'
import { JobLog } from '../components/JobLog'
import type { Device } from '../types/api'

interface MigrateStageProps {
  device: Device
  deviceId: number
}

export function MigrateStage({ device, deviceId }: MigrateStageProps) {
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: targets = [] } = useQuery({
    queryKey: ['storage-targets'],
    queryFn: getStorageTargets,
  })

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots', deviceId],
    queryFn: () => getSnapshots(deviceId),
    enabled: device.stage === 'verified',
  })

  const migrateMutation = useMutation({
    mutationFn: () => triggerJob(deviceId, 'migrate', selectedTargetId ?? (targets[0]?.id ?? null)),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
    },
  })

  const isMigratingOrVerifying =
    device.stage === 'migrating' || device.stage === 'migrated' || device.stage === 'verifying'
  const isVerified = device.stage === 'verified'
  const isReady = device.stage === 'analyzed'

  const effectiveTargetId = selectedTargetId ?? targets.find((t) => t.is_default)?.id ?? targets[0]?.id

  const latestSnapshot = snapshots[0] ?? null

  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-3">Step 2 — Migrate to Storage</h3>

      {isReady && (
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

      {isMigratingOrVerifying && (
        <div>
          <div className="text-sm text-blue-600 mb-2">
            {device.stage === 'migrating'
              ? 'Migrating files…'
              : device.stage === 'migrated'
                ? 'Migration complete. Verifying…'
                : 'Verifying snapshot…'}
          </div>
          {activeJobId && device.stage === 'migrating' ? (
            <JobLog jobId={activeJobId} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
              <span className="animate-spin">⟳</span>
              <span>Verification in progress…</span>
            </div>
          )}
        </div>
      )}

      {isVerified && (
        <div>
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">
            &#10003; Migration and verification complete
          </div>
          {latestSnapshot ? (
            <div className="text-sm space-y-2 mb-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                <span className="text-gray-400">Snapshot</span>
                <code className="bg-gray-100 px-1 rounded text-xs">
                  {latestSnapshot.restic_snapshot_id}
                </code>
                <span className="text-gray-400">Files</span>
                <span>{latestSnapshot.file_count.toLocaleString()}</span>
                <span className="text-gray-400">Total size</span>
                <span>{(latestSnapshot.total_bytes / 1e9).toFixed(2)} GB</span>
                <span className="text-gray-400">Added (net)</span>
                <span>{(latestSnapshot.added_bytes / 1e9).toFixed(2)} GB</span>
                <span className="text-gray-400">Verified at</span>
                <span>
                  {latestSnapshot.verified_at
                    ? new Date(latestSnapshot.verified_at).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-green-700 mt-1">
                &#10003; restic check passed — repository is consistent
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 mb-3">No snapshot record found.</div>
          )}
        </div>
      )}
    </div>
  )
}
