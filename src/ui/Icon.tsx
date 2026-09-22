/**
 * The console's icon set. Hand-drawn geometric paths on a 24x24 grid, stroked with
 * currentColor so every icon inherits the colour of the thing it labels. Inline on
 * purpose: no icon dependency to license, audit, or ship.
 */
export type IconName =
  | 'clock'
  | 'alert'
  | 'check'
  | 'x'
  | 'ban'
  | 'pending'
  | 'file'
  | 'shield'
  | 'play'
  | 'copy'
  | 'mic'
  | 'user'
  | 'list'
  | 'radio'
  | 'arrowRight';

const PATHS: Record<IconName, React.ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2L15.6 14" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2 21 19.2H3L12 4.2z" />
      <path d="M12 10v4" />
      <path d="M12 16.6v.2" />
    </>
  ),
  check: <path d="M5 12.8 9.2 17 19 7" />,
  x: (
    <>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.6 6.6l10.8 10.8" />
    </>
  ),
  pending: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l5 5v12.2a.8.8 0 0 1-.8.8H7.8a.8.8 0 0 1-.8-.8V3.8A.8.8 0 0 1 7.8 3z" />
      <path d="M14 3v5h5" />
    </>
  ),
  shield: <path d="M12 3l8 3v5.6c0 4.9-3.3 8.2-8 9.4-4.7-1.2-8-4.5-8-9.4V6l8-3z" />,
  play: <path d="M9 5.8 19 12 9 18.2z" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.6" />
      <path d="M15 5.5H5.6A1.6 1.6 0 0 0 4 7.1v9.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M5 20.2a7.2 7.2 0 0 1 14 0" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.6 6.5h.2M4.6 12h.2M4.6 17.5h.2" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="8" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4.5 12h14" />
      <path d="M13.2 6.5 18.8 12l-5.6 5.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `w-icon ${className}` : 'w-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
