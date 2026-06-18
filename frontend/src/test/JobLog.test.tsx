import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JobLog } from '../components/JobLog'

type ESListener = (e: MessageEvent) => void
type DoneListener = () => void
type ProgressListener = (e: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ESListener | null = null
  onerror: (() => void) | null = null
  private doneListeners: DoneListener[] = []
  private progressListeners: ProgressListener[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: DoneListener | ProgressListener) {
    if (type === 'done') this.doneListeners.push(cb as DoneListener)
    if (type === 'progress') this.progressListeners.push(cb as ProgressListener)
  }

  fireDone() {
    this.doneListeners.forEach((cb) => cb())
  }

  fireProgress(data: object) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.progressListeners.forEach((cb) => cb(event))
  }

  close() {}
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('JobLog', () => {
  it('connects to the correct SSE endpoint', async () => {
    render(<JobLog jobId={42} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    expect(MockEventSource.instances[0].url).toBe('/api/jobs/42/stream')
  })

  it('renders log lines as they arrive', async () => {
    render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    const es = MockEventSource.instances[0]
    await act(async () => {
      es.onmessage?.({ data: 'log line 1' } as MessageEvent)
      es.onmessage?.({ data: 'log line 2' } as MessageEvent)
    })
    expect(screen.getByText('log line 1')).toBeInTheDocument()
    expect(screen.getByText('log line 2')).toBeInTheDocument()
  })

  it('shows "Job complete" when done event fires', async () => {
    render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    await act(async () => {
      MockEventSource.instances[0].fireDone()
    })
    expect(screen.getByText(/Job complete/)).toBeInTheDocument()
  })

  it('resets lines when jobId changes', async () => {
    const { rerender } = render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    await act(async () => {
      MockEventSource.instances[0].onmessage?.({ data: 'old line' } as MessageEvent)
    })
    expect(screen.getByText('old line')).toBeInTheDocument()

    rerender(<JobLog jobId={2} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(2))
    expect(screen.queryByText('old line')).not.toBeInTheDocument()
  })

  it('accepts a custom className', async () => {
    const { container } = render(<JobLog jobId={1} className="my-class" />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    expect(container.firstChild).toHaveClass('my-class')
  })

  it('renders the dark terminal container', async () => {
    render(<JobLog jobId={7} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    expect(document.querySelector('.bg-gray-950')).toBeInTheDocument()
  })

  it('handles onerror by closing the connection', async () => {
    render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    // Calling onerror should not throw
    await act(async () => {
      MockEventSource.instances[0].onerror?.()
    })
    expect(screen.queryByText(/Job complete/)).not.toBeInTheDocument()
  })

  it('shows error banner when connection is lost', async () => {
    render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    await act(async () => {
      MockEventSource.instances[0].onerror?.()
    })
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument()
  })

  it('shows elapsed time in completion footer', async () => {
    render(<JobLog jobId={1} />)
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    await act(async () => {
      MockEventSource.instances[0].fireDone()
    })
    expect(screen.getByText(/done in/i)).toBeInTheDocument()
  })
})
