import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-lg p-6 shadow-sm">
            <h2 className="text-red-700 font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-600 mb-4">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm bg-red-50 text-red-700 border border-red-200 rounded px-3 py-1.5 hover:bg-red-100"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
