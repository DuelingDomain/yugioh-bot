/** The Dueling Domain mark: a gold D with a card in its slot. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M6 4H18.5L26 11.5V20.5L18.5 28H6Z M12 9H19.5A1.5 1.5 0 0 1 21 10.5V21.5A1.5 1.5 0 0 1 19.5 23H12A1.5 1.5 0 0 1 10.5 21.5V10.5A1.5 1.5 0 0 1 12 9Z" />
      <path fill="currentColor" d="M15.75 12.6L19.15 16L15.75 19.4L12.35 16Z" />
    </svg>
  );
}
