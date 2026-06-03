import type {
  Device, DeviceCreate, Job, Dependency,
  FileEntryPage, DuplicateGroup, DupStats, FileStatus,
  StorageTarget, StorageTargetCreate, Snapshot, IosDetectResult, StorageBackend,
  VerifyDiff, VolumeEntry,
} from '../types/api'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

// Devices
export const getDevices = () => request<Device[]>('/devices')
export const getDevice = (id: number) => request<Device>(`/devices/${id}`)
export const detectIos = () => request<IosDetectResult>('/devices/detect-ios')
export const createDevice = (body: DeviceCreate) =>
  request<Device>('/devices', { method: 'POST', body: JSON.stringify(body) })
export const updateDevice = (id: number, body: Partial<Device>) =>
  request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteDevice = (id: number) =>
  fetch(`${BASE}/devices/${id}`, { method: 'DELETE' })

// Jobs
export const getJob = (id: number) => request<Job>(`/jobs/${id}`)
export const triggerJob = (deviceId: number, jobType: string, storageTargetId?: number | null) =>
  request<{ job_id: number; status: string }>(`/devices/${deviceId}/jobs`, {
    method: 'POST',
    body: JSON.stringify({
      job_type: jobType,
      ...(storageTargetId != null ? { storage_target_id: storageTargetId } : {}),
    }),
  })
export const cancelJob = (id: number) =>
  request<{ job_id: number; status: string }>(`/jobs/${id}/cancel`, { method: 'POST' })

// File entries
export interface FileEntryQuery {
  device_id: number
  page?: number
  limit?: number
  status?: FileStatus
  search?: string
}

export const getFileEntries = (q: FileEntryQuery): Promise<FileEntryPage> => {
  const params = new URLSearchParams({ device_id: String(q.device_id) })
  if (q.page !== undefined) params.set('page', String(q.page))
  if (q.limit !== undefined) params.set('limit', String(q.limit))
  if (q.status) params.set('status', q.status)
  if (q.search) params.set('search', q.search)
  return request(`/file-entries?${params}`)
}

export const bulkUpdateFileStatus = (updates: { id: number; status: FileStatus }[]) =>
  request<{ updated: number }>('/file-entries', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })

// Duplicate groups
export const getDuplicateGroups = (deviceId: number, resolved?: boolean): Promise<DuplicateGroup[]> => {
  const params = new URLSearchParams({ device_id: String(deviceId) })
  if (resolved !== undefined) params.set('resolved', String(resolved))
  return request(`/duplicate-groups?${params}`)
}

export const resolveGroup = (groupId: number, canonicalEntryId: number) =>
  request<DuplicateGroup>(`/duplicate-groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ canonical_entry_id: canonicalEntryId }),
  })

export const autoResolveGroups = (deviceId: number) =>
  request<{ resolved: number; remaining: number }>(`/duplicate-groups/${deviceId}/auto-resolve`, {
    method: 'POST',
  })

export const getDupStats = (deviceId: number): Promise<DupStats> =>
  request(`/duplicate-groups/stats/${deviceId}`)

// Dependencies
export const getDependencies = () => request<Dependency[]>('/dependencies')
export const recheckDependencies = () =>
  request<Dependency[]>('/dependencies/recheck', { method: 'POST' })

// Storage targets
export const getStorageTargets = () => request<StorageTarget[]>('/storage-targets')
export const createStorageTarget = (body: StorageTargetCreate) =>
  request<StorageTarget>('/storage-targets', { method: 'POST', body: JSON.stringify(body) })
export const deleteStorageTarget = (id: number) =>
  fetch(`${BASE}/storage-targets/${id}`, { method: 'DELETE' })
export const testStorageTarget = (id: number) =>
  request<{ ok: boolean; output: string }>(`/storage-targets/${id}/test`, { method: 'POST' })
export const initStorageTarget = (id: number) =>
  request<{ ok: boolean; output: string }>(`/storage-targets/${id}/init`, { method: 'POST' })

// Snapshots
export const getSnapshots = (deviceId: number) =>
  request<Snapshot[]>(`/devices/${deviceId}/snapshots`)

export const getVerifyDiff = (deviceId: number) =>
  request<VerifyDiff>(`/devices/${deviceId}/verify-diff`)

// Device jobs
export const getDeviceJobs = (deviceId: number) =>
  request<Job[]>(`/devices/${deviceId}/jobs`)

// Wipe/recycle lifecycle
export const updateChecklist = (jobId: number, index: number, done: boolean) =>
  request<Job>(`/jobs/${jobId}/checklist`, {
    method: 'PATCH',
    body: JSON.stringify({ index, done }),
  })

export const markWiped = (deviceId: number) =>
  request<Device>(`/devices/${deviceId}/mark-wiped`, { method: 'POST' })

export const markRecycled = (deviceId: number) =>
  request<Device>(`/devices/${deviceId}/mark-recycled`, { method: 'POST' })

export const getCertificateUrl = (deviceId: number) => `${BASE}/devices/${deviceId}/certificate`

// Storage target update
export interface StorageTargetUpdate {
  name?: string
  backend?: StorageBackend
  path?: string
  restic_password_env?: string
  is_default?: boolean
}
export const updateStorageTarget = (id: number, body: StorageTargetUpdate) =>
  request<StorageTarget>(`/storage-targets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

// Staging dir cleanup (iOS devices)
export const clearStaging = (deviceId: number) =>
  request<Device>(`/devices/${deviceId}/clear-staging`, { method: 'POST' })

// Detect mounted volumes (for HDD/USB source path selection)
export const detectVolumes = () =>
  request<VolumeEntry[]>('/devices/detect-volumes')

// Device photos
export const getDevicePhotoUrl = (deviceId: number) => `${BASE}/devices/${deviceId}/photo`

export const uploadDevicePhoto = async (deviceId: number, file: File): Promise<Device> => {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/devices/${deviceId}/photo`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

export const deleteDevicePhoto = (deviceId: number) =>
  request<Device>(`/devices/${deviceId}/photo`, { method: 'DELETE' })
