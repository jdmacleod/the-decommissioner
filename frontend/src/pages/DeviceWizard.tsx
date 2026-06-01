import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevice, triggerJob } from '../lib/api'
import { StageProgress } from '../components/StageProgress'
import { JobLog } from '../components/JobLog'
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
        <h3 className="font-semibold text-gray-800 mb-3">Catalog Files</h3>

        {device.stage === 'cataloged' && !activeJobId && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
            Catalog complete. Files are ready for review.
          </div>
        )}

        {isCataloging || activeJobId ? (
          activeJobId ? (
            <div>
              <div className="text-sm text-blue-600 mb-3">Catalog job running...</div>
              <JobLog jobId={activeJobId} />
            </div>
          ) : (
            <div className="text-sm text-gray-500">Starting catalog job...</div>
          )
        ) : (
          <div className="flex items-center gap-4">
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
                  {catalogMutation.isPending ? 'Starting...' : device.stage === 'cataloged' ? 'Re-catalog' : 'Start Catalog'}
                </button>
              </div>
            ) : (
              <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                No source path set. Edit the device to add a source path before cataloging.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Placeholder cards for future stages */}
      {['Migrate', 'Verify', 'Wipe', 'Recycle'].map((stage) => (
        <div key={stage} className="bg-gray-50 border border-gray-100 rounded-lg p-5 mt-4 opacity-50">
          <h3 className="font-semibold text-gray-400">{stage}</h3>
          <div className="text-xs text-gray-400 mt-1">Available after previous stage completes</div>
        </div>
      ))}
    </div>
  )
}
