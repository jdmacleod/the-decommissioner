import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDependencies, recheckDependencies } from '../lib/api'

export function Settings() {
  const queryClient = useQueryClient()
  const { data: deps = [] } = useQuery({
    queryKey: ['dependencies'],
    queryFn: getDependencies,
  })

  const recheck = useMutation({
    mutationFn: recheckDependencies,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dependencies'] }),
  })

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Settings</h2>

      {/* Storage Target — coming in v0.3 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6 opacity-60">
        <h3 className="font-semibold text-gray-500 mb-1">Storage Target</h3>
        <p className="text-sm text-gray-400">Configure your restic repository — available in v0.3 (Migrate)</p>
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
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                    dep.status === 'found' ? 'text-green-700' : 'text-red-600'
                  }`}>
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
