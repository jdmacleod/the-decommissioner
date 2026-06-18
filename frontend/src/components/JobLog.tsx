import { useEffect, useRef, useState } from 'react'
import { useJobStream } from '../lib/stream'

interface JobLogProps {
  jobId: number
  className?: string
  height?: string
}

export function JobLog({ jobId, className = '', height = '300px' }: JobLogProps) {
  const { lines, done, error } = useJobStream(jobId)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [elapsedStr, setElapsedStr] = useState('')
  const startTimeRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  // Reset auto-scroll and start time when jobId changes
  useEffect(() => {
    autoScrollRef.current = true
    startTimeRef.current = Date.now() // eslint-disable-line react-hooks/purity
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowScrollBtn(false) // Intentional reset on jobId change
    setElapsedStr('')
  }, [jobId])

  // Capture elapsed time when job completes
  useEffect(() => {
    if (!done) return
    const ms = Date.now() - startTimeRef.current
    const min = Math.floor(ms / 60000)
    const sec = Math.floor((ms % 60000) / 1000)
    setElapsedStr(min > 0 ? `${min}m ${sec}s` : `${sec}s`)
  }, [done])

  // Auto-scroll unless user has scrolled up
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    autoScrollRef.current = atBottom
    setShowScrollBtn(!atBottom)
  }

  return (
    <div className={`relative ${className}`}>
      {error && (
        <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Connection lost. The job may still be running — check the device status.
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-950 text-green-400 font-mono text-xs p-4 rounded overflow-y-auto leading-5"
        style={{ height }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {done && <div className="text-gray-500 mt-2">— Job complete · Done in {elapsedStr} —</div>}
        <div ref={bottomRef} />
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {done ? `Finished in ${elapsedStr}.` : error ? 'Stream disconnected.' : ''}
      </span>
      {showScrollBtn && (
        <button
          onClick={() => {
            autoScrollRef.current = true
            setShowScrollBtn(false)
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="absolute bottom-3 right-3 text-xs bg-gray-700 text-white px-2 py-1 rounded"
        >
          ↓ Scroll to bottom
        </button>
      )}
    </div>
  )
}
