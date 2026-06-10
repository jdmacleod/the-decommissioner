import type { StorageTarget } from '../types/api'
import { StorageTargetForm } from './StorageTargetForm'
import type { StorageTargetFormValues } from './StorageTargetForm'

interface StorageTargetCardProps {
  target: StorageTarget
  isEditing: boolean
  testResult?: { ok: boolean; output: string }
  initResult?: { ok: boolean; output: string }
  onEdit: () => void
  onRemove: () => void
  onTest: () => void
  onInit: () => void
  onSaveEdit: (values: StorageTargetFormValues) => void
  onCancelEdit: () => void
  isTestPending: boolean
  isInitPending: boolean
  isEditPending: boolean
}

export function StorageTargetCard({
  target,
  isEditing,
  testResult,
  initResult,
  onEdit,
  onRemove,
  onTest,
  onInit,
  onSaveEdit,
  onCancelEdit,
  isTestPending,
  isInitPending,
  isEditPending,
}: StorageTargetCardProps) {
  return (
    <div className="border border-gray-100 rounded p-3">
      {isEditing ? (
        <StorageTargetForm
          initial={{
            name: target.name,
            backend: target.backend,
            path: target.path,
            restic_password_env: target.restic_password_env,
            is_default: target.is_default,
          }}
          onSubmit={onSaveEdit}
          onCancel={onCancelEdit}
          isPending={isEditPending}
          submitLabel="Save"
        />
      ) : (
        <>
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-sm text-gray-800">
                {target.name}
                {target.is_default && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                    default
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-gray-500 mt-0.5">{target.path}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {target.backend} · {target.restic_password_env} ·{' '}
                {target.initialized ? (
                  <span className="text-green-600">✓ initialized</span>
                ) : (
                  <span className="text-yellow-600">not initialized</span>
                )}
              </div>
            </div>
            <div className="flex gap-1 ml-2">
              <button
                onClick={onEdit}
                className="text-xs text-gray-400 hover:text-gray-700"
                aria-label={`Edit ${target.name}`}
              >
                ✎
              </button>
              <button
                onClick={onRemove}
                className="text-xs text-red-400 hover:text-red-600"
                aria-label={`Remove ${target.name}`}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button
              onClick={onTest}
              disabled={isTestPending}
              className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Test
            </button>
            {!target.initialized && (
              <button
                onClick={onInit}
                disabled={isInitPending}
                className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Init
              </button>
            )}
          </div>

          {testResult !== undefined && (
            <div
              className={`mt-2 text-xs font-mono p-2 rounded ${
                testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {testResult.ok ? '✓ Connected' : '✗ Failed'}
              {testResult.output && (
                <div className="text-gray-500 mt-1 truncate">{testResult.output}</div>
              )}
            </div>
          )}

          {initResult !== undefined && (
            <div
              className={`mt-2 text-xs font-mono p-2 rounded ${
                initResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {initResult.ok ? '✓ Repository initialized' : '✗ Init failed'}
              {initResult.output && (
                <pre className="mt-1 whitespace-pre-wrap text-gray-600 text-xs max-h-32 overflow-y-auto">
                  {initResult.output}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
