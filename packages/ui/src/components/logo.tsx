import type { ReactElement } from 'react';

/**
 * The Mio mark (S5, docs/design/design-system.md): two tilted overlapping
 * circles - light low-left, dark high-right - at fixed geometry. Never
 * rotated horizontal; below 24px use the favicon variant with enlarged
 * radii and no wordmark.
 */
export function MioMark({
  size = 44,
  onDark = false,
  className,
}: {
  size?: number;
  onDark?: boolean;
  className?: string;
}): ReactElement {
  const fill = onDark ? '#7FB5AE' : 'var(--color-teal, #115E59)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
      {...(className !== undefined ? { className } : {})}
    >
      <circle cx="16" cy="25" r="11" fill={fill} opacity="0.14" />
      <circle cx="25" cy="20" r="11" fill={fill} opacity="0.30" />
    </svg>
  );
}

/** Full lockup - sign-in screens and emails. */
export function MioLockup({
  markSize = 44,
  onDark = false,
  className,
}: {
  markSize?: number;
  onDark?: boolean;
  className?: string;
}): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className ?? ''}`.trim()}
      role="img"
      aria-label="Mio"
    >
      <MioMark size={markSize} onDark={onDark} />
      <span
        aria-hidden="true"
        className="font-display italic leading-none"
        style={{
          fontSize: markSize * 0.75,
          color: onDark ? '#7FB5AE' : 'var(--color-ink, #221F1A)',
          fontOpticalSizing: 'auto',
        }}
      >
        mio
      </span>
    </span>
  );
}
