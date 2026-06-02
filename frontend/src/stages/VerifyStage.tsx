import { useQuery } from '@tanstack/react-query'
import { getSnapshots } from '../lib/api'
import type { Device } from '../types/api'

interface VerifyStageProps {
  device: Device
  deviceId: number
}

export function VerifyStage({ device, deviceId }: VerifyStageProps) {
  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots', deviceId],
    queryFn: () => getSnapshots(deviceId),
    enabled: ['verifying', 'verified', 'wiping', 'wiped', 'recycled'].includes(device.stage),
  })

  const latestSnapshot = snapshots[0] ?? null

  if (['wiping', 'wiped', 'recycled'].includes(device.stage)) {
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
    return (
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Step 4 — Verify</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">
          ✓ Migration and verification complete
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
              ✓ restic check passed — repository is consistent
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400 mb-3">No snapshot record found.</div>
        )}
      </div>
    )
  }

  return null
}
