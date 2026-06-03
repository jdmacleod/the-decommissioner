export type DeviceType = 'mac' | 'linux' | 'iphone' | 'ipad' | 'usb_drive' | 'hard_drive'

export type DeviceStage =
  | 'registered' | 'cataloging' | 'cataloged'
  | 'analyzing' | 'analyzed'
  | 'migrating' | 'migrated'
  | 'verifying' | 'verified'
  | 'wiping' | 'wiped' | 'recycled'

export type JobType = 'catalog' | 'ios_extract' | 'migrate' | 'verify' | 'wipe'
export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type FileStatus = 'pending' | 'keep' | 'discard' | 'migrated' | 'verified'

export interface Device {
  id: number
  name: string
  device_type: DeviceType
  source_path: string | null
  serial_number: string | null
  notes: string | null
  stage: DeviceStage
  staging_path?: string | null
  photo_path?: string | null
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

export interface FileEntry {
  id: number
  device_id: number
  path: string
  relative_path: string
  size_bytes: number
  sha256: string
  mime_type: string | null
  status: FileStatus
  duplicate_group_id: number | null
}

export interface FileEntryPage {
  items: FileEntry[]
  total: number
  page: number
  limit: number
}

export interface FileEntryBrief {
  id: number
  path: string
  relative_path: string
  size_bytes: number
  mtime: string
  device_id: number
  status: FileStatus
}

export interface DuplicateGroup {
  id: number
  content_hash: string
  canonical_entry_id: number | null
  resolved: boolean
  auto_resolved: boolean
  total_size_bytes: number
  entries: FileEntryBrief[]
}

export interface DupStats {
  total: number
  resolved: number
  unresolved: number
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

export type StorageBackend = 'local' | 'sftp' | 's3'

export interface StorageTarget {
  id: number
  name: string
  backend: StorageBackend
  path: string
  restic_password_env: string
  is_default: boolean
  initialized: boolean
  created_at: string
}

export interface StorageTargetCreate {
  name: string
  backend: StorageBackend
  path: string
  restic_password_env: string
  is_default: boolean
}

export interface IosDetectResult {
  available: boolean
  name: string | null
  serial: string | null
}

export interface ChecklistItem {
  label: string
  done: boolean
}

export interface WipeJobMetadata {
  method?: string
  checklist_items?: ChecklistItem[]
  block_device?: string
}

export interface Snapshot {
  id: number
  device_id: number
  job_id: number
  storage_target_id: number
  restic_snapshot_id: string
  file_count: number
  total_bytes: number
  added_bytes: number
  tags: string | null
  taken_at: string
  verified_at: string | null
}

export interface VerifyDiff {
  discrepancy: boolean
  catalog_count: number
  snapshot_count: number
  missing_paths: string[]
}
