import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeviceJobs, triggerJob, updateChecklist, markWiped, detectStorageType, updateDevice } from '../lib/api'
import { JobLog } from '../components/JobLog'
import type { Device, StorageType, WipeJobMetadata } from '../types/api'

const APPLE_TYPES = ['mac', 'iphone', 'ipad', 'network_volume'] as const
type AppleType = (typeof APPLE_TYPES)[number]

const isApple = (device: Device): device is Device & { device_type: AppleType } =>
  (APPLE_TYPES as readonly string[]).includes(device.device_type)

const isUsb = (device: Device) => device.device_type === 'usb_drive'

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

  const detectMutation = useMutation({
    mutationFn: () => detectStorageType(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
  })

  const setStorageTypeMutation = useMutation({
    mutationFn: (storage_type: StorageType) => updateDevice(deviceId, { storage_type }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
  })

  // ── Terminal: wiped or recycled ───────────────────────────────────────────
  if (device.stage === 'wiped' || device.stage === 'recycled') {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Wipe</h3>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          <span>&#10003; Wipe complete</span>
        </div>
      </>
    )
  }

  // ── Wiping stage — checklist (Apple, SSD, USB) or job log (HDD) ──────────
  const isChecklistDevice = isApple(device) || isUsb(device) || device.storage_type === 'ssd'

  if (device.stage === 'wiping' && isChecklistDevice) {
    const title = isApple(device) || isUsb(device)
      ? 'Step 5 — Prepare for Recycling'
      : 'Step 5 — Secure Erase (SSD)'

    if (checklist.length === 0) {
      return (
        <>
          <h3 className="font-semibold text-gray-800 mb-3">{title}</h3>
          <div className="text-sm text-gray-400">Loading checklist…</div>
        </>
      )
    }

    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">
          Complete these steps before handing off the device.
        </p>
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

  // ── Wiping stage — overwrite job log (HDD / unknown) ─────────────────────
  if (device.stage === 'wiping') {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Wiping Drive…</h3>
        <div className="text-sm text-blue-600 mb-3">Wipe in progress — do not disconnect the drive.</div>
        {wipeMetadata.block_device && (
          <div className="text-xs text-gray-500 font-mono mb-2">
            Block device: {wipeMetadata.block_device}
          </div>
        )}
        {wipeMetadata.method && (
          <div className="text-xs text-gray-500 mb-3">
            Method: {wipeMetadata.method}
          </div>
        )}
        {effectiveJobId && <JobLog jobId={effectiveJobId} />}
      </>
    )
  }

  // ── Apple: verified stage — start checklist ───────────────────────────────
  if (device.stage === 'verified' && isApple(device)) {
    const deviceLabel = device.device_type.charAt(0).toUpperCase() + device.device_type.slice(1)
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Prepare for Recycling</h3>
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

  // ── USB flash: verified stage — always flash, skip detection ─────────────
  if (device.stage === 'verified' && isUsb(device)) {
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Erase USB Drive</h3>
        <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-4">
          USB flash drives use NAND flash storage and do not support multi-pass overwrite.
          A guided reformat checklist will be used instead.
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
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {wipeMutation.isPending ? 'Starting…' : 'Begin Erase Checklist'}
        </button>
      </>
    )
  }

  // ── HDD/SSD drives: verified stage — storage type gate ───────────────────
  if (device.stage === 'verified') {
    const storageType = device.storage_type

    // Unknown: require detection or manual selection before proceeding
    if (storageType === 'unknown') {
      return (
        <>
          <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Wipe Drive</h3>
          <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mb-4">
            &#9888; Storage type unknown — the wipe method depends on whether this drive is an
            HDD (overwrite) or SSD (cryptographic erase). Detect or select the type before
            proceeding.
          </div>
          {device.source_path && (
            <div className="text-xs text-gray-500 font-mono mb-3">
              Source: {device.source_path}
            </div>
          )}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => detectMutation.mutate()}
              disabled={detectMutation.isPending}
              className="text-sm bg-gray-100 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
            >
              {detectMutation.isPending ? 'Detecting…' : 'Auto-detect storage type'}
            </button>
            {detectMutation.isError && (
              <span className="text-xs text-red-600">Detection failed — select manually below</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span className="text-xs text-gray-500">Or select manually:</span>
            <button
              onClick={() => setStorageTypeMutation.mutate('hdd')}
              disabled={setStorageTypeMutation.isPending}
              className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              HDD (spinning disk)
            </button>
            <button
              onClick={() => setStorageTypeMutation.mutate('ssd')}
              disabled={setStorageTypeMutation.isPending}
              className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              SSD / NVMe
            </button>
          </div>
        </>
      )
    }

    // SSD confirmed: checklist path
    if (storageType === 'ssd') {
      return (
        <>
          <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Secure Erase (SSD)</h3>
          <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-4">
            Multi-pass overwrite is ineffective on SSDs. A guided cryptographic erase checklist
            will be used instead.
          </div>
          {device.source_path && (
            <div className="text-xs text-gray-500 font-mono mb-2">
              Source: {device.source_path}
            </div>
          )}
          <div className="text-xs text-gray-500 mb-4 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">SSD detected</span>
            <button
              onClick={() => setStorageTypeMutation.mutate('hdd')}
              className="underline text-gray-400 hover:text-gray-600"
            >
              Change to HDD
            </button>
          </div>
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
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {wipeMutation.isPending ? 'Starting…' : 'Begin Erase Checklist'}
          </button>
        </>
      )
    }

    // HDD confirmed: existing overwrite path
    return (
      <>
        <h3 className="font-semibold text-gray-800 mb-3">Step 5 — Wipe Drive</h3>
        <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mb-4">
          &#9888; This is irreversible. The drive will be overwritten.
          Verify your migration is complete before proceeding.
        </div>
        {device.source_path && (
          <div className="text-xs text-gray-500 font-mono mb-2">
            Source: {device.source_path}
          </div>
        )}
        <div className="text-xs text-gray-500 mb-4 flex items-center gap-2">
          <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-medium">HDD detected</span>
          <button
            onClick={() => setStorageTypeMutation.mutate('ssd')}
            className="underline text-gray-400 hover:text-gray-600"
          >
            Change to SSD
          </button>
        </div>
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

  return null
}
