import type { Dependency } from '../types/api'

interface DependencyBadgeProps {
  dependency: Dependency
}

export function DependencyBadge({ dependency: dep }: DependencyBadgeProps) {
  const found = dep.status === 'found'
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
        found
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-red-50 text-red-600 border border-red-200'
      }`}
    >
      {found ? '✓' : '✗'} {dep.status}
    </span>
  )
}
