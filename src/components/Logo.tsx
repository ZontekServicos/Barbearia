export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M20 7.5l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="currentColor" />
      <text
        x="20"
        y="27"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="15"
        fill="currentColor"
      >
        EC
      </text>
    </svg>
  )
}
