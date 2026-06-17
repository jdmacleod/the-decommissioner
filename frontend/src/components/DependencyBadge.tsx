import { Badge } from '@/components/ui/badge'
import type { Dependency } from '../types/api'

interface DependencyBadgeProps {
  dependency: Dependency
}

export function DependencyBadge({ dependency: dep }: DependencyBadgeProps) {
  return dep.status === 'found' ? (
    <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
      ✓ found
    </Badge>
  ) : (
    <Badge variant="destructive">✗ {dep.status}</Badge>
  )
}
