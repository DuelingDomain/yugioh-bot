// The two custom symbols the sign-in board draws.

export function BrandMark({ className = "ns-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="4.2" y="5.2" width="11.6" height="17" rx="2" transform="rotate(-12 10 13.7)" fill="#0e1729" stroke="#b59963" strokeOpacity=".8" strokeWidth="1.2" />
      <rect x="11.2" y="5.4" width="11.6" height="17" rx="2" transform="rotate(9 17 13.9)" fill="#5733d1" stroke="#c6b6ff" strokeOpacity=".75" strokeWidth="1.2" />
      <path d="M17 10.1 19.9 13.9 17 17.7 14.1 13.9Z" fill="#f4d690" />
    </svg>
  );
}

export function DiscordIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        stroke="none"
        d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4l-.2.4c1.55.38 2.27.93 3 1.57a13.9 13.9 0 0 0-11.8 0c.73-.64 1.55-1.2 3-1.57L8.9 4a16.6 16.6 0 0 0-4.17 1.33C2.1 9.27 1.38 13.1 1.74 16.9a16.8 16.8 0 0 0 5.1 2.6l1.1-1.6c-.6-.22-1.18-.5-1.72-.83l.42-.33a11.9 11.9 0 0 0 10.72 0l.42.33c-.54.33-1.12.6-1.72.83l1.1 1.6a16.7 16.7 0 0 0 5.1-2.6c.43-4.4-.73-8.2-3-11.57ZM8.68 14.6c-1 0-1.83-.93-1.83-2.07s.8-2.07 1.83-2.07 1.85.94 1.83 2.07c0 1.14-.8 2.07-1.83 2.07Zm6.64 0c-1 0-1.83-.93-1.83-2.07s.8-2.07 1.83-2.07 1.85.94 1.83 2.07c0 1.14-.8 2.07-1.83 2.07Z"
      />
    </svg>
  );
}
