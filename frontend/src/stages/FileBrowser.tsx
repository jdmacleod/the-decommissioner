import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getDevice, getFileEntries, bulkUpdateFileStatus } from '../lib/api'
import type { FileEntry, FileStatus } from '../types/api'
import { formatBytes } from '../lib/utils'

const STATUS_OPTIONS: { value: FileStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'text-gray-500' },
  { value: 'keep', label: 'Keep', color: 'text-green-700' },
  { value: 'discard', label: 'Discard', color: 'text-red-600' },
]

const PAGE_SIZE = 500

const col = createColumnHelper<FileEntry>()

export function FileBrowser() {
  const { id } = useParams<{ id: string }>()
  const deviceId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<FileStatus | ''>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // Local status overrides before flushing to server
  const pendingUpdates = useRef<Map<number, FileStatus>>(new Map())
  const [localStatuses, setLocalStatuses] = useState<Map<number, FileStatus>>(new Map())

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: device } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => getDevice(deviceId),
  })

  const queryKey = ['file-entries', deviceId, page, statusFilter, debouncedSearch]
  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      getFileEntries({
        device_id: deviceId,
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
      }),
    placeholderData: (prev) => prev,
  })

  const flushMutation = useMutation({
    mutationFn: (updates: { id: number; status: FileStatus }[]) => bulkUpdateFileStatus(updates),
    onSuccess: () => {
      pendingUpdates.current.clear()
      setLocalStatuses(new Map())
      queryClient.invalidateQueries({ queryKey: ['file-entries', deviceId] })
    },
  })

  const flushUpdates = useCallback(() => {
    if (pendingUpdates.current.size === 0) return
    const updates = Array.from(pendingUpdates.current.entries()).map(([id, status]) => ({
      id,
      status,
    }))
    flushMutation.mutate(updates)
  }, [flushMutation])

  // Flush on unmount
  useEffect(
    () => () => {
      flushUpdates()
    },
    [flushUpdates]
  )

  function setRowStatus(fileId: number, status: FileStatus) {
    pendingUpdates.current.set(fileId, status)
    setLocalStatuses((prev) => new Map(prev).set(fileId, status))
  }

  const columns = useMemo(
    () => [
      col.accessor('status', {
        header: 'Status',
        size: 110,
        cell: ({ row }) => {
          const effectiveStatus = localStatuses.get(row.original.id) ?? row.original.status
          return (
            <select
              value={effectiveStatus}
              onChange={(e) => setRowStatus(row.original.id, e.target.value as FileStatus)}
              className={`text-xs border-0 bg-transparent cursor-pointer font-medium ${
                STATUS_OPTIONS.find((s) => s.value === effectiveStatus)?.color ?? ''
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )
        },
      }),
      col.accessor('relative_path', {
        header: 'Path',
        size: 600,
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-gray-700 truncate block">{getValue()}</span>
        ),
      }),
      col.accessor('size_bytes', {
        header: 'Size',
        size: 90,
        cell: ({ getValue }) => (
          <span className="text-xs text-gray-500">{formatBytes(getValue())}</span>
        ),
      }),
      col.accessor('duplicate_group_id', {
        header: 'Dup',
        size: 40,
        cell: ({ getValue }) =>
          getValue() ? <span className="text-xs text-yellow-600">●</span> : null,
      }),
    ],
    [localStatuses]
  )

  const items = data?.items ?? []

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  })

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link to={`/devices/${deviceId}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← {device?.name ?? 'Device'}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-900">File Browser</span>
        <span className="text-xs text-gray-400 ml-1">{total.toLocaleString()} files</span>
        <div className="ml-auto flex items-center gap-2">
          {pendingUpdates.current.size > 0 && (
            <span className="text-xs text-orange-600">{pendingUpdates.current.size} unsaved</span>
          )}
          <button
            onClick={flushUpdates}
            disabled={flushMutation.isPending}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              flushUpdates()
              navigate(`/devices/${deviceId}/duplicates`)
            }}
            className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-900"
          >
            Go to Duplicates →
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          placeholder="Search paths…"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as FileStatus | '')
            setPage(0)
          }}
          className="border border-gray-300 rounded px-2 py-1 text-xs"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            items.forEach((item) => setRowStatus(item.id, 'keep'))
          }}
          className="text-xs border border-green-300 text-green-700 px-2 py-1 rounded hover:bg-green-50"
        >
          Select All Keep
        </button>
        <button
          onClick={() => {
            items.forEach((item) => setRowStatus(item.id, 'discard'))
          }}
          className="text-xs border border-red-300 text-red-700 px-2 py-1 rounded hover:bg-red-50"
        >
          Select All Discard
        </button>
        {isFetching && <span className="text-xs text-gray-400">Loading…</span>}
      </div>

      {/* Table header */}
      <div className="bg-gray-50 border-b border-gray-200">
        {table.getHeaderGroups().map((hg) => (
          <div key={hg.id} className="flex px-4">
            {hg.headers.map((header) => (
              <div
                key={header.id}
                style={{ width: header.getSize() }}
                className="py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0"
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vRow) => {
            const row = table.getRowModel().rows[vRow.index]
            return (
              <div
                key={row.id}
                style={{
                  position: 'absolute',
                  top: vRow.start,
                  height: vRow.size,
                  width: '100%',
                }}
                className="flex items-center px-4 border-b border-gray-100 hover:bg-gray-50"
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="shrink-0 overflow-hidden"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-white border-t border-gray-200 px-6 py-2 flex items-center gap-3 text-xs text-gray-600">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40"
          >
            Next →
          </button>
          <span className="ml-auto text-gray-400">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
            {total.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}
