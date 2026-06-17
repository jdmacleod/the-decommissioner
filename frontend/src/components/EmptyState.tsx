interface EmptyStateProps {
  message: string
  action?: { label: string; onClick?: () => void; href?: string }
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="text-center py-10 text-gray-400">
      <svg
        className="mx-auto mb-3 w-8 h-8 text-gray-300"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9h.01M15 9h.01M9 15h6" strokeLinecap="round" />
      </svg>
      <p className="text-sm">{message}</p>
      {action && action.href && (
        <a href={action.href} className="text-blue-500 text-sm mt-2 block hover:underline">
          {action.label}
        </a>
      )}
      {action && action.onClick && (
        <button
          onClick={action.onClick}
          className="text-blue-500 text-sm mt-2 block mx-auto hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
