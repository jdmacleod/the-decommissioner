import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDependencies, getFileEntries, triggerJob, clearStaging } from '../lib/api'
import { JobLog } from '../components/JobLog'
import { Button } from '@/components/ui/button'
import type { Device, DupStats } from '../types/api'

interface CatalogStageProps {
  device: Device
  deviceId: number
  dupStats?: DupStats | null
}

const CATALOG_STAGES = ['registered', 'cataloged'] as const

export function CatalogStage({ device, deviceId, dupStats }: CatalogStageProps) {
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<number | null>(null)

  const { data: deps = [] } = useQuery({
    queryKey: ['dependencies'],
    queryFn: getDependencies,
    refetchInterval: 60000,
  })

  const { data: fileCountPage } = useQuery({
    queryKey: ['file-entries-count', deviceId],
    queryFn: () => getFileEntries({ device_id: deviceId, limit: 1 }),
    enabled: ['cataloged', 'analyzing', 'analyzed'].includes(device.stage),
  })

  const catalogMutation = useMutation({
    mutationFn: () => triggerJob(deviceId, 'catalog'),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
    },
  })

  const clearStagingMutation = useMutation({
    mutationFn: () => clearStaging(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
  })

  const canCatalog = (CATALOG_STAGES as readonly string[]).includes(device.stage)
  const isCataloging = device.stage === 'cataloging'
  const postCatalog = ['cataloged', 'analyzing', 'analyzed'].includes(device.stage)

  const czkawka = deps.find((d) => d.name === 'czkawka_cli')
  const jdupes = deps.find((d) => d.name === 'jdupes')
  const toolInfo =
    czkawka?.status === 'found'
      ? `czkawka${jdupes?.status === 'found' ? ' · jdupes (fallback)' : ''} ✓`
      : jdupes?.status === 'found'
        ? 'jdupes ✓ (fallback only — no czkawka)'
        : null

  const fileTotal = fileCountPage?.total

  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-3">Step 1 — Catalog Files</h3>

      {isCataloging || (activeJobId && !postCatalog) ? (
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
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4 flex-wrap">
            <span>✓ Catalog complete</span>
            {fileTotal !== undefined && (
              <span className="text-green-600">· {fileTotal.toLocaleString()} files</span>
            )}
            {dupStats && dupStats.total > 0 && (
              <span className="text-green-600">
                · {dupStats.total} duplicate group{dupStats.total !== 1 ? 's' : ''} found
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link
              to={`/devices/${deviceId}/files`}
              className="text-sm border border-gray-300 px-3 py-2 rounded hover:bg-gray-50"
            >
              Review Files
            </Link>
            <Button asChild size="sm">
              <Link to={`/devices/${deviceId}/duplicates`}>
                {device.stage === 'analyzed' ? 'View Duplicates' : 'Resolve Duplicates →'}
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => catalogMutation.mutate()}
              disabled={catalogMutation.isPending}
              className="ml-auto text-gray-500"
            >
              Re-catalog
            </Button>
          </div>
          {device.staging_path && (
            <div className="mt-3 flex items-center justify-between text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded px-3 py-2">
              <span>
                Staging dir: <code className="font-mono">{device.staging_path}</code>
              </span>
              <button
                onClick={() => clearStagingMutation.mutate()}
                disabled={clearStagingMutation.isPending}
                className="ml-3 text-red-400 hover:text-red-600 disabled:opacity-50"
              >
                {clearStagingMutation.isPending ? 'Removing…' : 'Free space'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          {toolInfo && (
            <div className="text-xs text-gray-500 mb-3">
              Catalog tool: <span className="font-mono text-green-700">{toolInfo}</span>
            </div>
          )}
          {device.source_path ? (
            <div>
              <div className="text-sm text-gray-600 mb-3">
                Source:{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">{device.source_path}</code>
              </div>
              <Button
                onClick={() => catalogMutation.mutate()}
                disabled={!canCatalog || catalogMutation.isPending}
              >
                {catalogMutation.isPending ? 'Starting…' : 'Start Catalog'}
              </Button>
            </div>
          ) : (
            <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
              No source path set. Edit the device to add one before cataloging.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
