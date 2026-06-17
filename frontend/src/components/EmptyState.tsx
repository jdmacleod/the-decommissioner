interface EmptyStateProps {
  message: string
  action?: { label: string; onClick?: () => void; href?: string }
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 mb-5 rounded-2xl bg-gray-100 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h.01M15 9h.01M9 15h6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700 mb-1">{message}</p>
      {action?.href && (
        <a href={action.href} className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
          {action.label}
        </a>
      )}
      {action?.onClick && (
        <button
          onClick={action.onClick}
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
