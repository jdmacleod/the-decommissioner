import { useEffect, useState } from 'react'

export interface JobStreamState {
  lines: string[]
  done: boolean
  error: boolean
}

/**
 * useJobStream — subscribe to a job's SSE log stream.
 *
 * Returns the accumulated log lines, a `done` flag (server sent the "done"
 * event), and an `error` flag (EventSource closed with an error). Resets
 * automatically when `jobId` changes. Pass `null` to skip subscribing.
 */
export function useJobStream(jobId: number | null): JobStreamState {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (jobId === null) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines([]) // Intentional reset when jobId changes
    setDone(false)
    setError(false)

    const es = new EventSource(`/api/jobs/${jobId}/stream`)

    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data])
    }

    es.addEventListener('done', () => {
      setDone(true)
      es.close()
    })

    es.onerror = () => {
      setError(true)
      es.close()
    }

    return () => es.close()
  }, [jobId])

  return { lines, done, error }
}
