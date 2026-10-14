export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M2 17H24" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M5 17C9 17 7 7 12 7H16C20 7 18 17 22 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle cx="12" cy="7" r="2.6" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="7" r="2.6" fill="currentColor" />
    </svg>
  );
}
