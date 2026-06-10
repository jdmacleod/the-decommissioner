import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDependencies, recheckDependencies,
  getStorageTargets, createStorageTarget, deleteStorageTarget,
  testStorageTarget, initStorageTarget, updateStorageTarget,
} from '../lib/api'
import { StorageTargetCard } from '../components/StorageTargetCard'
import { StorageTargetForm } from '../components/StorageTargetForm'
import type { StorageTargetFormValues } from '../components/StorageTargetForm'
import { DependencyBadge } from '../components/DependencyBadge'

export function Settings() {
  const queryClient = useQueryClient()

  // ── Dependencies ──────────────────────────────────────────────────────────
  const { data: deps = [] } = useQuery({ queryKey: ['dependencies'], queryFn: getDependencies })

  const recheck = useMutation({
    mutationFn: recheckDependencies,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dependencies'] }),
  })

  // ── Storage targets ───────────────────────────────────────────────────────
  const { data: targets = [] } = useQuery({
    queryKey: ['storage-targets'],
    queryFn: getStorageTargets,
  })

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; output: string }>>({})

  const addTarget = useMutation({
    mutationFn: (values: StorageTargetFormValues) => createStorageTarget(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-targets'] })
      setShowAddForm(false)
    },
  })

  const removeTarget = useMutation({
    mutationFn: (id: number) => deleteStorageTarget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-targets'] }),
  })

  const testTarget = useMutation({
    mutationFn: (id: number) => testStorageTarget(id),
    onSuccess: (data, id) => setTestResults((prev) => ({ ...prev, [id]: data })),
  })

  const initTarget = useMutation({
    mutationFn: (id: number) => initStorageTarget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-targets'] }),
  })

  const saveEdit = useMutation({
    mutationFn: ({ id, values }: { id: number; values: StorageTargetFormValues }) =>
      updateStorageTarget(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-targets'] })
      setEditingId(null)
    },
  })

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Settings</h2>

      {/* Storage Targets */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Storage Target</h3>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
            >
              + Add
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="border border-gray-100 rounded p-3 mb-4">
            <StorageTargetForm
              onSubmit={(values) => addTarget.mutate(values)}
              onCancel={() => setShowAddForm(false)}
              isPending={addTarget.isPending}
              submitLabel="Add Target"
            />
          </div>
        )}

        {targets.length === 0 && !showAddForm && (
          <p className="text-sm text-gray-400">No storage targets configured.</p>
        )}

        <div className="space-y-3">
          {targets.map((t) => (
            <StorageTargetCard
              key={t.id}
              target={t}
              isEditing={editingId === t.id}
              testResult={testResults[t.id]}
              onEdit={() => setEditingId(t.id)}
              onCancelEdit={() => setEditingId(null)}
              onRemove={() => removeTarget.mutate(t.id)}
              onTest={() => testTarget.mutate(t.id)}
              onInit={() => initTarget.mutate(t.id)}
              onSaveEdit={(values) => saveEdit.mutate({ id: t.id, values })}
              isTestPending={testTarget.isPending}
              isInitPending={initTarget.isPending}
              isEditPending={saveEdit.isPending}
            />
          ))}
        </div>
      </div>

      {/* System Health */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">System Health</h3>
          <button
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {recheck.isPending ? 'Checking…' : 'Re-check'}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 uppercase text-left border-b border-gray-100">
              <th className="pb-2 pr-4">Tool</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Version</th>
              <th className="pb-2">Install</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {deps.map((dep) => (
              <tr key={dep.name}>
                <td className="py-2 pr-4 font-mono text-xs">{dep.name}</td>
                <td className="py-2 pr-4">
                  <DependencyBadge dependency={dep} />
                </td>
                <td className="py-2 pr-4 text-xs text-gray-500 font-mono truncate max-w-[180px]">
                  {dep.version ?? '—'}
                </td>
                <td className="py-2 text-xs text-gray-400 font-mono">
                  {dep.status !== 'found' ? dep.install_hint : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
