import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDependencies, recheckDependencies,
  getStorageTargets, createStorageTarget, deleteStorageTarget,
  testStorageTarget, initStorageTarget,
} from '../lib/api'
import type { StorageBackend } from '../types/api'

export function Settings() {
  const queryClient = useQueryClient()

  // ── Dependencies ──────────────────────────────────────────────────────────
  const { data: deps = [] } = useQuery({
    queryKey: ['dependencies'],
    queryFn: getDependencies,
  })

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
  const [newName, setNewName] = useState('')
  const [newBackend, setNewBackend] = useState<StorageBackend>('local')
  const [newPath, setNewPath] = useState('')
  const [newPwdEnv, setNewPwdEnv] = useState('RESTIC_PASSWORD')
  const [newDefault, setNewDefault] = useState(false)

  const addTarget = useMutation({
    mutationFn: () =>
      createStorageTarget({
        name: newName,
        backend: newBackend,
        path: newPath,
        restic_password_env: newPwdEnv,
        is_default: newDefault,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-targets'] })
      setShowAddForm(false)
      setNewName('')
      setNewPath('')
      setNewDefault(false)
    },
  })

  const removeTarget = useMutation({
    mutationFn: (id: number) => deleteStorageTarget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-targets'] }),
  })

  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; output: string }>>({})
  const testTarget = useMutation({
    mutationFn: (id: number) => testStorageTarget(id),
    onSuccess: (data, id) => setTestResults((prev) => ({ ...prev, [id]: data })),
  })

  const initTarget = useMutation({
    mutationFn: (id: number) => initStorageTarget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-targets'] }),
  })

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Settings</h2>

      {/* Storage Targets */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Storage Target</h3>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
          >
            {showAddForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={(e) => { e.preventDefault(); addTarget.mutate() }}
            className="border border-gray-100 rounded p-3 mb-4 space-y-2 text-sm"
          >
            <div>
              <label className="block text-gray-600 mb-0.5">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                placeholder="My Backup Repo"
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-gray-600 mb-0.5">Backend</label>
                <select
                  value={newBackend}
                  onChange={(e) => setNewBackend(e.target.value as StorageBackend)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="local">Local</option>
                  <option value="sftp">SFTP</option>
                  <option value="s3">S3</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-gray-600 mb-0.5">Password env var</label>
                <input
                  value={newPwdEnv}
                  onChange={(e) => setNewPwdEnv(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-600 mb-0.5">Path / URL</label>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                required
                placeholder="/Volumes/BackupDrive/repo"
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-gray-600">
              <input
                type="checkbox"
                checked={newDefault}
                onChange={(e) => setNewDefault(e.target.checked)}
              />
              Set as default
            </label>
            <button
              type="submit"
              disabled={addTarget.isPending}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {addTarget.isPending ? 'Adding…' : 'Add Target'}
            </button>
          </form>
        )}

        {targets.length === 0 && !showAddForm && (
          <p className="text-sm text-gray-400">No storage targets configured.</p>
        )}

        <div className="space-y-3">
          {targets.map((t) => (
            <div key={t.id} className="border border-gray-100 rounded p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-800">
                    {t.name}
                    {t.is_default && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        default
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-gray-500 mt-0.5">{t.path}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {t.backend} · {t.restic_password_env} ·{' '}
                    {t.initialized ? (
                      <span className="text-green-600">✓ initialized</span>
                    ) : (
                      <span className="text-yellow-600">not initialized</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeTarget.mutate(t.id)}
                  className="text-xs text-red-400 hover:text-red-600 ml-2"
                  aria-label={`Remove ${t.name}`}
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => testTarget.mutate(t.id)}
                  disabled={testTarget.isPending}
                  className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Test
                </button>
                {!t.initialized && (
                  <button
                    onClick={() => initTarget.mutate(t.id)}
                    disabled={initTarget.isPending}
                    className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Init
                  </button>
                )}
              </div>
              {testResults[t.id] !== undefined && (
                <div
                  className={`mt-2 text-xs font-mono p-2 rounded ${testResults[t.id].ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                >
                  {testResults[t.id].ok ? '✓ Connected' : '✗ Failed'}
                  {testResults[t.id].output && (
                    <div className="text-gray-500 mt-1 truncate">{testResults[t.id].output}</div>
                  )}
                </div>
              )}
            </div>
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
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      dep.status === 'found' ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    {dep.status === 'found' ? '✓' : '✗'} {dep.status}
                  </span>
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
