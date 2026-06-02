import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevice, triggerJob, getDupStats } from '../lib/api'
import { StageProgress } from '../components/StageProgress'
import { JobLog } from '../components/JobLog'
import { MigrateStage } from './MigrateStage'
import type { DeviceStage } from '../types/api'

const CATALOG_STAGES: DeviceStage[] = ['registered', 'cataloged']

export function DeviceWizard() {
  const { id } = useParams<{ id: string }>()
  const deviceId = Number(id)
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<number | null>(null)

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => getDevice(deviceId),
    refetchInterval: 3000,
  })

  const { data: dupStats } = useQuery({
    queryKey: ['dup-stats', deviceId],
    queryFn: () => getDupStats(deviceId),
    enabled: !!device && ['cataloged', 'analyzing', 'analyzed'].includes(device.stage),
  })

  const catalogMutation = useMutation({
    mutationFn: () => triggerJob(deviceId, 'catalog'),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
    },
  })

  if (isLoading || !device) {
    return <div className="p-8 text-gray-500">Loading...</div>
  }

  const canCatalog = CATALOG_STAGES.includes(device.stage)
  const isCataloging = device.stage === 'cataloging'
  const postCatalog = ['cataloged', 'analyzing', 'analyzed'].includes(device.stage)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">{device.name}</h2>
        <div className="text-sm text-gray-500 capitalize mt-1">
          {device.device_type.replace('_', ' ')}
          {device.source_path && (
            <span className="font-mono ml-2 text-gray-400">{device.source_path}</span>
          )}
        </div>
      </div>

      <div className="mb-8">
        <StageProgress stage={device.stage} />
      </div>

      {/* Catalog Stage */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Step 1 — Catalog Files</h3>

        {isCataloging || activeJobId ? (
          activeJobId ? (
            <div>
              <div className="text-sm text-blue-600 mb-3">Cataloging…</div>
              <JobLog jobId={activeJobId} />
            </div>
          ) : (
            <div className="text-sm text-gray-500">Starting catalog job…</div>
          )
        ) : postCatalog && !activeJobId ? (
          <div>
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
              <span>✓ Catalog complete</span>
              {dupStats && dupStats.total > 0 && (
                <span className="text-green-600">
                  · {dupStats.total} duplicate group{dupStats.total !== 1 ? 's' : ''} found
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                to={`/devices/${deviceId}/files`}
                className="text-sm border border-gray-300 px-3 py-2 rounded hover:bg-gray-50"
              >
                Review Files
              </Link>
              <Link
                to={`/devices/${deviceId}/duplicates`}
                className="text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
              >
                {device.stage === 'analyzed' ? 'View Duplicates' : 'Resolve Duplicates →'}
              </Link>
              <button
                onClick={() => catalogMutation.mutate()}
                disabled={catalogMutation.isPending}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 ml-auto"
              >
                Re-catalog
              </button>
            </div>
          </div>
        ) : (
          <div>
            {device.source_path ? (
              <div>
                <div className="text-sm text-gray-600 mb-3">
                  Source: <code className="bg-gray-100 px-1 rounded text-xs">{device.source_path}</code>
                </div>
                <button
                  onClick={() => catalogMutation.mutate()}
                  disabled={!canCatalog || catalogMutation.isPending}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {catalogMutation.isPending ? 'Starting…' : 'Start Catalog'}
                </button>
              </div>
            ) : (
              <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                No source path set. Edit the device to add one before cataloging.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Migrate + Verify Stage */}
      {(() => {
        const migrateActive = [
          'analyzed', 'migrating', 'migrated', 'verifying', 'verified',
          'wiping', 'wiped', 'recycled',
        ].includes(device.stage)
        return (
          <div
            className={`border rounded-lg p-5 mt-4 ${migrateActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}
          >
            {migrateActive ? (
              <MigrateStage device={device} deviceId={deviceId} />
            ) : (
              <>
                <h3 className="font-semibold text-gray-400">Step 2 — Migrate to Storage</h3>
                <div className="text-xs text-gray-400 mt-1">Available after duplicates are resolved</div>
              </>
            )}
          </div>
        )
      })()}

      {/* Wipe / Recycle placeholders */}
      {['Step 3 — Wipe', 'Step 4 — Recycle'].map((label) => (
        <div key={label} className="bg-gray-50 border border-gray-100 rounded-lg p-5 mt-4 opacity-40">
          <h3 className="font-semibold text-gray-400">{label}</h3>
          <div className="text-xs text-gray-400 mt-1">Available after previous stage completes</div>
        </div>
      ))}
    </div>
  )
}
