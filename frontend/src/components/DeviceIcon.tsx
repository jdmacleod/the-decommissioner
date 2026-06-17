interface DeviceIconProps {
  type: string
  className?: string
}

export function DeviceIcon({ type, className = 'w-5 h-5' }: DeviceIconProps) {
  const cls = `${className} text-gray-500`
  switch (type) {
    case 'mac':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M1 20h22M8 16l-1 4M16 16l1 4" />
        </svg>
      )
    case 'linux':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      )
    case 'iphone':
    case 'ipad':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <circle cx="12" cy="18" r="0.75" fill="currentColor" />
          <path d="M10 5h4" strokeLinecap="round" />
        </svg>
      )
    case 'usb_drive':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="8" y="6" width="8" height="10" rx="1" />
          <path d="M12 16v4M9 20h6M10 9h1M13 9h1M10 12h4" strokeLinecap="round" />
        </svg>
      )
    case 'hard_drive':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="7" width="20" height="10" rx="2" />
          <circle cx="17" cy="12" r="1.5" />
          <path d="M6 12h6" strokeLinecap="round" />
        </svg>
      )
    case 'network_volume':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 7h18M3 12h18M3 17h18" strokeLinecap="round" />
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <circle cx="19" cy="17" r="1" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 7h6M9 11h6M9 15h4" strokeLinecap="round" />
        </svg>
      )
  }
}
