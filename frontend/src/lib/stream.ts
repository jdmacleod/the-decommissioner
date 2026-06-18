import { useEffect, useState } from 'react'

export interface ProgressData {
  percent_done?: number
  percent?: number
  files_done?: number
  total_files?: number
  bytes_done?: number
  total_bytes?: number
  eta_seconds?: number | null
}

export interface JobStreamState {
  lines: string[]
  done: boolean
  error: boolean
  progress: ProgressData | null
}

/**
 * useJobStream — subscribe to a job's SSE log stream.
 *
 * Returns the accumulated log lines, a `done` flag (server sent the "done"
 * event), an `error` flag (EventSource closed with an error), and the latest
 * `progress` data from PROGRESS sentinel events. Resets automatically when
 * `jobId` changes. Pass `null` to skip subscribing.
 */
export function useJobStream(jobId: number | null): JobStreamState {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState(false)
  const [progress, setProgress] = useState<ProgressData | null>(null)

  useEffect(() => {
    if (jobId === null) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines([]) // Intentional reset when jobId changes
    setDone(false)
    setError(false)
    setProgress(null)

    const es = new EventSource(`/api/jobs/${jobId}/stream`)

    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data])
    }

    es.addEventListener('done', () => {
      setDone(true)
      es.close()
    })

    es.addEventListener('progress', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ProgressData
        setProgress(data)
      } catch {
        // malformed progress — ignore
      }
    })

    es.onerror = () => {
      setError(true)
      es.close()
    }

    return () => es.close()
  }, [jobId])

  return { lines, done, error, progress }
}
