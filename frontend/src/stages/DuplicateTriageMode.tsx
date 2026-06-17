import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DuplicateGroup, FileEntryBrief } from '../types/api'
import { resolveGroup } from '../lib/api'
import { formatBytes } from '../lib/utils'
import { suggestedKeeper, confidence, LOW_CONFIDENCE_THRESHOLD } from '../lib/dupHeuristic'

interface Props {
  groups: DuplicateGroup[]
  deviceId: number
  onClose: () => void
}

interface ToastState {
  message: string
  type: 'success' | 'error'
  key: number
}

export function DuplicateTriageMode({ groups, deviceId, onClose }: Props) {
  const [localGroups] = useState(() => groups.filter((g) => !g.resolved))
  const [cursor, setCursor] = useState(0)
  const [decisions, setDecisions] = useState<Map<number, number>>(() => new Map())
  const [phase, setPhase] = useState<'triage' | 'receipt'>(() =>
    groups.filter((g) => !g.resolved).length === 0 ? 'receipt' : 'triage'
  )
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()

  // Lock body scroll while mounted
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  function showToast(message: string, type: ToastState['type'] = 'success') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, type, key: Date.now() })
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 3000 : 500)
  }

  const resolveMutation = useMutation({
    mutationFn: ({ groupId, entryId }: { groupId: number; entryId: number }) =>
      resolveGroup(groupId, entryId),
    onSuccess: (_, { groupId, entryId }) => {
      setDecisions((prev) => new Map(prev).set(groupId, entryId))
      showToast('Recorded')
    },
    onError: () => {
      showToast('Failed to record — press K to go back and try again', 'error')
    },
  })

  // Keyboard handler — re-registers whenever cursor or phase changes
  useEffect(() => {
    if (phase === 'receipt') return

    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const group = localGroups[cursor]
      if (!group) return

      function doPick(entryId: number) {
        resolveMutation.mutate({ groupId: group.id, entryId })
        const next = cursor + 1
        if (next >= localGroups.length) setPhase('receipt')
        else setCursor(next)
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = cursor + 1
        if (next >= localGroups.length) setPhase('receipt')
        else setCursor(next)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        doPick(suggestedKeeper(group).id)
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        if (idx < group.entries.length) doPick(group.entries[idx].id)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, cursor, localGroups, resolveMutation])

  function handleFinish() {
    queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
    queryClient.invalidateQueries({ queryKey: ['duplicate-groups', deviceId] })
    onClose()
  }

  // Recovered bytes: sum of (total - keeper.size) for groups resolved this session
  let recovered = 0
  for (const [groupId, entryId] of decisions.entries()) {
    const group = localGroups.find((g) => g.id === groupId)
    if (!group) continue
    const keeper = group.entries.find((e) => e.id === entryId)
    if (keeper) recovered += group.total_size_bytes - keeper.size_bytes
  }

  const lowConfidenceGroups = localGroups.filter((g) => confidence(g) <= LOW_CONFIDENCE_THRESHOLD)
  const currentGroup = localGroups[cursor]

  const content = (
    <div
      className="fixed inset-0 z-50 bg-gray-950/95 flex flex-col text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard triage"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-gray-100">Keyboard Triage</span>
          {phase === 'triage' && (
            <span className="text-sm text-gray-400">
              {cursor + 1} / {localGroups.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-sm px-3 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
        >
          Exit triage
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {phase === 'triage' && currentGroup && (
          <TriageCard
            group={currentGroup}
            onPick={(entryId) => {
              resolveMutation.mutate({ groupId: currentGroup.id, entryId })
              const next = cursor + 1
              if (next >= localGroups.length) setPhase('receipt')
              else setCursor(next)
            }}
          />
        )}
        {phase === 'receipt' && (
          <ReceiptScreen
            resolvedCount={decisions.size}
            recovered={recovered}
            lowConfidenceGroups={lowConfidenceGroups}
            decisions={decisions}
            onFinish={handleFinish}
          />
        )}
      </div>

      {/* Keyboard hint strip */}
      {phase === 'triage' && (
        <div className="border-t border-gray-800 px-6 py-3 flex items-center gap-6 text-xs text-gray-500 shrink-0">
          <span>
            <kbd className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">Space</kbd> Accept
            suggestion
          </span>
          <span>
            <kbd className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">J</kbd> Next
          </span>
          <span>
            <kbd className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">K</kbd> Prev
          </span>
          <span>
            <kbd className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">1–9</kbd> Pick by index
          </span>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          key={toast.key}
          role="status"
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg pointer-events-none ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )

  return createPortal(content, document.body)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TriageCardProps {
  group: DuplicateGroup
  onPick: (entryId: number) => void
}

function TriageCard({ group, onPick }: TriageCardProps) {
  const keeper = suggestedKeeper(group)
  const conf = confidence(group)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-500">
            {group.content_hash.slice(0, 12)}…
          </span>
          <span className="text-xs text-gray-500">{formatBytes(group.total_size_bytes)} total</span>
        </div>
        {conf <= LOW_CONFIDENCE_THRESHOLD && (
          <span className="text-xs text-yellow-400 border border-yellow-700 rounded px-2 py-0.5">
            low confidence
          </span>
        )}
      </div>

      <div className="space-y-2">
        {group.entries.map((entry: FileEntryBrief, idx: number) => {
          const isSuggested = entry.id === keeper.id
          return (
            <button
              key={entry.id}
              onClick={() => onPick(entry.id)}
              className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${
                isSuggested
                  ? 'border-green-500 bg-green-950/50 hover:bg-green-950'
                  : 'border-gray-700 bg-gray-900 hover:border-gray-500'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xs text-gray-500 mt-0.5 shrink-0 font-mono w-4">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-gray-200 break-all">{entry.path}</div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    <span>{formatBytes(entry.size_bytes)}</span>
                    {entry.mtime && <span>{new Date(entry.mtime).toLocaleDateString()}</span>}
                  </div>
                </div>
                {isSuggested && (
                  <span className="text-xs text-green-400 shrink-0 mt-0.5">suggested</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {group.entries.length > 9 && (
        <p className="mt-3 text-xs text-gray-500">Use mouse to pick files beyond index 9.</p>
      )}
    </div>
  )
}

interface ReceiptScreenProps {
  resolvedCount: number
  recovered: number
  lowConfidenceGroups: DuplicateGroup[]
  decisions: Map<number, number>
  onFinish: () => void
}

function ReceiptScreen({
  resolvedCount,
  recovered,
  lowConfidenceGroups,
  decisions,
  onFinish,
}: ReceiptScreenProps) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-1">
          Done — {resolvedCount} {resolvedCount === 1 ? 'group' : 'groups'} resolved
          {recovered > 0 && `, ${formatBytes(recovered)} recovered`}
        </h2>
        <p className="text-sm text-gray-400">
          {lowConfidenceGroups.length > 0
            ? `Review ${lowConfidenceGroups.length} low-confidence ${
                lowConfidenceGroups.length === 1 ? 'decision' : 'decisions'
              } below.`
            : 'All decisions were high-confidence — nothing to review.'}
        </p>
      </div>

      {lowConfidenceGroups.length > 0 && (
        <div className="space-y-3 mb-8">
          {lowConfidenceGroups.map((group) => {
            const chosenId = decisions.get(group.id)
            return (
              <div
                key={group.id}
                className="border border-gray-700 rounded-lg px-4 py-3 bg-gray-900"
              >
                <div className="text-xs text-gray-500 font-mono mb-2">
                  {group.content_hash.slice(0, 12)}… · {formatBytes(group.total_size_bytes)}
                </div>
                {group.entries.map((entry: FileEntryBrief) => {
                  const isChosen = entry.id === chosenId
                  return (
                    <div
                      key={entry.id}
                      className={`text-xs font-mono py-0.5 ${
                        isChosen ? 'text-green-400' : 'text-gray-500 line-through'
                      }`}
                    >
                      {isChosen ? '✓ ' : '✕ '}
                      {entry.path}
                    </div>
                  )
                })}
                {chosenId === undefined && (
                  <div className="text-xs text-yellow-500 mt-1">Not resolved in this session</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={onFinish}
        className="bg-white text-gray-900 font-medium px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors"
      >
        Finish
      </button>
    </div>
  )
}
