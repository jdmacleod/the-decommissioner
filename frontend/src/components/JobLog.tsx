import { useEffect, useRef, useState } from 'react'
import { useJobStream } from '../lib/stream'

interface JobLogProps {
  jobId: number
  className?: string
  height?: string
}

export function JobLog({ jobId, className = '', height = '300px' }: JobLogProps) {
  const { lines, done } = useJobStream(jobId)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  // Reset auto-scroll when jobId changes
  useEffect(() => {
    autoScrollRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowScrollBtn(false) // Intentional reset on jobId change
  }, [jobId])

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
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-950 text-green-400 font-mono text-xs p-4 rounded overflow-y-auto leading-5"
        style={{ height }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {done && <div className="text-gray-500 mt-2">— Job complete —</div>}
        <div ref={bottomRef} />
      </div>
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
