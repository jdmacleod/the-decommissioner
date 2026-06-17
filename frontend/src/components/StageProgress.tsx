import type { DeviceStage } from '../types/api'

const STAGES: { label: string; stages: DeviceStage[] }[] = [
  { label: 'Catalog', stages: ['registered', 'cataloging', 'cataloged'] },
  { label: 'Analyze', stages: ['analyzing', 'analyzed'] },
  { label: 'Migrate', stages: ['migrating', 'migrated'] },
  { label: 'Verify', stages: ['verifying', 'verified'] },
  { label: 'Wipe', stages: ['wiping', 'wiped'] },
  { label: 'Done', stages: ['recycled'] },
]

function stageIndex(stage: DeviceStage): number {
  return STAGES.findIndex((s) => s.stages.includes(stage))
}

interface StageProgressProps {
  stage: DeviceStage
}

export function StageProgress({ stage }: StageProgressProps) {
  const current = stageIndex(stage)

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => {
        const isDone = i < current
        const isActive = i === current
        return (
          <div key={s.label} className="flex items-center gap-1">
            <div
              className={`px-3 py-1 rounded text-xs font-medium ${
                isDone
                  ? 'bg-green-600 text-white'
                  : isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s.label}
            </div>
            {i < STAGES.length - 1 && (
              <div className={`w-6 h-0.5 ${isDone ? 'bg-green-600' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
