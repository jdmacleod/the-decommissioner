import { useState } from 'react'
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
            onChange={(e) => setBackend(e.target.value as StorageBackend)}
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
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          required
          placeholder="/Volumes/BackupDrive/repo"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
        />
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
