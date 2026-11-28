export function AppIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
    >
      <defs>
        <linearGradient id="ai-code" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#dcdfe9" />
          <stop offset="100%" stopColor="#cdd1e2" />
        </linearGradient>
        <linearGradient id="ai-b1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4081" />
          <stop offset="100%" stopColor="#e91e63" />
        </linearGradient>
        <linearGradient id="ai-b2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffeb3b" />
          <stop offset="100%" stopColor="#fdd835" />
        </linearGradient>
        <linearGradient id="ai-b3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#29b6f6" />
          <stop offset="100%" stopColor="#03a9f4" />
        </linearGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width="512"
        height="512"
        rx="90"
        ry="90"
        fill="#1a1a2e"
      />
      <polyline
        points="180,186 100,256 180,326"
        fill="none"
        stroke="url(#ai-code)"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="332,186 412,256 332,326"
        fill="none"
        stroke="url(#ai-code)"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="206" cy="256" r="30" fill="url(#ai-b1)" opacity="0.95" />
      <circle cx="256" cy="256" r="36" fill="url(#ai-b2)" opacity="0.95" />
      <circle cx="306" cy="256" r="30" fill="url(#ai-b3)" opacity="0.95" />
    </svg>
  )
}
