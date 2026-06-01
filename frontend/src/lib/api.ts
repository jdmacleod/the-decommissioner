import type { Device, DeviceCreate, Job, Dependency } from '../types/api'

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
export const createDevice = (body: DeviceCreate) =>
  request<Device>('/devices', { method: 'POST', body: JSON.stringify(body) })
export const deleteDevice = (id: number) =>
  fetch(`${BASE}/devices/${id}`, { method: 'DELETE' })

// Jobs
export const getJob = (id: number) => request<Job>(`/jobs/${id}`)
export const triggerJob = (deviceId: number, jobType: string) =>
  request<{ job_id: number; status: string }>(`/devices/${deviceId}/jobs`, {
    method: 'POST',
    body: JSON.stringify({ job_type: jobType }),
  })
export const cancelJob = (id: number) =>
  request<{ job_id: number; status: string }>(`/jobs/${id}/cancel`, { method: 'POST' })

// Dependencies
export const getDependencies = () => request<Dependency[]>('/dependencies')
export const recheckDependencies = () =>
  request<Dependency[]>('/dependencies/recheck', { method: 'POST' })
