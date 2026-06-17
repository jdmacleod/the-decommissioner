import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getDevices } from '../lib/api'
import { DeviceCard } from '../components/DeviceCard'
import { EmptyState } from '../components/EmptyState'
import { Button } from '@/components/ui/button'
import type { DeviceStage } from '../types/api'

const STAGE_GROUPS: { label: string; stages: DeviceStage[]; color: string }[] = [
  {
    label: 'Catalog',
    stages: ['registered', 'cataloging', 'cataloged', 'analyzing', 'analyzed'],
    color: 'border-blue-400',
  },
  {
    label: 'Migrate',
    stages: ['migrating', 'migrated', 'verifying', 'verified'],
    color: 'border-yellow-400',
  },
  { label: 'Wipe', stages: ['wiping', 'wiped'], color: 'border-orange-400' },
  { label: 'Done', stages: ['recycled'], color: 'border-green-400' },
]

export function Dashboard() {
  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: getDevices,
    refetchInterval: 5000,
  })

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-gray-400">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading…
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Decommissioner</h1>
        <Button asChild>
          <Link to="/devices/new">+ Add Device</Link>
        </Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          message="No devices yet."
          action={{ label: 'Add your first device →', href: '/devices/new' }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
          {STAGE_GROUPS.map((group) => {
            const groupDevices = devices.filter((d) => group.stages.includes(d.stage))
            return (
              <div key={group.label}>
                <div
                  className={`text-xs font-semibold text-gray-500 uppercase mb-3 pb-2 border-b-2 ${group.color}`}
                >
                  {group.label} ({groupDevices.length})
                </div>
                <div className="space-y-3">
                  {groupDevices.map((d) => (
                    <DeviceCard key={d.id} device={d} />
                  ))}
                  {groupDevices.length === 0 && (
                    <div className="text-xs text-gray-400 italic">empty</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
