import { useMutation, useQueryClient } from '@tanstack/react-query'
import { markRecycled, getCertificateUrl } from '../lib/api'
import type { Device } from '../types/api'

interface RecycleStageProps {
  device: Device
  deviceId: number
}

const RECYCLING_OPTIONS = [
  {
    label: 'Apple Trade In',
    description: 'Get store credit or a gift card',
    url: 'https://www.apple.com/shop/trade-in',
  },
  {
    label: 'Apple Free Recycling',
    description: 'No trade-in value? Still accepted. Drop off at any Apple Store.',
    url: null,
  },
  {
    label: 'Best Buy Electronics Recycling',
    description: 'Drop off at any Best Buy location',
    url: 'https://www.bestbuy.com/site/recycling',
  },
]

export function RecycleStage({ device, deviceId }: RecycleStageProps) {
  const queryClient = useQueryClient()
  const certUrl = getCertificateUrl(deviceId)

  const recycledMutation = useMutation({
    mutationFn: () => markRecycled(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
  })

  if (device.stage === 'recycled') {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 6 — Recycle</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
          <span>&#10003; {device.name} is fully decommissioned.</span>
        </div>
        <a
          href={certUrl}
          download
          className="inline-block text-sm border border-gray-300 px-3 py-2 rounded hover:bg-gray-50"
        >
          Download Certificate (PDF)
        </a>
      </>
    )
  }

  return (
    <>
      <h3 className="font-semibold text-gray-800 mb-3">Step 6 — Recycle</h3>

      <div className="mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">Recycling options:</div>
        <div className="space-y-2">
          {RECYCLING_OPTIONS.map((opt) => (
            <div
              key={opt.label}
              className="border border-gray-100 rounded px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-800">{opt.label}</span>
                {opt.url && (
                  <a
                    href={opt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs ml-2"
                  >
                    Open &#8599;
                  </a>
                )}
              </div>
              <div className="text-gray-500 text-xs mt-0.5">{opt.description}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 mt-4 flex items-center justify-between">
        <a
          href={certUrl}
          download
          className="text-sm border border-gray-300 px-3 py-2 rounded hover:bg-gray-50"
        >
          Download Certificate (PDF)
        </a>
        <button
          onClick={() => recycledMutation.mutate()}
          disabled={recycledMutation.isPending}
          className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
        >
          {recycledMutation.isPending ? 'Saving…' : 'Mark as Recycled ✓'}
        </button>
      </div>
    </>
  )
}
