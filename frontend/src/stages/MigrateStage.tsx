import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStorageTargets, triggerJob } from '../lib/api'
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

  const migrateMutation = useMutation({
    mutationFn: () =>
      triggerJob(deviceId, 'migrate', selectedTargetId ?? (targets[0]?.id ?? null)),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
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
          {activeJobId && <JobLog jobId={activeJobId} />}
        </div>
      )}

      {device.stage === 'migrated' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="animate-spin inline-block">⟳</span>
          <span>Migration complete. Verifying…</span>
        </div>
      )}
    </div>
  )
}
