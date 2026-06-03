import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDevices, getDependencies, getStorageTargets, getDevicePhotoUrl } from '../lib/api'
import type { Device, DeviceStage } from '../types/api'

function stageDot(stage: DeviceStage): { dot: boolean; className: string } {
  if (stage === 'recycled') return { dot: false, className: 'text-gray-400 text-xs font-bold' }
  if (['wiped', 'verified'].includes(stage)) return { dot: true, className: 'bg-green-500' }
  if (['cataloging', 'migrating', 'verifying', 'wiping'].includes(stage))
    return { dot: true, className: 'bg-blue-500 animate-pulse' }
  if (stage === 'analyzing') return { dot: true, className: 'bg-yellow-400 animate-pulse' }
  if (['analyzed', 'cataloged', 'migrated'].includes(stage))
    return { dot: true, className: 'bg-blue-400' }
  return { dot: true, className: 'bg-gray-300' }
}

function DeviceTypeIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    mac: '💻',
    linux: '🐧',
    iphone: '📱',
    ipad: '📱',
    usb_drive: '💾',
    hard_drive: '🖥',
  }
  return <span className="text-xs">{icons[type] ?? '📦'}</span>
}

export function DeviceSidebar() {
  const { id } = useParams<{ id?: string }>()
  const activeId = id ? Number(id) : null

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: getDevices,
    refetchInterval: 5000,
  })

  const { data: deps = [] } = useQuery({
    queryKey: ['dependencies'],
    queryFn: getDependencies,
    refetchInterval: 60000,
  })

  const { data: storageTargets = [] } = useQuery({
    queryKey: ['storage-targets'],
    queryFn: getStorageTargets,
    refetchInterval: 60000,
  })

  const missingDeps = deps.filter((d) => d.status === 'missing')

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <Link to="/" className="font-bold text-gray-900 text-sm tracking-tight">
          ◈ the-decommissioner
        </Link>
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto py-3">
        <div className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Devices
        </div>
        <nav className="space-y-0.5">
          {devices.map((device: Device) => {
            const { dot, className } = stageDot(device.stage)
            return (
              <Link
                key={device.id}
                to={`/devices/${device.id}`}
                className={`flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 ${
                  activeId === device.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                }`}
              >
                {dot ? (
                  <span className={`w-2 h-2 rounded-full shrink-0 ${className}`} />
                ) : (
                  <span className={`shrink-0 ${className}`}>✓</span>
                )}
                {device.photo_path ? (
                  <img
                    src={`${getDevicePhotoUrl(device.id)}?v=${device.updated_at}`}
                    alt={device.name}
                    className="w-5 h-5 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <DeviceTypeIcon type={device.device_type} />
                )}
                <span className="truncate">{device.name}</span>
              </Link>
            )
          })}
          {devices.length === 0 && (
            <div className="px-4 py-2 text-xs text-gray-400 italic">No devices yet</div>
          )}
        </nav>

        <Link
          to="/devices/new"
          className="flex items-center gap-2 px-4 py-2 mt-2 text-sm text-blue-600 hover:bg-blue-50"
        >
          <span className="text-base leading-none">+</span>
          <span>Add Device</span>
        </Link>
      </div>

      {/* Health footer */}
      <div className="border-t border-gray-100 py-3">
        {/* Storage targets health */}
        {storageTargets.length > 0 && (
          <div className="px-4 mb-2">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Storage
            </div>
            {storageTargets.map((t) => (
              <div key={t.id} className="flex items-center gap-1.5 text-xs py-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    t.initialized ? 'bg-green-500' : 'bg-yellow-400'
                  }`}
                />
                <span
                  className={`truncate ${t.initialized ? 'text-gray-600' : 'text-yellow-700'}`}
                  title={t.path}
                >
                  {t.initialized ? '✓ ' : ''}
                  {t.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Missing deps */}
        {missingDeps.length > 0 && (
          <div className="px-4 mb-2">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Missing tools
            </div>
            {missingDeps.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-red-600 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                <span className="font-mono">{d.name}</span>
              </div>
            ))}
          </div>
        )}

        <Link
          to="/settings"
          className="flex items-center gap-2 px-4 py-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          ⚙ Settings
        </Link>
      </div>
    </aside>
  )
}
