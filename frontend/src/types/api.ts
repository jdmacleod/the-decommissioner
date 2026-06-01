export type DeviceType = 'mac' | 'linux' | 'iphone' | 'ipad' | 'usb_drive' | 'hard_drive'

export type DeviceStage =
  | 'registered' | 'cataloging' | 'cataloged'
  | 'analyzing' | 'analyzed'
  | 'migrating' | 'migrated'
  | 'verifying' | 'verified'
  | 'wiping' | 'wiped' | 'recycled'

export type JobType = 'catalog' | 'ios_extract' | 'migrate' | 'verify' | 'wipe'
export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface Device {
  id: number
  name: string
  device_type: DeviceType
  source_path: string | null
  serial_number: string | null
  notes: string | null
  stage: DeviceStage
  created_at: string
  updated_at: string
}

export interface DeviceCreate {
  name: string
  device_type: DeviceType
  source_path?: string | null
  serial_number?: string | null
  notes?: string | null
}

export interface Job {
  id: number
  device_id: number
  job_type: JobType
  status: JobStatus
  started_at: string | null
  completed_at: string | null
  exit_code: number | null
  error_message: string | null
  log_path: string
  job_metadata: string | null
  created_at: string
}

export interface Dependency {
  id: number
  name: string
  required_for: string
  status: 'found' | 'missing' | 'wrong_version'
  version: string | null
  install_hint: string
  checked_at: string
}
