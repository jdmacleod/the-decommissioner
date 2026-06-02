import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeviceJobs, triggerJob, updateChecklist, markWiped } from '../lib/api'
import { JobLog } from '../components/JobLog'
import type { Device, WipeJobMetadata } from '../types/api'

const APPLE_TYPES = ['mac', 'iphone', 'ipad'] as const
type AppleType = (typeof APPLE_TYPES)[number]

const isApple = (device: Device): device is Device & { device_type: AppleType } =>
  (APPLE_TYPES as readonly string[]).includes(device.device_type)

interface WipeStageProps {
  device: Device
  deviceId: number
}

export function WipeStage({ device, deviceId }: WipeStageProps) {
  const queryClient = useQueryClient()
  const [confirmed, setConfirmed] = useState(false)
  const [activeJobId, setActiveJobId] = useState<number | null>(null)

  const { data: deviceJobs = [] } = useQuery({
    queryKey: ['device-jobs', deviceId],
    queryFn: () => getDeviceJobs(deviceId),
    enabled: ['wiping', 'wiped', 'recycled'].includes(device.stage),
    refetchInterval: device.stage === 'wiping' ? 2000 : false,
  })

  const wipeJob = deviceJobs.find((j) => j.job_type === 'wipe') ?? null
  const effectiveJobId = activeJobId ?? wipeJob?.id ?? null

  const wipeMetadata: WipeJobMetadata = (() => {
    try {
      return wipeJob?.job_metadata ? JSON.parse(wipeJob.job_metadata) : {}
    } catch {
      return {}
    }
  })()
  const checklist = wipeMetadata.checklist_items ?? []
  const allDone = checklist.length > 0 && checklist.every((item) => item.done)

  const wipeMutation = useMutation({
    mutationFn: () => triggerJob(deviceId, 'wipe'),
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['device-jobs', deviceId] })
    },
  })

  const checklistMutation = useMutation({
    mutationFn: ({ index, done }: { index: number; done: boolean }) =>
      updateChecklist(effectiveJobId!, index, done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device-jobs', deviceId] }),
  })

  const markWipedMutation = useMutation({
    mutationFn: () => markWiped(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
  })

  // ── Terminal: wiped or recycled ───────────────────────────────────────────
  if (device.stage === 'wiped' || device.stage === 'recycled') {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Wipe</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          <span>&#10003; Wipe complete</span>
        </div>
      </>
    )
  }

  // ── Apple checklist: wiping stage ─────────────────────────────────────────
  if (device.stage === 'wiping' && isApple(device)) {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Prepare for Recycling</h3>
        <p className="text-sm text-gray-600 mb-4">
          Complete these steps on the device before handing it off.
        </p>
        {checklist.length === 0 ? (
          <div className="text-sm text-gray-400">Loading checklist…</div>
        ) : (
          <div className="space-y-2 mb-5">
            {checklist.map((item, i) => (
              <label
                key={i}
                className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={checklistMutation.isPending}
                  onChange={(e) =>
                    checklistMutation.mutate({ index: i, done: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span className={item.done ? 'line-through text-gray-400' : ''}>{item.label}</span>
              </label>
            ))}
          </div>
        )}
        <button
          onClick={() => markWipedMutation.mutate()}
          disabled={!allDone || markWipedMutation.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {markWipedMutation.isPending ? 'Saving…' : 'Mark as Wiped'}
        </button>
      </>
    )
  }

  // ── HDD/Linux: wiping stage ───────────────────────────────────────────────
  if (device.stage === 'wiping' && !isApple(device)) {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Wiping Drive…</h3>
        <div className="text-sm text-blue-600 mb-3">Wipe in progress — do not disconnect the drive.</div>
        {effectiveJobId && <JobLog jobId={effectiveJobId} />}
      </>
    )
  }

  // ── Apple: verified stage — start checklist ───────────────────────────────
  if (device.stage === 'verified' && isApple(device)) {
    const deviceLabel = device.device_type.charAt(0).toUpperCase() + device.device_type.slice(1)
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Prepare for Recycling</h3>
        <p className="text-sm text-gray-600 mb-4">
          Start the guided decommission checklist for this {deviceLabel}. You'll step through each
          required action before handing it off.
        </p>
        <button
          onClick={() => wipeMutation.mutate()}
          disabled={wipeMutation.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {wipeMutation.isPending ? 'Starting…' : 'Begin Checklist'}
        </button>
      </>
    )
  }

  // ── HDD/Linux: verified stage — start wipe ────────────────────────────────
  return (
    <>
      <h3 className="font-semibold text-gray-800 mb-3">Step 3 — Wipe Drive</h3>

      <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mb-4">
        &#9888; This is irreversible. The drive will be overwritten.
        Verify your migration is complete before proceeding.
      </div>

      {device.source_path && (
        <div className="text-xs text-gray-500 font-mono mb-3">
          Source: {device.source_path}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        I have verified the migration snapshot is intact
      </label>

      <button
        onClick={() => wipeMutation.mutate()}
        disabled={!confirmed || wipeMutation.isPending}
        className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50"
      >
        {wipeMutation.isPending ? 'Starting…' : 'Start Wipe'}
      </button>
    </>
  )
}
