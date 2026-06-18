import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSnapshots, getVerifyDiff } from '../lib/api'
import { formatBytes } from '../lib/utils'
import type { Device } from '../types/api'

interface VerifyStageProps {
  device: Device
  deviceId: number
}

const VERIFY_STAGES = ['verifying', 'verified', 'wiping', 'wiped', 'recycled']
const DONE_STAGES = ['wiping', 'wiped', 'recycled']

export function VerifyStage({ device, deviceId }: VerifyStageProps) {
  const [pathFilter, setPathFilter] = useState('')

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots', deviceId],
    queryFn: () => getSnapshots(deviceId),
    enabled: VERIFY_STAGES.includes(device.stage),
  })

  const { data: diff } = useQuery({
    queryKey: ['verify-diff', deviceId],
    queryFn: () => getVerifyDiff(deviceId),
    enabled: device.stage === 'verified',
  })

  const latestSnapshot = snapshots[0] ?? null

  const filteredPaths = useMemo(() => {
    if (!diff?.missing_paths) return []
    const q = pathFilter.trim().toLowerCase()
    return q ? diff.missing_paths.filter((p) => p.toLowerCase().includes(q)) : diff.missing_paths
  }, [diff, pathFilter])

  if (DONE_STAGES.includes(device.stage)) {
    return (
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Step 4 — Verify</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          ✓ Verification complete
        </div>
      </div>
    )
  }

  if (device.stage === 'verifying') {
    return (
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Step 4 — Verify</h3>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="animate-spin inline-block">⟳</span>
          <span>Verification in progress…</span>
        </div>
      </div>
    )
  }

  if (device.stage === 'verified') {
    const hasDiscrepancy = diff?.discrepancy ?? false

    return (
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Step 4 — Verify</h3>

        {/* Status banner */}
        {hasDiscrepancy ? (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
            ⚠ Verification found {diff!.missing_paths.length} file
            {diff!.missing_paths.length !== 1 ? 's' : ''} not present in snapshot
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">
            ✓ Migration and verification complete
          </div>
        )}

        {/* Count comparison */}
        {diff && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600 mb-3">
            <span className="text-gray-400">Catalog</span>
            <span>{diff.catalog_count.toLocaleString()} files</span>
            <span className="text-gray-400">In snapshot</span>
            <span className={hasDiscrepancy ? 'text-amber-600 font-medium' : ''}>
              {diff.snapshot_count.toLocaleString()} files
            </span>
            <span className="text-gray-400">Difference</span>
            <span className={hasDiscrepancy ? 'text-amber-600 font-medium' : 'text-green-700'}>
              {hasDiscrepancy
                ? `${diff.missing_paths.length} file${diff.missing_paths.length !== 1 ? 's' : ''} missing`
                : '0 files ✓'}
            </span>
          </div>
        )}

        {/* Snapshot details */}
        {latestSnapshot && (
          <div className="text-sm mb-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
              <span className="text-gray-400">Snapshot</span>
              <code className="bg-gray-100 px-1 rounded text-xs">
                {latestSnapshot.restic_snapshot_id}
              </code>
              <span className="text-gray-400">Total size</span>
              <span>{formatBytes(latestSnapshot.total_bytes)}</span>
              <span className="text-gray-400">Added (net)</span>
              <span>{formatBytes(latestSnapshot.added_bytes)}</span>
            </div>
            {!hasDiscrepancy && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 mt-2">
                ✓ restic check passed — repository is consistent
              </div>
            )}
          </div>
        )}

        {/* Missing paths table */}
        {hasDiscrepancy && diff!.missing_paths.length > 0 && (
          <div className="mt-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-700">Missing files</span>
              <input
                type="text"
                placeholder="Filter paths…"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                className="ml-auto text-xs border border-gray-300 rounded px-2 py-1 w-56"
                aria-label="Filter missing paths"
              />
            </div>
            <div className="border border-amber-200 rounded overflow-hidden max-h-48 overflow-y-auto">
              {filteredPaths.length > 0 ? (
                filteredPaths.map((p) => (
                  <div
                    key={p}
                    className="px-3 py-1.5 text-xs font-mono text-gray-700 border-b border-amber-100 last:border-0 hover:bg-amber-50"
                  >
                    {p}
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-gray-400">No paths match filter.</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}
