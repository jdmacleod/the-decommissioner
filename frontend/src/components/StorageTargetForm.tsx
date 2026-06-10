import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDirs } from '../lib/api'
import type { StorageBackend, StorageTargetCreate } from '../types/api'

export interface StorageTargetFormValues {
  name: string
  backend: StorageBackend
  path: string
  restic_password_env: string
  is_default: boolean
}

interface StorageTargetFormProps {
  initial?: Partial<StorageTargetFormValues>
  onSubmit: (values: StorageTargetFormValues) => void
  onCancel: () => void
  isPending: boolean
  submitLabel: string
}

function DirBrowser({ currentPath, onSelect }: { currentPath: string; onSelect: (p: string) => void }) {
  const seedPath = currentPath && currentPath !== '' ? currentPath : '/'
  const [browsePath, setBrowsePath] = useState(seedPath)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['list-dirs', browsePath],
    queryFn: () => listDirs(browsePath),
    retry: false,
  })

  const parts = data?.path.split('/').filter(Boolean) ?? []

  return (
    <div className="border border-gray-200 rounded bg-gray-50 text-xs mt-1">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 flex-wrap">
        <button
          type="button"
          onClick={() => setBrowsePath('/')}
          className="text-blue-600 hover:underline"
        >
          /
        </button>
        {parts.map((part, i) => {
          const partPath = '/' + parts.slice(0, i + 1).join('/')
          return (
            <span key={partPath} className="flex items-center gap-1">
              <span className="text-gray-400">/</span>
              <button
                type="button"
                onClick={() => setBrowsePath(partPath)}
                className="text-blue-600 hover:underline"
              >
                {part}
              </button>
            </span>
          )
        })}
      </div>

      {/* Directory list */}
      <div className="max-h-40 overflow-y-auto">
        {isLoading && <div className="px-3 py-2 text-gray-400">Loading…</div>}
        {isError && <div className="px-3 py-2 text-red-500">Cannot read directory</div>}
        {data?.parent && (
          <button
            type="button"
            onClick={() => setBrowsePath(data.parent!)}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-gray-500 font-mono"
          >
            ..
          </button>
        )}
        {data?.entries.length === 0 && !isLoading && (
          <div className="px-3 py-2 text-gray-400">No subdirectories</div>
        )}
        {data?.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => setBrowsePath(entry.path)}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-100 font-mono flex items-center gap-1.5"
          >
            <span className="text-gray-400">&#128193;</span>
            {entry.name}
          </button>
        ))}
      </div>

      {/* Use this folder */}
      <div className="px-2 py-1.5 border-t border-gray-200 flex items-center justify-between gap-2">
        <span className="font-mono text-gray-500 truncate">{data?.path ?? browsePath}</span>
        <button
          type="button"
          onClick={() => onSelect(data?.path ?? browsePath)}
          className="shrink-0 bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
        >
          Use this folder
        </button>
      </div>
    </div>
  )
}

export function StorageTargetForm({
  initial = {},
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: StorageTargetFormProps) {
  const [name, setName] = useState(initial.name ?? '')
  const [backend, setBackend] = useState<StorageBackend>(initial.backend ?? 'local')
  const [path, setPath] = useState(initial.path ?? '')
  const [pwdEnv, setPwdEnv] = useState(initial.restic_password_env ?? 'RESTIC_PASSWORD')
  const [isDefault, setIsDefault] = useState(initial.is_default ?? false)
  const [showBrowser, setShowBrowser] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ name, backend, path, restic_password_env: pwdEnv, is_default: isDefault })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 text-sm">
      <div>
        <label className="block text-gray-600 mb-0.5">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="My Backup Repo"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-gray-600 mb-0.5">Backend</label>
          <select
            value={backend}
            onChange={(e) => {
              setBackend(e.target.value as StorageBackend)
              setShowBrowser(false)
            }}
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
            value={pwdEnv}
            onChange={(e) => setPwdEnv(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </div>
      </div>
      <div>
        <label className="block text-gray-600 mb-0.5">Path / URL</label>
        <div className="flex gap-1.5">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            placeholder={backend === 'local' ? '/Volumes/BackupDrive/repo' : backend === 'sftp' ? 'sftp:user@host:/path/repo' : 's3:s3.amazonaws.com/bucket'}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
          {backend === 'local' && (
            <button
              type="button"
              onClick={() => setShowBrowser((v) => !v)}
              className={`text-xs border px-2 py-1 rounded shrink-0 ${
                showBrowser
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-gray-300 hover:bg-gray-50 text-gray-600'
              }`}
            >
              Browse…
            </button>
          )}
        </div>
        {showBrowser && backend === 'local' && (
          <DirBrowser
            currentPath={path || '/'}
            onSelect={(p) => {
              setPath(p)
              setShowBrowser(false)
            }}
          />
        )}
      </div>
      <label className="flex items-center gap-2 text-gray-600">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        Set as default
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-gray-300 px-3 py-1 rounded text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// Re-export for convenience when building StorageTargetCreate bodies
export type { StorageTargetCreate }
