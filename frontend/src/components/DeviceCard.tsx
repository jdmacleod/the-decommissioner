import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getDupStats, getFileEntries, getDevicePhotoUrl } from '../lib/api'
import type { Device, DeviceStage } from '../types/api'

const STAGE_LABELS: Partial<Record<DeviceStage, string>> = {
  registered: 'Not started',
  cataloging: 'Cataloging…',
  cataloged: 'Cataloged',
  analyzing: 'Analyzing…',
  analyzed: 'Ready to migrate',
  migrating: 'Migrating…',
  migrated: 'Migrated',
  verifying: 'Verifying…',
  verified: 'Verified',
  wiping: 'Wiping…',
  wiped: 'Wiped',
  recycled: 'Recycled ✓',
}

const TYPE_ICON: Record<string, string> = {
  mac: '💻',
  linux: '🖥',
  iphone: '📱',
  ipad: '📲',
  usb_drive: '🗂',
  hard_drive: '💾',
  network_volume: '📦',
}

const POST_CATALOG: DeviceStage[] = [
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

function nextAction(device: Device): { label: string; href: string } | null {
  switch (device.stage) {
    case 'registered':
      return { label: 'Start Catalog →', href: `/devices/${device.id}` }
    case 'cataloged':
      return { label: 'Review Files →', href: `/devices/${device.id}/files` }
    case 'analyzed':
      return { label: 'Start Migration →', href: `/devices/${device.id}` }
    case 'verified':
      return { label: 'Start Wipe →', href: `/devices/${device.id}` }
    case 'wiped':
      return { label: 'Recycle →', href: `/devices/${device.id}` }
    default:
      return null
  }
}

function DeviceCardStats({ device }: { device: Device }) {
  const enabled = POST_CATALOG.includes(device.stage)

  const { data: fileCountPage } = useQuery({
    queryKey: ['file-entries-count', device.id],
    queryFn: () => getFileEntries({ device_id: device.id, limit: 1 }),
    enabled,
    staleTime: 120_000,
  })

  const { data: dupStats } = useQuery({
    queryKey: ['dup-stats', device.id],
    queryFn: () => getDupStats(device.id),
    enabled,
    staleTime: 120_000,
  })

  if (!enabled || (!fileCountPage && !dupStats)) return null

  return (
    <div className="mt-2 text-xs text-gray-400 space-y-0.5">
      {fileCountPage && <div>{fileCountPage.total.toLocaleString()} files</div>}
      {dupStats && dupStats.total > 0 && (
        <div>
          {dupStats.total} dup group{dupStats.total !== 1 ? 's' : ''}
          {dupStats.unresolved > 0 ? ` · ${dupStats.unresolved} unresolved` : ' · all resolved'}
        </div>
      )}
    </div>
  )
}

export function DeviceCard({ device }: { device: Device }) {
  const action = nextAction(device)
  const icon = TYPE_ICON[device.device_type] ?? '📦'
  const stageLabel = STAGE_LABELS[device.stage] ?? device.stage

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <Link to={`/devices/${device.id}`} className="block">
        <div className="flex items-start gap-2">
          {device.photo_path ? (
            <img
              src={`${getDevicePhotoUrl(device.id)}?v=${device.updated_at}`}
              alt={device.name}
              className="w-10 h-10 rounded object-cover shrink-0"
            />
          ) : (
            <span className="text-lg leading-none mt-0.5">{icon}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 truncate text-sm">{device.name}</div>
            <div className="text-xs text-gray-500 mt-0.5 capitalize">
              {device.device_type.replace('_', ' ')}
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs font-medium text-blue-700">{stageLabel}</div>
        {device.source_path && (
          <div className="text-xs text-gray-400 mt-0.5 truncate font-mono">
            {device.source_path}
          </div>
        )}
        <DeviceCardStats device={device} />
      </Link>
      {action && (
        <Link
          to={action.href}
          className="mt-3 block text-center text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-2.5 hover:bg-blue-100 min-h-[44px] flex items-center justify-center"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
