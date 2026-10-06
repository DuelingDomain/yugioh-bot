/** The Dueling Domain mark: two cards and a gold diamond (board sprite `i-mark`). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="4.2" y="5.2" width="11.6" height="17" rx="2" transform="rotate(-12 10 13.7)" fill="#0e1729" stroke="#b59963" strokeOpacity=".8" strokeWidth="1.2" />
      <rect x="11.2" y="5.4" width="11.6" height="17" rx="2" transform="rotate(9 17 13.9)" fill="#5733d1" stroke="#c6b6ff" strokeOpacity=".75" strokeWidth="1.2" />
      <path d="M17 10.1 19.9 13.9 17 17.7 14.1 13.9Z" fill="#f4d690" />
    </svg>
  );
}
