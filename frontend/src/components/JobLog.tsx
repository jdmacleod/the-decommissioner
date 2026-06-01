import { useEffect, useRef, useState } from 'react'

interface JobLogProps {
  jobId: number
  className?: string
}

export function JobLog({ jobId, className = '' }: JobLogProps) {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  useEffect(() => {
    setLines([])
    setDone(false)
    autoScrollRef.current = true

    const es = new EventSource(`/api/jobs/${jobId}/stream`)

    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data])
    }

    es.addEventListener('done', () => {
      setDone(true)
      es.close()
    })

    es.onerror = () => {
      es.close()
    }

    return () => es.close()
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
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-950 text-green-400 font-mono text-xs p-4 rounded overflow-y-auto h-64 leading-5"
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {done && <div className="text-gray-500 mt-2">— Job complete —</div>}
        <div ref={bottomRef} />
      </div>
      {!autoScrollRef.current && (
        <button
          onClick={() => {
            autoScrollRef.current = true
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
