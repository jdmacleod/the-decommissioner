import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDevice,
  getDuplicateGroups,
  getDupStats,
  resolveGroup,
  autoResolveGroups,
} from '../lib/api'
import type { DuplicateGroup } from '../types/api'
import { formatBytes } from '../lib/utils'
import { DuplicateTriageMode } from './DuplicateTriageMode'

export function DuplicateResolver() {
  const { id } = useParams<{ id: string }>()
  const deviceId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cursor, setCursor] = useState(0)
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(true)
  const [triageOpen, setTriageOpen] = useState(false)

  const { data: device } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => getDevice(deviceId),
    refetchInterval: 3000,
  })

  // Fetching groups triggers the cataloged → analyzing stage transition server-side
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['duplicate-groups', deviceId, showUnresolvedOnly ? 'unresolved' : 'all'],
    queryFn: () => getDuplicateGroups(deviceId, showUnresolvedOnly ? false : undefined),
    refetchInterval: 5000,
  })

  const { data: stats } = useQuery({
    queryKey: ['dup-stats', deviceId],
    queryFn: () => getDupStats(deviceId),
    refetchInterval: 3000,
  })

  const resolveMutation = useMutation({
    mutationFn: ({ groupId, canonicalId }: { groupId: number; canonicalId: number }) =>
      resolveGroup(groupId, canonicalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicate-groups', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['dup-stats', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      setCursor((c) => Math.max(0, c))
    },
  })

  const autoMutation = useMutation({
    mutationFn: () => autoResolveGroups(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicate-groups', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['dup-stats', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      setCursor(0)
    },
  })

  const totalGroups = groups.length
  const group: DuplicateGroup | undefined = groups[cursor]
  const wastedBytes = groups.reduce(
    (sum, g) => sum + g.total_size_bytes - (g.entries[0]?.size_bytes ?? 0),
    0
  )

  const allResolved = stats && stats.unresolved === 0 && stats.total > 0

  function skipGroup() {
    if (cursor < totalGroups - 1) {
      setCursor((c) => c + 1)
    }
  }

  function keepTopEntry() {
    if (!group || group.entries.length === 0) return
    resolveMutation.mutate({ groupId: group.id, canonicalId: group.entries[0].id })
  }

  if (isLoading) return <div className="p-8 text-gray-500">Loading groups…</div>

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link to={`/devices/${deviceId}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← {device?.name ?? 'Device'}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-900">Resolve Duplicates</span>
        <div className="ml-auto">
          <button
            onClick={() => setTriageOpen(true)}
            disabled={groups.length === 0}
            className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            Keyboard triage ⌨
          </button>
        </div>
      </div>

      {triageOpen && (
        <DuplicateTriageMode
          groups={groups}
          deviceId={deviceId}
          onClose={() => setTriageOpen(false)}
        />
      )}

      <div className="flex-1 overflow-auto p-6 max-w-3xl mx-auto w-full">
        {/* Stats + controls */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            {stats && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="h-2 rounded-full bg-green-500 transition-all"
                    style={{
                      width: `${stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0}%`,
                      minWidth: 4,
                    }}
                  />
                  <div className="h-2 rounded-full bg-gray-200 flex-1" />
                </div>
                <div className="text-xs text-gray-500">
                  {stats.resolved.toLocaleString()} resolved · {stats.unresolved.toLocaleString()}{' '}
                  remaining
                  {wastedBytes > 0 && ` · ${formatBytes(wastedBytes)} recoverable`}
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showUnresolvedOnly}
              onChange={(e) => {
                setShowUnresolvedOnly(e.target.checked)
                setCursor(0)
              }}
              className="rounded"
            />
            Show unresolved only
          </label>
          <button
            onClick={() => autoMutation.mutate()}
            disabled={autoMutation.isPending}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {autoMutation.isPending ? 'Resolving…' : 'Auto-resolve all'}
          </button>
        </div>

        {/* All done */}
        {allResolved && showUnresolvedOnly && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <div className="text-green-700 font-semibold text-lg mb-1">All duplicates resolved</div>
            <div className="text-green-600 text-sm mb-4">
              {stats?.total.toLocaleString()} groups resolved · {formatBytes(wastedBytes)} freed
            </div>
            <button
              onClick={() => navigate(`/devices/${deviceId}`)}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
            >
              Continue to Migration →
            </button>
          </div>
        )}

        {/* No groups */}
        {!isLoading && totalGroups === 0 && !allResolved && (
          <div className="text-gray-500 text-sm text-center py-12">
            {showUnresolvedOnly ? 'No unresolved duplicate groups.' : 'No groups to show.'}
          </div>
        )}

        {/* Group card */}
        {group && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Group header */}
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">
                  Group {cursor + 1} of {totalGroups}
                </span>
                <span className="text-xs text-gray-400 ml-3 font-mono">
                  {group.content_hash.slice(0, 12)}…
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {group.entries.length} copies · {formatBytes(group.total_size_bytes)} total
                {group.resolved && (
                  <span className="ml-2 text-green-600 font-medium">
                    {group.auto_resolved ? '✓ auto-resolved' : '✓ resolved'}
                  </span>
                )}
              </div>
            </div>

            {/* Entries */}
            <div className="divide-y divide-gray-100">
              {group.entries.map((entry) => {
                const isCanonical = entry.id === group.canonical_entry_id
                return (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-4 px-5 py-4 ${
                      isCanonical ? 'bg-green-50' : group.resolved ? 'bg-red-50/40' : ''
                    }`}
                  >
                    <div className="pt-0.5">
                      {!group.resolved ? (
                        <button
                          onClick={() =>
                            resolveMutation.mutate({ groupId: group.id, canonicalId: entry.id })
                          }
                          disabled={resolveMutation.isPending}
                          className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-green-500 hover:bg-green-100 transition-colors flex items-center justify-center"
                          title="Keep this copy"
                        >
                          {resolveMutation.isPending && (
                            <span className="w-2 h-2 rounded-full bg-gray-300" />
                          )}
                        </button>
                      ) : (
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            isCanonical ? 'bg-green-500 text-white' : 'bg-red-200 text-red-700'
                          }`}
                        >
                          {isCanonical ? '✓' : '✕'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs font-mono truncate ${
                          isCanonical && group.resolved
                            ? 'font-semibold text-green-800'
                            : 'text-gray-700'
                        }`}
                      >
                        {entry.path}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
                        <span>{formatBytes(entry.size_bytes)}</span>
                        <span>{new Date(entry.mtime).toLocaleDateString()}</span>
                        <span
                          className={`font-medium ${
                            entry.status === 'keep'
                              ? 'text-green-600'
                              : entry.status === 'discard'
                                ? 'text-red-500'
                                : 'text-gray-400'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Actions for unresolved group */}
            {!group.resolved && (
              <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex items-center gap-3">
                <span className="text-xs text-gray-500 flex-1">
                  Click a radio button to keep that copy; the others will be marked discard.
                </span>
                <button
                  onClick={keepTopEntry}
                  disabled={resolveMutation.isPending}
                  className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                  title="Keep first entry, discard the rest"
                >
                  Keep top
                </button>
                <button
                  onClick={skipGroup}
                  disabled={cursor >= totalGroups - 1}
                  className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                >
                  Skip →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Prev / Next */}
        {totalGroups > 1 && (
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0}
              className="text-xs border border-gray-300 px-3 py-1.5 rounded disabled:opacity-40 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <button
              onClick={() => setCursor((c) => Math.min(totalGroups - 1, c + 1))}
              disabled={cursor >= totalGroups - 1}
              className="text-xs border border-gray-300 px-3 py-1.5 rounded disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
