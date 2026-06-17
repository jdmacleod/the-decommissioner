import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getDevices } from '../lib/api'
import { DeviceCard } from '../components/DeviceCard'
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
    return <div className="p-8 text-gray-500">Loading devices...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Decommissioner</h1>
        <Link
          to="/devices/new"
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          + Add Device
        </Link>
      </div>

      {devices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No devices yet.</p>
          <Link to="/devices/new" className="text-blue-500 text-sm mt-2 block">
            Add your first device →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-6">
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
